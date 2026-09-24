import pytest
from sqlalchemy import create_engine, text
from app.importer import _order_line_exists
from app.routers.orders import _validate_batch_update_targets, _calculated_payload_data
from fastapi import HTTPException
from app.routers.orders import OrderUpdate, _validate_batch_create_targets

LINE_TABLE = (
    'CREATE TABLE order_line (id INTEGER, sales_order_id INTEGER, sub_project_id INTEGER, project_name TEXT,'
    ' goods_name TEXT, specification_model TEXT, quantity NUMERIC, sales_unit_price NUMERIC,'
    ' source_preserved INTEGER DEFAULT 0, deleted_at TEXT)'
)
SUB_PROJECT_TABLE = (
    'CREATE TABLE sub_project (id INTEGER, sales_order_id INTEGER, name TEXT, deleted_at TEXT)'
)
PURCHASE_TABLE = (
    'CREATE TABLE purchase_info (id INTEGER, order_line_id INTEGER, supplier_name TEXT, deleted_at TEXT)'
)


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


def test_same_line_with_different_quantity_or_price_is_allowed():
    base = dict(project_code='P1', order_no='O1', project_name='项目甲', goods_name='设备')
    _validate_batch_create_targets([
        OrderUpdate(**base, quantity=4, unit_price=74),
        OrderUpdate(**base, quantity=1, unit_price=106),
    ])
    _validate_batch_create_targets([
        OrderUpdate(**base, quantity=4, unit_price=74),
        OrderUpdate(**base, quantity=4, unit_price=75),
    ])
    with pytest.raises(HTTPException) as error:
        _validate_batch_create_targets([
            OrderUpdate(**base, quantity=4, unit_price=74),
            OrderUpdate(**base, quantity=4, unit_price=74),
        ])
    assert error.value.status_code == 409


def test_same_line_with_different_supplier_is_allowed():
    base = dict(project_code='P1', order_no='O1', project_name='项目甲', goods_name='设备',
                quantity=4, unit_price=74)
    _validate_batch_create_targets([
        OrderUpdate(**base, supplier_name='安徽恒米科技有限公司'),
        OrderUpdate(**base, supplier_name='安徽美迪来纸制品有限公司'),
    ])
    with pytest.raises(HTTPException) as error:
        _validate_batch_create_targets([
            OrderUpdate(**base, supplier_name='安徽恒米科技有限公司'),
            OrderUpdate(**base, supplier_name='安徽恒米科技有限公司'),
        ])
    assert error.value.status_code == 409


def _line_engine(quantity=740, sales_unit_price=2.26, spec=None, supplier='天翼电信终端有限公司安徽分公司'):
    engine = create_engine('sqlite://')
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE project (id INTEGER, project_code TEXT, project_name TEXT, deleted_at TEXT)'))
        conn.execute(text('CREATE TABLE sales_order (id INTEGER, project_id INTEGER, order_no TEXT, deleted_at TEXT)'))
        conn.execute(text(SUB_PROJECT_TABLE))
        conn.execute(text(LINE_TABLE))
        conn.execute(text(PURCHASE_TABLE))
        conn.execute(text("INSERT INTO project VALUES (1, 'P1', '项目甲', NULL)"))
        conn.execute(text("INSERT INTO sales_order VALUES (1, 1, 'O1', NULL)"))
        # 同一订单下的两个子项目：客户单位等属于子项目，可以各自不同。
        conn.execute(text("INSERT INTO sub_project VALUES (1, 1, '项目甲', NULL)"))
        conn.execute(text("INSERT INTO sub_project VALUES (2, 1, '项目乙', NULL)"))
        conn.execute(
            text(
                'INSERT INTO order_line (id, sales_order_id, sub_project_id, project_name, goods_name,'
                ' specification_model, quantity, sales_unit_price, deleted_at)'
                ' VALUES (1, 1, 1, :name, :goods, :spec, :quantity, :price, NULL)'
            ),
            {'name': '项目甲', 'goods': '设备', 'spec': spec, 'quantity': quantity, 'price': sales_unit_price},
        )
        conn.execute(
            text('INSERT INTO purchase_info (id, order_line_id, supplier_name, deleted_at) VALUES (1, 1, :supplier, NULL)'),
            {'supplier': supplier},
        )
    return engine.connect()


@pytest.mark.parametrize('spec', [None, '', '型号A'])
def test_import_duplicate_query_is_scoped_to_one_sub_project(spec):
    """判重限定在同一子项目内；换一个子项目，五项完全相同也是合法明细。"""
    conn = _line_engine(spec=spec)
    with conn:
        assert _order_line_exists(conn, 1, '设备', spec, 740, 2.26, '天翼电信终端有限公司安徽分公司')
        assert not _order_line_exists(conn, 2, '设备', spec, 740, 2.26, '天翼电信终端有限公司安徽分公司')
        conn.execute(text("UPDATE order_line SET deleted_at = '2026-09-14'"))
        assert not _order_line_exists(conn, 1, '设备', spec, 740, 2.26, '天翼电信终端有限公司安徽分公司')


