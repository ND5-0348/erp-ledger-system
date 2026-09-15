"""Task 2：跨入口并发写入保护。

并发全部用屏障（threading.Barrier）与事件（threading.Event）同步，
不用 sleep 制造“看起来像并发”的假象。
"""
from __future__ import annotations

import ast
import re
import shutil
import threading
from pathlib import Path
from typing import Any, Callable

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from conftest import TEST_PASSWORD
from app.config import BACKEND_DIR, DOCS_DIR, settings
from app.db import MYSQL_CONNECT_ARGS, db, engine
from app.main import app
from app.write_guard import (
    BUSY_ERROR_CODE,
    LOCK_TIMEOUT_SECONDS,
    business_write,
    lock_name,
)

ROUTERS_DIR = BACKEND_DIR / "app" / "routers"


def _payload(suffix: str) -> dict[str, str]:
    return {
        "amount_type": "gross",
        "project_code": f"CONC-{suffix}",
        "project_name": "Concurrency Test",
        "department": "QA",
        "branch_company": "QA Branch",
        "account_manager": "QA Manager",
        "order_no": f"SO-CONC-{suffix}",
        "order_date": "2026-07-14",
        "business_type": "QA",
        "statistical_category": "QA",
        "team_name": "QA Team",
        "customer_unit_name": "QA Customer",
        "user_name": "QA User",
        "regional_platform": "QA Platform",
        "goods_name": "QA Equipment",
        "specification_model": "QA-SPEC",
        "unit_name": "unit",
        "quantity": "10.000000",
        "net_unit_price": "100.000000",
        "unit_price": "113.000000",
        "net_revenue": "1000.00",
        "order_value": "1130.00",
        "supplier_name": "QA Supplier",
        "purchase_unit_price_no_tax": "70.000000",
        "purchase_unit_price": "79.100000",
        "cost_no_tax": "700.00",
        "purchase_amount": "791.00",
        "close_status": "进行中",
    }


def _run_with_barrier(target: Callable[[int], Any], count: int = 2, timeout: float = 60.0):
    """让 count 个线程在屏障处对齐后同时执行 target(index)。"""
    barrier = threading.Barrier(count)
    results: list[Any] = [None] * count
    failures: list[BaseException | None] = [None] * count

    def runner(index: int) -> None:
        try:
            barrier.wait(timeout=timeout)
            results[index] = target(index)
        except BaseException as exc:  # noqa: BLE001 - 记录后由断言判断
            failures[index] = exc

    threads = [threading.Thread(target=runner, args=(index,)) for index in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=timeout)
    assert all(not thread.is_alive() for thread in threads), "并发线程未在超时内结束"
    return results, failures


def _line_count() -> int:
    with db() as conn:
        return int(conn.execute(text("SELECT COUNT(*) FROM order_line")).scalar() or 0)


def _first_order_line_id() -> int:
    with db() as conn:
        return int(conn.execute(text("SELECT id FROM order_line ORDER BY id LIMIT 1")).scalar())


# --- 锁本身 -----------------------------------------------------------------


def test_two_connections_never_enter_the_critical_section_together(mysql_test_database: None) -> None:
    """另一条连接持锁期间，第二个连接不可能取得同一把锁。

    用 0 超时探测而不是“谁先谁后”的时序断言：holder 在锁内发信号，
    探测必然发生在锁被持有的时刻，不受线程调度影响。
    """
    holder_inside = threading.Event()
    release_holder = threading.Event()
    probe_results: list[Any] = []

    def holder() -> None:
        with business_write() as conn:
            conn.execute(text("SELECT 1"))
            holder_inside.set()
            release_holder.wait(timeout=LOCK_TIMEOUT_SECONDS * 4)

    holder_thread = threading.Thread(target=holder)
    holder_thread.start()
    assert holder_inside.wait(timeout=LOCK_TIMEOUT_SECONDS * 4), "持锁线程未就绪"
    try:
        with engine.connect() as probe:
            probe_results.append(
                probe.execute(text("SELECT GET_LOCK(:name, 0)"), {"name": lock_name()}).scalar()
            )
    finally:
        release_holder.set()
        holder_thread.join(timeout=LOCK_TIMEOUT_SECONDS * 4)
    assert not holder_thread.is_alive()

    assert probe_results == [0], "持锁期间第二个连接不应取得同一把锁"

    # 释放后立即可得，说明锁确实被还给了数据库，不会永久占用。
    with business_write() as conn:
        assert conn.execute(text("SELECT 1")).scalar() == 1


