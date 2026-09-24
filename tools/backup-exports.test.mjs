import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import XLSX from 'xlsx';
import { buildWarehouseBackup, buildCompanyMasterBackup, companyBackupFilename } from '../server/backupExports.mjs';

const roundTrip = wb => XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer' });
const rows = (wb, sheet) => XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });
const fixture = () => ({
  companies: [{id:'c1',name:'First Company'}, {id:'c2',name:'Second Company'}],
  products: [
    {id:'p1',sku:'000123',name:'=Literal product',costPrice:12.345,stock:7,lowStockLevel:0,createdAt:'2026-01-01',image:'data:image/png;base64,test'},
    {id:'p2',sku:'ARCHIVED',name:'Archived Product',costPrice:0,stock:0,active:false,removedAt:'2026-09-20'},
    {id:'p3',sku:'NO-OPENING',name:'No opening record',costPrice:1,stock:50},
    {id:'p4',sku:'STORED-OPENING',name:'Stored opening field',costPrice:2,stock:5,openingStock:0}
  ],
  stockMovements: [{productId:'p1',type:'OPENING',qty:10},{productId:'p1',type:'SALE',qty:-3},{productId:'p2',type:'OPENING',qty:0}],
  productMaster: [
    {id:'m1',companyId:'c1',marketplace:'Amazon',marketplaceSku:'001234567890123456789',productId:'p1',productName:'Mapping Name',createdAt:'2026-01-02'},
    {id:'m2',companyId:'c1',marketplace:'Flipkart',marketplaceSku:'=LITERAL',productId:'p2',productName:'Archived Mapping'},
    {id:'m3',companyId:'c2',marketplace:'Meesho',marketplaceSku:'OTHER',productId:'p1',productName:'Other Company'},
    {id:'m4',companyId:'c1',marketplace:'amazon',marketplaceSku:'ORPHAN',productId:'missing',productName:'Unresolved product'}
  ]
});

test('warehouse workbook includes every product, exact numeric/text data and stored opening quantities without mutation', () => {
  const db = fixture(), before = structuredClone(db);
  const wb = roundTrip(buildWarehouseBackup(db));
  assert.deepEqual(wb.SheetNames, ['WAREHOUSE']);
  const data = rows(wb, 'WAREHOUSE');
  assert.equal(data.length, db.products.length);
  db.products.forEach((p,i) => {
    assert.equal(data[i]['Warehouse Product Code'],p.sku);
    assert.equal(data[i]['Product Name'],p.name);
    assert.equal(data[i]['Cost Price'],p.costPrice);
    assert.equal(data[i]['Current Stock'],p.stock);
    assert.equal(data[i]['Product ID'],p.id);
  });
  assert.equal(data[0]['Opening Stock'],10);
  assert.equal(data[1]['Opening Stock'],0);
  assert.equal(data[2]['Opening Stock'],'');
  assert.equal(data[3]['Opening Stock'],0);
  assert.equal(data[1].Status,'Archived');
  assert.equal(wb.Sheets.WAREHOUSE.A2.t,'s');
  assert(!Object.values(wb.Sheets.WAREHOUSE).some(c=>c?.f));
  assert.deepEqual(db,before);
});

