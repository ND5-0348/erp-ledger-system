from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings, validate_security_settings
from .auth import ensure_default_admin
from .db import active_table_count, initialize_schema
from .routers import auth, dashboard, ledgers, orders, purchases, sales, system
from .validation import validation_error_message

startup_state = {"database": "not_checked", "imported_rows": 0, "error": None}


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
