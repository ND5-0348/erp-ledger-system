export async function loadAllPages<T>(fetchPage: (params: { limit: number; offset: number }) => Promise<{ items: T[]; total: number }>) {
  const items: T[] = [];
  let total = 0;
  do {
    const page = await fetchPage({ limit: 500, offset: items.length });
    total = page.total;
    if (!page.items.length && items.length < total) throw new Error('数据加载不完整，请刷新重试');
    items.push(...page.items);
  } while (items.length < total);
  return { items, total };
}
