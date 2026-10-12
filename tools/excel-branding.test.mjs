import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import ExcelJS from 'exceljs';
import XLSX from 'xlsx';
import {writeBrandedWorkbook, EXCEL_BRAND, INR_FORMAT, importHeaderRow} from '../server/excelStyle.mjs';
import {purchaseTemplate, previewPurchaseFile, PURCHASE_COLUMNS} from '../server/purchaseRoutes.mjs';
import {buildReportsWorkbook} from '../server/reportExcel.mjs';

const read=async bytes=>{const w=new ExcelJS.Workbook();await w.xlsx.load(bytes);return w;};
const data=s=>XLSX.utils.sheet_to_json(s,{range:s['!autofilter'].ref,defval:''});
const db=()=>({meta:{version:1},companies:[{id:'c',name:'Test company'}],agents:[],accounts:[],products:[{id:'p',sku:'0001',name:'=Literal',stock:20,costPrice:5}],productMaster:[],todaySales:[],salesHistory:[],ledger:[],refunds:[],stockMovements:[],monthCloseArchive:[],walletResets:[]});
const checkSheet=s=>{assert.equal(s.getCell('A1').value,'SellQuanta');assert.equal(s.getCell('A1').fill.fgColor.argb,EXCEL_BRAND.dark);assert.equal(s.getCell('A6').fill.fgColor.argb,EXCEL_BRAND.header);assert.equal(s.getCell('A6').font.color.argb,EXCEL_BRAND.white);assert.equal(s.views[0].state,'frozen');assert.equal(s.views[0].ySplit,6);assert.ok(s.autoFilter);assert.match(s.headerFooter.oddFooter,/SellQuanta/);};

test('shared writer preserves exact typed data, literals, styles, filters, INR, totals and source immutability',async()=>{
 const source=XLSX.utils.book_new();XLSX.utils.book_append_sheet(source,XLSX.utils.aoa_to_sheet([['SKU','Quantity','Sales Amount'],['0001',2,12.345],['=Literal',3,0]]),'Sales');const before=JSON.stringify(source);
 const bytes=await writeBrandedWorkbook(source,{period:'2026-10-01 - 2026-10-31 (UTC)',generatedAt:new Date('2026-10-12T10:00:00Z')});const w=await read(bytes),s=w.worksheets[0];checkSheet(s);
 assert.equal(s.getCell('A7').value,'0001');assert.equal(s.getCell('A8').value,'=Literal');assert.equal(s.getCell('C7').value,12.345);assert.equal(s.getCell('C7').numFmt,INR_FORMAT);assert.equal(s.getCell('A7').fill.fgColor.argb,EXCEL_BRAND.white);assert.equal(s.getCell('A8').fill.fgColor.argb,EXCEL_BRAND.light);assert.equal(s.getCell('B10').value,5);assert.equal(s.getCell('C10').value,12.345);assert.equal(data(XLSX.read(bytes).Sheets.Sales).length,2);assert.equal(JSON.stringify(source),before);
 const grouped=XLSX.utils.book_new();XLSX.utils.book_append_sheet(grouped,XLSX.utils.aoa_to_sheet([['Product','Orders','Total Sales'],['A',1,10],['B',1,20]]),'Product Summary');
 const summary=await read(await writeBrandedWorkbook(grouped,{totalsBySheet:{'Product Summary':{Orders:1,'Total Sales':30}}}));assert.equal(summary.worksheets[0].getCell('B10').value,1,'One order across two products must not become two orders in the totals row');
});

test('all five report worksheets have consistent branding and empty reports remain usable',async()=>{
 const state=db(), before=JSON.stringify(state);const {workbook}=buildReportsWorkbook(state,{mode:'monthly',month:'2026-10'});const bytes=await writeBrandedWorkbook(workbook,{reportName:'Sales & Returns Reports',period:'2026-10-01 - 2026-10-31 (UTC)'});const w=await read(bytes);
 assert.deepEqual(w.worksheets.map(s=>s.name),['Sales','Returns','Marketplace Summary','Agent Summary','Product Summary']);w.worksheets.forEach(checkSheet);assert.equal(data(XLSX.read(bytes).Sheets.Sales).length,0);assert.equal(JSON.stringify(state),before);
});

