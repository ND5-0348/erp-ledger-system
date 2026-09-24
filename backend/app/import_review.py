"""Review source imports without deduplicating legitimate repeated transactions."""
import hashlib
import hmac
import json
from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from fastapi import HTTPException
from sqlalchemy import text, bindparam
from .auth import can_access_department
from .config import settings
from .backup import BACKUP_TABLES
from .serializers import clean_row


def dumps(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str, separators=(',', ':'))


def unpack(value):
    return json.loads(value) if isinstance(value, str) else value


def canonical(value):
    if value in (None, ''):
        return ''
    if isinstance(value, (datetime, date)):
        return value.isoformat()[:10]
    value = str(value).strip()
    try:
        number = Decimal(value)
        if number.is_finite():
            return str(number.quantize(Decimal('.000001')).normalize())
    except (InvalidOperation, ValueError):
        pass
    return value


def identity(row):
    return tuple(canonical(row[i-1]) for i in (2,13,14,15,16,17,18,21,24))


def find_duplicates(conn, originals, user, digest):
    candidates = defaultdict(list)
    rows = conn.execute(text('''SELECT r.raw_json,r.excel_row_no,r.import_batch_id,
        b.source_file_name,v.order_line_id,v.department,v.account_manager,v.order_value
        FROM ledger_raw_row r JOIN import_batch b ON b.id=r.import_batch_id
        JOIN order_line ol ON ol.raw_row_id=r.id
        JOIN v_order_line_finance v ON v.order_line_id=ol.id
        WHERE b.status='completed' ''')).mappings()
    for stored in rows:
        if not can_access_department(user, stored['department']):
            continue
        raw = unpack(stored['raw_json'])
        values = raw.get('values') if isinstance(raw, dict) else None
        if not isinstance(values, list) or len(values) < 24:
            continue
        candidates[identity(values)].append(clean_row({k:stored[k] for k in (
            'order_line_id','excel_row_no','import_batch_id','source_file_name','account_manager','order_value')}))
    matches, binding = [], []
    repeated = Counter(identity(row) for row in originals.values())
    for row_no, row in originals.items():
        existing = candidates.get(identity(row), [])
        if existing:
            matches.append({'row':row_no,'project_code':row[1],'order_no':row[12],'goods_name':row[14],
                            'order_amount':format(Decimal(str(row[22] or 0)).quantize(Decimal('.01'), rounding=ROUND_HALF_UP),'.2f'),'manager':row[4],
                            'match_count':len(existing),'matches':existing[:3]})
            binding.append([row_no, existing])
    signature = hmac.new(settings.auth_secret.encode(), (digest+dumps(binding)).encode(), hashlib.sha256).hexdigest() if matches else None
    return {'rows':matches,'count':len(matches),'within_file_rows':sum(n for n in repeated.values() if n>1),'confirmation_token':signature}


def batch_lines(conn, batch_id):
    return conn.execute(text('''SELECT ol.*,so.project_id FROM order_line ol JOIN ledger_raw_row r ON r.id=ol.raw_row_id
        JOIN sales_order so ON so.id=ol.sales_order_id WHERE r.import_batch_id=:id ORDER BY ol.id'''), {'id':batch_id}).mappings().all()


def batch_fingerprint(conn, batch_id):
    lines = batch_lines(conn, batch_id)
    if not lines:
        return None
    ids = [r['id'] for r in lines]
    orders = sorted({r['sales_order_id'] for r in lines})
    projects = sorted({r['project_id'] for r in lines})
    subprojects = sorted({r['sub_project_id'] for r in lines if r['sub_project_id']})
    selectors = {'order_line':('id',ids),'sales_order':('id',orders),'project':('id',projects),
                 'sub_project':('id',subprojects),'sales_order_number_history':('sales_order_id',orders),
                 'project_manager_history':('project_id',projects)}
    for table in BACKUP_TABLES[BACKUP_TABLES.index('purchase_info'):]:
        if table != 'legacy_import_audit_source':
            selectors[table] = ('order_line_id',ids)
    payload = {}
    for table,(column,values) in selectors.items():
        rows = conn.execute(text(f'SELECT * FROM {table} WHERE {column} IN :ids ORDER BY id').bindparams(bindparam('ids',expanding=True)),{'ids':values}).mappings().all() if values else []
        # Project versions advance when the enclosing import transaction finishes.
        payload[table] = [{k:v for k,v in r.items() if not (table=='project' and k in ('version','updated_at'))} for r in rows]
    # A subsequent line added to a shared order/project also blocks automatic undo.
    payload['membership'] = [dict(r) for r in conn.execute(text('''SELECT ol.id,ol.sales_order_id,ol.sub_project_id,ol.deleted_at FROM order_line ol
        JOIN sales_order so ON so.id=ol.sales_order_id WHERE so.project_id IN :ids ORDER BY ol.id''').bindparams(bindparam('ids',expanding=True)),{'ids':projects}).mappings()]
    return hashlib.sha256(dumps(payload).encode()).hexdigest()


def summary(conn, batch_id):
    row = conn.execute(text('''SELECT COUNT(*) AS line_count,COUNT(DISTINCT v.project_code) AS project_count,
        COUNT(DISTINCT ol.sales_order_id) AS order_count,SUM(v.order_value) AS order_amount,
        SUM(v.delivery_value) AS delivery_amount,SUM(v.sales_invoice_amount) AS invoice_amount,
        SUM(v.total_received) AS receipt_amount FROM v_order_line_finance v
        JOIN order_line ol ON ol.id=v.order_line_id JOIN ledger_raw_row r ON r.id=ol.raw_row_id
        WHERE r.import_batch_id=:id'''),{'id':batch_id}).mappings().one()
    return {k:(int(v or 0) if k.endswith('_count') else format(Decimal(v or 0),'.2f')) for k,v in row.items()}


def assert_batch_access(conn, batch, user):
    if 'system_admin' not in user.permissions and batch['uploaded_by'] != user.id:
        raise HTTPException(404,'导入批次不存在或无权访问')
    for row in batch_lines(conn,batch['id']):
        department = row['line_department'] if row['source_preserved'] else conn.execute(text('SELECT department FROM project WHERE id=:id'),{'id':row['project_id']}).scalar()
        if not can_access_department(user,department):
            raise HTTPException(403,'该批次含无权查看的部门数据')
