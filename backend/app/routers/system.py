from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from ..auth import CurrentUser, get_current_user, require_permission
from ..backup import create_backup, restore_backup
from ..config import DOCS_DIR
from ..db import db
from ..importer import import_excel
from ..serializers import clean_rows
from ..write_guard import business_write

router = APIRouter(tags=["system"], dependencies=[Depends(get_current_user)])


@router.post("/api/import/excel")
def run_import(user: CurrentUser = Depends(require_permission("system_admin"))) -> dict:
    if not any(DOCS_DIR.glob("2026*.xlsx")):
        raise HTTPException(status_code=400, detail="docs 目录中未找到 2026*.xlsx 业务台账文件")
    try:
        with business_write() as conn:
            create_backup(conn, user, "pre_import")
    except HTTPException:
        # 写入忙（409）等已有语义的响应必须原样透出，不能被下面的兜底吞成 500。
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="导入前自动备份失败，已取消导入") from exc
    with business_write() as conn:
        try:
            result = import_excel(conn, reset=True, user=user)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if result["failed_rows"]:
            raise HTTPException(
                status_code=422,
                detail=f"导入存在 {result['failed_rows']} 条错误数据，已整批回滚",
            )
        return result


@router.get("/api/logs")
def logs(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _: CurrentUser = Depends(require_permission("system_admin")),
) -> dict:
    with db() as conn:
        total = conn.execute(text("SELECT COUNT(*) FROM operation_log")).scalar()
        rows = conn.execute(
            text(
                """
                SELECT id, user_name, module_name, action_name, detail, status, created_at
                FROM operation_log
                ORDER BY created_at DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"limit": limit, "offset": offset},
        ).mappings().all()
    return {"total": int(total or 0), "items": clean_rows(rows)}


@router.get("/api/backups")
def backups(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _: CurrentUser = Depends(require_permission("system_admin")),
) -> dict:
    with db() as conn:
        total = conn.execute(text("SELECT COUNT(*) FROM backup_record")).scalar()
        rows = conn.execute(
            text(
                """
                SELECT id, file_name, file_size_label, backup_type, status, backup_time
                FROM backup_record
                ORDER BY backup_time DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"limit": limit, "offset": offset},
        ).mappings().all()
    return {"total": int(total or 0), "items": clean_rows(rows)}


@router.post("/api/backups")
def create_system_backup(user: CurrentUser = Depends(require_permission("system_admin"))) -> dict:
    with business_write() as conn:
        return create_backup(conn, user)


@router.post("/api/backups/{backup_id}/restore")
def restore_system_backup(
    backup_id: int,
    user: CurrentUser = Depends(require_permission("system_admin")),
) -> dict:
    with business_write() as conn:
        create_backup(conn, user, "pre_restore")
    with business_write() as conn:
        return restore_backup(conn, backup_id, user)
