"""Import an authoritative ledger without inferring renames or financial allocations.

Source rows are business records, including repeated rows. File digests prevent
replaying a completed file. All mutations run in the caller's locked transaction.
"""
from collections import Counter
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
from io import BytesIO
import json

from fastapi import HTTPException
from openpyxl import load_workbook
from sqlalchemy import text

from .importer import import_excel, validate_template_numbers
from .ledger_excel import standard_template_version, normalize_standard_row, TEMPLATE_HEADERS
from .legacy_ledger_parser import parse_date_sequence, parse_amount_sequence, parse_document_sequence
from .legacy_import_service import FINANCE_SOURCES, PHASE_TABLE_COLUMNS
from .validation import validate_business_date
from .financial_calculations import refresh_balances
from .edit_versions import touch_line


def source_text(value):
    if value is None:
        return None
    return value.isoformat() if isinstance(value, (datetime, date)) else str(value)


def source_phases(date_value, amount_value, document_value):
    """Only split proven positional pairs. Otherwise retain one undated total."""
    dates = parse_date_sequence(date_value)
    amounts = parse_amount_sequence(amount_value)
    documents = parse_document_sequence(document_value)
    if amounts.blocking or any(not a.is_finite() or abs(a) > Decimal('9999999999999999.99') for a in amounts.values):
        raise ValueError('财务金额无效或超出范围')
    total = sum(amounts.values, Decimal(0)) if amounts.values else None
    if total is not None:
        total = total.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
    if len(dates.values) == len(amounts.values) > 1 and not dates.blocking and len(documents.values) in (0, len(dates.values)):
        return [(validate_business_date(d), d.isoformat(), a.quantize(Decimal('.01'), rounding=ROUND_HALF_UP), documents.values[i] if documents.values else None)
                for i, (d, a) in enumerate(zip(dates.values, amounts.values))], False
    actual_date = validate_business_date(dates.values[0]) if not dates.blocking and len(dates.values) == 1 else None
    return [(actual_date, source_text(date_value), total, source_text(document_value))], bool(
        dates.blocking or len(dates.values) > 1 or (total is not None and actual_date is None))


