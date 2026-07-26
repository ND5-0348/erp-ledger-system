from __future__ import annotations

import os
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings, validate_security_settings
from .auth import current_user_from_token, ensure_default_admin
from .db import active_table_count, db, initialize_schema
from .audit import failed_mutation_metadata, failure_reason, write_operation_log
from .routers import auth, dashboard, ledgers, orders, purchases, sales, system
from .validation import validation_error_message

startup_state = {"database": "not_checked", "imported_rows": 0, "error": None}
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        validate_security_settings()
        initialize_schema()
        ensure_default_admin()
        startup_state["imported_rows"] = active_table_count("order_line")
        startup_state["database"] = "configured"
        startup_state["error"] = None
    except Exception as exc:  # noqa: BLE001 - keep API visible for health diagnostics
        startup_state["database"] = "error"
        startup_state["error"] = str(exc)
    yield


app = FastAPI(title="ERP Ledger API", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def audit_failed_data_change(request: Request, call_next):
    try:
        response = await call_next(request)
    except Exception:
        _write_failed_data_change(request, 500)
        raise
    if response.status_code >= 400:
        _write_failed_data_change(request, response.status_code)
    return response


def _write_failed_data_change(request: Request, status_code: int) -> None:
    metadata = failed_mutation_metadata(request.method, request.url.path)
    user = getattr(request.state, "current_user", None)
    if user is None:
        authorization = request.headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token:
            try:
                user = current_user_from_token(token)
            except HTTPException:
                user = None
    if metadata is None or user is None:
        return
    module_name, action_name, action_label = metadata
    try:
        with db() as conn:
            write_operation_log(
                conn,
                user,
                module_name,
                action_name,
                f"{action_label}失败：{failure_reason(status_code)}",
                status="failed",
            )
    except Exception:
        # 审计库不可用时保留原业务错误，避免覆盖真实失败原因。
        logger.exception("写入失败操作审计日志失败")


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"detail": validation_error_message(exc.errors())},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboard.router)
app.include_router(auth.router)
app.include_router(ledgers.router)
app.include_router(orders.router)
app.include_router(purchases.router)
app.include_router(sales.router)
app.include_router(system.router)


@app.get("/api/health")
def health() -> dict:
    imported_rows = startup_state["imported_rows"]
    if startup_state["database"] == "configured":
        try:
            imported_rows = active_table_count("order_line")
        except Exception:  # noqa: BLE001 - retain the last known count in diagnostics
            pass
    return {
        "status": "ok" if startup_state["database"] == "configured" else "degraded",
        "database": startup_state["database"],
        "importedRows": imported_rows,
        "error": startup_state["error"],
    }


FRONTEND_DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend_dist"))

if os.path.isdir(FRONTEND_DIST):
    assets_path = os.path.join(FRONTEND_DIST, "assets")
    if os.path.isdir(assets_path):
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        target = os.path.join(FRONTEND_DIST, full_path)
        if os.path.isfile(target):
            return FileResponse(target)
        index = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.isfile(index):
            return FileResponse(index)
        raise HTTPException(status_code=404)
