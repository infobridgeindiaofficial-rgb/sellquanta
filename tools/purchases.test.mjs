import test from 'node:test';
import assert from 'node:assert/strict';
import {receivePurchases,returnPurchase,saveSupplier,purchaseState} from '../server/purchases.mjs';
import {purchaseHistory} from '../server/purchaseReport.mjs';
import {warehouseSummary} from '../client/src/warehouseSummary.js';
import {dashboardStats} from '../client/src/dashboardStats.js';
import {previewPurchaseFile,purchaseTemplate,PURCHASE_COLUMNS} from '../server/purchaseRoutes.mjs';
import XLSX from 'xlsx';
import {purchaseTransaction} from '../server/purchaseTransaction.mjs';

const fresh=()=>({meta:{version:1},companies:[],agents:[],accounts:[],products:[],productMaster:[],todaySales:[],salesHistory:[],ledger:[],refunds:[],stockMovements:[],monthCloseArchive:[]});
const invoice=(number='INV-1',lines=[{sku:'P1',name:'Product',qty:5,unitCost:'10.25',lowStockLevel:0}],date='2026-10-12',supplierName='Supplier')=>({date,supplierName,invoiceNumber:number,lines});
const receive=(db,i=invoice(),requestId='request_12345678901')=>receivePurchases(db,{requestId,invoices:[i]});
const excel=rows=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([PURCHASE_COLUMNS,...rows]),'Purchases');return XLSX.write(book,{type:'base64',bookType:'xlsx'});};

test('atomic commit failure leaves all persisted stock and history unchanged; replay skips saving',()=>{
 const persisted=fresh(),before=JSON.stringify(persisted);let saves=0;
 assert.throws(()=>purchaseTransaction(()=>structuredClone(persisted),()=>{saves++;throw Error('disk failure');},db=>receive(db)),/disk failure/);
 assert.equal(JSON.stringify(persisted),before);assert.equal(saves,1);
 receive(persisted);purchaseTransaction(()=>structuredClone(persisted),()=>assert.fail('Replay must not write'),db=>receive(db));
});

