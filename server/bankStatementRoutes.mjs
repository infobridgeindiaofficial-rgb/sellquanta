import { buildPreview, parseStatement } from './bankStatement.mjs';
import { advisePreview } from './bankStatementAi.mjs';
import { bankReceiptHistory, bankReconciliationPreview } from './bankReconciliation.mjs';
import crypto from 'node:crypto';
import {validateManualReceipt} from '../client/src/manualBankReceipt.js';

export function registerBankStatementRoutes(app, { readDb, advise = advisePreview, persist }) {
  const scans=new Map();
  app.post('/api/banking/receipts/:id/reverse',(req,res)=>{
    try {if(!persist)throw Error('Local receipt saving is unavailable.');const result=persist([],{operation:'reversal',receiptId:req.params.id,reason:req.body.reason,confirmed:req.body.confirmed});const db=readDb();res.set('Cache-Control','no-store').json({...result,history:{receipts:bankReceiptHistory(db),audit:db.bankingAudit||[]}});}
    catch(error){res.status(409).json({error:error.message});}
  });
  const prune=()=>{for(const [key,scan] of scans) if(scan.expiresAt<Date.now())scans.delete(key);while(scans.size>10)scans.delete(scans.keys().next().value);};
  app.post('/api/banking/receipts/manual',(req,res)=>{
    if(!persist)return res.status(409).json({error:'Local receipt saving is unavailable.'});
    const validated=validateManualReceipt(req.body);
    if(!validated.valid)return res.status(400).json({error:validated.error});
    try {
      const {marketplace,date,amountCents,reference,notes}=validated.value;
      const result=persist([{transaction:{id:'manual',date,reference,narration:notes||'Manual bank receipt',notes,creditCents:amountCents,debitCents:0,sources:[],originalRows:[],detection:{status:'Confirmed',marketplace}},marketplace,classificationSource:'Manual',approved:true}],{requestId:req.body.requestId,entrySource:'Manual'});
      if(!result.saved&&!result.replayed)return res.status(409).json({error:'This bank receipt is already recorded. No duplicate was saved.'});
      const db=readDb();
      res.set('Cache-Control','no-store').json({...result,history:{receipts:bankReceiptHistory(db),audit:db.bankingAudit||[]}});
    }catch(error){res.status(409).json({error:error.message||'Manual receipt could not be saved.'});}
  });
  app.get('/api/banking/receipts', (_req,res)=>{
    try { const db=readDb();res.set('Cache-Control','no-store').json({receipts:bankReceiptHistory(db),audit:Array.isArray(db.bankingAudit)?db.bankingAudit:[],reconciliation:bankReconciliationPreview(db)}); }
    catch(error) {res.status(400).json({error:error.message||'Receipt history could not be read.'});}
  });
  app.post('/api/banking/statement/preview', async (req, res) => {
    try {
      const parsed = parseStatement(req.body || {});
      const db = readDb();
      if (db.bankSettlements != null && !Array.isArray(db.bankSettlements)) throw new Error('Existing bank receipt storage is invalid; preview blocked.');
      let preview = { ...buildPreview(parsed, db.bankSettlements || []), sourceFilename: String(req.body.filename || '') };
      if (req.body.useOllama !== false) preview = await advise(preview);
      else preview.aiStatus = 'Ollama verification was not requested; uncertain entries require manual review.';
      preview.legacyReconciliation = bankReconciliationPreview(db,preview.rows);
      preview.scanToken=crypto.randomUUID();
      preview.savingEnabled=!!persist&&parsed.reconciliation.verified&&parsed.warnings.length===0;
      preview.saveBlockedReason=preview.savingEnabled ? '' : 'Saving requires reconciled extraction and an available local receipt writer.';
      scans.set(preview.scanToken,{rows:structuredClone(preview.rows),reconciled:parsed.reconciliation.verified,expiresAt:Date.now()+30*60*1000});prune();
      // Preview only. Original transaction rows live only in the response, not on disk.
      res.set('Cache-Control', 'no-store').json(preview);
    } catch (error) { res.status(400).json({ error: error.message || 'Statement could not be parsed.' }); }
  });
  app.post('/api/banking/statement/import', (req, res) => {
    if(!persist) return res.status(409).json({error:'Local receipt saving is unavailable.',saved:0});
    try {
      prune();
      const body=req.body||{};
      if(body.confirm!==true||body.verificationComplete!==true) throw new Error('Explicit verification and Confirm & Save are required.');
      if(!Array.isArray(body.selections)||!body.selections.length||body.selections.length>10000) throw new Error('Select approved marketplace credits.');
      const selections=body.selections.map(selection=>{
        if(!selection||Object.keys(selection).some(key=>!['scanToken','rowId','marketplace','classificationSource','approved'].includes(key))) throw new Error('Only preview classifications may be submitted; transaction fields are immutable.');
        const scan=scans.get(selection.scanToken);
        if(!scan||!scan.reconciled) throw new Error('Scan expired or extraction is not reconciled. Rescan before saving.');
        const transaction=scan.rows.find(row=>row.id===selection.rowId);
        if(!transaction) throw new Error('Selected transaction is not in the scanned statement.');
        return {transaction,marketplace:selection.marketplace,classificationSource:selection.classificationSource,approved:selection.approved};
      });
      const result=persist(selections,{requestId:body.requestId});
      res.set('Cache-Control','no-store').json(result);
    } catch(error) {res.status(409).json({error:error.message||'Bank receipts were not saved.',saved:0});}
  });
}
