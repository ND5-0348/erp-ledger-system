from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Callable

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text

from .config import settings
from .db import db

Permission = str
ALL_PERMISSIONS = {
    "order_entry",
    "order_edit",
    "order_delete",
    "purchase_entry",
    "purchase_edit",
    "purchase_delete",
    "sales_entry",
    "sales_edit",
    "sales_delete",
    "system_admin",
}

ROLE_PERMISSIONS: dict[str, set[Permission]] = {
    "admin": set(ALL_PERMISSIONS),
    "order_entry": {"order_entry"},
    "purchase_entry": {"purchase_entry"},
    "sales_entry": {"sales_entry"},
    "viewer": set(),
}

ROLE_LABELS: dict[str, str] = {
    "admin": "管理员",
    "order_entry": "订单录入员",
    "purchase_entry": "采购录入员",
    "sales_entry": "销售录入员",
    "viewer": "查看员",
}

security = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    id: int
    username: str
    display_name: str
    role_code: str
    permissions: list[str]
    department_scope: list[str]
    department_can_view: bool
    department_can_entry: bool


def has_permission(role_code: str, permission: Permission, permissions: list[str] | set[str] | None = None) -> bool:
    granted = set(permissions) if permissions is not None else ROLE_PERMISSIONS.get(role_code, set())
    return permission in granted


def normalize_permissions(role_code: str, permissions: list[str] | None) -> list[str]:
    if permissions is None:
        return sorted(ROLE_PERMISSIONS.get(role_code, set()))
    return sorted({permission for permission in permissions if permission in ALL_PERMISSIONS})


def parse_json_list(value: object) -> list[str]:
    if value in (None, ""):
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed if str(item).strip()]


def encode_json_list(values: list[str]) -> str:
    clean_values = [value.strip() for value in values if value.strip()]
    return json.dumps(clean_values, ensure_ascii=False)


def apply_department_scope(
    conditions: list[str],
    params: dict[str, object],
    user: CurrentUser,
    column_name: str = "department",
) -> None:
    if has_permission(user.role_code, "system_admin", user.permissions):
        return
    if not user.department_scope:
        return
    if not user.department_can_view:
        conditions.append("1=0")
        return
    placeholders: list[str] = []
    for index, department in enumerate(user.department_scope):
        key = f"scope_department_{index}"
        placeholders.append(f":{key}")
        params[key] = department
    conditions.append(f"{column_name} IN ({', '.join(placeholders)})")


def can_access_department(user: CurrentUser, department: str | None, require_entry: bool = False) -> bool:
    if has_permission(user.role_code, "system_admin", user.permissions):
        return True
    if not user.department_scope:
        return True
    if require_entry and not user.department_can_entry:
        return False
    if not require_entry and not user.department_can_view:
        return False
    return bool(department and department in user.department_scope)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256$120000${salt}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations, salt, expected = stored_hash.split("$", 3)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), int(iterations))
    return hmac.compare_digest(digest.hex(), expected)


def create_access_token(user: CurrentUser, expires_in_seconds: int = 12 * 60 * 60) -> str:
    payload = {
        "sub": user.username,
        "role": user.role_code,
        "exp": int(time.time()) + expires_in_seconds,
    }
    payload_bytes = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    payload_b64 = _b64encode(payload_bytes)
    signature = _sign(payload_b64.encode("ascii"))
    return f"{payload_b64}.{signature}"


def decode_access_token(token: str) -> dict:
    try:
        payload_b64, signature = token.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    if not hmac.compare_digest(_sign(payload_b64.encode("ascii")), signature):
        raise HTTPException(status_code=401, detail="Invalid token")
    try:
        payload = json.loads(_b64decode(payload_b64))
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(status_code=401, detail="Token expired")
    return payload


