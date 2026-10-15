import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {prepareReceiptReversal} from './bankReceiptReversal.mjs';
import { MARKETS, bankDate, fingerprint, normalized } from './bankStatement.mjs';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const uuid=prefix=>`${prefix}_${crypto.randomUUID()}`;
const ref=value=>{const text=normalized(value);return text&&!/^[-–—0]+$/.test(text)?text:null;};
export function receiptDuplicateKey(row) {
  return hash(JSON.stringify([row.date,row.creditCents,ref(row.reference)||[row.accountKey||'',normalized(row.narration)]]));
}

export function prepareReceiptImport(db, selections, {requestId, timestamp=new Date().toISOString(), entrySource='Statement'}={}) {
  if(!['Statement','Manual'].includes(entrySource)) throw new Error('Invalid receipt source.');
  if(!/^[A-Za-z0-9_-]{8,100}$/.test(requestId||'')) throw new Error('A valid import request ID is required.');
  if(!Array.isArray(selections)||!selections.length||selections.length>10000) throw new Error('Approve at least one eligible credit.');
  for(const name of ['bankSettlements','bankingAudit','bankingRequests','bankingImportBatches']) if(db[name]!=null&&!Array.isArray(db[name])) throw new Error('Banking storage requires review before saving.');
  const receipts=db.bankSettlements||[];
  const payload=selections.map(({transaction,marketplace,classificationSource})=>[fingerprint(transaction),marketplace,classificationSource]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const payloadHash=hash(JSON.stringify(entrySource==='Statement'?payload:[entrySource,payload]));
  const replay=(db.bankingRequests||[]).find(item=>item.kind==='statement_import'&&item.requestId===requestId);
  if(replay) {
    if(replay.payloadHash!==payloadHash) throw new Error('Import request ID was already used for different selections.');
    return {db,result:{...replay.result,replayed:true},changed:false};
  }
  const batchId=uuid('bank_batch'), added=[], duplicates=[], seen=new Set();
  for(const selection of selections) {
    const {transaction,marketplace,classificationSource,approved}=selection;
    if(approved!==true || !MARKETS.includes(marketplace)||!['Rule','Manual','Ollama Suggested'].includes(classificationSource)) throw new Error('Every selected row must be explicitly approved with a valid marketplace.');
    if(!transaction || !bankDate(transaction.date)||!Number.isSafeInteger(transaction.creditCents)||transaction.creditCents<=0||transaction.debitCents!==0||transaction.detection?.status==='Other / Excluded') throw new Error('Excluded, invalid or debit transactions cannot be saved.');
    if(classificationSource==='Rule'&&transaction.detection?.marketplace!==marketplace) throw new Error('Rule classification does not support this marketplace.');
    if(classificationSource==='Ollama Suggested'&&transaction.ai?.marketplace!==marketplace) throw new Error('AI suggestion does not support this marketplace.');
    const key=receiptDuplicateKey(transaction), transactionFingerprint=fingerprint(transaction);
    const existing=receipts.find(receipt=>receipt.transactionFingerprint===transactionFingerprint||receipt.duplicateKey===key
      || (String(receipt.date||'').slice(0,10)===transaction.date&&receipt.amountCents===transaction.creditCents&&ref(receipt.reference)&&ref(receipt.reference)===ref(transaction.reference)));
    if(existing||seen.has(key)||transaction.duplicate) {duplicates.push({rowId:transaction.id,reason:'Already recorded or duplicated in selected statements.'});continue;}
    // Missing references cannot prove that same-date/amount legacy records are distinct.
    if(receipts.some(receipt=>String(receipt.date||'').slice(0,10)===transaction.date&&receipt.amountCents===transaction.creditCents&&(!ref(receipt.reference)||!ref(transaction.reference)))) throw new Error('Possible legacy receipt overlap: confirm the original reference before importing this date/amount.');
    seen.add(key);
    added.push({id:uuid('bank'),marketplace,date:transaction.date,amountCents:transaction.creditCents,reference:transaction.reference,narration:transaction.narration,
      kind:'marketplace_settlement',entrySource,source:entrySource.toLowerCase(),status:'Saved',transactionFingerprint,duplicateKey:key,...(entrySource==='Manual'?{notes:transaction.notes||''}:{}),
      accountKey:transaction.accountKey||null,valueDate:transaction.valueDate||null,debitCents:0,creditCents:transaction.creditCents,balanceCents:transaction.balanceCents??null,
      sourceLocations:structuredClone(transaction.sources||[]),originalRows:structuredClone(transaction.originalRows||[]),classificationSource,
      importBatchId:batchId,importedAt:timestamp,createdAt:timestamp,updatedAt:timestamp,version:1});
  }
  const result={saved:added.length,duplicates:duplicates.length,receiptIds:added.map(item=>item.id),batchId:added.length?batchId:null,replayed:false};
  if(!added.length) return {db,result,changed:false};
  const next=structuredClone(db);
  (next.bankSettlements||=[]).push(...added);
  (next.bankingAudit||=[]).push(...added.map(receipt=>({id:uuid('bank_audit'),settlementId:receipt.id,action:entrySource==='Manual'?'manual_receipt':'statement_import',at:timestamp,before:null,after:structuredClone(receipt),importBatchId:batchId})));
  (next.bankingRequests||=[]).push({kind:'statement_import',requestId,payloadHash,result,createdAt:timestamp});
  (next.bankingImportBatches||=[]).push({id:batchId,createdAt:timestamp,requestId,saved:added.length,duplicates:duplicates.length,receiptIds:result.receiptIds});
  return {db:next,result,changed:true};
}

// The JSON store supports atomic file replacement, not multi-process ACID transactions.
// Banking commits synchronously under an exclusive lock and verify the original file
// before replacement. Existing receipt objects and every unrelated field are retained.
export function createBankReceiptPersistence({dbFile,backupDir,io=fs}) {
  return (selections,options)=>{
    const lock=`${dbFile}.banking-lock`, temp=`${dbFile}.banking-${crypto.randomUUID()}.tmp`;
    const fd=io.openSync(lock,'wx');
    try {
      const original=io.readFileSync(dbFile),db=JSON.parse(original);
      const prepared=options?.operation==='reversal'?prepareReceiptReversal(db,options):prepareReceiptImport(db,selections,options);
      if(!prepared.changed) return prepared.result;
      io.mkdirSync(backupDir,{recursive:true});
      const backup=path.join(backupDir,`banking-before-import-${crypto.randomUUID()}.json`);
      io.writeFileSync(backup,original,{flag:'wx'});
      if(!original.equals(io.readFileSync(backup))) throw new Error('Banking backup verification failed; no receipts saved.');
      JSON.parse(io.readFileSync(backup,'utf8'));
      if(!original.equals(io.readFileSync(dbFile))) throw new Error('Database changed during backup; rescan before saving.');
      const output=JSON.stringify(prepared.db,null,2);
      const out=io.openSync(temp,'wx');
      try {io.writeFileSync(out,output,'utf8');io.fsyncSync(out);}finally{io.closeSync(out);}
      if(io.readFileSync(temp,'utf8')!==output) throw new Error('Bank receipt persistence did not verify.');
      if(!original.equals(io.readFileSync(dbFile))) throw new Error('Database changed before commit; no receipts saved.');
      io.renameSync(temp,dbFile);
      return prepared.result;
    } finally {
      if(io.existsSync(temp)) io.unlinkSync(temp);
      io.closeSync(fd);io.unlinkSync(lock);
    }
  };
}
