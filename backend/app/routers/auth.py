from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..auth import (
    ROLE_LABELS,
    ROLE_PERMISSIONS,
    CurrentUser,
    encode_json_list,
    create_access_token,
    current_user_payload,
    get_current_user,
    hash_password,
    normalize_permissions,
    parse_json_list,
    require_permission,
    verify_password,
)
from ..db import db
from ..audit import write_operation_log
from ..serializers import clean_rows

router = APIRouter(prefix="/api/auth", tags=["auth"])

PERMISSION_LABELS_CN = {
    "order_entry": "基本信息录入",
    "order_edit": "基本信息修改",
    "order_delete": "基本信息删除",
    "purchase_entry": "采购信息录入",
    "purchase_edit": "采购信息修改",
    "purchase_delete": "采购信息删除",
    "sales_entry": "销售信息录入",
    "sales_edit": "销售信息修改",
    "sales_delete": "销售信息删除",
    "system_admin": "系统管理",
}


def _permission_labels(permissions: list[str]) -> list[str]:
    return [PERMISSION_LABELS_CN.get(permission, permission) for permission in permissions]


def _user_audit_snapshot(row, *, permissions: list[str] | None = None, department_scope: list[str] | None = None) -> dict:
    role_code = str(row["role_code"])
    normalized_permissions = permissions
    if normalized_permissions is None:
        normalized_permissions = normalize_permissions(
            role_code,
            parse_json_list(row["permissions_json"]) if row.get("permissions_json") else None,
        )
    scope = department_scope
    if scope is None:
        scope = parse_json_list(row["department_scope_json"]) if row.get("department_scope_json") else []
    return {
        "id": int(row["id"]) if row.get("id") is not None else None,
        "username": str(row["username"]),
        "display_name": str(row["display_name"]),
        "role_name": ROLE_LABELS.get(role_code, role_code),
        "permissions": _permission_labels(normalized_permissions),
        "department_scope": scope or ["全部部门"],
        "department_can_view": bool(row.get("department_can_view", False)),
        "department_can_entry": bool(row.get("department_can_entry", False)),
        "account_status": "启用" if bool(row.get("is_active", True)) else "停用",
    }


class LoginRequest(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    display_name: str = Field(min_length=1, max_length=64)
    role_code: str
    permissions: list[str] = Field(default_factory=list)
    department_scope: list[str] = Field(default_factory=list)
    department_can_view: bool = False
    department_can_entry: bool = False


class UserPermissionUpdate(BaseModel):
    role_code: str
    permissions: list[str] = Field(default_factory=list)
    department_scope: list[str] = Field(default_factory=list)
    department_can_view: bool = False
    department_can_entry: bool = False


class UserPasswordReset(BaseModel):
    password: str = Field(min_length=6, max_length=128)


def _validate_department_permissions(
    department_scope: list[str],
    department_can_view: bool,
    department_can_entry: bool,
) -> None:
    if department_can_entry and not department_can_view:
        raise HTTPException(
            status_code=400,
            detail="勾选录入权限时必须同时勾选查看权限，用于核对录入数据是否有误",
        )
    if department_scope and not (department_can_view or department_can_entry):
        raise HTTPException(status_code=400, detail="选择部门后至少需要勾选查看或录入权限")


@router.post("/login")
def login(payload: LoginRequest) -> dict:
    with db() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, username, password_hash, display_name, role_code, permissions_json,
                       department_scope_json, department_can_view, department_can_entry, is_active
                FROM erp_user
                WHERE username = :username
                """
            ),
            {"username": payload.username},
        ).mappings().first()
        if row is None or not row["is_active"] or not verify_password(payload.password, str(row["password_hash"])):
            raise HTTPException(status_code=401, detail="用户名或密码错误")
        user = CurrentUser(
            id=int(row["id"]),
            username=str(row["username"]),
            display_name=str(row["display_name"]),
            role_code=str(row["role_code"]),
            permissions=normalize_permissions(
                str(row["role_code"]),
                parse_json_list(row["permissions_json"]) if row["permissions_json"] else None,
            ),
            department_scope=parse_json_list(row["department_scope_json"]),
            department_can_view=bool(row["department_can_view"]),
            department_can_entry=bool(row["department_can_entry"]),
        )
        conn.execute(text("UPDATE erp_user SET last_login_at = NOW() WHERE id = :id"), {"id": user.id})
    return {"access_token": create_access_token(user), "token_type": "bearer", "user": current_user_payload(user)}


@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user)) -> dict:
    return {"user": current_user_payload(user)}


@router.get("/roles")
def roles(user: CurrentUser = Depends(get_current_user)) -> dict:
    return {
        "items": [
            {
                "role_code": role_code,
                "role_label": ROLE_LABELS[role_code],
                "permissions": sorted(permissions),
            }
            for role_code, permissions in ROLE_PERMISSIONS.items()
        ]
    }


def _list_users(status: str) -> dict:
    is_active = 1 if status == "active" else 0
    with db() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, username, display_name, role_code, permissions_json,
                       department_scope_json, department_can_view, department_can_entry,
                       is_active, last_login_at, created_at, updated_at
                FROM erp_user
                WHERE is_active = :is_active
                ORDER BY id
                """
            ),
            {"is_active": is_active},
        ).mappings().all()
    return {"items": clean_rows(rows)}


