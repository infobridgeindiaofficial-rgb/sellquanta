import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import XLSX from 'xlsx';
import {reportPeriod,salesReport,REPORT_COLUMNS} from '../client/src/salesReport.js';
import {captureFinancialSnapshot} from '../server/financialSnapshot.mjs';
import {buildSalesReportWorkbook,registerSalesReportRoutes} from '../server/salesReports.mjs';

const sale=(id,date,qty=2)=>({id,date,qty,orderId:'ORDER-'+id,agentId:'a',accountId:'acc',marketplace:'Amazon',productId:'p',saleAmount:qty*150,source:'manual',costTotal:qty*30,financialSnapshot:captureFinancialSnapshot({cost_price:30,estimated_settlement:100,estimated_profit:70},qty)});
const fixture=()=>({agents:[{id:'a',name:'Agent'}],accounts:[{id:'acc',name:'Account'}],products:[{id:'p',name:'Product'}],productMaster:[{estimated_settlement:999}],todaySales:[sale('today','2026-10-14')],salesHistory:[sale('history','2026-10-12'),sale('outside','2026-09-30')],monthCloseArchive:[{sales:[sale('archive','2026-10-01'),sale('history','2026-10-12')]}],refunds:[]});

test('Daily, Monday-Sunday Weekly, leap-year Monthly and Custom report boundaries validate dates',()=>{
 assert.deepEqual(reportPeriod({mode:'daily',date:'2026-10-14'}),{from:'2026-10-14',to:'2026-10-14'});
 assert.deepEqual(reportPeriod({mode:'weekly',date:'2026-10-18'}),{from:'2026-10-12',to:'2026-10-18'});
 assert.deepEqual(reportPeriod({mode:'weekly',date:'2027-01-01'}),{from:'2026-12-28',to:'2027-01-03'});
 assert.deepEqual(reportPeriod({mode:'monthly',month:'2024-02'}),{from:'2024-02-01',to:'2024-02-29'});
 assert.deepEqual(reportPeriod({mode:'custom',from:'2026-09-30',to:'2026-10-14'}),{from:'2026-09-30',to:'2026-10-14'});
 for(const selection of [{mode:'daily',date:'2026-02-30'},{mode:'custom',from:'2026-10-14',to:'2026-10-01'},{mode:'custom',from:'',to:''},{mode:'monthly',month:'2026-13'},{mode:'invalid'}])assert.throws(()=>reportPeriod(selection));
});

test('reports include historical archives once, reuse captured quantity financials, preserve records and refresh/restart',()=>{
 const state=fixture(),before=structuredClone(state),selection={mode:'monthly',month:'2026-10'};
 const report=salesReport(state,selection);
 assert.deepEqual(report.totals,{orders:3,qty:6,amount:900,cost:180,settlement:600,profit:420});
 assert.deepEqual(report.records[0],['2026-10-01','Agent','Account / Amazon','ORDER-archive','Product',2,300,60,200,140,'manual']);
 assert.equal(salesReport(state,{mode:'daily',date:'2026-10-14'}).rows.length,1);
 assert.equal(salesReport(state,{mode:'weekly',date:'2026-10-14'}).rows.length,2);
 assert.deepEqual(salesReport(JSON.parse(JSON.stringify(state)),selection),report);
 assert.deepEqual(state,before);
 const fresh={...state,todaySales:[...state.todaySales,sale('new','2026-10-14',3)]};
 assert.equal(salesReport(fresh,selection).totals.qty,9);
});

test('Excel has selected-period records only and matching top summary and numeric financial values',()=>{
 const wb=buildSalesReportWorkbook(fixture(),{mode:'weekly',date:'2026-10-14'});
 const reopened=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
 const cells=XLSX.utils.sheet_to_json(reopened.Sheets['Sales Report'],{header:1,defval:''});
 assert.deepEqual(cells[4].slice(0,6),[2,4,600,120,400,280]);assert.deepEqual(cells[6],REPORT_COLUMNS);
 assert.equal(cells.length,9);assert.deepEqual(cells.slice(7).map(row=>row[0]),['2026-10-12','2026-10-14']);
 assert.equal(reopened.Sheets['Sales Report'].H8.t,'n');
});

test('export API reads without writes, repeated downloads preserve Daily Sales, invalid periods fail',async t=>{
 const state=fixture(),before=JSON.stringify(state),app=express();let reads=0;
 registerSalesReportRoutes(app,{readDb:()=>{reads++;return state;}});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}/api/reports/sales/export`;
 for(let i=0;i<2;i++){
  const response=await fetch(base+'?mode=daily&date=2026-10-14');assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/2026-10-14-to-2026-10-14.xlsx/);
  const wb=XLSX.read(Buffer.from(await response.arrayBuffer()),{type:'buffer'});assert.equal(XLSX.utils.sheet_to_json(wb.Sheets['Sales Report'],{header:1}).length,8);
 }
 assert.equal((await fetch(base+'?mode=custom&from=2026-10-15&to=2026-10-01')).status,400);
 assert.equal(JSON.stringify(state),before);assert.equal(reads,3);
});
