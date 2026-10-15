// Calendar dates stay independent of the entry's creation timestamp and timezone.
export function manualSaleDate(value, now = new Date()) {
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '0001-01-01'
    ? new Date(value+'T12:00:00Z') : null;
  if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value)
    throw Error('Select a valid Sale Date.');
  if (value > today) throw Error('Sale Date cannot be in the future.');
  return value;
}