@router.get("/users")
def list_users(
    status: str = Query(default="active", pattern="^(active|inactive)$"),
    _: CurrentUser = Depends(require_permission("system_admin")),
) -> dict:
    return _list_users(status)


@router.post("/users")
def create_user(payload: UserCreate, admin: CurrentUser = Depends(require_permission("system_admin"))) -> dict:
    if payload.role_code not in ROLE_PERMISSIONS:
        raise HTTPException(status_code=400, detail="无效的角色")
    permissions = normalize_permissions(payload.role_code, payload.permissions)
    department_scope = [department.strip() for department in payload.department_scope if department.strip()]
    _validate_department_permissions(
        department_scope,
        payload.department_can_view,
        payload.department_can_entry,
    )
    with db() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM erp_user WHERE username = :username"),
            {"username": payload.username},
        ).scalar()
        if exists:
            raise HTTPException(status_code=409, detail="账号已存在")
        conn.execute(
            text(
                """
                INSERT INTO erp_user
                  (username, password_hash, display_name, role_code, permissions_json,
                   department_scope_json, department_can_view, department_can_entry, is_active)
                VALUES
                  (:username, :password_hash, :display_name, :role_code, :permissions_json,
                   :department_scope_json, :department_can_view, :department_can_entry, 1)
                """
            ),
            {
                "username": payload.username,
                "password_hash": hash_password(payload.password),
                "display_name": payload.display_name,
                "role_code": payload.role_code,
                "permissions_json": encode_json_list(permissions),
                "department_scope_json": encode_json_list(department_scope),
                "department_can_view": int(payload.department_can_view),
                "department_can_entry": int(payload.department_can_entry),
            },
        )
        created = conn.execute(
            text(
                """
                SELECT id, username, display_name, role_code, permissions_json, department_scope_json,
                       department_can_view, department_can_entry, is_active
                FROM erp_user WHERE username = :username
                """
            ),
            {"username": payload.username},
        ).mappings().one()
        write_operation_log(
            conn,
            admin,
            "账号管理",
            "create_user",
            f"创建账号“{payload.username}”，角色为“{ROLE_LABELS.get(payload.role_code, payload.role_code)}”",
            after=_user_audit_snapshot(created, permissions=permissions, department_scope=department_scope),
        )
    return _list_users("active")