test('legacy database reads without migration or record changes; first purchase is additive with permanent movement and image',()=>{
 const db=fresh(),before=JSON.stringify(db);assert.deepEqual(purchaseState(db),{suppliers:[],purchases:[],purchaseReturns:[]});assert.equal(JSON.stringify(db),before);
 db.productMaster.push({id:'master',productId:'legacy'});const existing=JSON.stringify(db.productMaster);
 const result=receive(db,invoice('IMAGE',[{sku:'P1',name:'Product',qty:5,unitCost:'10.25',lowStockLevel:0,image:'data:image/png;base64,aA=='}]));
 assert.equal(db.products[0].stock,5);assert.equal(db.products[0].image,'data:image/png;base64,aA==');assert.equal(db.products[0].lowStockLevel,0);
 assert.equal(result.purchases[0].totalCents,5125);assert.equal(db.stockMovements[0].qty,5);assert.equal(db.stockMovements[0].purchaseLineId,result.purchases[0].lines[0].id);assert.equal(JSON.stringify(db.productMaster),existing);
});
test('existing-product receipt, multi-line invoice, latest-cost inventory value and immutable historical costs reconcile',()=>{
 const db=fresh();receive(db);const first=JSON.stringify(db.purchases[0]);
 receive(db,invoice('INV-2',[{sku:'p1',name:'ignored rename',qty:2,unitCost:'20.50',lowStockLevel:3},{sku:'P2',name:'Second',qty:3,unitCost:'1.20',lowStockLevel:1}]),'request_22345678901');
 assert.equal(db.products.length,2);assert.equal(db.products[0].stock,7);assert.equal(db.products[0].name,'Product');assert.equal(db.products[0].costPrice,20.5);assert.equal(JSON.stringify(db.purchases[0]),first);
 assert.deepEqual(warehouseSummary(db.products),{products:2,units:10,value:147.1});
 const dashboard=dashboardStats(db,'2026-10',new Date('2026-10-12T00:00:00Z'),{utc:true});assert.ok(dashboard);
 assert.equal(db.stockMovements.filter(m=>m.productId===db.products[0].id).reduce((n,m)=>n+m.qty,0),7);
});
test('duplicate request retries replay; altered request keys, duplicate invoices and duplicate line codes are rejected',()=>{
 const db=fresh();const i=invoice();receive(db,i);const before=JSON.stringify(db);
 assert.equal(receive(db,i).replayed,true);assert.equal(JSON.stringify(db),before);
 assert.throws(()=>receive(db,invoice('OTHER')),/different purchase details/);
 assert.throws(()=>receive(db,invoice(' inv-1 '), 'request_32345678901'),/already recorded/);
 assert.throws(()=>receive(db,invoice('NEW',[{sku:'X',name:'X',qty:1,unitCost:2,lowStockLevel:1},{sku:'x',name:'X',qty:1,unitCost:2,lowStockLevel:1}]),'request_42345678901'),/Duplicate product/);
 assert.equal(JSON.stringify(db),before);
});
test('invalid quantities, precision, dates, archived codes and batch validation fail before changes',()=>{
 for(const field of [{qty:0},{qty:1.5},{qty:-2},{unitCost:'1.001'},{unitCost:''},{lowStockLevel:-1},{image:'javascript:alert(1)'}]){
  const db=fresh(),before=JSON.stringify(db);assert.throws(()=>receive(db,invoice('BAD',[{sku:'X',name:'X',qty:1,unitCost:2,lowStockLevel:1,...field}])));assert.equal(JSON.stringify(db),before);
 }
 const db=fresh();assert.throws(()=>receive(db,invoice('BAD',undefined,'2026-02-30')),/valid purchase date/);
 db.products.push({id:'old',sku:'OLD',name:'old',stock:2,costPrice:1,active:false});assert.throws(()=>receive(db,invoice('BAD',[{sku:'OLD',name:'reuse',qty:2,unitCost:1,lowStockLevel:1}])),/archived/);
 const before=JSON.stringify(db);assert.throws(()=>receivePurchases(db,{requestId:'batch_12345678901',invoices:[invoice('GOOD'),invoice('BAD',[{sku:'X',name:'X',qty:-1,unitCost:1,lowStockLevel:0}])]}));assert.equal(JSON.stringify(db),before);
});
test('supplier editing preserves invoice snapshots and old-name aliases prevent duplicate invoice bypass',()=>{
 const db=fresh();receive(db);const saved=db.purchases[0];saveSupplier(db,{name:'Renamed Supplier',phone:'123',gstin:'',address:'New'},saved.supplierId);
 assert.equal(saved.supplierName,'Supplier');assert.equal(db.suppliers.length,1);
 assert.throws(()=>receive(db,invoice('INV-1',undefined,undefined,'Supplier'),'other_12345678901'),/already recorded/);
 assert.throws(()=>receive(db,invoice('INV-1',undefined,undefined,'Renamed Supplier'),'other_22345678901'),/already recorded/);
});
test('partial returns preserve costs, stock and invoice reconciliation, reject over-return and replay safely',()=>{
 const db=fresh();receive(db);const original=JSON.stringify(db.purchases[0]),line=db.purchases[0].lines[0];
 const body={requestId:'return_12345678901',lineId:line.id,qty:2,date:'2026-10-13',notes:'Damaged'};const result=returnPurchase(db,body);
 assert.equal(db.products[0].stock,3);assert.equal(result.return.totalCents,2050);assert.equal(db.products[0].costPrice,10.25);assert.equal(JSON.stringify(db.purchases[0]),original);
 const before=JSON.stringify(db);assert.equal(returnPurchase(db,body).replayed,true);assert.equal(JSON.stringify(db),before);
 assert.throws(()=>returnPurchase(db,{...body,qty:1}),/different details/);assert.throws(()=>returnPurchase(db,{...body,requestId:'return_22345678901',qty:4}),/eligible/);
 db.products[0].stock=1;assert.throws(()=>returnPurchase(db,{...body,requestId:'return_32345678901',qty:2}),/Not enough/);
 assert.throws(()=>returnPurchase(db,{...body,requestId:'return_42345678901',date:'2026-10-01',qty:1}),/precede/);
 assert.equal(db.stockMovements.reduce((n,m)=>n+m.qty,0),3);assert.equal(db.ledger.length,0);assert.equal(db.refunds.length,0);
});
test('purchase history filters UTC daily/weekly/monthly/yearly/custom boundaries and supplier/product/invoice without writes',()=>{
 const db=fresh();receive(db,invoice('SEP',undefined,'2026-09-30'));receive(db,invoice('OCT',undefined,'2026-10-01'),'request_22345678901');receive(db,invoice('NOV',undefined,'2026-11-01','Another'),'request_32345678901');
 const before=JSON.stringify(db);assert.equal(purchaseHistory(db,{mode:'daily',date:'2026-10-01'}).lines.length,1);assert.equal(purchaseHistory(db,{mode:'weekly',date:'2026-10-01'}).lines.length,2);assert.equal(purchaseHistory(db,{mode:'monthly',month:'2026-10'}).lines.length,1);assert.equal(purchaseHistory(db,{mode:'yearly',year:'2026'}).lines.length,3);
 assert.equal(purchaseHistory(db,{mode:'custom',from:'2026-09-30',to:'2026-10-01',supplierId:db.suppliers[0].id,product:' p1 ',invoice:'oc'}).lines.length,1);assert.throws(()=>purchaseHistory(db,{mode:'custom',from:'2026-10-02',to:'2026-10-01'}));assert.equal(JSON.stringify(db),before);
});
test('Excel template, hundreds of rows, invoice grouping, serial dates and error rows are validated read-only',()=>{
 assert.deepEqual(XLSX.utils.sheet_to_json(purchaseTemplate().Sheets.Purchases,{header:1})[0],PURCHASE_COLUMNS);
 const db=fresh(),before=JSON.stringify(db);const rows=Array.from({length:400},(_,i)=>['2026-10-12','Supplier','BULK-'+Math.floor(i/2),'P'+i,'Product '+i,1,10,5,'']);const preview=previewPurchaseFile(db,excel(rows));assert.equal(preview.valid,true);assert.equal(preview.summary.invoices,200);assert.equal(preview.summary.quantity,400);assert.equal(preview.summary.totalCents,400000);assert.equal(JSON.stringify(db),before);
 const bad=previewPurchaseFile(db,excel([['2026-10-12','Supplier','BAD','P','Product',0,10,5,''],['2026-10-12','Supplier','BAD','p','Product',2,10,5,'']]));assert.equal(bad.valid,false);assert.ok(bad.rows.every(r=>r.error));
 const serial=previewPurchaseFile(db,excel([[46307,'Supplier','DATE','P','Product',1,10,5,'']]));assert.match(serial.rows[0].date,/^\d{4}-\d{2}-\d{2}$/);
});
