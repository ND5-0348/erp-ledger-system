"""Codex 复审两项缺陷的修复后对照（与 repro_codex2_before.py 同场景）。

差异只有一处：人工确认的每一期现在必须声明 `source_group`（来自第几个模板
列组），金额才能按来源列组分别核对。

用法（在仓库根目录执行）：

    MYSQL_DATABASE=erp_ledger_test_readiness_20260915 \
    BACKUP_ROOT=$TEMP/erp-ledger-readiness-20260915 \
    python outputs/legacy-ledger-history-20260915/repro_codex2_after.py
"""
from __future__ import annotations

import os
import sys
from datetime import date
from decimal import Decimal

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, os.path.join(ROOT, "backend", "tests"))

os.environ.setdefault("DEFAULT_ADMIN_PASSWORD", "Integration-Test-20260714!")

from conftest import TEST_PASSWORD, clear_business_data, initialize_test_schema  # noqa: E402

initialize_test_schema()
clear_business_data()

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import db  # noqa: E402
from app.main import app  # noqa: E402
from test_legacy_import_flow import _row, _workbook  # noqa: E402

PAY_DATE, PAY_AMOUNT = 55, 57
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


print("=" * 72)
print("缺陷一：跨框架同号不再被误报为链条冲突")
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
print("cross_row_issues:", result.get("cross_row_issues"))
print("提交结果:", commit(session_id, content).status_code, "（期望 200）")
with db() as conn:
    stored = conn.execute(
        text(
            "SELECT p.project_code, so.order_no FROM sales_order so "
            "JOIN project p ON p.id = so.project_id ORDER BY p.project_code"
        )
    ).mappings().all()
    chains = conn.execute(
        text(
            "SELECT p.project_code, h.order_no FROM sales_order_number_history h "
            "JOIN sales_order so ON so.id = h.sales_order_id "
            "JOIN project p ON p.id = so.project_id ORDER BY p.project_code, h.history_order"
        )
    ).mappings().all()
print("落库订单数:", count("sales_order"), "（期望 2）")
print("归属:", [(row["project_code"], row["order_no"]) for row in stored])
print("别名链归属:", [(row["project_code"], row["order_no"]) for row in chains])

print()
print("=" * 72)
print("缺陷二：金额按来源列组分别核对")
print("=" * 72)
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
                            {
                                "source_group": 1,
                                "date": "2026-01-05",
                                "amount": "100.00",
                                "document_no": "PAY-1",
                            },
                            {
                                "source_group": 1,
                                "date": "2026-02-05",
                                "amount": "200.00",
                                "document_no": "PAY-2",
                            },
                            {
                                "source_group": 2,
                                "date": "2026-03-05",
                                "amount": "50.00",
                                "document_no": "PAY-3",
                            },
                        ]
                    }
                }
            },
        }
    ],
)
print("正确拆分 100+200+50 的确认结果:", correct.status_code, "（期望 200）")
saved = commit(session_id, content)
print("提交结果:", saved.status_code, "（期望 200）")
with db() as conn:
    rows = conn.execute(
        text(
            "SELECT phase_no, payment_date, payment_voucher_no, payment_amount "
            "FROM purchase_payment WHERE deleted_at IS NULL ORDER BY phase_no"
        )
    ).mappings().all()
print(
    "落库期次:",
    [
        (int(row["phase_no"]), str(row["payment_date"]), row["payment_voucher_no"], str(row["payment_amount"]))
        for row in rows
    ],
)

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
                            {
                                "source_group": 1,
                                "date": "2026-01-05",
                                "amount": "100.00",
                                "document_no": "PAY-1",
                            },
                            {
                                "source_group": 1,
                                "date": "2026-02-05",
                                "amount": "200.00",
                                "document_no": "PAY-2",
                            },
                        ]
                    }
                }
            },
        }
    ],
)
print("漏掉第二组的确认结果:", missing.status_code, "（期望 422）")
print("  详情:", str(missing.json().get("detail"))[:100])
print("  落库期次:", count("purchase_payment"), "（期望 0）")

clear_business_data()
session_id, content = preview([two_source_row()])
wrong_total = resolve(
    session_id,
    [
        {
            "excel_row_no": 3,
            "resolution": {
                "finance": {
                    "purchase_payment": {
                        "phases": [
                            {
                                "source_group": 1,
                                "date": "2026-01-05",
                                "amount": "100.00",
                                "document_no": "PAY-1",
                            },
                            {
                                "source_group": 1,
                                "date": "2026-02-05",
                                "amount": "200.00",
                                "document_no": "PAY-2",
                            },
                            {
                                "source_group": 2,
                                "date": "2026-03-05",
                                "amount": "30.00",
                                "document_no": "PAY-3",
                            },
                        ]
                    }
                }
            },
        }
    ],
)
print("第二组金额填错的确认结果:", wrong_total.status_code, "（期望 422）")
print("  详情:", str(wrong_total.json().get("detail"))[:100])
