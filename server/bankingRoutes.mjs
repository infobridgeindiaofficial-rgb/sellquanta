import express from 'express';
import XLSX from 'xlsx';
import {readDb,saveDb} from './store.mjs';
import {applySettlement,bankingReport} from './banking.mjs';
import {writeBrandedWorkbook} from './excelStyle.mjs';

export function buildBankingWorkbook(report){
 const workbook=XLSX.utils.book_new();
 const add=(name,rows)=>{const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=rows[0].map((_,i)=>({wch:i===0?36:28}));XLSX.utils.book_append_sheet(workbook,sheet,name);};
 const headers=['Scope','Total Sales','Bank Received Amount','Reference Difference Amount'];
 const row=(name,t)=>[name,t.salesCents/100,t.receivedCents/100,t.differenceCents/100];
 add('Banking Summary',[headers,row('All marketplaces',report.totals)]);
 add('Marketplace Breakdown',[headers,...report.marketplaces.map(m=>row(m.marketplace,m))]);
 add('Settlement History',[['Bank Received Date','Marketplace','Amount Received','UTR / Reference','Notes','Created Date','Updated Date','Settlement ID'],...report.history.map(s=>[s.date,s.marketplace,s.amountCents/100,s.reference,s.notes,s.createdAt,s.updatedAt,s.id])]);
 return workbook;
}
export function createBankingRouter(){
 const router=express.Router();
 const route=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||400).json({error:e.message});}};
 router.get('/',route((req,res)=>res.json(bankingReport(readDb(),req.query))));
 router.get('/audit',route((_req,res)=>res.json({entries:readDb().bankingAudit||[]})));
 router.get('/export',route(async(req,res)=>{
  const report=bankingReport(readDb(),req.query),period=report.range.mode==='all'?'All Time':`${report.range.from} - ${report.range.to} (UTC)`;
  const summary='Reference difference only; not profit/loss/unpaid. Payouts may relate to earlier sales; fees/refunds explain differences.'+(report.historyFiltered?' History-only search/marketplace filter applied.':'');
  const bytes=await writeBrandedWorkbook(buildBankingWorkbook(report),{reportName:'Banking Reconciliation',period,summary});
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="SellQuanta_Banking.xlsx"');res.send(bytes);
 }));
 const edit=action=>route((req,res)=>{const db=readDb(),result=applySettlement(db,action,req.params.id,req.body);if(!result.replayed)saveDb(db);res.json(result);});
 router.post('/settlements',edit('create'));
 router.put('/settlements/:id',edit('update'));
 router.delete('/settlements/:id',edit('delete'));
 return router;
}
