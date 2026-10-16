import test from 'node:test';
import assert from 'node:assert/strict';
import {bankingReport} from '../server/banking.mjs';
import {buildMasterChart} from '../client/src/masterChartData.js';
import {bankingSummary} from '../client/src/masterChartCompatibility.js';
import {buildMasterChartWorkbook} from '../server/masterChartExport.mjs';
import {writeBrandedWorkbook} from '../server/excelStyle.mjs';
import XLSX from 'xlsx';
const filters={from:'2026-10-01',to:'2026-10-31'};
const fixture=()=>({companies:[],agents:[],products:[],productMaster:[],todaySales:[{id:'s',date:'2026-10-01',marketplace:'Amazon',qty:1,saleAmount:100,costTotal:20,financialSnapshot:{perUnit:{estimated_settlement:80,estimated_profit:60,cost_price:20}}}],salesHistory:[],refunds:[],ledger:[],purchases:[],bankSettlements:[{id:'r',marketplace:'Amazon',date:'2026-10-02',createdAt:'2026-10-02T00:00:00Z',amountCents:3000},{id:'deleted',marketplace:'Amazon',date:'2026-10-03',amountCents:5000,deletedAt:'2026-10-04'}],returnCharges:[]});
test('Master Chart reference difference matches released Banking through archive copies, correction and deletion',()=>{
 const state=fixture();state.salesHistory=[{sales:[{...state.todaySales[0]}]}];const before=JSON.stringify(state);
 const reference=bankingReport(state,{mode:'all'}).totals;
 const report=buildMasterChart(state,filters);
 assert.equal(report.financial.due,7000);assert.equal(report.financial.due,reference.differenceCents);
 assert.equal(report.financial.received,reference.receivedCents);
 assert.equal(buildMasterChart(state,{...filters,companyId:'c'}).financial.due,null);
 assert.equal(JSON.stringify(state),before);
 state.bankSettlements[0].amountCents=4000;
 assert.equal(buildMasterChart(state,filters).financial.due,bankingReport(state,{mode:'all'}).totals.differenceCents);
});
test('Master Chart rejects invalid and overflowing monetary records',()=>{
 const state=fixture();state.todaySales[0].saleAmount='invalid';assert.throws(()=>bankingSummary(state,state.bankSettlements),/invalid/);
 state.todaySales[0].saleAmount=Number.MAX_SAFE_INTEGER;assert.throws(()=>bankingSummary(state,state.bankSettlements),/invalid|range/);
});
test('Master Chart exports 13 branded worksheets without mutating records; missing estimates remain unavailable',async()=>{
 const state=fixture();delete state.todaySales[0].financialSnapshot;const before=JSON.stringify(state);
 assert.equal(buildMasterChart(state,filters).totals.profit,null);
 const workbook=buildMasterChartWorkbook(state,{filters});assert.equal(workbook.SheetNames.length,13);
 const bytes=await writeBrandedWorkbook(workbook,{reportName:'Master Chart'});
 const loaded=XLSX.read(bytes);assert.equal(loaded.SheetNames.length,13);assert.equal(loaded.Sheets['Business Overview'].A1.v,'SellQuanta');
 assert.equal(JSON.stringify(state),before);
});