def test_waiting_longer_than_the_timeout_reports_busy(mysql_test_database: None) -> None:
    """超过等待上限必须得到可识别的 409，而不是无限期挂住。"""
    holder_ready = threading.Event()
    release_holder = threading.Event()

    def holder() -> None:
        with business_write() as conn:
            holder_ready.set()
            release_holder.wait(timeout=LOCK_TIMEOUT_SECONDS * 6)
            conn.execute(text("SELECT 1"))

    holder_thread = threading.Thread(target=holder)
    holder_thread.start()
    assert holder_ready.wait(timeout=LOCK_TIMEOUT_SECONDS * 4)
    try:
        with pytest.raises(HTTPException) as error:
            with business_write() as conn:
                conn.execute(text("SELECT 1"))
    finally:
        release_holder.set()
        holder_thread.join(timeout=LOCK_TIMEOUT_SECONDS * 4)

    assert error.value.status_code == 409
    assert error.value.detail["code"] == BUSY_ERROR_CODE


def test_lock_is_released_when_the_body_raises(mysql_test_database: None) -> None:
    with pytest.raises(RuntimeError):
        with business_write() as conn:
            conn.execute(text("SELECT 1"))
            raise RuntimeError("boom")

    with business_write() as conn:
        assert conn.execute(text("SELECT 1")).scalar() == 1


def test_nested_business_write_reuses_the_same_lock(mysql_test_database: None) -> None:
    """嵌套调用不能再取一次锁，否则会自己等自己。"""
    with business_write() as outer:
        with business_write() as inner:
            assert inner is outer
            assert inner.execute(text("SELECT 1")).scalar() == 1


def test_lock_names_differ_per_database_and_fit_mysql_limit() -> None:
    first = lock_name("erp_ledger_test_alpha")
    second = lock_name("erp_ledger_test_beta")
    assert first != second
    assert len(first) <= 64 and len(second) <= 64


def test_another_databases_lock_does_not_block(mysql_test_database: None) -> None:
    """不同数据库（例如另一个测试库）使用不同的锁，互不阻塞。"""
    other_lock = lock_name("erp_ledger_test_somewhere_else")
    with business_write() as conn:
        acquired = conn.execute(
            text("SELECT GET_LOCK(:name, 0)"), {"name": other_lock}
        ).scalar()
        try:
            assert acquired == 1
        finally:
            conn.execute(text("SELECT RELEASE_LOCK(:name)"), {"name": other_lock})


def test_lock_is_visible_to_an_independent_engine(mysql_test_database: None) -> None:
    """换成独立连接池（等价于另一个应用进程）仍被同一把锁挡住。

    命名锁是 MySQL 服务器级的，所以多进程部署共享同一数据库时同样受保护。
    """
    other_engine = create_engine(
        settings.database_url, pool_pre_ping=True, future=True, connect_args=MYSQL_CONNECT_ARGS
    )
    try:
        with business_write() as conn:
            conn.execute(text("SELECT 1"))
            with other_engine.connect() as other:
                acquired = other.execute(
                    text("SELECT GET_LOCK(:name, 0)"), {"name": lock_name()}
                ).scalar()
        assert acquired == 0, "独立连接池不应能同时取得同一把业务写锁"
    finally:
        other_engine.dispose()


# --- 跨入口 -----------------------------------------------------------------


def _concurrent_api_posts(payload: dict[str, str]) -> list[Any]:
    def post(index: int) -> Any:
        client = TestClient(app, raise_server_exceptions=False)
        login = client.post(
            "/api/auth/login", json={"username": "admin", "password": TEST_PASSWORD}
        )
        assert login.status_code == 200, login.text
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        return client.post("/api/orders", json=payload, headers=headers)

    responses, failures = _run_with_barrier(post, count=2)
    assert failures == [None, None], failures
    return responses


def test_concurrent_identical_single_creates_keep_one_line(client: TestClient, headers: dict[str, str]) -> None:
    """两个请求同时提交完全相同的明细：最多一条合法明细入库。"""
    responses = _concurrent_api_posts(_payload("SINGLE"))
    statuses = sorted(response.status_code for response in responses)
    assert statuses[0] in (200, 409), [response.text for response in responses]
    assert _line_count() == 1


