import { OrderRecord } from '../types';

export const ORDER_IMPORT_TEMPLATE_HEADERS = [
  '项目编号',
  '订单号',
  '全额/净额',
  '部门',
  '分公司',
  '客户经理',
  '订单日期',
  '业务类型',
  '统计类别',
  '三级团队名称',
  '客户单位名称',
  '用户',
  '区域平台',
  '项目名称',
  '货物名称',
  '规格型号',
  '单位',
  '数量',
  '不含税单价',
  '单价',
  '不含税收入',
  '订单价值',
];

const SAMPLE_ROW = [
  'AH24000001-01',
  'XSDD202606290001',
  '全额',
  '科贸部',
  '安徽分公司',
  '张三',
  '2026-06-29',
  '设备销售',
  '政企客户',
  '供应链一组',
  '示例客户单位',
  '最终用户A',
  '合肥平台',
  '示例项目名称',
  '示例货物名称',
  '型号A',
  '台',
  '1',
  '1000',
  '1060',
  '1000',
  '1060',
];

export const ORDER_IMPORT_TEMPLATE_CSV = `${ORDER_IMPORT_TEMPLATE_HEADERS.join(',')}\r\n${SAMPLE_ROW.join(',')}\r\n`;

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function numberValue(value: string | undefined) {
  return Number.parseFloat(value || '') || 0;
}

export function parseOrderImportCsv(content: string, fallbackDate: string): OrderRecord[] {
  const [headerLine, ...rows] = content.split(/\r?\n/).filter((line) => line.trim());
  if (!headerLine) return [];

  const headers = parseCsvLine(headerLine);

  return rows.flatMap((row) => {
    const values = parseCsvLine(row);
    const data = headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = values[index] || '';
      return acc;
    }, {});
    const project = data['项目编号'] || data.projectId;
    const order = data['订单号'] || data.orderId;
    if (!project || !order) return [];

    const unit = data['单位'] || '';
    const quantity = data['数量'] || '0';

    return [
      {
        amountType: data['全额/净额'] || data.amountType || '全额',
        projectId: project,
        department: data['部门'] || '',
        branchCompany: data['分公司'] || '',
        manager: data['客户经理'] || '',
        orderId: order,
        orderDate: data['订单日期'] || fallbackDate,
        businessType: data['业务类型'] || '',
        statisticalCategory: data['统计类别'] || '',
        teamName: data['三级团队名称'] || '',
        clientUnit: data['客户单位名称'] || data['客户单位'] || data.clientUnit || '',
        userName: data['用户'] || '',
        regionalPlatform: data['区域平台'] || '',
        projectName: data['项目名称'] || '',
        goodsName: data['货物名称'] || data['货物/服务名称'] || data.goodsName || '',
        specModel: data['规格型号'] || '',
        unitName: unit,
        quantity: `${quantity} ${unit}`.trim(),
        netUnitPrice: numberValue(data['不含税单价']),
        unitPrice: numberValue(data['单价']),
        netRevenue: numberValue(data['不含税收入']),
        orderValue: numberValue(data['订单价值']),
        deliveredQty: 0,
      },
    ];
  });
}
