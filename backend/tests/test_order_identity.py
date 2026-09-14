import pytest
from sqlalchemy import create_engine, text
from app.importer import _order_line_exists
from app.routers.orders import _validate_batch_update_targets, _calculated_payload_data
from fastapi import HTTPException
from app.routers.orders import OrderUpdate, _validate_batch_create_targets


@pytest.mark.parametrize('spec', [None, '', '型号A'])
def test_same_goods_in_different_named_projects_are_allowed(spec):
    rows = [OrderUpdate(project_code='P1', order_no='O1', project_name=name,
                        goods_name='设备', specification_model=spec, unit_price=100)
            for name in ['项目甲', '项目乙']]
    _validate_batch_create_targets(rows)


def test_same_project_duplicate_is_still_rejected():
    row = OrderUpdate(project_code='P1', order_no='O1', project_name='项目甲', goods_name='设备')
    with pytest.raises(HTTPException) as error:
        _validate_batch_create_targets([row, row])
    assert error.value.status_code == 409


@pytest.mark.parametrize('spec', [None, '', '型号A'])
def test_import_duplicate_query_uses_project_name_and_ignores_deleted(spec):
    engine = create_engine('sqlite://')
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE project (id INTEGER, project_code TEXT, project_name TEXT, deleted_at TEXT)'))
        conn.execute(text('CREATE TABLE sales_order (id INTEGER, project_id INTEGER, order_no TEXT, deleted_at TEXT)'))
        conn.execute(text('CREATE TABLE order_line (id INTEGER, sales_order_id INTEGER, project_name TEXT, goods_name TEXT, specification_model TEXT, deleted_at TEXT)'))
        conn.execute(text("INSERT INTO project VALUES (1, 'P1', '项目甲', NULL)"))
        conn.execute(text("INSERT INTO sales_order VALUES (1, 1, 'O1', NULL)"))
        conn.execute(text("INSERT INTO order_line VALUES (1, 1, '项目甲', '设备', :spec, NULL)"), {'spec': spec})
        assert _order_line_exists(conn, 'P1', 'O1', '设备', spec, '项目甲')
        assert not _order_line_exists(conn, 'P1', 'O1', '设备', spec, '项目乙')
        conn.execute(text("UPDATE order_line SET deleted_at = '2026-09-14'"))
        assert not _order_line_exists(conn, 'P1', 'O1', '设备', spec, '项目甲')


def test_batch_edit_keeps_distinct_projects_and_rejects_collision():
    engine = create_engine('sqlite://')
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE order_line (id INTEGER, sales_order_id INTEGER, project_name TEXT, goods_name TEXT, specification_model TEXT, deleted_at TEXT)'))
        conn.execute(text("INSERT INTO order_line VALUES (1, 1, '项目甲', '设备', NULL, NULL), (2, 1, '项目乙', '设备', NULL, NULL)"))
        ids = {'project_id': 1, 'sales_order_id': 1, 'order_line_id': 2}
        row = OrderUpdate(project_code='P1', order_no='O1', project_name='项目乙', goods_name='设备')
        _validate_batch_update_targets(conn, [(ids, row, _calculated_payload_data(row), {})])
        row.project_name = '项目甲'
        with pytest.raises(HTTPException) as error:
            _validate_batch_update_targets(conn, [(ids, row, _calculated_payload_data(row), {})])
        assert error.value.status_code == 409
