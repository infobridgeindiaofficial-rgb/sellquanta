export const REVERSAL_REASONS=['Wrong amount','Wrong marketplace','Duplicate entry','Wrong date/reference','Other'];
export function bankNetReceipts(records=[]) {
 const latest=new Map();
 for(const r of records){const id=r.id||r;const old=latest.get(id);if(!old||Number(r.version||0)>Number(old.version||0)||(Number(r.version||0)===Number(old.version||0)&&String(r.updatedAt||'')>=String(old.updatedAt||'')))latest.set(id,r);}
 const originals=[...latest.values()].filter(r=>r.kind!=='receipt_reversal'&&!r.deletedAt&&Number.isSafeInteger(r.amountCents)&&r.amountCents>0);
 const seen=new Set(),result=[],ids=new Set();
 for(const r of originals){const ref=String(r.reference||'').toUpperCase().replace(/\s+/g,' ').trim();const key=ref?JSON.stringify([String(r.date||'').slice(0,10),ref,r.amountCents]):r.transactionFingerprint||r.duplicateKey||r.id;if(key&&seen.has(key))continue;if(key)seen.add(key);result.push(r);ids.add(r.id);}
 const reversed=new Set();
 for(const r of latest.values()){if(r.kind!=='receipt_reversal'||r.deletedAt||reversed.has(r.originalReceiptId))continue;const original=latest.get(r.originalReceiptId);if(!original||!ids.has(original.id)||r.marketplace!==original.marketplace||r.amountCents!==-original.amountCents)continue;reversed.add(original.id);result.push(r);}
 return result;
}