def test_import_duplicate_query_distinguishes_quantity_and_price():
    conn = _line_engine()
    with conn:
        assert not _order_line_exists(conn, 1, '设备', None, 1, 2.26, '天翼电信终端有限公司安徽分公司')
        assert not _order_line_exists(conn, 1, '设备', None, 740, 1.80, '天翼电信终端有限公司安徽分公司')
        assert _order_line_exists(conn, 1, '设备', None, 740, 2.26, '天翼电信终端有限公司安徽分公司')


def test_import_duplicate_query_distinguishes_supplier():
    conn = _line_engine()
    with conn:
        assert _order_line_exists(conn, 1, '设备', None, 740, 2.26, '天翼电信终端有限公司安徽分公司')
        assert not _order_line_exists(conn, 1, '设备', None, 740, 2.26, '安徽恒米科技有限公司')
        assert not _order_line_exists(conn, 1, '设备', None, 740, 2.26, None)
        assert _order_line_exists(conn, 1, '设备', None, 740, 2.26, ' 天翼电信终端有限公司安徽分公司 ')


def test_import_duplicate_query_treats_blank_and_zero_as_equal():
    conn = _line_engine(quantity=None, sales_unit_price=None, supplier=None)
    with conn:
        assert _order_line_exists(conn, 1, '设备', None, None, None, None)
        assert _order_line_exists(conn, 1, '设备', None, 0, 0, None)
        assert not _order_line_exists(conn, 1, '设备', None, 740, 0, None)


def _batch_conn(line_rows: str, purchase_rows: str = ''):
    engine = create_engine('sqlite://')
    with engine.begin() as setup:
        setup.execute(text(LINE_TABLE))
        setup.execute(text(PURCHASE_TABLE))
        setup.execute(text(line_rows))
        if purchase_rows:
            setup.execute(text(purchase_rows))
    return engine.connect()


IDS = {'project_id': 1, 'sales_order_id': 1, 'order_line_id': 2}


def test_batch_edit_keeps_distinct_projects_and_rejects_collision():
    conn = _batch_conn(
        "INSERT INTO order_line (id, sales_order_id, project_name, goods_name, specification_model,"
        " quantity, sales_unit_price, deleted_at) VALUES"
        " (1, 1, '项目甲', '设备', NULL, NULL, NULL, NULL), (2, 1, '项目乙', '设备', NULL, NULL, NULL, NULL)"
    )
    with conn:
        row = OrderUpdate(project_code='P1', order_no='O1', project_name='项目乙', goods_name='设备')
        _validate_batch_update_targets(conn, [(IDS, row, _calculated_payload_data(row), {})])
        row.project_name = '项目甲'
        with pytest.raises(HTTPException) as error:
            _validate_batch_update_targets(conn, [(IDS, row, _calculated_payload_data(row), {})])
        assert error.value.status_code == 409


def test_batch_edit_allows_same_name_when_quantity_differs():
    conn = _batch_conn(
        "INSERT INTO order_line (id, sales_order_id, project_name, goods_name, specification_model,"
        " quantity, sales_unit_price, deleted_at) VALUES"
        " (1, 1, '项目甲', '设备', NULL, 4, 74, NULL), (2, 1, '项目甲', '设备', NULL, 1, 106, NULL)"
    )
    with conn:
        row = OrderUpdate(project_code='P1', order_no='O1', project_name='项目甲', goods_name='设备',
                          quantity=1, unit_price=106)
        _validate_batch_update_targets(conn, [(IDS, row, _calculated_payload_data(row), {})])
        row.quantity = '4.000000'
        row.unit_price = '74.000000'
        with pytest.raises(HTTPException) as error:
            _validate_batch_update_targets(conn, [(IDS, row, _calculated_payload_data(row), {})])
        assert error.value.status_code == 409


def test_batch_edit_allows_same_name_when_supplier_differs():
    conn = _batch_conn(
        "INSERT INTO order_line (id, sales_order_id, project_name, goods_name, specification_model,"
        " quantity, sales_unit_price, deleted_at) VALUES"
        " (1, 1, '项目甲', '设备', NULL, 4, 74, NULL), (2, 1, '项目甲', '设备', NULL, 4, 74, NULL)",
        "INSERT INTO purchase_info (id, order_line_id, supplier_name, deleted_at) VALUES"
        " (1, 1, '安徽美迪来纸制品有限公司', NULL), (2, 2, '安徽恒米科技有限公司', NULL)",
    )
    with conn:
        row = OrderUpdate(project_code='P1', order_no='O1', project_name='项目甲', goods_name='设备',
                          quantity=4, unit_price=74, supplier_name='安徽恒米科技有限公司')
        _validate_batch_update_targets(conn, [(IDS, row, _calculated_payload_data(row), {})])
        row.supplier_name = '安徽美迪来纸制品有限公司'
        with pytest.raises(HTTPException) as error:
            _validate_batch_update_targets(conn, [(IDS, row, _calculated_payload_data(row), {})])
        assert error.value.status_code == 409