def test_concurrent_different_purchase_amounts_still_conflict_or_wait(
    client: TestClient, headers: dict[str, str]
) -> None:
    """同项目同订单同货物但采购金额不同：允许共存，不能互相覆盖。"""
    first = _payload("DIFF")
    second = _payload("DIFF")
    second.update(quantity="4.000000", net_unit_price="74.000000", unit_price="83.620000")

    def post(index: int) -> Any:
        client = TestClient(app, raise_server_exceptions=False)
        login = client.post("/api/auth/login", json={"username": "admin", "password": TEST_PASSWORD})
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        return client.post("/api/orders", json=first if index == 0 else second, headers=headers)

    responses, failures = _run_with_barrier(post, count=2)
    assert failures == [None, None], failures
    assert [response.status_code for response in responses] == [200, 200]
    assert _line_count() == 2


# 代表性写端点：订单新增/批量/修改/删除、采购批量与付款、销售批量与回款。
# 持锁期间它们必须全部 409，任何一个绕开锁成功都说明覆盖不全。
# 第三项是接收真实 order_line_id 的请求体构造函数。
GUARDED_ENDPOINTS: list[tuple[str, str, Callable[[int], dict[str, Any]]]] = [
    ("POST", "/api/orders", lambda _id: _payload("LOCKED")),
    ("POST", "/api/orders/batch", lambda _id: {"items": [_payload("LOCKED-BATCH")]}),
    ("PUT", "/api/orders/batch-basic", lambda _id: {"items": [{"order_line_id": _id, "goods_name": "LOCKED"}]}),
    ("PUT", "/api/orders/{order_line_id}", lambda _id: _payload("LOCKED-UPDATE")),
    ("DELETE", "/api/orders/{order_line_id}", lambda _id: {}),
    ("PUT", "/api/purchases/batch", lambda _id: {"items": [{"order_line_id": _id, "supplier_name": "LOCKED"}]}),
    ("PUT", "/api/purchases/{order_line_id}/summary", lambda _id: {"supplier_name": "LOCKED"}),
    ("POST", "/api/purchases/{order_line_id}/payments", lambda _id: {"payment_amount": "1.00"}),
    ("PUT", "/api/sales/batch", lambda _id: {"items": [{"order_line_id": _id, "close_status": "已关闭"}]}),
    ("POST", "/api/sales/{order_line_id}/receipts", lambda _id: {"receipt_amount": "1.00"}),
]


def test_write_endpoints_all_wait_behind_the_lock(client: TestClient, headers: dict[str, str]) -> None:
    """持有写入锁时，所有代表性写端点都必须返回 409 且不写入数据。

    请求并发发出，因此整体只等待一次锁超时。先用一条真实明细把各端点的
    参数校验/存在性检查走通，确保请求真的到达取锁这一步。
    """
    created = client.post("/api/orders", json=_payload("TARGET"), headers=headers)
    assert created.status_code == 200, created.text
    order_line_id = _first_order_line_id()

    def call(index: int) -> Any:
        method, path, build_body = GUARDED_ENDPOINTS[index]
        path = path.format(order_line_id=order_line_id)
        client = TestClient(app, raise_server_exceptions=False)
        login = client.post("/api/auth/login", json={"username": "admin", "password": TEST_PASSWORD})
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        return client.request(method, path, json=build_body(order_line_id), headers=headers)

    with business_write() as conn:
        conn.execute(text("SELECT 1"))
        responses, failures = _run_with_barrier(call, count=len(GUARDED_ENDPOINTS))

    assert failures == [None] * len(GUARDED_ENDPOINTS), failures
    for (method, path, _), response in zip(GUARDED_ENDPOINTS, responses):
        assert response.status_code == 409, f"{method} {path} -> {response.status_code} {response.text}"
        assert response.json()["detail"]["code"] == BUSY_ERROR_CODE
    assert _line_count() == 1, "持锁期间不得有任何新明细写入"

    # 锁释放后同样的请求必须能正常处理，证明 409 只是等待超时而不是端点坏了。
    follow_up = client.post("/api/orders", json=_payload("AFTER-LOCK"), headers=headers)
    assert follow_up.status_code == 200, follow_up.text