@router.put("/users/{user_id}")
def update_user_permissions(
    user_id: int,
    payload: UserPermissionUpdate,
    admin: CurrentUser = Depends(require_permission("system_admin")),
) -> dict:
    if payload.role_code not in ROLE_PERMISSIONS:
        raise HTTPException(status_code=400, detail="无效的角色")
    permissions = normalize_permissions(payload.role_code, payload.permissions)
    department_scope = [department.strip() for department in payload.department_scope if department.strip()]
    _validate_department_permissions(
        department_scope,
        payload.department_can_view,
        payload.department_can_entry,
    )
    with db() as conn:
        target = conn.execute(
            text(
                """
                SELECT id, username, display_name, role_code, permissions_json, department_scope_json,
                       department_can_view, department_can_entry, is_active
                FROM erp_user
                WHERE id = :user_id
                """
            ),
            {"user_id": user_id},
        ).mappings().first()
        if target is None or not target["is_active"]:
            raise HTTPException(status_code=404, detail="账号不存在")
        before = _user_audit_snapshot(target)
        if "system_admin" not in permissions:
            admin_rows = conn.execute(
                text(
                    """
                    SELECT id, role_code, permissions_json
                    FROM erp_user
                    WHERE is_active = 1
                    """
                )
            ).mappings().all()
            active_admin_count = sum(
                1
                for row in admin_rows
                if int(row["id"]) != user_id
                and "system_admin"
                in normalize_permissions(
                    str(row["role_code"]),
                    parse_json_list(row["permissions_json"]) if row["permissions_json"] else None,
                )
            )
            if active_admin_count <= 0:
                raise HTTPException(status_code=400, detail="至少保留一个系统管理员账号")
        conn.execute(
            text(
                """
                UPDATE erp_user
                SET role_code = :role_code,
                    permissions_json = :permissions_json,
                    department_scope_json = :department_scope_json,
                    department_can_view = :department_can_view,
                    department_can_entry = :department_can_entry,
                    updated_at = NOW()
                WHERE id = :user_id
                """
            ),
            {
                "user_id": user_id,
                "role_code": payload.role_code,
                "permissions_json": encode_json_list(permissions),
                "department_scope_json": encode_json_list(department_scope),
                "department_can_view": int(payload.department_can_view),
                "department_can_entry": int(payload.department_can_entry),
            },
        )
        after = {
            **before,
            "role_name": ROLE_LABELS.get(payload.role_code, payload.role_code),
            "permissions": _permission_labels(permissions),
            "department_scope": department_scope or ["全部部门"],
            "department_can_view": payload.department_can_view,
            "department_can_entry": payload.department_can_entry,
        }
        write_operation_log(
            conn,
            admin,
            "账号管理",
            "update_user_permissions",
            f"修改账号“{target['username']}”的角色和权限",
            before=before,
            after=after,
        )
    return _list_users("active")


@router.post("/users/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    payload: UserPasswordReset,
    admin: CurrentUser = Depends(require_permission("system_admin")),
) -> dict:
    with db() as conn:
        target = conn.execute(
            text("SELECT id, username, is_active FROM erp_user WHERE id = :user_id"),
            {"user_id": user_id},
        ).mappings().first()
        if target is None:
            raise HTTPException(status_code=404, detail="账号不存在")
        if not target["is_active"]:
            raise HTTPException(status_code=400, detail="账号已停用，请先恢复账号再重置密码")
        conn.execute(
            text(
                """
                UPDATE erp_user
                SET password_hash = :password_hash,
                    updated_at = NOW()
                WHERE id = :user_id
                """
            ),
            {"user_id": user_id, "password_hash": hash_password(payload.password)},
        )
        write_operation_log(
            conn,
            admin,
            "账号管理",
            "reset_user_password",
            f"重置账号“{target['username']}”的密码",
        )
    return {"message": "密码重置成功"}