test('branded and legacy purchase templates accept 400 rows and keep actual Excel row numbers and formula rejection',async()=>{
 const state=db(), source=purchaseTemplate();for(let i=0;i<400;i++)XLSX.utils.sheet_add_aoa(source.Sheets.Purchases,[['2026-10-12','Supplier',`INV-${i}`,`P-${i}`,'Product',1,5,2,'']],{origin:-1});
 for(const bytes of [XLSX.write(source,{type:'buffer',bookType:'xlsx'}),await writeBrandedWorkbook(source,{template:true})]){const preview=previewPurchaseFile(state,bytes.toString('base64'));assert.equal(preview.valid,true);assert.equal(preview.rows.length,400);assert.equal(preview.summary.totalCents,200000);}
 const bytes=await writeBrandedWorkbook(source,{template:true}),w=await read(bytes);checkSheet(w.getWorksheet('Purchases'));w.getWorksheet('Purchases').getCell('F7').value={formula:'1+1',result:2};const invalid=previewPurchaseFile(state,Buffer.from(await w.xlsx.writeBuffer()).toString('base64'));assert.equal(invalid.rows[0].row,7);assert.match(invalid.rows[0].error,/formulas/);
 assert.equal(importHeaderRow(XLSX.read(bytes).Sheets.Purchases),5);
});

test('live isolated server styles every export, all reporting periods and template previews without business writes',async t=>{
 const root=path.resolve(import.meta.dirname,'..'),dir=fs.mkdtempSync(path.join(root,'tmp/excel-branding-http-'));fs.mkdirSync(path.join(dir,'data'));const file=path.join(dir,'data/stockpilot.json');fs.writeFileSync(file,JSON.stringify(db()));
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,[path.join(root,'server/index.mjs')],{cwd:root,env:{...process.env,PORT:String(port),SELLQUANTA_DATA_ROOT:dir,SELLQUANTA_CLIENT_DIST:path.join(dir,'none')},windowsHide:true,stdio:'ignore'});t.after(async()=>{if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});});
 const req=(url,body)=>fetch(`http://127.0.0.1:${port}/api${url}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
 let ready=false;for(let i=0;i<200;i++){try{if((await req('/server-info')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready);const before=fs.readFileSync(file);
 const download=async url=>{const res=await req(url);assert.equal(res.status,200,url);const bytes=Buffer.from(await res.arrayBuffer());const w=await read(bytes);w.worksheets.forEach(checkSheet);return w;};
 for(const query of ['mode=daily&date=2026-10-12','mode=weekly&date=2026-10-12','mode=monthly&month=2026-10','mode=yearly&year=2026','mode=custom&from=2026-10-01&to=2026-10-12']){assert.equal((await download('/reports/export?'+query)).worksheets.length,5);await download('/purchases/history-export?'+query);}
 await download('/products/export-backup');assert.equal((await download('/product-master/export-backup?companyId=c')).worksheets.length,3);
 const configs=[['/products/import-template','WAREHOUSE',['P-NEW','Product',5,10],'/products/import-preview',{}],['/product-master/template?companyId=c&marketplace=Amazon','PRODUCT_MASTER',['0001','SKU','Product'],'/product-master/import-preview',{companyId:'c',marketplace:'Amazon'}],['/purchases/import-template','Purchases',['2026-10-12','Supplier','INV','0001','Product',2,5,2,''],'/purchases/import-preview',{}]];
 for(const [url,name,row,preview,scope] of configs){const w=await download(url);w.getWorksheet(name).getRow(7).values=row;const fileBase64=Buffer.from(await w.xlsx.writeBuffer()).toString('base64');const res=await req(preview,{...scope,fileBase64});assert.equal(res.status,200,preview);const result=await res.json();if(name==='Purchases')assert.equal(result.valid,true);else assert.ok(!JSON.stringify(result).includes('Missing column'));}
 const w=await download('/purchases/import-template');w.getWorksheet('Purchases').getRow(7).values=['2026-10-12','','BAD','P','Product',0,5,2,''];const err=await req('/purchases/error-report',{fileBase64:Buffer.from(await w.xlsx.writeBuffer()).toString('base64')});assert.equal(err.status,200);(await read(Buffer.from(await err.arrayBuffer()))).worksheets.forEach(checkSheet);
 assert.ok(fs.readFileSync(file).equals(before),'All downloads/previews are read-only');
});
