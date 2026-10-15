import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import XLSX from 'xlsx';
import { MASTER_VALUE_FIELDS, masterValues } from '../server/masterValues.mjs';

test('optional mapping values validate blanks, zeros and manual losses without calculations',()=>{
 assert.deepEqual(masterValues({listing_price:'0',cost_price:'12.50',estimated_settlement:'9',estimated_profit:'-17.25'}),{listing_price:0,cost_price:12.5,estimated_settlement:9,estimated_profit:-17.25});
 assert.deepEqual(masterValues({cost_price:''}),{cost_price:null});
 assert.deepEqual(masterValues({cost_price:''},{preserveBlanks:true}),{});
 for(const bad of ['NaN','Infinity','-1','1.001',true])assert.throws(()=>masterValues({cost_price:bad}));
 assert.throws(()=>masterValues({estimated_profit:'-1.001'}));
});

test('all marketplaces: create/edit, seven-column download/import/export, legacy imports, validation and restart persistence',async t=>{
 const root=path.resolve(import.meta.dirname,'..'),live=path.join(root,'data/stockpilot.json'),before=JSON.parse(fs.readFileSync(live));
 const dir=fs.mkdtempSync(path.join(root,'tmp/master-values-http-'));fs.mkdirSync(path.join(dir,'data'));
 const initial={meta:{version:1},companies:[{id:'c1',name:'One'},{id:'c2',name:'Two'}],agents:[],accounts:[],products:[{id:'p',sku:'PDN',name:'Warehouse Name',stock:15,costPrice:50}],productMaster:[],todaySales:[],salesHistory:[{id:'history',costPrice:42}],ledger:[],stockMovements:[],refunds:[],monthCloseArchive:[],walletResets:[],purchases:[{id:'receipt'}]};
 const dbFile=path.join(dir,'data/stockpilot.json');fs.writeFileSync(dbFile,JSON.stringify(initial));
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 let child;
 const request=(route,method='GET',body)=>fetch(`http://127.0.0.1:${port}/api${route}`,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const start=async()=>{child=spawn(process.execPath,[path.join(root,'server/index.mjs')],{cwd:root,env:{...process.env,PORT:String(port),SELLQUANTA_DATA_ROOT:dir,SELLQUANTA_CLIENT_DIST:path.join(dir,'no-dist')},windowsHide:true,stdio:'ignore'});for(let i=0;i<100;i++){try{if((await request('/server-info')).ok)return;}catch{}await new Promise(r=>setTimeout(r,40));}throw Error('Test server did not start');};
 const stop=async()=>{if(child?.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});};
 t.after(async()=>{await stop();assert.deepEqual(JSON.parse(fs.readFileSync(live)),before,'Live business records unchanged');});
 await start();
 const protectedBefore = JSON.parse(fs.readFileSync(dbFile)); // Existing startup housekeeping is outside this feature.
 const baseHeaders=['warehouse_product_code','marketplace_sku','product_name'],headers=[...baseHeaders,...MASTER_VALUE_FIELDS.map(([f])=>f)];
 const workbook=(columns,rows,formula=false)=>{const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([columns,...rows]);if(formula)ws.D2={t:'n',v:300,f:'100+200'};XLSX.utils.book_append_sheet(wb,ws,'PRODUCT_MASTER');return XLSX.write(wb,{type:'base64',bookType:'xlsx'});};
 const ids=[];
 for(const marketplace of ['Amazon','Flipkart','Meesho']){
  const scope={companyId:'c1',marketplace};
  const template=await request('/product-master/template?'+new URLSearchParams(scope));assert.equal(template.status,200);
  const sheet=XLSX.read(Buffer.from(await template.arrayBuffer())).Sheets.PRODUCT_MASTER;
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet,{header:1})[4],headers);
  const input={...scope,code:'PDN',sku:'000-SKU',name:'Manual Name',listing_price:'250',cost_price:'100.25',estimated_settlement:'160',estimated_profit:'-5.50'};
  const created=await request('/product-master','POST',input);assert.equal(created.status,200);const mapping=await created.json();ids.push(mapping.id);assert.equal(mapping.estimated_profit,-5.5);
  const update=await request('/product-master/'+mapping.id+'/product','POST',{productId:'p',updateName:false,listing_price:'300',estimated_profit:'77.25'});assert.equal(update.status,200);const edited=await update.json();assert.equal(edited.productName,'Manual Name');assert.equal(edited.cost_price,100.25);assert.equal(edited.estimated_profit,77.25);
  const imported=await(await request('/product-master/import','POST',{...scope,fileBase64:workbook(headers,[['PDN','000-SKU','Imported Name',310,99.5,170,8.75],['PDN','NEW-SKU','New Name','','','','']])})).json();assert.equal(imported.updated,1);assert.equal(imported.added,1);assert.equal(imported.errors.length,0);
  const legacy=await(await request('/product-master/import','POST',{...scope,fileBase64:workbook(baseHeaders,[['PDN','000-SKU','Legacy Name']])})).json();assert.equal(legacy.updated,1);
  let db=JSON.parse(fs.readFileSync(dbFile));let row=db.productMaster.find(m=>m.id===mapping.id);assert.equal(row.productName,'Legacy Name');assert.equal(row.estimated_profit,8.75);assert.equal(row.cost_price,99.5);
  const blanks=await(await request('/product-master/import','POST',{...scope,fileBase64:workbook(headers,[['PDN','000-SKU','Blank Prices','','','','']])})).json();assert.equal(blanks.updated,1);
  const invalid=await(await request('/product-master/import','POST',{...scope,fileBase64:workbook(headers,[['PDN','INVALID','Invalid',1,-2,3,4]])})).json();assert.equal(invalid.errors.length,1);assert.equal(invalid.added,0);
  const formulas=await(await request('/product-master/import','POST',{...scope,fileBase64:workbook(headers,[['PDN','FORMULA','Formula',300,10,20,30]],true)})).json();assert.equal(formulas.errors.length,1);
  assert.equal((await request('/product-master/'+mapping.id+'/product','POST',{productId:'p',estimated_profit:'bad'})).status,400);
 }
 const other=await request('/product-master','POST',{companyId:'c2',marketplace:'Amazon',code:'PDN',sku:'000-SKU',name:'Other',cost_price:'0'});assert.equal(other.status,200);
 const response=await request('/product-master/export-backup?companyId=c1');assert.equal(response.status,200);const exported=XLSX.read(Buffer.from(await response.arrayBuffer()));
 for(const marketplace of ['AMAZON','FLIPKART','MEESHO']){
  const rows=XLSX.utils.sheet_to_json(exported.Sheets[marketplace],{defval:''});assert.equal(rows.length,2);const row=rows.find(r=>r['Marketplace SKU']==='000-SKU');assert.equal(row.listing_price,310);assert.equal(row.cost_price,99.5);assert.equal(row.estimated_settlement,170);assert.equal(row.estimated_profit,8.75);
 }
 await stop();await start();const state=await(await request('/state')).json();assert.equal(state.productMaster.filter(m=>ids.includes(m.id)).length,3);assert.equal(state.productMaster.find(m=>m.id===ids[0]).estimated_profit,8.75);
 const cleared=await(await request('/product-master/'+ids[0]+'/product','POST',{productId:'p',estimated_profit:''})).json();assert.equal(cleared.estimated_profit,null);assert.equal(cleared.cost_price,99.5);
 const db=JSON.parse(fs.readFileSync(dbFile));for(const k of ['products','todaySales','salesHistory','stockMovements','ledger','purchases','companies'])assert.deepEqual(db[k],protectedBefore[k],k);
});
