import re
from fastapi import HTTPException
from .ledger_excel import TEMPLATE_HEADERS


class ImportReportError(HTTPException):
    def __init__(self,result):
        issues=[]
        for message in result.get('errors',[]):
            match=re.search(r'第\s*(\d+)\s*行',message)
            columns=list(dict.fromkeys(h for h in TEMPLATE_HEADERS if h and h in message))
            issues.append({'row':int(match[1]) if match else 0,'column':' / '.join(columns) or '业务字段（见原因）','reason':message})
        self.report={'total_rows':result.get('total_rows',0),'valid_rows':result.get('success_rows',0),
                     'skipped_rows':result.get('skipped_rows',0),'error_count':len(issues),'errors':issues}
        # Keep the existing readable detail for older clients; full report is
        # separately serialized by the exception handler, without truncation.
        super().__init__(422,f"导入存在 {result['failed_rows']} 条错误数据，已整批回滚："+'；'.join(result.get('errors',[])[:3]))
