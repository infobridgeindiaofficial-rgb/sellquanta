import test from 'node:test';import assert from 'node:assert/strict';import XLSX from 'xlsx';
import {writeThemedWorkbook} from '../server/excelTheme.mjs';import {buildSalesReportWorkbook} from '../server/salesReports.mjs';import {buildWarehouseBackup,buildCompanyMasterBackup} from '../server/backupExports.mjs';
const wb=(name,headers)=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([headers]),name);return w;};
const db={companies:[{id:'c',name:'Company'}],products:[{id:'p',sku:'001',name:'Product',costPrice:20,stock:3}],productMaster:[{id:'m',companyId:'c',marketplace:'Amazon',productId:'p',marketplaceSku:'0001',productName:'Product',listing_price:100,cost_price:20,estimated_settlement:80,estimated_profit:60}],todaySales:[{id:'s',date:'2026-10-15',qty:1,saleAmount:100,costTotal:20,marketplace:'Amazon',financialSnapshot:{perUnit:{cost_price:20,estimated_settlement:80,estimated_profit:60}}}],salesHistory:[],refunds:[],agents:[],accounts:[],stockMovements:[]};
const zipFiles=buffer=>{const z=XLSX.CFB.read(buffer,{type:'buffer'});return Object.fromEntries(z.FileIndex.map((entry,i)=>[z.FullPaths[i],Buffer.from(entry.content||[]).toString('utf8')]));};
for(const [name,source,report]of [['warehouse backup',buildWarehouseBackup(db),false],['master backup',buildCompanyMasterBackup(db,'c'),false],['warehouse template',wb('WAREHOUSE',['warehouse_product_code','product_name','COST PRICE','OPENING STOCK']),false],['master template',wb('PRODUCT_MASTER',['warehouse_product_code','marketplace_sku','product_name','listing_price','cost_price','estimated_settlement','estimated_profit']),false],['sales report',buildSalesReportWorkbook(db,{mode:'daily',date:'2026-10-15'}),true]]){
 test(name+' retains exact structure, cells, number formats, widths and filters while adding theme',()=>{
  const before=structuredClone(source),raw=XLSX.write(structuredClone(source),{type:'buffer',bookType:'xlsx'}),styled=writeThemedWorkbook(source,{report});assert.deepEqual(source,before);
  const a=zipFiles(raw),b=zipFiles(styled);assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());
  for(const key of Object.keys(a)){if(key.endsWith('/xl/styles.xml')){for(const color of ['FF121212','FF151515','FF2E5E4E','FF8CC3AD','FFE8EFEB','FFE4E4DF','FFFFFFFF'])assert.ok(b[key].includes(color));continue;}
   if(/worksheets\/sheet\d+\.xml$/.test(key)){const clean=xml=>xml.replace(/(<c\b[^>]*?)\s+s="\d+"/g,'$1');assert.equal(clean(b[key]),clean(a[key]));}else assert.equal(b[key],a[key]);
  }
  const reopened=XLSX.read(styled,{type:'buffer',cellStyles:true});assert.deepEqual(reopened.SheetNames,source.SheetNames);for(const sheet of source.SheetNames)assert.deepEqual(XLSX.utils.sheet_to_json(reopened.Sheets[sheet],{header:1,defval:'',raw:true}),XLSX.utils.sheet_to_json(source.Sheets[sheet],{header:1,defval:'',raw:true}));
 });
}