def ensure_default_admin() -> None:
    with db() as conn:
        _ensure_user_permission_columns(conn)
        existing = conn.execute(
            text("SELECT password_hash FROM erp_user WHERE username = 'admin'")
        ).mappings().first()
        if existing:
            conn.execute(
                text(
                    """
                    UPDATE erp_user
                    SET role_code = 'admin',
                        permissions_json = :permissions_json,
                        department_scope_json = :department_scope_json,
                        department_can_view = 1,
                        department_can_entry = 1,
                        is_active = 1
                    WHERE username = 'admin'
                """
                ),
                {
                    "permissions_json": encode_json_list(sorted(ALL_PERMISSIONS)),
                    "department_scope_json": encode_json_list([]),
                },
            )
            return
        conn.execute(
            text(
                """
                INSERT INTO erp_user
                  (username, password_hash, display_name, role_code, permissions_json,
                   department_scope_json, department_can_view, department_can_entry, is_active)
                VALUES
                  (:username, :password_hash, :display_name, :role_code, :permissions_json,
                   :department_scope_json, 1, 1, 1)
                """
            ),
            {
                "username": "admin",
                "password_hash": hash_password(settings.default_admin_password),
                "display_name": "系统管理员",
                "role_code": "admin",
                "permissions_json": encode_json_list(sorted(ALL_PERMISSIONS)),
                "department_scope_json": encode_json_list([]),
            },
        )


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> CurrentUser:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_access_token(credentials.credentials)
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token")
    with db() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, username, display_name, role_code, permissions_json,
                       department_scope_json, department_can_view, department_can_entry
                FROM erp_user
                WHERE username = :username AND is_active = 1
                """
            ),
            {"username": username},
        ).mappings().first()
    if row is None:
        raise HTTPException(status_code=401, detail="User disabled or not found")
    role_code = str(row["role_code"])
    permissions = normalize_permissions(role_code, parse_json_list(row["permissions_json"]) if row["permissions_json"] else None)
    return CurrentUser(
        id=int(row["id"]),
        username=str(row["username"]),
        display_name=str(row["display_name"]),
        role_code=role_code,
        permissions=permissions,
        department_scope=parse_json_list(row["department_scope_json"]),
        department_can_view=bool(row["department_can_view"]),
        department_can_entry=bool(row["department_can_entry"]),
    )


def require_permission(permission: Permission) -> Callable[[CurrentUser], CurrentUser]:
    def dependency(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not has_permission(user.role_code, permission, user.permissions):
            raise HTTPException(status_code=403, detail="Permission denied")
        return user

    return dependency


def current_user_payload(user: CurrentUser) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "role_code": user.role_code,
        "role_label": ROLE_LABELS.get(user.role_code, user.role_code),
        "permissions": user.permissions,
        "department_scope": user.department_scope,
        "department_can_view": user.department_can_view,
        "department_can_entry": user.department_can_entry,
    }


def _ensure_user_permission_columns(conn) -> None:
    columns = {
        row["COLUMN_NAME"]
        for row in conn.execute(
            text(
                """
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'erp_user'
                """
            )
        ).mappings()
    }
    column_sql = {
        "permissions_json": "ALTER TABLE erp_user ADD COLUMN permissions_json JSON NULL AFTER role_code",
        "department_scope_json": "ALTER TABLE erp_user ADD COLUMN department_scope_json JSON NULL AFTER permissions_json",
        "department_can_view": "ALTER TABLE erp_user ADD COLUMN department_can_view TINYINT(1) NOT NULL DEFAULT 0 AFTER department_scope_json",
        "department_can_entry": "ALTER TABLE erp_user ADD COLUMN department_can_entry TINYINT(1) NOT NULL DEFAULT 0 AFTER department_can_view",
    }
    for column, ddl in column_sql.items():
        if column not in columns:
            conn.execute(text(ddl))


def _sign(value: bytes) -> str:
    signature = hmac.new(settings.auth_secret.encode("utf-8"), value, hashlib.sha256).digest()
    return _b64encode(signature)


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)
