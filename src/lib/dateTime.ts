const beijingDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function hasTimeZone(value: string) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
}

export function formatDatabaseUtcTime(value: string | null | undefined) {
  if (!value) return '';

  const normalized = value.trim().replace(' ', 'T');
  const date = new Date(hasTimeZone(normalized) ? normalized : `${normalized}Z`);
  if (Number.isNaN(date.getTime())) return '';

  const parts: Record<string, string> = {};
  beijingDateTimeFormatter.formatToParts(date).forEach((part) => {
    parts[part.type] = part.value;
  });

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