def import_source(conn, content, filename, user, *, preview=False, duplicate_confirmation=None):
    digest = sha256(content).hexdigest()
    existing = conn.execute(text("SELECT id,success_rows FROM import_batch WHERE source_sha256=:sha AND status IN ('completed','reverted') LIMIT 1"), {'sha':digest}).mappings().first()
    if existing:
        raise HTTPException(409, f"这份文件已经导入（批次 {existing['id']}，{existing['success_rows']} 行），未重复写入")
    wb = load_workbook(BytesIO(content), data_only=True)
    candidates = [s for s in wb if standard_template_version([c.value for c in s[2]])]
    if len(candidates) != 1:
        raise ValueError('请使用包含唯一业务工作表的 0916 新版92列或原版91列模板')
    ws = candidates[0]
    version = standard_template_version([c.value for c in ws[2]])
    originals, records, warnings = {}, {}, []
    groups = dict(FINANCE_SOURCES)
    groups['finance_payment_entry'] = groups.pop('finance_invoice_check')
    # Sales document number and invoice number are separate source columns.
    groups['sales_invoice'] = ((74, 76, 75),)
    for row_no, cells in enumerate(ws.iter_rows(min_row=3), 3):
        values = [c.value for c in cells]
        if not any(v not in (None, '') for v in values):
            continue
        if len(originals) >= 20000:
            raise ValueError('单次最多20,000行')
        row = normalize_standard_row(values, version)
        if not row[1] or not row[12] or not row[14]:
            raise ValueError(f'第 {row_no} 行缺少项目编号、销售订单号或物资/服务名称')
        originals[row_no] = row[:]
        for col in (19,25):
            if cells[col-1].data_type == 'e':
                warnings.append({'row':row_no,'field':TEMPLATE_HEADERS[col-1],'message':f'原表税率公式为 {row[col-1]}，保留原始值，税率留空，不影响已填金额'})
                row[col-1] = None
        records[row_no] = {}
        for name, sources in groups.items():
            phases = []
            for dc, ac, nc in sources:
                if all(row[c-1] in (None, '') for c in (dc, ac, nc)):
                    continue
                parts, aggregate = source_phases(row[dc-1], row[ac-1], row[nc-1])
                phases.extend(parts)
                if aggregate:
                    warnings.append({'row':row_no, 'field':TEMPLATE_HEADERS[ac-1], 'message':'保留原日期文本及合计金额，不分摊；无单一日期的金额不归入某一天'})
            records[row_no][name] = phases
        for sources in groups.values():
            for columns in sources:
                for col in columns:
                    row[col-1] = None
        row[72] = None  # invoice_doc_no is restored with the sales invoice records
        # Excel binary precision is normalized to the database's documented scale.
        # Original unrounded values remain in the positional source archive.
        for col in (18,20,21,26,27,31,23,29,42,70,91,92):
            value = row[col-1]
            if value in (None, ''):
                continue
            number = Decimal(str(value))
            if not number.is_finite() or abs(number) > Decimal('999999999999.99'):
                raise ValueError(f'第 {row_no} 行 {TEMPLATE_HEADERS[col-1]} 无效或超出范围')
            scale = Decimal('.000001') if col in (18,20,21,26,27,31) else Decimal('.01')
            row[col-1] = number.quantize(scale, rounding=ROUND_HALF_UP)
        for col, value in enumerate(row, 1):
            ws.cell(row_no, col).value = value
    for col, label in enumerate(TEMPLATE_HEADERS, 1):
        ws.cell(2,col).value = label
    for other in list(wb):
        if other != ws:
            wb.remove(other)
    if not originals:
        raise ValueError('文件没有业务数据')
    from .import_review import find_duplicates, summary
    duplicates = find_duplicates(conn, originals, user, digest)
    if duplicates['count'] and not preview and duplicate_confirmation != duplicates['confirmation_token']:
        raise HTTPException(409, '发现疑似重复明细或比对结果已变化，请重新预检并确认保留后再导入')
    normalized = BytesIO(); wb.save(normalized); wb.close()
    ids = {}
    result = import_excel(conn, reset=False, workbook_bytes=normalized.getvalue(), source_file_name=filename,
                          user=user, strict_template=True, preserve_source=True, line_id_map=ids)
    if result['failed_rows']:
        from .import_report import ImportReportError
        raise ImportReportError(result)
    written = Counter()
    for row_no, line_id in ids.items():
        row = originals[row_no]
        raw = json.dumps({'headers':TEMPLATE_HEADERS,'values':row}, ensure_ascii=False, default=source_text)
        conn.execute(text('UPDATE ledger_raw_row r JOIN order_line ol ON ol.raw_row_id=r.id SET r.raw_json=CAST(:raw AS JSON),r.row_hash=:hash WHERE ol.id=:id'),
                     {'id':line_id,'raw':raw,'hash':sha256((str(row_no)+':'+raw).encode()).hexdigest()})
        # Authoritative source totals take precedence over rounding from unit prices.
        for table, mapping in {
            'order_line': {'sales_unit_price_no_tax':20,'sales_unit_price':21,'revenue_no_tax':22,'order_value':23},
            'purchase_info': {'purchase_unit_price_no_tax':26,'purchase_unit_price':27,'cost_no_tax':28,'purchase_amount':29},
            'delivery_record': {'delivery_revenue_no_tax':32,'delivery_value':33,'delivery_cost_no_tax':34,'delivery_cost':35,
                                'pending_delivery_quantity':36,'pending_delivery_amount_no_tax':37,'pending_delivery_amount':38},
        }.items():
            params = {'id':line_id}
            assignments = []
            for field, col in mapping.items():
                value = row[col-1]
                params[field] = None if value in (None,'') else Decimal(str(value)).quantize(
                    Decimal('.000001') if 'unit_price' in field or field.endswith('quantity') else Decimal('.01'), rounding=ROUND_HALF_UP)
                assignments.append(f'{field}=:{field}')
            key = 'id' if table == 'order_line' else 'order_line_id'
            conn.execute(text(f"UPDATE {table} SET {','.join(assignments)} WHERE {key}=:id"), params)
        for name, phases in records[row_no].items():
            dc, nc, ac = PHASE_TABLE_COLUMNS[name]
            # A due-date-only payment created by the base importer belongs to phase 1.
            if name == 'purchase_payment' and phases:
                conn.execute(text('DELETE FROM purchase_payment WHERE order_line_id=:id'), {'id':line_id})
            for no, (dt, dt_text, amount, document) in enumerate(phases, 1):
                conn.execute(text(f'INSERT INTO {name} (order_line_id,phase_no,{dc},{dc}_text,{ac},{nc}) VALUES (:id,:phase,:date,:date_text,:amount,:document)'),
                             {'id':line_id,'phase':no,'date':dt,'date_text':dt_text,'amount':amount,'document':document})
                if name == 'sales_invoice':
                    conn.execute(text('UPDATE sales_invoice SET invoice_doc_no=:doc WHERE order_line_id=:id AND phase_no=:phase'),
                                 {'id':line_id,'phase':no,'doc':source_text(row[72])})
                written[name] += 1
            if name == 'purchase_payment' and phases and row[53] is not None:
                from .importer import _as_date
                conn.execute(text('UPDATE purchase_payment SET due_payment_date=:due WHERE order_line_id=:id AND phase_no=1'),{'id':line_id,'due':_as_date(row[53])})
        touch_line(conn, line_id)
        refresh_balances(conn, line_id)
    conn.execute(text('UPDATE import_batch SET source_sha256=:sha WHERE id=:id'), {'sha':digest,'id':result['batch_id']})
    return {**result,'source_sha256':digest,'warnings':warnings,'phase_counts':dict(written),'source_preserved':True,
            'layout':'0916 新版' if version == 92 else '原版台账','summary':summary(conn,result['batch_id']), 'duplicates':duplicates}
