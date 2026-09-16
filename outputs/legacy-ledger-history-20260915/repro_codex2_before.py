"""Codex 复审两项缺陷的最小复现（在修复前的代码上运行）。

用法（在修复前的工作树里执行）：

    MYSQL_DATABASE=erp_ledger_test_readiness_20260915 \
    BACKUP_ROOT=$TEMP/erp-ledger-readiness-20260915 \
    python repro_codex2_before.py

缺陷一：订单别名连通分组没有按框架隔离——同一文件里 P-ONE 的 A/C 与 P-TWO 的
        A/D 共享 A，被并成一条链后误报"当前值不一致"。
缺陷二：多来源财务组只取第一个来源组的原合计与全部期次总和比较——第一组 300、
        第二组 50 时，正确的 100+200+50=350 被拒绝，漏掉第二组的 300 被放行。
"""
from __future__ import annotations

import os
import sys
from datetime import date
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend", "tests"))

os.environ.setdefault("DEFAULT_ADMIN_PASSWORD", "Integration-Test-20260714!")

from conftest import TEST_PASSWORD, clear_business_data, initialize_test_schema  # noqa: E402

initialize_test_schema()
clear_business_data()

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import db  # noqa: E402
from app.main import app  # noqa: E402
from test_legacy_import_flow import _row, _workbook  # noqa: E402

PAY_DATE, PAY_VOUCHER, PAY_AMOUNT = 55, 56, 57
PAY2_DATE, PAY2_VOUCHER, PAY2_AMOUNT = 58, 59, 60

client = TestClient(app, raise_server_exceptions=False)
login = client.post("/api/auth/login", json={"username": "admin", "password": TEST_PASSWORD})
headers = {"Authorization": f"Bearer {login.json()['access_token']}"}


def preview(rows):
    content = _workbook(rows)
    response = client.post(
        "/api/orders/import-preview?filename=repro.xlsx", content=content, headers=headers
    )
    return response.json()["session_id"], content


def resolve(session_id, items):
    return client.put(
        f"/api/orders/import-preview/{session_id}/resolutions",
        json={"items": items},
        headers=headers,
    )


def commit(session_id, content):
    return client.post(
        f"/api/orders/import-preview/{session_id}/commit", content=content, headers=headers
    )


def summary(session_id):
    return client.get(f"/api/orders/import-preview/{session_id}", headers=headers).json()["summary"]


def count(table):
    with db() as conn:
        return int(conn.execute(text(f"SELECT COUNT(*) FROM `{table}`")).scalar() or 0)


print("=" * 72)
print("缺陷一：跨框架同号被误报为链条冲突")
print("=" * 72)
clear_business_data()
session_id, content = preview(
    [
        _row({2: "P-ONE", 13: "SO-A/SO-C", 15: "服务器"}),
        _row({2: "P-TWO", 13: "SO-A/SO-D", 15: "交换机"}),
    ]
)
result = summary(session_id)
print("summary:", {key: result[key] for key in ("total_rows", "blocking_rows", "comparable")})
print("cross_row_issues:", [issue["message"][:60] for issue in result.get("cross_row_issues", [])])
print("提交结果:", commit(session_id, content).status_code, "（期望 200）")
print("落库订单数:", count("sales_order"), "（期望 2）")

print()
print("=" * 72)
print("缺陷二：多来源财务组按第一个合计与总和比较")
print("=" * 72)


def two_source_row():
    return _row(
        {
            PAY_DATE: "2026/01/05/2026/02/05",
            PAY_AMOUNT: "300",
            PAY2_DATE: date(2026, 3, 5),
            PAY2_VOUCHER: "PAY-3",
            PAY2_AMOUNT: Decimal("50.00"),
        }
    )


clear_business_data()
session_id, content = preview([two_source_row()])
print("预检阻断（第一组需要拆分）:", summary(session_id)["comparable"] is False)

correct = resolve(
    session_id,
    [
        {
            "excel_row_no": 3,
            "resolution": {
                "finance": {
                    "purchase_payment": {
                        "phases": [
                            {"date": "2026-01-05", "amount": "100.00", "document_no": "PAY-1"},
                            {"date": "2026-02-05", "amount": "200.00", "document_no": "PAY-2"},
                            {"date": "2026-03-05", "amount": "50.00", "document_no": "PAY-3"},
                        ]
                    }
                }
            },
        }
    ],
)
print("正确拆分 100+200+50 的确认结果:", correct.status_code, "（期望 200）")
print("  详情:", str(correct.json().get("detail"))[:90])

clear_business_data()
session_id, content = preview([two_source_row()])
missing = resolve(
    session_id,
    [
        {
            "excel_row_no": 3,
            "resolution": {
                "finance": {
                    "purchase_payment": {
                        "phases": [
                            {"date": "2026-01-05", "amount": "100.00", "document_no": "PAY-1"},
                            {"date": "2026-02-05", "amount": "200.00", "document_no": "PAY-2"},
                        ]
                    }
                }
            },
        }
    ],
)
print("漏掉第二组的确认结果:", missing.status_code, "（期望 422）")
print("  详情:", str(missing.json().get("detail"))[:90])
