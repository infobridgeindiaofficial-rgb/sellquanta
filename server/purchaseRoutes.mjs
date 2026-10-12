import { writeBrandedWorkbook, importHeaderRow } from './excelStyle.mjs';
import express from 'express';
import XLSX from 'xlsx';
import { readDb, saveDb } from './store.mjs';
import { purchaseTransaction } from './purchaseTransaction.mjs';
import { purchaseState, preparePurchases, receivePurchases, saveSupplier, returnPurchase, purchaseHistory } from './purchases.mjs';

export const PURCHASE_COLUMNS = ['Purchase Date','Supplier Name','Invoice Number','Warehouse Product Code','Product Name','Quantity','Unit Cost','Low Stock Alert','Notes'];
const workbook = (name, rows) => {const book=XLSX.utils.book_new(), sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=rows[0].map((_,i)=>({wch:[16,26,24,28,30,14,16,18,45][i]||24}));XLSX.utils.book_append_sheet(book,sheet,name);return book;};
export const purchaseTemplate = () => workbook('Purchases',[PURCHASE_COLUMNS]);
function parseDate(value) {
  if (typeof value === 'number') {const p=XLSX.SSF.parse_date_code(value);return p?`${String(p.y).padStart(4,'0')}-${String(p.m).padStart(2,'0')}-${String(p.d).padStart(2,'0')}`:'';}
  return String(value ?? '').trim();
}
export function previewPurchaseFile(db, fileBase64) {
  if (typeof fileBase64 !== 'string' || !fileBase64.length || fileBase64.length > 12*1024*1024 || !/^[A-Za-z0-9+/=]+$/.test(fileBase64)) throw Error('Upload a valid Excel workbook under 8 MB.');
  const bytes=Buffer.from(fileBase64,'base64');if(bytes.length>8*1024*1024)throw Error('Excel workbook must be under 8 MB.');
  const book=XLSX.read(bytes,{type:'buffer',cellDates:false,cellFormula:true,sheetRows:2007});
  const sheet=book.Sheets.Purchases;if(!sheet)throw Error('Workbook must contain a Purchases sheet. Download the template.');
  const headerRow=importHeaderRow(sheet);const ref=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']||'A1');if(ref.e.r>2000+headerRow||ref.e.c>8)throw Error('Use the nine template columns and at most 2000 purchase rows.');
  const raw=XLSX.utils.sheet_to_json(sheet,{range:headerRow,header:1,defval:'',blankrows:true});
  if(!PURCHASE_COLUMNS.every((c,i)=>String(raw[0]?.[i]||'').trim()===c))throw Error('Column headers do not match the purchase template.');
  const rows=[],groups=new Map();
  for(let i=1;i<raw.length;i++){
    const r=raw[i];if(!r.some(v=>String(v).trim()))continue;
    const row={row:i+1+headerRow,date:parseDate(r[0]),supplierName:String(r[1]).trim(),invoiceNumber:String(r[2]).trim(),sku:String(r[3]).trim(),name:String(r[4]).trim(),qty:r[5],unitCost:r[6],lowStockLevel:r[7],notes:String(r[8]).trim(),error:''};
    rows.push(row);
    for(let col=0;col<9;col++)if(sheet[XLSX.utils.encode_cell({r:i+headerRow,c:col})]?.f)row.error='Import input cells must contain values, not formulas.';
    const key=JSON.stringify([row.supplierName.toLowerCase(),row.invoiceNumber.toLowerCase()]);
    if(!groups.has(key))groups.set(key,{date:row.date,supplierName:row.supplierName,invoiceNumber:row.invoiceNumber,lines:[],rows:[]});
    const group=groups.get(key);group.lines.push({...row});group.rows.push(row);
    if(group.date!==row.date)group.rows.forEach(x=>x.error='All lines of one invoice must have the same purchase date.');
  }
  if(!rows.length)throw Error('The workbook contains no purchase rows.');
  for(const group of groups.values()){
    try{preparePurchases(db,[group]);}catch(e){group.rows.forEach(r=>r.error=r.error||e.message);}
  }
  if(rows.every(r=>!r.error))try{preparePurchases(db,[...groups.values()]);}catch(e){rows.forEach(r=>r.error=e.message);}
  // The complete batch is checked again inside the atomic commit, against the latest database.
  const valid=rows.every(r=>!r.error), totalQuantity=rows.reduce((n,r)=>n+(Number.isSafeInteger(Number(r.qty))?Number(r.qty):0),0);
  const totalCents=rows.reduce((n,r)=>n+(!r.error?Math.round(Number(r.unitCost)*100)*Number(r.qty):0),0);
  return {valid,rows,invoices:[...groups.values()].map(({rows,...g})=>g),summary:{invoices:groups.size,products:new Set(rows.map(r=>r.sku.toLowerCase())).size,quantity:totalQuantity,totalCents,invalidRows:rows.filter(r=>r.error).length}};
}
const sendWorkbook=async(res,book,name,options={})=>{res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="${name}"`);res.send(await writeBrandedWorkbook(book,options));};
// Replay responses do not rewrite the data file. Failed validation/saves never commit a partial batch.
const transaction=fn=>purchaseTransaction(readDb,saveDb,fn);
export function createPurchaseRouter(){
 const router=express.Router();
 const route=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||400).json({error:e.message});}};
 router.get('/',route((_req,res)=>res.json(purchaseState(readDb()))));
 router.post('/',route((req,res)=>res.json(transaction(db=>receivePurchases(db,{requestId:req.body.requestId,invoices:[req.body.invoice]})))));
 router.post('/suppliers',route((req,res)=>res.json(transaction(db=>saveSupplier(db,req.body)))));
 router.put('/suppliers/:id',route((req,res)=>res.json(transaction(db=>saveSupplier(db,req.body,req.params.id)))));
 router.post('/returns',route((req,res)=>res.json(transaction(db=>returnPurchase(db,req.body)))));
 router.get('/import-template',route((_req,res)=>sendWorkbook(res,purchaseTemplate(),'SellQuanta_Purchase_Template.xlsx',{template:true})));
 router.post('/import-preview',route((req,res)=>res.json(previewPurchaseFile(readDb(),req.body.fileBase64))));
 router.post('/import',route((req,res)=>{
   const result=transaction(db=>{const preview=previewPurchaseFile(db,req.body.fileBase64);
     // Replays are checked before duplicate-invoice validation from preview.
     if(!preview.valid && !(db.purchaseRequests||[]).some(r=>r.key===req.body.requestId))throw Error('Import contains invalid rows. Correct the entire workbook before importing.');
     return receivePurchases(db,{requestId:req.body.requestId,invoices:preview.invoices,source:'excel'});
   });res.json(result);
 }));
 router.post('/error-report',route(async(req,res)=>{const preview=previewPurchaseFile(readDb(),req.body.fileBase64);await sendWorkbook(res,workbook('Errors',[[...PURCHASE_COLUMNS,'Excel Row','Error'],...preview.rows.filter(r=>r.error).map(r=>[r.date,r.supplierName,r.invoiceNumber,r.sku,r.name,r.qty,r.unitCost,r.lowStockLevel,r.notes,r.row,r.error])]),'SellQuanta_Purchase_Errors.xlsx');}));
 router.get('/history',route((req,res)=>res.json(purchaseHistory(readDb(),req.query))));
 router.get('/history-export',route(async(req,res)=>{const report=purchaseHistory(readDb(),req.query);sendWorkbook(res,workbook('Purchase History',[['Purchase Date','Supplier Name','Invoice Number','Warehouse Product Code','Product Name','Quantity','Unit Cost','Total Cost','Returned Quantity','Status'],...report.lines.map(l=>[l.date,l.supplierName,l.invoiceNumber,l.sku,l.productName,l.qty,l.unitCost,l.totalCost,l.returnedQty,l.status])]),`SellQuanta_Purchases_${report.range.from}_${report.range.to}.xlsx`,{reportName:"Purchase History",period:`${report.range.from} - ${report.range.to} (UTC)`});}));
 return router;
}
