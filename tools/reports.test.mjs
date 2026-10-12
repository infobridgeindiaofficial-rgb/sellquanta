import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { reportRange, reportRecords, salesReturnsReport } from '../server/reports.mjs';
import { buildReportsWorkbook } from '../server/reportExcel.mjs';

const sale=(id,date,amount,qty=1,marketplace='Amazon')=>({id,date,saleAmount:amount,qty,marketplace,agentId:'a',productId:'p',orderId:id});
const fixture=()=>{const old=sale('old','2026-09-30',100,4);return {
 agents:[{id:'a',name:'Agent'}],products:[{id:'p',name:'Product',stock:99}],ledger:[{id:'l',type:'SALE',amount:20}],
 todaySales:[sale('oct','2026-10-01',80,2,'Flipkart'),sale('end','2026-10-31',50,1,'Meesho')],salesHistory:[old],
 monthCloseArchive:[{sales:[old,sale('year','2025-12-31',30)],refunds:[]}],
 refunds:[{id:'r',saleId:'old',refundDate:'2026-10-02',qty:1,refundAmount:25},{id:'partial',saleId:'oct',refundDate:'2026-10-31',qty:1,refundAmount:40}],
 undoLog:[{sales:[sale('undone','2026-10-01',1000)]}],walletResets:[]};};

test('all five period types use inclusive UTC dates, Monday weeks, leap months and year boundaries',()=>{
 assert.deepEqual(reportRange({mode:'daily',date:'2026-10-01'}),{mode:'daily',from:'2026-10-01',to:'2026-10-01'});
 assert.deepEqual(reportRange({mode:'weekly',date:'2026-01-01'}),{mode:'weekly',from:'2025-12-29',to:'2026-01-04'});
 assert.equal(reportRange({mode:'monthly',month:'2024-02'}).to,'2024-02-29');
 assert.equal(reportRange({mode:'yearly',year:'2026'}).to,'2026-12-31');
 assert.deepEqual(reportRange({mode:'custom',from:'2026-10-01',to:'2026-10-31'}),{mode:'custom',from:'2026-10-01',to:'2026-10-31'});
 for(const filter of [{mode:'custom',from:'2026-11-01',to:'2026-10-01'},{mode:'daily',date:'2026-02-30'},{mode:'monthly',month:'2026-13'},{mode:'yearly',year:'oops'}])assert.throws(()=>reportRange(filter));
 assert.equal(reportRange({},new Date('2026-10-01T01:00:00+04:00')).from,'2026-09-30');
});
test('archived sales deduplicate; partial and cross-period refunds subtract once on their own date',()=>{
 const state=fixture(),before=JSON.stringify(state);assert.equal(reportRecords(state).sales.length,4);
 const report=salesReturnsReport(state,{mode:'monthly',month:'2026-10'});
 assert.deepEqual(report.totals,{totalSalesCents:13000,orders:2,unitsSold:3,returnsCount:2,returnedUnits:2,returnAmountCents:6500,netSalesCents:6500});
 for(const groups of [report.marketplaces,report.agents,report.products,report.trends]){
  assert.equal(groups.reduce((n,g)=>n+g.totalSalesCents,0),report.totals.totalSalesCents);
  assert.equal(groups.reduce((n,g)=>n+g.returnAmountCents,0),report.totals.returnAmountCents);
  assert.equal(groups.reduce((n,g)=>n+g.netSalesCents,0),report.totals.netSalesCents);
 }
 assert.equal(salesReturnsReport(state,{mode:'daily',date:'2026-10-02'}).totals.netSalesCents,-2500);
 assert.equal(salesReturnsReport(state,{mode:'weekly',date:'2026-10-01'}).totals.totalSalesCents,18000);
 assert.equal(salesReturnsReport(state,{mode:'yearly',year:2025}).totals.totalSalesCents,3000);
 assert.equal(salesReturnsReport(state,{mode:'custom',from:'2026-10-31',to:'2026-10-31'}).totals.netSalesCents,1000);
 assert.equal(JSON.stringify(state),before,'stock, ledger and every source record must remain byte-equivalent');
});
test('Excel selected-period worksheets reconcile and are generated without source mutations',()=>{
 const state=fixture(),before=JSON.stringify(state);const {workbook,report}=buildReportsWorkbook(state,{mode:'monthly',month:'2026-10'});
 const bytes=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});const wb=XLSX.read(bytes,{type:'buffer'});
 assert.deepEqual(wb.SheetNames,['Sales','Returns','Marketplace Summary','Agent Summary','Product Summary']);
 const rows=name=>XLSX.utils.sheet_to_json(wb.Sheets[name]);
 assert.equal(rows('Sales').reduce((n,r)=>n+r['Sales Amount'],0),130);
 assert.equal(rows('Returns').reduce((n,r)=>n+r['Refund Amount'],0),65);
 for(const name of wb.SheetNames.slice(2))assert.equal(rows(name).reduce((n,r)=>n+r['Net Sales'],0),report.totals.netSalesCents/100);
 assert.equal(JSON.stringify(state),before);
});
test('empty periods show zeroes, legacy UTC timestamps and missing date warning are handled',()=>{
 const state=fixture();state.todaySales.push({id:'legacy',createdAt:'2026-10-01T01:00:00+04:00',saleAmount:0.1,qty:1,marketplace:'amazon'});state.todaySales.push({id:'undated',saleAmount:999});
 const report=salesReturnsReport(state,{mode:'daily',date:'2026-09-30'});assert.equal(report.totals.totalSalesCents,10010);assert.equal(report.missingDates,1);
 const empty=salesReturnsReport(state,{mode:'monthly',month:'2027-01'});assert.equal(empty.totals.netSalesCents,0);assert.equal(empty.totals.orders,0);assert.equal(empty.marketplaces.length,3);
 assert.equal(buildReportsWorkbook(state,{mode:'yearly',year:'2027'}).workbook.SheetNames.length,5);
});
test('duplicate refund copies and ledger reversals never create extra returns; order lines group within an account',()=>{
 const state=fixture();state.monthCloseArchive[0].refunds=[state.refunds[0]];state.ledger.push({kind:'REFUND_REVERSAL',refundId:'r',amount:-25});
 state.todaySales.push({...state.todaySales[0],id:'oct-line',qty:1,saleAmount:10});
 const report=salesReturnsReport(state,{mode:'monthly',month:'2026-10'});
 assert.equal(report.totals.returnsCount,2);assert.equal(report.totals.returnAmountCents,6500);assert.equal(report.totals.orders,2);
});