@router.delete("/users/{user_id}")
def deactivate_user(user_id: int, admin: CurrentUser = Depends(require_permission("system_admin"))) -> dict:
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除当前登录账号")
    with db() as conn:
        target = conn.execute(
            text(
                """
                SELECT id, username, display_name, role_code, permissions_json, department_scope_json,
                       department_can_view, department_can_entry, is_active
                FROM erp_user
                WHERE id = :user_id
                """
            ),
            {"user_id": user_id},
        ).mappings().first()
        if target is None or not target["is_active"]:
            raise HTTPException(status_code=404, detail="账号不存在")
        before = _user_audit_snapshot(target)

        target_permissions = normalize_permissions(
            str(target["role_code"]),
            parse_json_list(target["permissions_json"]) if target["permissions_json"] else None,
        )
        if "system_admin" in target_permissions:
            admin_rows = conn.execute(
                text(
                    """
                    SELECT role_code, permissions_json
                    FROM erp_user
                    WHERE is_active = 1
                    """
                )
            ).mappings().all()
            active_admin_count = sum(
                1
                for row in admin_rows
                if "system_admin"
                in normalize_permissions(
                    str(row["role_code"]),
                    parse_json_list(row["permissions_json"]) if row["permissions_json"] else None,
                )
            )
            if active_admin_count <= 1:
                raise HTTPException(status_code=400, detail="至少保留一个系统管理员账号")

        conn.execute(
            text("UPDATE erp_user SET is_active = 0, updated_at = NOW() WHERE id = :user_id"),
            {"user_id": user_id},
        )
        write_operation_log(
            conn,
            admin,
            "账号管理",
            "delete_user",
            f"停用账号“{target['username']}”",
            before=before,
            after={**before, "account_status": "停用"},
        )
    return _list_users("active")


@router.post("/users/{user_id}/restore")
def restore_user(
    user_id: int,
    admin: CurrentUser = Depends(require_permission("system_admin")),
) -> dict:
    with db() as conn:
        target = conn.execute(
            text(
                """
                SELECT id, username, display_name, role_code, permissions_json, department_scope_json,
                       department_can_view, department_can_entry, is_active
                FROM erp_user
                WHERE id = :user_id
                """
            ),
            {"user_id": user_id},
        ).mappings().first()
        if target is None:
            raise HTTPException(status_code=404, detail="账号不存在")
        if target["is_active"]:
            raise HTTPException(status_code=400, detail="账号当前已启用，无需恢复")
        before = _user_audit_snapshot(target)
        conn.execute(
            text("UPDATE erp_user SET is_active = 1, updated_at = NOW() WHERE id = :user_id"),
            {"user_id": user_id},
        )
        write_operation_log(
            conn,
            admin,
            "账号管理",
            "restore_user",
            f"恢复停用账号“{target['username']}”",
            before={**before, "account_status": "停用"},
            after={**before, "account_status": "启用"},
        )
    return _list_users("active")


@router.delete("/users/{user_id}/permanent")
def permanently_delete_user(
    user_id: int,
    admin: CurrentUser = Depends(require_permission("system_admin")),
) -> dict:
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除当前登录账号")
    with db() as conn:
        target = conn.execute(
            text(
                """
                SELECT id, username, display_name, role_code, permissions_json, department_scope_json,
                       department_can_view, department_can_entry, is_active
                FROM erp_user
                WHERE id = :user_id
                """
            ),
            {"user_id": user_id},
        ).mappings().first()
        if target is None:
            raise HTTPException(status_code=404, detail="账号不存在")
        if target["is_active"]:
            raise HTTPException(status_code=400, detail="请先停用账号，再执行永久删除")
        before = _user_audit_snapshot(target)
        conn.execute(
            text("UPDATE operation_log SET user_id = NULL WHERE user_id = :user_id"),
            {"user_id": user_id},
        )
        conn.execute(
            text("UPDATE backup_record SET created_by = NULL WHERE created_by = :user_id"),
            {"user_id": user_id},
        )
        conn.execute(
            text("UPDATE import_batch SET uploaded_by = NULL WHERE uploaded_by = :user_id"),
            {"user_id": user_id},
        )
        conn.execute(
            text("DELETE FROM erp_user WHERE id = :user_id"),
            {"user_id": user_id},
        )
        write_operation_log(
            conn,
            admin,
            "账号管理",
            "permanently_delete_user",
            f"永久删除停用账号“{target['username']}”",
            before=before,
        )
    return _list_users("inactive")
