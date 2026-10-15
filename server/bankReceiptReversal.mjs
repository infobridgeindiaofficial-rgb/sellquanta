import crypto from 'node:crypto';
import {REVERSAL_REASONS,bankNetReceipts} from '../client/src/bankNetReceipts.js';
import {MARKETS,bankDate} from './bankStatement.mjs';
export function prepareReceiptReversal(db,{receiptId,reason,confirmed,timestamp=new Date().toISOString()}) {
 if(confirmed!==true||!REVERSAL_REASONS.includes(reason))throw Error('Select a reversal reason and explicitly confirm.');
 const receipts=db.bankSettlements||[];
 if(receipts.some(r=>r.kind==='receipt_reversal'&&r.originalReceiptId===receiptId))throw Error('This receipt is already reversed.');
 const original=bankNetReceipts(receipts).find(r=>r.id===receiptId&&r.kind!=='receipt_reversal');
 if(!original||original.deletedAt||original.displayStatus==='Reversed'||!MARKETS.includes(original.marketplace)||!bankDate(String(original.date||'').slice(0,10)))throw Error('Only an active original receipt can be reversed.');
 const reversal={id:'bank_reversal_'+crypto.randomUUID(),kind:'receipt_reversal',originalReceiptId:original.id,marketplace:original.marketplace,date:new Date(timestamp).toLocaleDateString('en-CA',{timeZone:'Asia/Dubai'}),amountCents:-original.amountCents,reference:original.reference||'',originalReference:original.reference||'',entrySource:'Reversal',source:'reversal',reversalReason:reason,status:'Reversal',createdAt:timestamp,importedAt:timestamp,version:1};
 const next=structuredClone(db);(next.bankSettlements||=[]).push(reversal);
 (next.bankingAudit||=[]).push({id:'bank_audit_'+crypto.randomUUID(),action:'receipt_reversal',settlementId:original.id,reversalId:reversal.id,reason,amountCents:reversal.amountCents,at:timestamp});
 return {db:next,changed:true,result:{saved:1,reversalId:reversal.id}};
}
