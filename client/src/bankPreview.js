export const BANK_MARKETS = ['Amazon', 'Flipkart', 'Meesho'];
export const maskBankText = text => String(text ?? '').replace(/\b\d{11,}\b/g, value => `••••${value.slice(-4)}`);
export const bankMoney = cents => cents == null ? '—' : `₹${(cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function updatePreviewRow(row, action, marketplace = row.marketplace) {
  if (row.duplicate || !row.creditCents || row.debitCents) return row;
  if (action === 'correct' && BANK_MARKETS.includes(marketplace)) return { ...row, marketplace, approved: false, status: 'Confirmed', classificationSource: 'Manual' };
  if (action === 'confirmDetection' && BANK_MARKETS.includes(marketplace)) return { ...row, approved: false, status: 'Confirmed', classificationSource: row.classificationSource || 'Manual' };
  if (action === 'marketplace') return { ...row, marketplace: BANK_MARKETS.includes(marketplace) ? marketplace : null, approved: false, status: 'Review required', classificationSource: 'Manual' };
  if (action === 'approve' && BANK_MARKETS.includes(marketplace)) return { ...row, approved: true, status: 'Approved', classificationSource: row.classificationSource || (row.detection.marketplace === marketplace ? 'Rule' : 'Manual') };
  if (action === 'ai' && BANK_MARKETS.includes(row.ai?.marketplace)) return { ...row, marketplace: row.ai.marketplace, approved: false, status: 'Review required', classificationSource: 'Ollama Suggested' };
  if (action === 'exclude') return { ...row, approved: false, status: 'Other / Excluded' };
  if (action === 'review') return { ...row, approved: false, status: 'Review required' };
  return row;
}

export function previewTotals(rows) {
  const totals = Object.fromEntries(BANK_MARKETS.map(market => [market, 0]));
  for (const row of rows) if (row.approved && !row.duplicate && row.creditCents > 0 && !row.debitCents && BANK_MARKETS.includes(row.marketplace)) totals[row.marketplace] += row.creditCents;
  return totals;
}

// Detection-test totals are separate from receipt accounting and import approval.
export function settlementDetectionResults(rows) {
  const confirmed = rows.filter(row => !row.duplicate && row.creditCents > 0 && !row.debitCents && BANK_MARKETS.includes(row.marketplace) && ['Confirmed', 'Approved'].includes(row.status));
  const review = rows.filter(row => !row.duplicate && row.creditCents > 0 && !row.debitCents && row.status === 'Review required');
  const summaries = BANK_MARKETS.map(marketplace => {
    const matches = confirmed.filter(row => row.marketplace === marketplace);
    return { marketplace, count: matches.length, cents: matches.reduce((sum, row) => sum + row.creditCents, 0) };
  });
  return { confirmed, review, summaries, totalCents: summaries.reduce((sum, group) => sum + group.cents, 0), hiddenCount: rows.length - confirmed.length - review.length };
}

export function combineBankPreviews(previews) {
  const seen = new Set();
  return {
    rows: previews.flatMap((preview, index) => preview.rows.map(row => {
      const repeated = row.fingerprint && seen.has(row.fingerprint);
      if (row.fingerprint) seen.add(row.fingerprint);
      return { ...row, originalRowId:row.id, scanToken:preview.scanToken, id: `${index + 1}:${row.id}`, statementLabel: `Statement ${index + 1}`, ...(repeated && !row.duplicate ? { duplicate: 'Repeated across selected statements.', status: 'Duplicate', approved: false } : {}) };
    })),
    warnings: previews.flatMap((preview, index) => preview.warnings.map(warning => ({ ...warning, statementLabel: `Statement ${index + 1}` }))),
    reconciled: previews.every(preview => preview.reconciliation.verified),
    aiStatus: previews.map((preview, index) => `Statement ${index + 1}: ${preview.aiStatus}`).join(' '),
    legacyReconciliations: previews.map((preview,index)=>({statementLabel:`Statement ${index+1}`, ...preview.legacyReconciliation})),
    savingEnabled: previews.every(preview=>preview.savingEnabled===true)
  };
}