@pytest.fixture
def maintenance_source_file():
    """维护替换入口固定从 docs 目录读 2026*.xlsx；这里放一个临时占位文件。

    docs/*.xlsx 已被 .gitignore 忽略，测试结束即删除。
    """
    target = DOCS_DIR / "2026并发测试占位.xlsx"
    shutil.copy(BACKEND_DIR / "templates" / "市场部业务台账模板.xlsx", target)
    try:
        yield target
    finally:
        target.unlink(missing_ok=True)


def test_maintenance_import_uses_the_same_lock(
    client: TestClient, headers: dict[str, str], maintenance_source_file: Path
) -> None:
    """维护替换（全量清库导入）必须和普通写入互斥，不能交错。"""
    created = client.post("/api/orders", json=_payload("KEEP"), headers=headers)
    assert created.status_code == 200, created.text

    with business_write() as conn:
        conn.execute(text("SELECT 1"))
        response = client.post("/api/import/excel", headers=headers)

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == BUSY_ERROR_CODE
    assert _line_count() == 1, "维护替换被锁挡住时不得删除任何业务数据"


def test_restore_uses_the_same_lock(client: TestClient, headers: dict[str, str]) -> None:
    """业务恢复同样必须等待写入锁，不能一边写一边覆盖。"""
    with business_write() as conn:
        conn.execute(text("SELECT 1"))
        response = client.post("/api/backups/1/restore", headers=headers)

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == BUSY_ERROR_CODE


# --- 覆盖清单（源码级） -----------------------------------------------------

# POST 但只读的端点：查看编辑数据不算业务写入。
READ_ONLY_ENDPOINTS = {
    ("orders.py", "get_batch_editor_schema"),
    ("orders.py", "get_batch_editor_rows"),
    ("purchases.py", "get_purchase_batch_editor_rows"),
    ("sales.py", "get_sales_batch_editor_rows"),
}

# 自身不直接取锁、但把写入交给已取锁的 helper 完成的端点。
# 值是该 helper 的函数名，测试会核对它确实出现在端点函数体里。
VIA_GUARDED_HELPER = {
    ("orders.py", "import_orders_excel"): "_run_order_import",
    ("purchases.py", "delete_purchase_contract"): "_soft_delete_detail",
    ("purchases.py", "delete_purchase_invoice"): "_soft_delete_detail",
    ("purchases.py", "delete_warehouse_entry"): "_soft_delete_detail",
    ("purchases.py", "delete_finance_invoice_check"): "_soft_delete_detail",
    ("purchases.py", "delete_finance_payment"): "_soft_delete_detail",
    ("purchases.py", "delete_purchase_payment"): "_soft_delete_detail",
    ("sales.py", "delete_sales_contract"): "_soft_delete_detail",
    ("sales.py", "delete_sales_invoice"): "_soft_delete_detail",
}

WRITE_DECORATOR = re.compile(r"^router\.(post|put|delete|patch)\(")


def test_every_business_write_endpoint_goes_through_the_guard() -> None:
    """源码级覆盖清单：路由文件里每个写端点都必须直接或间接走 business_write。"""
    missing: list[str] = []
    checked = 0
    for file_name in ("orders.py", "purchases.py", "sales.py", "system.py"):
        source = (ROUTERS_DIR / file_name).read_text(encoding="utf-8")
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            decorators = [ast.unparse(decorator) for decorator in node.decorator_list]
            if not any(WRITE_DECORATOR.match(decorator) for decorator in decorators):
                continue
            key = (file_name, node.name)
            if key in READ_ONLY_ENDPOINTS or key in VIA_GUARDED_HELPER:
                continue
            checked += 1
            body = ast.get_source_segment(source, node) or ""
            if "business_write" not in body:
                missing.append(f"{file_name}::{node.name}")

    assert checked >= 25, f"覆盖清单只检查到 {checked} 个端点，可能漏了路由文件"
    assert missing == [], f"以下写端点没有走 business_write：{missing}"


def test_whitelisted_endpoints_really_call_the_guarded_helper() -> None:
    """白名单里的端点必须真的调用那个取锁的 helper，不能只是纸面豁免。"""
    for (file_name, function_name), helper in sorted(VIA_GUARDED_HELPER.items()):
        source = (ROUTERS_DIR / file_name).read_text(encoding="utf-8")
        tree = ast.parse(source)
        target = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == function_name
        )
        body = ast.get_source_segment(source, target) or ""
        assert re.search(r"\b" + re.escape(helper) + r"\b", body), (
            f"{file_name}::{function_name} 没有调用 {helper}"
        )

