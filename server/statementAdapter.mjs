import crypto from 'node:crypto';
import {parseStatement,buildPreview,fingerprint,MARKETS} from './bankStatement.mjs';
import {applySettlement} from './banking.mjs';
import {manualBackup} from './store.mjs';
import {advisePreview} from './bankStatementAi.mjs';

const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ref=value=>String(value||'').trim().toLowerCase();
export function prepareStatementImport(input,selections,{requestId,confirm,verificationComplete}={}){
 if(confirm!==true||verificationComplete!==true)throw Error('Verify the extraction and explicitly confirm before saving.');
 if(!/^[A-Za-z0-9_-]{16,100}$/.test(requestId||''))throw Error('A valid request ID is required.');
 if(!Array.isArray(selections)||!selections.length||selections.length>10000)throw Error('Select approved marketplace credits.');
 const payloadHash=hash(selections.map(s=>[fingerprint(s.transaction),s.marketplace,s.classificationSource,s.approved]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
 const old=(input.bankingRequests||[]).find(r=>r.requestId===requestId);
 if(old){if(old.kind!=='statement_batch'||old.payloadHash!==payloadHash)throw Error('Request ID was already used for different details.');return {db:input,result:{...old.result,replayed:true},changed:false};}
 const db=structuredClone(input),batchId='statement_'+crypto.randomUUID(),receiptIds=[];let duplicates=0;
 for(const selection of selections){
  const {transaction:t,marketplace,classificationSource,approved}=selection;
  if(!t||approved!==true||!MARKETS.includes(marketplace)||!['Rule','Manual'].includes(classificationSource))throw Error('Every selected row must be explicitly approved and classified.');
  if(t.debitCents!==0||!Number.isSafeInteger(t.creditCents)||t.creditCents<=0||t.detection?.status==='Other / Excluded')throw Error('Invalid, debit and excluded transactions cannot be saved.');
  if(classificationSource==='Rule'&&t.detection?.marketplace!==marketplace)throw Error('Rule classification does not match the marketplace.');
  const key=fingerprint(t),rows=db.bankSettlements||[];
  if(rows.some(r=>r.transactionFingerprint===key)){duplicates++;continue;}
  const overlap=rows.find(r=>r.marketplace===marketplace&&(ref(t.reference)&&ref(r.reference)===ref(t.reference)||!ref(t.reference)&&!ref(r.reference)&&r.date===t.date&&r.amountCents===t.creditCents));
  if(overlap){if(overlap.date!==t.date||overlap.amountCents!==t.creditCents)throw Error('Statement reference conflicts with an existing receipt; reconcile it before saving.');duplicates++;continue;}
  if(rows.some(r=>r.date===t.date&&r.amountCents===t.creditCents&&(!ref(r.reference)||!ref(t.reference))))throw Error('Possible legacy receipt overlap; verify the original reference before saving.');
  const result=applySettlement(db,'create',null,{requestId:'stmt_'+hash([requestId,key,marketplace]),marketplace,date:t.date,amount:(t.creditCents/100).toFixed(2),reference:t.reference||'',notes:t.narration||''});
  Object.assign(result.settlement,{transactionFingerprint:key,entrySource:'Statement',importBatchId:batchId,sourceLocations:structuredClone(t.sources||[]),classificationSource});
  db.bankingAudit.at(-1).after=structuredClone(result.settlement);
  receiptIds.push(result.settlement.id);
 }
 const result={saved:receiptIds.length,duplicates,receiptIds,batchId,replayed:false};
 (db.bankingRequests||=[]).push({kind:'statement_batch',requestId,payloadHash,result});
 (db.bankingImportBatches||=[]).push({id:batchId,requestId,receiptIds,saved:receiptIds.length,duplicates,createdAt:new Date().toISOString()});
 return {db,result,changed:true};
}
export function registerStatementRoutes(app,{readDb,saveDb}){
 const scans=new Map();
 const prune=()=>{for(const [key,value]of scans)if(value.expires<Date.now())scans.delete(key);};
 app.post('/api/banking/statement/preview',async(req,res)=>{
  try{prune();if(scans.size>=20)throw Error('Too many active scans; wait before scanning again.');
   const parsed=parseStatement(req.body||{});let preview=buildPreview(parsed,readDb().bankSettlements||[]);const scanToken=crypto.randomUUID();
   if(req.body.useOllama===true)preview=await advisePreview(preview);
   const savingEnabled=parsed.reconciliation.verified&&parsed.warnings.length===0;
   scans.set(scanToken,{rows:structuredClone(preview.rows),savingEnabled,expires:Date.now()+30*60*1000});
   res.set('Cache-Control','no-store').json({...preview,scanToken,savingEnabled,saveBlockedReason:savingEnabled?'':'Extraction must reconcile without warnings before saving.',aiStatus:preview.aiStatus||'Rule detection only. Unknown credits require explicit manual classification; no AI service was started.'});
  }catch(e){res.status(400).json({error:e.message});}
 });
 app.post('/api/banking/statement/import',(req,res)=>{
  try{prune();const body=req.body||{};if(!Array.isArray(body.selections)||body.selections.length>10000)throw Error('Select verified rows.');
   const selected=body.selections.map(s=>{if(!s||Object.keys(s).some(k=>!['scanToken','rowId','marketplace','classificationSource','approved'].includes(k)))throw Error('Transaction fields are immutable; only classifications may be submitted.');const scan=scans.get(s.scanToken);if(!scan?.savingEnabled)throw Error('Scan expired or extraction did not reconcile.');const transaction=scan.rows.find(r=>r.id===s.rowId);if(!transaction)throw Error('Row is not in the scanned statement.');return {...s,transaction};});
   const prepared=prepareStatementImport(readDb(),selected,body);
   if(prepared.changed){const backup=manualBackup();if(!backup.verified)throw Error('Verified backup required before import.');saveDb(prepared.db);}
   res.set('Cache-Control','no-store').json(prepared.result);
  }catch(e){res.status(e.status||409).json({error:e.message,saved:0});}
 });
}
