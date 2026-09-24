from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from .. import maintenance_import
from sqlalchemy import text

from ..auth import CurrentUser, get_current_user, require_permission
from ..backup import create_backup, restore_backup, verify_backup
from ..config import DOCS_DIR
from ..db import db
from ..importer import import_excel
from ..serializers import clean_rows
from ..write_guard import business_write

router = APIRouter(tags=["system"], dependencies=[Depends(get_current_user)])


class MaintenancePreview(BaseModel):
    file_name: str = Field(min_length=1,max_length=255)


class MaintenanceCommit(MaintenancePreview):
    token: str = Field(min_length=1,max_length=4096)
    confirmation: str


@router.get('/api/import/files')
def maintenance_files(user: CurrentUser = Depends(require_permission('system_admin'))):
    return {'items':[p.name for p in DOCS_DIR.glob('*.xlsx') if p.is_file()]}


@router.post('/api/import/preview')
def preview_maintenance(payload: MaintenancePreview, user: CurrentUser = Depends(require_permission('system_admin'))):
    with db() as conn:
        return maintenance_import.preview(conn,user,payload.file_name)


@router.post('/api/import/excel')
def run_import(payload: MaintenanceCommit, user: CurrentUser = Depends(require_permission('system_admin'))):
    with business_write() as conn:
        return maintenance_import.replace(conn,user,payload.file_name,payload.token,payload.confirmation)


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


@router.get('/api/backups/{backup_id}/verify')
def verify_system_backup(backup_id: int, user: CurrentUser = Depends(require_permission('system_admin'))):
    with db() as conn:
        return verify_backup(conn,backup_id)


@router.post("/api/backups/{backup_id}/restore")
def restore_system_backup(
    backup_id: int,
    user: CurrentUser = Depends(require_permission("system_admin")),
) -> dict:
    with business_write() as conn:
        create_backup(conn, user, "pre_restore")
        return restore_backup(conn, backup_id, user)
