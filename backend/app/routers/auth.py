from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
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
from ..serializers import clean_rows

router = APIRouter(prefix="/api/auth", tags=["auth"])


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


@router.get("/users")
def list_users(_: CurrentUser = Depends(require_permission("system_admin"))) -> dict:
    with db() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, username, display_name, role_code, permissions_json,
                       department_scope_json, department_can_view, department_can_entry,
                       is_active, last_login_at, created_at
                FROM erp_user
                WHERE is_active = 1
                ORDER BY id
                """
            )
        ).mappings().all()
    return {"items": clean_rows(rows)}


@router.post("/users")
def create_user(payload: UserCreate, admin: CurrentUser = Depends(require_permission("system_admin"))) -> dict:
    if payload.role_code not in ROLE_PERMISSIONS:
        raise HTTPException(status_code=400, detail="无效的角色")
    permissions = normalize_permissions(payload.role_code, payload.permissions)
    department_scope = [department.strip() for department in payload.department_scope if department.strip()]
    if department_scope and not (payload.department_can_view or payload.department_can_entry):
        raise HTTPException(status_code=400, detail="选择部门后至少需要勾选查看或录入权限")
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
        conn.execute(
            text(
                """
                INSERT INTO operation_log (user_id, user_name, module_name, action_name, detail, status)
                VALUES (:user_id, :user_name, '账号管理', 'create_user', :detail, 'success')
                """
            ),
            {
                "user_id": admin.id,
                "user_name": admin.display_name,
                "detail": f"创建账号 {payload.username}，权限 {','.join(permissions) or '无'}",
            },
        )
    return list_users(admin)


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
    if department_scope and not (payload.department_can_view or payload.department_can_entry):
        raise HTTPException(status_code=400, detail="选择部门后至少需要勾选查看或录入权限")
    with db() as conn:
        target = conn.execute(
            text(
                """
                SELECT id, username, display_name, role_code, permissions_json, is_active
                FROM erp_user
                WHERE id = :user_id
                """
            ),
            {"user_id": user_id},
        ).mappings().first()
        if target is None or not target["is_active"]:
            raise HTTPException(status_code=404, detail="账号不存在")
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
        conn.execute(
            text(
                """
                INSERT INTO operation_log (user_id, user_name, module_name, action_name, detail, status)
                VALUES (:user_id, :user_name, '账号管理', 'update_user_permissions', :detail, 'success')
                """
            ),
            {
                "user_id": admin.id,
                "user_name": admin.display_name,
                "detail": f"修改账号 {target['username']} 权限为 {','.join(permissions) or '无'}",
            },
        )
    return list_users(admin)


@router.delete("/users/{user_id}")
def delete_user(user_id: int, admin: CurrentUser = Depends(require_permission("system_admin"))) -> dict:
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除当前登录账号")
    with db() as conn:
        target = conn.execute(
            text(
                """
                SELECT id, username, display_name, role_code, permissions_json, is_active
                FROM erp_user
                WHERE id = :user_id
                """
            ),
            {"user_id": user_id},
        ).mappings().first()
        if target is None or not target["is_active"]:
            raise HTTPException(status_code=404, detail="账号不存在")

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
        conn.execute(
            text(
                """
                INSERT INTO operation_log (user_id, user_name, module_name, action_name, detail, status)
                VALUES (:user_id, :user_name, '账号管理', 'delete_user', :detail, 'success')
                """
            ),
            {
                "user_id": admin.id,
                "user_name": admin.display_name,
                "detail": f"删除账号 {target['username']}",
            },
        )
    return list_users(admin)
