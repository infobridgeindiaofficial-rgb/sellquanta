import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseReturnReport} from './returnCharges.mjs';
import {returnChargeTotals} from '../client/src/returnChargeTotals.js';
import {reconcileReturnRows} from './refundClassification.mjs';

export function createReturnChargePersistence({dbFile,backupDir}) {
 return rows=>{
  const bytes=fs.readFileSync(dbFile),db=JSON.parse(bytes),seen=new Set((db.returnCharges||[]).map(row=>row.duplicateKey));
  const additions=[];let duplicates=0;
  for(const row of rows){if(seen.has(row.duplicateKey)){duplicates++;continue;}seen.add(row.duplicateKey);additions.push({...row,id:'return_'+crypto.randomUUID(),status:'Confirmed',importedAt:new Date().toISOString()});}
  if(!additions.length)return {saved:0,duplicates};
  const next={...db,returnCharges:[...(db.returnCharges||[]),...additions]};
  fs.mkdirSync(backupDir,{recursive:true});const backup=path.join(backupDir,`return-charges-before-import-${crypto.randomUUID()}.json`);
  fs.writeFileSync(backup,bytes,{flag:'wx'});if(!bytes.equals(fs.readFileSync(backup)))throw Error('Backup did not verify. Nothing saved.');
  const temp=dbFile+'.return-'+crypto.randomUUID()+'.tmp',output=JSON.stringify(next,null,2);
  try {const fd=fs.openSync(temp,'wx');try{fs.writeFileSync(fd,output);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   if(fs.readFileSync(temp,'utf8')!==output||!bytes.equals(fs.readFileSync(dbFile)))throw Error('Data changed before commit. Nothing saved.');
   fs.renameSync(temp,dbFile);
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  return {saved:additions.length,duplicates};
 };
}
export function registerReturnChargeRoutes(app,{readDb,persist}) {
 const scans=new Map();
 app.get('/api/return-charges',(_req,res)=>{try{const records=readDb().returnCharges||[];res.set('Cache-Control','no-store').json({records,totals:returnChargeTotals(records)});}catch(error){res.status(500).json({error:error.message});}});
 app.post('/api/return-charges/scan',(req,res)=>{
  try {for(const [key,scan]of scans)if(scan.expires<Date.now())scans.delete(key);
   if(scans.size>=30)throw Error('Too many active scans. Try again later.');
   const preview=parseReturnReport(req.body),token=crypto.randomUUID();preview.rows=reconcileReturnRows(preview.rows,readDb());preview.totalCents=preview.rows.filter(row=>row.status==='Confirmed').reduce((sum,row)=>sum+row.amountCents,0);preview.reviewCount=preview.rows.filter(row=>row.status==='Needs Review').length;scans.set(token,{...preview,expires:Date.now()+30*60*1000});res.json({...preview,token});
  }catch(error){res.status(400).json({error:error.message});}
 });
 app.post('/api/return-charges/import',(req,res)=>{
  try {const scan=scans.get(req.body.token);if(!scan||scan.expires<Date.now())throw Error('Scan expired. Rescan the report.');
   if(req.body.confirm!==true||!Array.isArray(req.body.approved)||!req.body.approved.length)throw Error('Select and confirm charges before saving.');
   const rows=req.body.approved.map(id=>{const row=scan.rows.find(row=>row.id===id);if(!row||row.status==='Duplicate'||!row.orderId||!row.date)throw Error('Invalid or incomplete charge selected.');return {...row,reviewedByUser:row.status==='Needs Review'};});
   res.json(persist(rows));
  }catch(error){res.status(400).json({error:error.message});}
 });
}
