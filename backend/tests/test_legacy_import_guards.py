"""H2/H3 后端缺口的反例回归（Codex 静态审查 2026-09-15）。

每个用例都从真实入口（预检 → 人工确认 → 提交 / 普通导入）覆盖，
不以辅助函数单元测试代替业务入口。

覆盖清单：
1. 只确认错误码但未拆分金额，仍被拒绝；
2. 拆分合计不符、期次数不符、无效日期被拒绝且无业务写入；
3. 只修正某个财务组，其他组仍完整保留；
4. 历史别名与另一个订单冲突，整批回滚；
5. 已有完整历史后导入仅当前值，历史不丢失；
6. 同框架多行历史链冲突，不按首行覆盖；
7. 最后一期财务数据异常，整批回滚；
8. 备份失败不写入；同会话重复提交不重复写入；
9. Excel 中间空行不影响明细与财务/历史的对应；
10. 第二组付款/回款列与单元格内多期并存，顺序、来源与金额正确。
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import text

from app.config import ROOT_DIR
from app.db import db
from test_legacy_import_flow import _count, _phases, _row, _workbook

TEMPLATE_PATH = ROOT_DIR / "backend" / "templates" / "市场部业务台账模板.xlsx"

INVOICE_DOC, INVOICE_DATE, INVOICE_AMOUNT = 73, 74, 76
PAY_DATE, PAY_VOUCHER, PAY_AMOUNT = 55, 56, 57
PAY2_DATE, PAY2_VOUCHER, PAY2_AMOUNT = 58, 59, 60
RECEIPT_DATE, RECEIPT_NOTICE, RECEIPT_AMOUNT = 79, 80, 81
RECEIPT2_DATE, RECEIPT2_NOTICE, RECEIPT2_AMOUNT = 83, 84, 85


def _preview(client: TestClient, headers: dict[str, str], rows: list[list[object]]):
    return client.post(
        "/api/orders/import-preview?filename=legacy.xlsx", content=_workbook(rows), headers=headers
    )


def _open_session(client: TestClient, headers: dict[str, str], rows: list[list[object]]) -> tuple[str, bytes]:
    content = _workbook(rows)
    response = client.post(
        "/api/orders/import-preview?filename=legacy.xlsx", content=content, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()["session_id"], content


def _resolve(client: TestClient, headers: dict[str, str], session_id: str, items: list[dict]):
    return client.put(
        f"/api/orders/import-preview/{session_id}/resolutions",
        json={"items": items},
        headers=headers,
    )


def _commit(client: TestClient, headers: dict[str, str], session_id: str, content: bytes):
    return client.post(
        f"/api/orders/import-preview/{session_id}/commit", content=content, headers=headers
    )


def _summary(client: TestClient, headers: dict[str, str], session_id: str) -> dict:
    response = client.get(f"/api/orders/import-preview/{session_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["summary"]


def _split_case_row() -> list[object]:
    """两个开票日期只填了一个合计金额，必须人工拆分。"""
    return _row({INVOICE_DATE: "2026/01/01/2026/02/01", INVOICE_AMOUNT: "300"})


# --- 1 / 2：人工确认必须重新校验 -------------------------------------------


def test_acknowledged_code_alone_does_not_unblock(client: TestClient, headers: dict[str, str]) -> None:
    """只提交“已确认错误码”不能使不完整的财务数据通过。"""
    session_id, content = _open_session(client, headers, [_split_case_row()])
    assert _summary(client, headers, session_id)["comparable"] is False

    response = _resolve(
        client,
        headers,
        session_id,
        [
            {
                "excel_row_no": 3,
                "resolution": {"acknowledged_codes": ["AMOUNT_SPLIT_REQUIRED"]},
            }
        ],
    )
    assert response.status_code in (200, 422), response.text
    assert _summary(client, headers, session_id)["comparable"] is False

    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 422, commit.text
    assert _count("order_line") == 0
    assert _count("sales_invoice") == 0


def test_split_total_mismatch_is_rejected(client: TestClient, headers: dict[str, str]) -> None:
    """拆分后各期之和与原合计不一致且未给理由 → 拒绝且无业务写入。"""
    session_id, content = _open_session(client, headers, [_split_case_row()])
    response = _resolve(
        client,
        headers,
        session_id,
        [
            {
                "excel_row_no": 3,
                "resolution": {
                    "finance": {
                        "sales_invoice": {
                            "phases": [
                                {"date": "2026-01-01", "amount": "100.00", "document_no": "DOC-1"},
                                {"date": "2026-02-01", "amount": "150.00", "document_no": "DOC-2"},
                            ]
                        }
                    }
                },
            }
        ],
    )
    assert response.status_code == 422, response.text
    assert _summary(client, headers, session_id)["comparable"] is False
    assert _commit(client, headers, session_id, content).status_code == 422
    assert _count("sales_invoice") == 0


def test_split_total_correction_records_reason_and_amounts(
    client: TestClient, headers: dict[str, str]
) -> None:
    """原合计本身写错时：必须给出理由，并记录原值、修正值、理由、操作者和时间。"""
    session_id, content = _open_session(client, headers, [_split_case_row()])
    response = _resolve(
        client,
        headers,
        session_id,
        [
            {
                "excel_row_no": 3,
                "resolution": {
                    "finance": {
                        "sales_invoice": {
                            "phases": [
                                {"date": "2026-01-01", "amount": "100.00", "document_no": "DOC-1"},
                                {"date": "2026-02-01", "amount": "150.00", "document_no": "DOC-2"},
                            ],
                            "total_correction_reason": "原合计 300 写错，实际两期合计 250",
                        }
                    }
                },
            }
        ],
    )
    assert response.status_code == 200, response.text
    assert _summary(client, headers, session_id)["comparable"] is True

    with db() as conn:
        row = conn.execute(
            text(
                "SELECT resolution_json, resolved_by, resolved_at FROM legacy_import_source "
                "WHERE session_id = :id AND excel_row_no = 3"
            ),
            {"id": session_id},
        ).mappings().first()
    assert row["resolved_by"], "必须记录操作者"
    assert row["resolved_at"], "必须记录时间"

    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 200, commit.text
    with db() as conn:
        amounts = [
            str(value)
            for value in conn.execute(
                text("SELECT invoice_amount FROM sales_invoice ORDER BY phase_no")
            ).scalars().all()
        ]
    assert amounts == ["100.00", "150.00"]


def test_phase_count_mismatch_revision_is_rejected(client: TestClient, headers: dict[str, str]) -> None:
    """修正的期次数与日期数不符 → 拒绝。"""
    session_id, content = _open_session(client, headers, [_split_case_row()])
    response = _resolve(
        client,
        headers,
        session_id,
        [
            {
                "excel_row_no": 3,
                "resolution": {
                    "finance": {
                        "sales_invoice": {
                            "phases": [
                                {"date": "2026-01-01", "amount": "300.00", "document_no": "DOC-1"}
                            ]
                        }
                    }
                },
            }
        ],
    )
    assert response.status_code == 422, response.text
    assert "期" in response.json()["detail"]
    assert _commit(client, headers, session_id, content).status_code == 422
    assert _count("sales_invoice") == 0


def test_invalid_date_in_revision_is_rejected(client: TestClient, headers: dict[str, str]) -> None:
    """修正里出现不存在的日期或超范围年份 → 拒绝。"""
    session_id, content = _open_session(client, headers, [_split_case_row()])
    response = _resolve(
        client,
        headers,
        session_id,
        [
            {
                "excel_row_no": 3,
                "resolution": {
                    "finance": {
                        "sales_invoice": {
                            "phases": [
                                {"date": "2026-02-30", "amount": "100.00"},
                                {"date": "2026-02-01", "amount": "200.00"},
                            ]
                        }
                    }
                },
            }
        ],
    )
    assert response.status_code == 422, response.text
    assert _commit(client, headers, session_id, content).status_code == 422
    assert _count("sales_invoice") == 0


def test_negative_amount_in_revision_is_rejected(client: TestClient, headers: dict[str, str]) -> None:
    """金额沿用现有业务规则：不能为负，最多两位小数。"""
    session_id, content = _open_session(client, headers, [_split_case_row()])
    response = _resolve(
        client,
        headers,
        session_id,
        [
            {
                "excel_row_no": 3,
                "resolution": {
                    "finance": {
                        "sales_invoice": {
                            "phases": [
                                {"date": "2026-01-01", "amount": "-100.00"},
                                {"date": "2026-02-01", "amount": "400.00"},
                            ],
                            "total_correction_reason": "把负数改掉",
                        }
                    }
                },
            }
        ],
    )
    assert response.status_code == 422, response.text
    assert _commit(client, headers, session_id, content).status_code == 422
    assert _count("sales_invoice") == 0


# --- 3：部分修正不得丢掉其他财务组 ------------------------------------------


def test_partial_finance_revision_keeps_other_groups(client: TestClient, headers: dict[str, str]) -> None:
    """只修正销售开票组，采购付款组必须原样保留。"""
    row = _row(
        {
            INVOICE_DATE: "2026/01/01/2026/02/01",
            INVOICE_AMOUNT: "300",
            PAY_DATE: "2026/01/05",
            PAY_VOUCHER: "PAY-1",
            PAY_AMOUNT: "70",
        }
    )
    session_id, content = _open_session(client, headers, [row])
    response = _resolve(
        client,
        headers,
        session_id,
        [
            {
                "excel_row_no": 3,
                "resolution": {
                    "finance": {
                        "sales_invoice": {
                            "phases": [
                                {"date": "2026-01-01", "amount": "100.00", "document_no": "DOC-1"},
                                {"date": "2026-02-01", "amount": "200.00", "document_no": "DOC-2"},
                            ]
                        }
                    }
                },
            }
        ],
    )
    assert response.status_code == 200, response.text
    assert _summary(client, headers, session_id)["comparable"] is True

    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 200, commit.text
    with db() as conn:
        payment = conn.execute(
            text("SELECT payment_date, payment_voucher_no, payment_amount FROM purchase_payment")
        ).mappings().all()
    assert len(payment) == 1, "未修改的采购付款组被丢掉了"
    assert str(payment[0]["payment_amount"]) == "70.00"
    assert payment[0]["payment_voucher_no"] == "PAY-1"


# --- 9 / 10：空行与第二组列 ------------------------------------------------


def test_blank_row_in_middle_keeps_row_correspondence(client: TestClient, headers: dict[str, str]) -> None:
    """文件中部有空行时，规范化后每行的财务与历史仍对应原始行。"""
    first = _row({13: "SO-FIRST", 15: "服务器", INVOICE_AMOUNT: "111", INVOICE_DATE: "2026/01/01"})
    blank = [None] * 91
    second = _row({13: "SO-SECOND", 15: "交换机", INVOICE_AMOUNT: "222", INVOICE_DATE: "2026/02/02"})
    session_id, content = _open_session(client, headers, [first, blank, second])
    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 200, commit.text
    assert commit.json()["success_rows"] == 2

    with db() as conn:
        rows = conn.execute(
            text(
                "SELECT so.order_no, ol.goods_name, si.invoice_amount "
                "FROM sales_invoice si "
                "JOIN order_line ol ON ol.id = si.order_line_id "
                "JOIN sales_order so ON so.id = ol.sales_order_id "
                "ORDER BY so.order_no"
            )
        ).mappings().all()
    assert [(r["order_no"], r["goods_name"], str(r["invoice_amount"])) for r in rows] == [
        ("SO-FIRST", "服务器", "111.00"),
        ("SO-SECOND", "交换机", "222.00"),
    ]


def test_second_group_merges_with_in_cell_multi_values(
    client: TestClient, headers: dict[str, str]
) -> None:
    """第一组单元格内两期 + 第二组列一期：期次顺序、来源与金额都正确。"""
    row = _row(
        {
            PAY_DATE: "2026/01/05/2026/02/05",
            PAY_VOUCHER: "PAY-1/PAY-2",
            PAY_AMOUNT: "70/80",
            PAY2_DATE: date(2026, 3, 5),
            PAY2_VOUCHER: "PAY-3",
            PAY2_AMOUNT: Decimal("90.00"),
        }
    )
    session_id, content = _open_session(client, headers, [row])
    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 200, commit.text

    with db() as conn:
        rows = conn.execute(
            text(
                "SELECT phase_no, payment_date, payment_voucher_no, payment_amount "
                "FROM purchase_payment WHERE deleted_at IS NULL ORDER BY phase_no"
            )
        ).mappings().all()
    assert [
        (int(r["phase_no"]), str(r["payment_date"]), r["payment_voucher_no"], str(r["payment_amount"]))
        for r in rows
    ] == [
        (1, "2026-01-05", "PAY-1", "70.00"),
        (2, "2026-02-05", "PAY-2", "80.00"),
        (3, "2026-03-05", "PAY-3", "90.00"),
    ]


def test_second_group_receipt_merges_with_in_cell_multi_values(
    client: TestClient, headers: dict[str, str]
) -> None:
    """回款同理：第一组两期 + 第二组一期，共三期且一一对应。"""
    row = _row(
        {
            RECEIPT_DATE: "2026/01/10/2026/02/10",
            RECEIPT_NOTICE: "RC-1/RC-2",
            RECEIPT_AMOUNT: "11/22",
            RECEIPT2_DATE: date(2026, 3, 10),
            RECEIPT2_NOTICE: "RC-3",
            RECEIPT2_AMOUNT: Decimal("33.00"),
        }
    )
    session_id, content = _open_session(client, headers, [row])
    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 200, commit.text

    with db() as conn:
        rows = conn.execute(
            text(
                "SELECT phase_no, receipt_date, payment_notice_no, receipt_amount "
                "FROM sales_receipt WHERE deleted_at IS NULL ORDER BY phase_no"
            )
        ).mappings().all()
    assert [
        (int(r["phase_no"]), str(r["receipt_date"]), r["payment_notice_no"], str(r["receipt_amount"]))
        for r in rows
    ] == [
        (1, "2026-01-10", "RC-1", "11.00"),
        (2, "2026-02-10", "RC-2", "22.00"),
        (3, "2026-03-10", "RC-3", "33.00"),
    ]


# --- 4 / 6：别名与历史链 ----------------------------------------------------


def _seed_order(client: TestClient, headers: dict[str, str], rows: list[list[object]]) -> None:
    """用普通导入预置已有业务数据。"""
    response = client.post(
        "/api/orders/import-excel?filename=seed.xlsx", content=_workbook(rows), headers=headers
    )
    assert response.status_code == 200, response.text


def test_existing_history_survives_import_with_current_value_only(
    client: TestClient, headers: dict[str, str]
) -> None:
    """已确认的别名链在后续只填当前号的文件中不被截短。"""
    session_id, content = _open_session(client, headers, [_row({13: "SO-A/SO-B/SO-C"})])
    assert _commit(client, headers, session_id, content).status_code == 200

    session_id2, content2 = _open_session(client, headers, [_row({13: "SO-C", 15: "交换机"})])
    commit = _commit(client, headers, session_id2, content2)
    assert commit.status_code == 200, commit.text

    with db() as conn:
        chain = conn.execute(
            text("SELECT order_no FROM sales_order_number_history ORDER BY history_order")
        ).scalars().all()
        order_no = conn.execute(text("SELECT order_no FROM sales_order")).scalar()
    assert list(chain) == ["SO-A", "SO-B", "SO-C"], "已确认的历史别名被截短了"
    assert order_no == "SO-C"


def test_multi_row_manager_chain_conflict_is_not_resolved_by_first_row(
    client: TestClient, headers: dict[str, str]
) -> None:
    """同一框架多行给出不同的负责人链：不得静默按首行覆盖。"""
    rows = [
        _row({5: "甲/乙", 15: "服务器"}),
        _row({5: "甲/丙", 15: "交换机"}),
    ]
    session_id, content = _open_session(client, headers, rows)
    assert _summary(client, headers, session_id)["comparable"] is False
    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 422, commit.text
    assert _count("project") == 0
    assert _count("order_line") == 0


def test_multi_row_order_chain_conflict_is_not_resolved_by_first_row(
    client: TestClient, headers: dict[str, str]
) -> None:
    """同一订单多行给出不同的别名链（现任不同）：必须阻断。"""
    rows = [
        _row({13: "SO-A/SO-B", 15: "服务器"}),
        _row({13: "SO-A/SO-C", 15: "交换机"}),
    ]
    session_id, content = _open_session(client, headers, rows)
    assert _summary(client, headers, session_id)["comparable"] is False
    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 422, commit.text
    assert _count("order_line") == 0
    assert _count("sales_order") == 0


def _seed_via_preview(client: TestClient, headers: dict[str, str], rows: list[list[object]]) -> None:
    """用预检提交预置已有业务数据（可带别名链）。"""
    session_id, content = _open_session(client, headers, rows)
    response = _commit(client, headers, session_id, content)
    assert response.status_code == 200, response.text


def test_alias_conflict_with_another_order_blocks_whole_batch(
    client: TestClient, headers: dict[str, str]
) -> None:
    """同一框架内，文件的别名链命中另一个已有订单 → 整批阻断，不自动合并。"""
    _seed_via_preview(client, headers, [_row({13: "SO-OLD/SO-OTHER", 15: "服务器"})])

    session_id, content = _open_session(client, headers, [_row({13: "SO-OTHER/SO-NEW", 15: "交换机"})])
    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 422, commit.text
    with db() as conn:
        orders = conn.execute(text("SELECT COUNT(*) FROM sales_order")).scalar()
        lines = conn.execute(text("SELECT COUNT(*) FROM order_line")).scalar()
    assert int(orders) == 1, "冲突时不得新建订单"
    assert int(lines) == 1, "冲突时不得追加明细"


def test_plain_import_blocks_order_number_change(
    client: TestClient, headers: dict[str, str]
) -> None:
    """文件里写了改号链时，普通导入整批拒绝：不改号，也不另建订单。"""
    _seed_order(client, headers, [_row({13: "SO-KEEP", 15: "服务器"})])

    response = client.post(
        "/api/orders/import-excel?filename=rename.xlsx",
        content=_workbook([_row({13: "SO-KEEP/SO-CHANGED", 15: "交换机"})]),
        headers=headers,
    )
    assert response.status_code == 422, response.text
    with db() as conn:
        order_nos = list(
            conn.execute(text("SELECT order_no FROM sales_order ORDER BY id")).scalars().all()
        )
        lines = int(conn.execute(text("SELECT COUNT(*) FROM order_line")).scalar() or 0)
    assert order_nos == ["SO-KEEP"], "普通导入自动改号或另建了订单"
    assert lines == 1, "被拒绝的批次不得追加明细"


def test_plain_import_blocks_multi_value_manager(
    client: TestClient, headers: dict[str, str]
) -> None:
    """文件里的交接链同样不能在普通导入里静默落库。"""
    response = client.post(
        "/api/orders/import-excel?filename=handover.xlsx",
        content=_workbook([_row({5: "甲/乙"})]),
        headers=headers,
    )
    assert response.status_code == 422, response.text
    assert _count("order_line") == 0
    assert _count("project") == 0


def test_plain_import_still_allows_a_genuinely_new_order(
    client: TestClient, headers: dict[str, str]
) -> None:
    """同一框架下新增另一个订单是合法操作，不因改号防护被误伤。"""
    _seed_order(client, headers, [_row({13: "SO-1", 15: "服务器"})])
    response = client.post(
        "/api/orders/import-excel?filename=second.xlsx",
        content=_workbook([_row({13: "SO-2", 14: "子项目乙", 15: "交换机"})]),
        headers=headers,
    )
    assert response.status_code == 200, response.text
    with db() as conn:
        order_nos = sorted(
            conn.execute(text("SELECT order_no FROM sales_order")).scalars().all()
        )
    assert order_nos == ["SO-1", "SO-2"]


# --- 7 / 8：整批回滚与备份 ------------------------------------------------


def test_invalid_last_phase_rolls_back_whole_batch(client: TestClient, headers: dict[str, str]) -> None:
    """最后一行的财务日期非法 → 整批回滚，前面已处理的行也不落地。"""
    rows = [
        _row({13: "SO-OK", 15: "服务器", INVOICE_AMOUNT: "100", INVOICE_DATE: "2026/01/01"}),
        _row({13: "SO-BAD", 15: "交换机", INVOICE_AMOUNT: "200", INVOICE_DATE: "2099/12/31/2100/01/01"}),
    ]
    session_id, content = _open_session(client, headers, rows)
    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 422, commit.text
    assert _count("order_line") == 0
    assert _count("sales_invoice") == 0
    assert _count("sales_order") == 0


def test_backup_failure_blocks_commit(
    client: TestClient, headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """导入前备份失败时不得写入任何业务数据。"""
    from app.routers import orders as orders_router

    def _boom(*args, **kwargs):
        raise RuntimeError("备份不可用")

    monkeypatch.setattr(orders_router, "create_backup", _boom)
    session_id, content = _open_session(client, headers, [_row()])
    commit = _commit(client, headers, session_id, content)
    assert commit.status_code >= 400, commit.text
    assert _count("order_line") == 0
    assert _count("project") == 0
    assert _count("sales_order") == 0


# --- 与库内现状的一致性（提交前再次校验） -----------------------------------


def _manager_chain() -> list[str]:
    with db() as conn:
        return list(
            conn.execute(
                text("SELECT manager_name FROM project_manager_history ORDER BY history_order")
            ).scalars().all()
        )


def test_same_number_in_another_framework_is_allowed(
    client: TestClient, headers: dict[str, str]
) -> None:
    """跨框架同号是合法的：冲突判定只在本框架内。"""
    _seed_via_preview(client, headers, [_row({2: "P-ONE", 13: "SO-SHARED", 15: "服务器"})])
    session_id, content = _open_session(
        client, headers, [_row({2: "P-TWO", 13: "SO-SHARED", 15: "服务器"})]
    )
    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 200, commit.text
    assert _count("sales_order") == 2


def test_manager_change_against_existing_project_is_blocked(
    client: TestClient, headers: dict[str, str]
) -> None:
    """已有框架的现任负责人不能被普通预检提交改掉——那需要整体交接。"""
    _seed_via_preview(client, headers, [_row({5: "张三", 15: "服务器"})])
    session_id, content = _open_session(client, headers, [_row({5: "李四", 15: "交换机"})])
    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 422, commit.text
    with db() as conn:
        current = conn.execute(text("SELECT account_manager FROM project")).scalar()
        lines = int(conn.execute(text("SELECT COUNT(*) FROM order_line")).scalar() or 0)
    assert current == "张三"
    assert lines == 1, "被拒绝的批次不得追加明细"


def test_manager_history_order_is_preserved_and_not_truncated(
    client: TestClient, headers: dict[str, str]
) -> None:
    """甲→乙→甲 保留三个位置；后续只填现任的文件不得截短它。"""
    _seed_via_preview(client, headers, [_row({5: "甲/乙/甲", 15: "服务器"})])
    assert _manager_chain() == ["甲", "乙", "甲"]

    session_id, content = _open_session(client, headers, [_row({5: "甲", 15: "交换机"})])
    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 200, commit.text
    assert _manager_chain() == ["甲", "乙", "甲"], "已确认的任职顺序被截短或去重"
    with db() as conn:
        current = conn.execute(text("SELECT account_manager FROM project")).scalar()
    assert current == "甲"


def test_manager_history_can_be_extended_only_when_order_is_provable(
    client: TestClient, headers: dict[str, str]
) -> None:
    """文件补充缺失历史且现任一致 → 允许补充；顺序无法证明 → 阻断。"""
    _seed_via_preview(client, headers, [_row({5: "乙/丙", 15: "服务器"})])

    session_id, content = _open_session(client, headers, [_row({5: "甲/乙/丙", 15: "交换机"})])
    blocked = _commit(client, headers, session_id, content)
    assert blocked.status_code == 200, blocked.text
    assert _manager_chain() == ["甲", "乙", "丙"]

    session_id2, content2 = _open_session(client, headers, [_row({5: "乙/甲/丙", 15: "打印机"})])
    conflict = _commit(client, headers, session_id2, content2)
    assert conflict.status_code == 422, conflict.text
    assert _manager_chain() == ["甲", "乙", "丙"], "冲突的链不得覆盖已确认顺序"


def test_commit_rechecks_aliases_against_current_database_state(
    client: TestClient, headers: dict[str, str]
) -> None:
    """预检通过后库内又出现占用同一编号的订单 → 提交时再次校验并阻断。"""
    session_id, content = _open_session(client, headers, [_row({13: "SO-A/SO-B", 15: "服务器"})])
    _seed_via_preview(client, headers, [_row({13: "SO-X/SO-B", 15: "交换机"})])

    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 422, commit.text
    assert _count("order_line") == 1, "被拒绝的批次不得写入明细"


# --- 疑似重复与审计 ---------------------------------------------------------


def test_due_payment_date_alone_is_kept(client: TestClient, headers: dict[str, str]) -> None:
    """整行只填了到期付款日（没有付款日期与金额）时，该字段不能丢。"""
    row = _row({54: date(2026, 6, 30)})
    session_id, content = _open_session(client, headers, [row])
    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 200, commit.text
    with db() as conn:
        rows = conn.execute(
            text(
                "SELECT phase_no, due_payment_date, payment_date, payment_amount "
                "FROM purchase_payment WHERE deleted_at IS NULL ORDER BY phase_no"
            )
        ).mappings().all()
    assert len(rows) == 1
    assert str(rows[0]["due_payment_date"]) == "2026-06-30"
    assert rows[0]["payment_date"] is None
    assert rows[0]["payment_amount"] is None


def test_due_payment_date_is_not_written_twice(client: TestClient, headers: dict[str, str]) -> None:
    """有付款日期与金额时，到期付款日只作为行级值带到每一期，不额外多写一条。"""
    row = _row(
        {
            54: date(2026, 6, 30),
            PAY_DATE: "2026/01/05/2026/02/05",
            PAY_VOUCHER: "PAY-1/PAY-2",
            PAY_AMOUNT: "70/80",
        }
    )
    session_id, content = _open_session(client, headers, [row])
    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 200, commit.text
    with db() as conn:
        rows = conn.execute(
            text(
                "SELECT phase_no, due_payment_date, payment_amount FROM purchase_payment "
                "WHERE deleted_at IS NULL ORDER BY phase_no"
            )
        ).mappings().all()
    assert [(int(r["phase_no"]), str(r["payment_amount"])) for r in rows] == [
        (1, "70.00"),
        (2, "80.00"),
    ]
    assert all(str(r["due_payment_date"]) == "2026-06-30" for r in rows)


def test_duplicate_phase_across_column_groups_is_flagged_not_deduplicated(
    client: TestClient, headers: dict[str, str]
) -> None:
    """同一笔同时填在两组付款列里：不静默去重、也不双计，只标为疑似重复。"""
    row = _row(
        {
            PAY_DATE: "2026/01/05",
            PAY_VOUCHER: "PAY-1",
            PAY_AMOUNT: "70",
            PAY2_DATE: date(2026, 1, 5),
            PAY2_VOUCHER: "PAY-1",
            PAY2_AMOUNT: Decimal("70.00"),
        }
    )
    session_id, content = _open_session(client, headers, [row])
    assert _summary(client, headers, session_id)["comparable"] is True, "疑似重复不应阻断提交"
    rows = client.get(
        f"/api/orders/import-preview/{session_id}", headers=headers
    ).json()["rows"]["items"]
    codes = [issue["code"] for issue in rows[0]["parsed"]["issues"]]
    assert "DUPLICATE_PHASE_SUSPECTED" in codes

    commit = _commit(client, headers, session_id, content)
    assert commit.status_code == 200, commit.text
    with db() as conn:
        amounts = [
            str(value)
            for value in conn.execute(
                text(
                    "SELECT payment_amount FROM purchase_payment "
                    "WHERE deleted_at IS NULL ORDER BY phase_no"
                )
            ).scalars().all()
        ]
    assert amounts == ["70.00", "70.00"], "两处都填了就要写两期，不能静默去重"


def test_manual_resolution_writes_audit_log(client: TestClient, headers: dict[str, str]) -> None:
    """人工修正必须留下审计：操作者、时间、以及合计修正的原值/修正值/理由。"""
    session_id, _ = _open_session(client, headers, [_split_case_row()])
    response = _resolve(
        client,
        headers,
        session_id,
        [
            {
                "excel_row_no": 3,
                "resolution": {
                    "finance": {
                        "sales_invoice": {
                            "phases": [
                                {"date": "2026-01-01", "amount": "100.00", "document_no": "DOC-1"},
                                {"date": "2026-02-01", "amount": "150.00", "document_no": "DOC-2"},
                            ],
                            "total_correction_reason": "原合计 300 写错，实际两期合计 250",
                        }
                    }
                },
            }
        ],
    )
    assert response.status_code == 200, response.text

    with db() as conn:
        log = conn.execute(
            text(
                "SELECT user_name, detail FROM operation_log "
                "WHERE action_name = 'resolve_legacy_import' ORDER BY id DESC LIMIT 1"
            )
        ).mappings().first()
        stored = conn.execute(
            text(
                "SELECT resolution_json FROM legacy_import_source "
                "WHERE session_id = :id AND excel_row_no = 3"
            ),
            {"id": session_id},
        ).scalar()
    assert log is not None, "人工修正没有写审计日志"
    assert "admin" in log["user_name"], "审计没有记录操作者"
    detail = log["detail"] if isinstance(log["detail"], str) else str(log["detail"])
    assert "300" in detail and "250" in detail, "审计里没有记录合计的原值与修正值"
    assert "原合计 300 写错" in detail, "审计里没有记录修正理由"
    assert "服务器" not in detail, "审计日志不得输出原始业务内容"
    stored_text = stored if isinstance(stored, str) else str(stored)
    assert "原合计 300 写错" in stored_text, "理由必须落在会话记录里"
