import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import XLSX from 'xlsx';
import {buildMasterChartWorkbook,registerMasterChartRoutes} from '../server/masterChartExport.mjs';
import {sample} from './fixtures/master-chart.mjs';
const input={filters:{from:'2026-09-01',to:'2026-09-30'},pivot:{rows:['product','marketplace'],column:'month',metric:'returnRate'}};
test('Master Chart workbook has scoped analyses, definitions, weighted pivot totals and no configuration leakage',()=>{
 const state=sample();state.secrets={apiKey:'DO-NOT-EXPORT'};state.meta={privatePath:'DO-NOT-EXPORT'};const before=structuredClone(state);
 const workbook=buildMasterChartWorkbook(state,input);assert.equal(workbook.SheetNames.length,13);
 assert.ok(workbook.SheetNames.includes('Pivot Analysis'));assert.ok(workbook.SheetNames.includes('Agent Wallets'));
 const pivot=XLSX.utils.sheet_to_json(workbook.Sheets['Pivot Analysis'],{header:1});
 assert.equal(pivot.at(-1).at(-1),.2);assert.equal(workbook.Sheets['Pivot Analysis']['C2'].z,'0.00%');
 const products=XLSX.utils.sheet_to_json(workbook.Sheets.Products);assert.equal(products[0]['Estimated Profit'],66.9);assert.equal(products[0]['Customer Return %'],.2);
 const finances=XLSX.utils.sheet_to_json(workbook.Sheets['Financial Position']);assert.equal(finances.find(r=>r.Metric==='Final settlement due')['Amount INR'],226.9);
 assert.doesNotMatch(JSON.stringify(workbook),/DO-NOT-EXPORT|apiKey|privatePath/);assert.deepEqual(state,before);
});
test('Excel endpoint is read-only, styled, validates selections and retains safe strings',async t=>{
 const state=sample();state.products[0].name='=HYPERLINK("https://example.invalid")';const before=structuredClone(state);
 const app=express();app.use(express.json());registerMasterChartRoutes(app,{readDb:()=>state});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());
 const url=`http://127.0.0.1:${server.address().port}/api/master-chart/export`;
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/spreadsheetml/);
 const bytes=Buffer.from(await r.arrayBuffer()),wb=XLSX.read(bytes,{type:'buffer',cellStyles:true});assert.equal(wb.SheetNames.length,13);
 assert.equal(wb.Sheets.Products.A2.t,'s');assert.equal(wb.Sheets.Products.A2.f,undefined);assert.equal(wb.Sheets.Products.A2.v,state.products[0].name);
 const zip=XLSX.CFB.read(bytes,{type:'buffer'}),styles=zip.FileIndex.find((e,i)=>zip.FullPaths[i].endsWith('/xl/styles.xml'));assert.match(Buffer.from(styles.content).toString(),/FF2E5E4E/);
 for(const invalid of [{filters:{from:'2026-09-31',to:'2026-09-30'}},{...input,pivot:{rows:['not-a-field']}},{...input,filters:{...input.filters,marketplace:'Other'}}]){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(invalid)});assert.equal(response.status,400);
 }
 assert.deepEqual(state,before);
});