test('company backup has exactly three marketplace sheets, preserves mapping IDs and excludes every other company', () => {
  const db = fixture(), before = structuredClone(db);
  const wb = roundTrip(buildCompanyMasterBackup(db,'c1'));
  assert.deepEqual(wb.SheetNames,['AMAZON','FLIPKART','MEESHO']);
  for (const marketplace of wb.SheetNames) {
    const data=rows(wb,marketplace);
    const expected=db.productMaster.filter(m=>m.companyId==='c1' && m.marketplace.toUpperCase()===marketplace);
    assert.deepEqual(data.map(r=>r['Mapping ID']),expected.map(m=>m.id));
    data.forEach((r,i)=>{
      const m=expected[i];
      assert.equal(r['Company ID'],'c1');
      assert.equal(r['Marketplace SKU'],m.marketplaceSku);
      assert.equal(r['Product Name'],m.productName);
      assert.equal(r['Warehouse Product Code'],db.products.find(p=>p.id===m.productId)?.sku || '');
      assert.equal(r['Warehouse Product ID'],m.productId);
    });
    assert(!Object.values(wb.Sheets[marketplace]).some(c=>c?.f));
  }
  assert.equal(rows(wb,'MEESHO').length,0);
  assert.equal(wb.Sheets.MEESHO.A1.v,'Warehouse Product Code');
  assert.deepEqual(db,before);
  assert.throws(()=>buildCompanyMasterBackup(db,''), /Company/);
  assert.throws(()=>buildCompanyMasterBackup(db,'missing'), /Company/);
  assert.equal(companyBackupFilename('Demo Traders','2026-09-23'),'StockPilot_Product_Master_Demo_Traders_Backup_2026-09-23.xlsx');
  assert(!/["\\/:*?<>|\r\n]/.test(companyBackupFilename('Unsafe / name\r\n"','2026-09-23')));
});

test('empty warehouse and empty company keep headers; real stored data round-trips unchanged', () => {
  const empty={companies:[{id:'empty',name:'Empty'}],products:[],productMaster:[],stockMovements:[]};
  assert.equal(roundTrip(buildWarehouseBackup(empty)).Sheets.WAREHOUSE.A1.v,'Warehouse Product Code');
  const e=roundTrip(buildCompanyMasterBackup(empty,'empty'));
  for(const name of e.SheetNames) assert.equal(rows(e,name).length,0);
  const livePath=path.resolve(import.meta.dirname,'fixtures/business/data/stockpilot.json'); // synthetic demo data
  const original=fs.readFileSync(livePath);
  const db=JSON.parse(original);
  const warehouse=roundTrip(buildWarehouseBackup(db));
  const data=rows(warehouse,'WAREHOUSE');
  assert.equal(data.length,db.products.length);
  db.products.forEach((p,i)=>{
    assert.deepEqual([data[i]['Warehouse Product Code'],data[i]['Product Name'],data[i]['Cost Price'],data[i]['Current Stock']], [p.sku,p.name,p.costPrice,p.stock]);
  });
  for(const c of db.companies) {
    const workbook=roundTrip(buildCompanyMasterBackup(db,c.id));
    for(const marketplace of workbook.SheetNames) {
      const expected=db.productMaster.filter(m=>m.companyId===c.id && m.marketplace.toUpperCase()===marketplace);
      assert.deepEqual(rows(workbook,marketplace).map(r=>r['Mapping ID']),expected.map(m=>m.id));
    }
  }
  assert(fs.readFileSync(livePath).equals(original));
});

test('download endpoints return valid XLSX and company filenames without any data writes', async t => {
  const root=path.resolve(import.meta.dirname,'..'), livePath=path.join(root,'tools/fixtures/business/data/stockpilot.json');
  fs.mkdirSync(path.join(root,'tmp'),{recursive:true});
  const original=fs.readFileSync(livePath);
  const dir=fs.mkdtempSync(path.join(root,'tmp/export-http-test-'));
  fs.cpSync(path.join(root,'server'),path.join(dir,'server'),{recursive:true});
  fs.mkdirSync(path.join(dir,'data'));
  const dbPath=path.join(dir,'data/stockpilot.json');
  fs.writeFileSync(dbPath,original);
  const listener=net.createServer();
  await new Promise(r=>listener.listen(0,'127.0.0.1',r));
  const port=listener.address().port;
  await new Promise(r=>listener.close(r));
  const child=spawn(process.execPath,[path.join(dir,'server/index.mjs')],{env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'ignore'});
  t.after(async()=>{
    if(child.exitCode===null) await new Promise(r=>{child.once('exit',r);child.kill();});
    assert(fs.readFileSync(livePath).equals(original));
  });
  const url=`http://127.0.0.1:${port}/api`;
  let ready=false;
  for(let i=0;i<100;i++) {
    try { ready=(await fetch(`${url}/server-info`)).ok; } catch {}
    if(ready) break;
    await new Promise(r=>setTimeout(r,50));
  }
  assert(ready);
  const before=fs.readFileSync(dbPath), db=JSON.parse(before);
  const fetchWorkbook=async(route,filenamePattern)=>{
    const response=await fetch(`${url}${route}`);
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/spreadsheetml.sheet/);
    assert.match(response.headers.get('content-disposition'),filenamePattern);
    assert.equal(response.headers.get('access-control-expose-headers'),'Content-Disposition');
    const buffer=Buffer.from(await response.arrayBuffer());
    const filename=response.headers.get('content-disposition').match(/filename="([^"]+)"/)[1];
    fs.writeFileSync(path.join(dir,filename),buffer);
    return XLSX.read(buffer,{type:'buffer'});
  };
  const wh=await fetchWorkbook('/products/export-backup',/StockPilot_Warehouse_Backup_\d{4}-\d{2}-\d{2}\.xlsx/);
  assert.equal(rows(wh,'WAREHOUSE').length,db.products.length);
  for(const company of db.companies) {
    const wb=await fetchWorkbook(`/product-master/export-backup?companyId=${encodeURIComponent(company.id)}`,/StockPilot_Product_Master_.+_Backup_\d{4}-\d{2}-\d{2}\.xlsx/);
    assert.deepEqual(wb.SheetNames,['AMAZON','FLIPKART','MEESHO']);
    for(const marketplace of wb.SheetNames) {
      const expected=db.productMaster.filter(m=>m.companyId===company.id && m.marketplace.toUpperCase()===marketplace);
      assert.deepEqual(rows(wb,marketplace).map(r=>r['Mapping ID']),expected.map(m=>m.id));
    }
  }
  assert.equal((await fetch(`${url}/product-master/export-backup`)).status,400);
  assert.equal((await fetch(`${url}/product-master/export-backup?companyId=unknown`)).status,400);
  assert(fs.readFileSync(dbPath).equals(before));
  // Missing/corrupt data is never initialized, normalized or overwritten by exports.
  fs.unlinkSync(dbPath);
  assert.equal((await fetch(`${url}/products/export-backup`)).status,400);
  assert(!fs.existsSync(dbPath));
  fs.writeFileSync(dbPath,'{broken');
  assert.equal((await fetch(`${url}/products/export-backup`)).status,400);
  assert.equal(fs.readFileSync(dbPath,'utf8'),'{broken');
  console.log(`Export sample workbooks: ${dir}`);
});
