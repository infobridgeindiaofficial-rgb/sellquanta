export const MASTER_VALUE_FIELDS = [
  ['listing_price', 'Listing Price (INR)'],
  ['cost_price', 'Cost Price (INR)'],
  ['estimated_settlement', 'Estimated Settlement (INR)'],
  ['estimated_profit', 'Estimated Profit (INR)']
];

// Mapping metadata only; never derives values from a warehouse product or sales.
export function masterValues(input = {}, { preserveBlanks = false } = {}) {
  const values = {};
  for (const [field, label] of MASTER_VALUE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
    const raw = input[field];
    if (raw === null || String(raw).trim() === '') {
      if (!preserveBlanks) values[field] = null;
      continue;
    }
    const pattern = field === 'estimated_profit' ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/;
    if (!['string', 'number'].includes(typeof raw) || !pattern.test(String(raw).trim()) || !Number.isSafeInteger(Math.round(Number(raw) * 100))) {
      throw new Error(`${label} must be ${field === 'estimated_profit' ? 'an' : 'a non-negative'} amount with at most two decimal places.`);
    }
    values[field] = Number(raw);
  }
  return values;
}
