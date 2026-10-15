import { MARKETS, bankDate, normalized } from './bankStatement.mjs';
import {bankNetReceipts} from '../client/src/bankNetReceipts.js';

const usableReference = value => {
  const reference=normalized(value);
  return reference && !/^[-–—0]+$/.test(reference) ? reference : null;
};

// Same latest-ID/version policy as Dashboard; this view never changes the collection.
export function bankReceiptHistory(db) {
  if(db.bankSettlements != null && !Array.isArray(db.bankSettlements)) throw new Error('Bank receipt storage is invalid.');
  const latest=new Map();
  for(const receipt of db.bankSettlements||[]) {
    const key=receipt.id || `unidentified-${latest.size}`;
    const prior=latest.get(key);
    if(!prior || Number(receipt.version||0)>Number(prior.version||0) || (Number(receipt.version||0)===Number(prior.version||0) && String(receipt.updatedAt||'')>=String(prior.updatedAt||''))) latest.set(key,receipt);
  }
  const reversed=new Set(bankNetReceipts([...latest.values()]).filter(r=>r.kind==='receipt_reversal').map(r=>r.originalReceiptId));
  return [...latest.values()].map(receipt=>({
    ...receipt,
    displaySource: receipt.kind==='receipt_reversal'?'Reversal':receipt.entrySource==='Manual'||/^manual$/i.test(receipt.source||'') ? 'Manual' : receipt.entrySource==='Statement'||receipt.importBatchId ? 'Statement' : 'Legacy / Unknown',
    displayStatus: receipt.kind==='receipt_reversal' ? 'Reversal' : reversed.has(receipt.id) ? 'Reversed' : receipt.deletedAt ? 'Deleted (retained)' : !bankDate(String(receipt.date||'').slice(0,10))||!Number.isSafeInteger(receipt.amountCents)||receipt.amountCents<=0||!MARKETS.includes(receipt.marketplace) ? 'Invalid - review required' : 'Active'

  })).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
}

export function bankReconciliationPreview(db, transactions=[]) {
  const history=bankReceiptHistory(db), audits=Array.isArray(db.bankingAudit)?db.bankingAudit:[];
  const active=history.filter(receipt=>!receipt.deletedAt);
  const receipts=history.map(receipt=>{
    const candidates=[];
    for(const transaction of transactions) {
      if(!transaction.creditCents || transaction.debitCents) continue;
      const comparisons={
        date: bankDate(String(receipt.date||'').slice(0,10))===transaction.date,
        reference: !!usableReference(receipt.reference)&&usableReference(receipt.reference)===usableReference(transaction.reference),
        marketplace: transaction.detection?.marketplace===receipt.marketplace,
        amount: transaction.creditCents===receipt.amountCents
      };
      // Same amount alone is weak evidence and can never resolve a legacy record.
      if(comparisons.reference || comparisons.amount || (comparisons.date&&comparisons.marketplace)) candidates.push({
        transaction, comparisons, strength: Object.values(comparisons).every(Boolean) ? 'All four fields agree — manual evidence confirmation required' : comparisons.amount&&!comparisons.date&&!comparisons.reference ? 'Amount only — insufficient evidence' : 'Partial evidence — manual review required'
      });
    }
    const marketplaceRows=transactions.filter(row=>row.creditCents>0&&!row.debitCents&&row.detection?.marketplace===receipt.marketplace);
    const sameMonthRows=marketplaceRows.filter(row=>row.date.slice(0,7)===String(receipt.date||'').slice(0,7));
    const sum=sameMonthRows.reduce((total,row)=>total+row.creditCents,0);
    return {receipt,candidates,aggregation:{transactionCount:sameMonthRows.length,sumEqualsReceipt:sameMonthRows.length>1&&sum===receipt.amountCents,provenance:'Unknown: neither individual nor aggregated settlement is established.'},
      auditEntries:audits.filter(entry=>entry.settlementId===receipt.id),
      status:receipt.deletedAt?'Retained historical record':'Manual confirmation required',resolved:false};
  });
  return {receipts,unresolvedCount:active.filter(receipt=>!receipt.transactionFingerprint).length,
    note:'Existing receipts are preserved. Matching amounts alone do not establish provenance; duplicate or possible-overlap rows must not be imported again.'};
}
