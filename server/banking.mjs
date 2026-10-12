import {randomUUID} from 'node:crypto';
import {reportRecords, reportRange, REPORT_MARKETPLACES} from './reports.mjs';

export const BANKING_NOTE='Reference reconciliation difference = gross recorded sales − bank receipts. This is not profit, loss or an automatically unpaid settlement. Commissions, shipping fees, returns, refunds, deductions and payout timing may explain differences. Payouts received in this period may relate to sales from previous periods.';
export const BANKING_RULES='Sales use the same gross saleAmount basis as Reports, including refunded sales; refunds are not deducted again. All saved sales are included (the current schema has no sale status field); undone sales are absent. Current, daily-history and month-close records are deduplicated by sale ID. Sales use date, falling back to createdAt in UTC. Receipts use Bank Received Date. Filters use inclusive UTC calendar dates; weeks run Monday–Sunday. All Time includes undated historical sales.';
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
export const validBankDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const saleDate=s=>validBankDate(s.date)?s.date:Number.isFinite(Date.parse(s.createdAt||''))?new Date(s.createdAt).toISOString().slice(0,10):'';
const market=v=>REPORT_MARKETPLACES.find(m=>m.toLowerCase()===String(v||'').trim().toLowerCase());
const total=values=>{const n=values.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(n))fail('The selected totals exceed the supported monetary range.');return n;};
const text=(value,max,label)=>{if(value===undefined||value===null)return '';if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail(`${label} must be plain text of at most ${max} characters.`);return value.trim();};
function fields(body){
 if(!REPORT_MARKETPLACES.includes(body.marketplace))fail('Choose Amazon, Flipkart or Meesho.');
 if(!validBankDate(body.date))fail('Choose a valid Bank Received Date.');
 const value=typeof body.amount==='number'?String(body.amount):body.amount;
 if(typeof value!=='string'||!/^\d+(\.\d{1,2})?$/.test(value))fail('Amount must be positive with at most two decimal places.');
 const [whole,fraction='']=value.split('.');const amountCents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>999999999999)fail('Amount must be positive and no greater than ₹9,999,999,999.99.');
 const reference=text(body.reference,200,'Reference / UTR');
 if(reference&& !/^[\p{L}\p{N} ._/#:-]+$/u.test(reference))fail('Reference / UTR contains unsupported characters.');
 return {marketplace:body.marketplace,date:body.date,amountCents,reference,notes:text(body.notes,2000,'Notes')};
}
const active=db=>(db.bankSettlements||[]).filter(s=>!s.deletedAt);
function duplicate(db,value,id){
 const match=active(db).find(s=>s.id!==id&&s.marketplace===value.marketplace&&(value.reference? s.reference?.toLowerCase()===value.reference.toLowerCase():!s.reference&&s.date===value.date&&s.amountCents===value.amountCents));
 if(match)fail('A settlement with this marketplace/reference, or the same unreferenced date and amount, already exists. Check history before saving.',409);
}
export function bankingReport(db,filter={},now=new Date()){
 const range=(filter.mode||'all')==='all'?{mode:'all',from:null,to:null}:reportRange(filter,now);
 if(range.mode==='yearly')fail('Choose All Time, Daily, Weekly, Monthly or Custom Date Range.');
 const included=d=>range.mode==='all'||(d&&d>=range.from&&d<=range.to);
 const sales=reportRecords(db).sales.filter(s=>market(s.marketplace)&&included(saleDate(s)));
 const settlements=active(db).filter(s=>included(s.date));
 const tally=m=>{const salesCents=total(sales.filter(s=>!m||market(s.marketplace)===m).map(s=>{const value=Math.round(Number(s.saleAmount||0)*100);if(!Number.isSafeInteger(value))fail('A saved sale has an invalid amount; reconcile the source record before reporting.');return value;}));const receivedCents=total(settlements.filter(s=>!m||s.marketplace===m).map(s=>s.amountCents));return {salesCents,receivedCents,differenceCents:total([salesCents,-receivedCents])};};
 const historyMarketplace=filter.marketplace||'';if(historyMarketplace&&!REPORT_MARKETPLACES.includes(historyMarketplace))fail('Choose a valid history marketplace.');
 const search=text(filter.search,200,'Search').toLowerCase();
 const history=settlements.filter(s=>(!historyMarketplace||s.marketplace===historyMarketplace)&&(!search||[s.date,s.marketplace,s.reference,s.notes,String(s.amountCents/100)].join(' ').toLowerCase().includes(search))).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
 return {range,totals:tally(),marketplaces:REPORT_MARKETPLACES.map(m=>({marketplace:m,...tally(m)})),history,note:BANKING_NOTE,rules:BANKING_RULES,undatedSales:reportRecords(db).sales.filter(s=>market(s.marketplace)&&!saleDate(s)).length,historyFiltered:!!(search||historyMarketplace)};
}
// Synchronous transaction: validation and audit append happen on an isolated read;
// one atomic store save commits banking fields only. No stock or wallet mutation.
export function applySettlement(db,action,id,body,now=new Date()){
 if(!body||typeof body!=='object'||Array.isArray(body))fail('Provide settlement details.');
 const requestId=text(body.requestId,100,'Request ID');if(!/^[A-Za-z0-9_-]{16,100}$/.test(requestId))fail('A valid request ID is required.');
 if((action==='update'||action==='delete')&&body.confirm!==true)fail('Confirm this settlement correction.');
 const value=action==='delete'?null:fields(body);
 const fingerprint=JSON.stringify({action,id:id||null,value,version:body.version??null});
 const previous=(db.bankingRequests||[]).find(r=>r.requestId===requestId);
 if(previous){if(previous.fingerprint!==fingerprint)fail('This request ID was already used for different details.',409);return {...previous.result,replayed:true};}
 if(!['create','update','delete'].includes(action))fail('Unknown settlement action.');
 const current=active(db).find(s=>s.id===id);
 if(action!=='create'&&!current)fail('Settlement not found or already deleted.',404);
 if(current&&body.version!==current.version)fail('This settlement changed. Reload history before correcting it.',409);
 if(value)duplicate(db,value,id);
 const at=now.toISOString();const before=current?{...current}:null;
 const after=action==='create'?{id:'bank_'+randomUUID(),...value,createdAt:at,updatedAt:at,version:1}:action==='update'?{...current,...value,updatedAt:at,version:current.version+1}:{...current,deletedAt:at,updatedAt:at,version:current.version+1};
 const rows=[...(db.bankSettlements||[])];if(current)rows[rows.findIndex(s=>s.id===id)]=after;else rows.push(after);
 db.bankSettlements=rows;
 db.bankingAudit=[...(db.bankingAudit||[]),{id:'bank_audit_'+randomUUID(),settlementId:after.id,action,at,before,after:{...after}}];
 const result={settlement:after,replayed:false};
 db.bankingRequests=[...(db.bankingRequests||[]),{requestId,fingerprint,result}];
 return result;
}
