import XLSX from 'xlsx';
import crypto from 'node:crypto';

const norm=value=>String(value??'').replace(/\s+/g,' ').trim().toLowerCase();
const text=value=>String(value??'').trim();
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const amount=value=>{
 const raw=text(value).replace(/,/g,'');if(!raw)return 0;
 const n=Number(raw);if(!Number.isFinite(n))throw Error('Invalid amount in a return charge column.');
 const cents=Math.round(n*100);if(!Number.isSafeInteger(cents))throw Error('Return charge amount is too large.');return cents;
};
function date(value){
 if(value instanceof Date)return value.toISOString().slice(0,10);
 if(typeof value==='number'){const d=XLSX.SSF.parse_date_code(value);return d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:'';}
 const raw=text(value).replace(/\bSept\b/i,'Sep'),n=Date.parse(raw);return Number.isFinite(n)?new Date(n).toISOString().slice(0,10):'';
}
function table(wb,sheet,required){
 if(!wb.Sheets[sheet])throw Error(`Required sheet missing: ${sheet}`);
 const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1,defval:'',raw:true});
 const index=rows.findIndex(row=>required.every(field=>row.some(v=>norm(v)===norm(field))));
 if(index<0)throw Error(`Unrecognized ${sheet} headers.`);
 const headers=rows[index].map(norm);
 return rows.slice(index+1).map((row,i)=>({get:field=>row[headers.indexOf(norm(field))]??'',row:index+i+2}));
}
function record(marketplace,row,fields,charge,sheet,filename){
 const value=amount(row.get(charge));if(value>=0)return null; // Positive fee reversals are not extra deductions.
 const orderId=text(row.get(fields.order)),sku=text(row.get(fields.sku)),returnStatus=text(row.get(fields.status)),returnDate=date(row.get(fields.date));
 const basis=fields.date,transactionId=text(row.get(fields.transaction));
 const chargeCents=-value;
 const duplicateKey=hash(JSON.stringify([marketplace,orderId,sku,transactionId,returnDate,norm(charge),chargeCents]));
 return {id:hash(`${sheet}:${row.row}:${duplicateKey}`),marketplace,date:returnDate,orderId,sku,product:text(row.get(fields.product)),amountCents:chargeCents,chargeSource:charge,sourceSheet:sheet,sourceRow:row.row,sourceFile:filename,returnStatus,transactionId,dateBasis:basis,duplicateKey,status:orderId&&returnDate?'Confirmed':'Needs Review',reason:orderId&&returnDate?`Explicit customer-return charge; date from ${basis}.`:'Missing order ID or usable date; cannot save until resolved.'};
}

export function parseAmazon(wb,filename){
 const rows=table(wb,wb.SheetNames[0],['date/time','type','order id','Sku','product sales','selling fees','fba fees','other transaction fees','other']);
 const result=[];
 for(const row of rows){
  const type=norm(row.get('type')),description=norm(row.get('description'));
  const refund=/^(refund|customer return)$/.test(type);
  const explicit=/(refund administration|return processing|customer return|return shipping)/.test(description);
  if(!refund&&!explicit)continue;
  for(const column of ['selling fees','fba fees','other transaction fees','other']){
   const entry=record('Amazon',row,{order:'order id',sku:'Sku',product:'description',status:'type',date:'date/time',transaction:'settlement id'},column,wb.SheetNames[0],filename);
   if(!entry)continue;
   if(!explicit){entry.status='Needs Review';entry.reason='Deduction on a refund transaction, but this generic fee column does not prove an extra customer-return fee. Product refund excluded.';}
   result.push(entry);
  }
 }
 return result;
}
export function parseFlipkart(wb,filename){
 const rows=table(wb,'Orders',['Order ID','Order item ID','Seller SKU','Return Type','Item Return Status','Reverse Shipping Fee (Rs.)','Payment Date']);
 return rows.filter(row=>norm(row.get('Return Type'))==='customer return').map(row=>record('Flipkart',row,{order:'Order ID',sku:'Seller SKU',product:'Product Sub Category',status:'Item Return Status',date:'Payment Date',transaction:'Order item ID'},'Reverse Shipping Fee (Rs.)','Orders',filename)).filter(Boolean);
}
export function parseMeesho(wb,filename){
 const rows=table(wb,'Order Payments',['Sub Order No','Supplier SKU','Product Name','Live Order Status','Payment Date','Return Shipping Charge (Incl. GST)']);
 return rows.filter(row=>norm(row.get('Live Order Status'))==='return').map(row=>record('Meesho',row,{order:'Sub Order No',sku:'Supplier SKU',product:'Product Name',status:'Live Order Status',date:'Payment Date',transaction:'Transaction ID'},'Return Shipping Charge (Incl. GST)','Order Payments',filename)).filter(Boolean);
}
export function parseReturnReport({filename,base64}){
 if(typeof base64!=='string'||base64.length>30_000_000)throw Error('Report must be smaller than 20 MB.');
 let bytes=Buffer.from(base64,'base64');if(!bytes.length)throw Error('Select a report file.');
 const extension=text(filename).split('.').at(-1).toLowerCase();
 if(!['csv','xlsx','zip'].includes(extension))throw Error('Use an Amazon CSV, Flipkart XLSX or Meesho ZIP/XLSX.');
 if(extension==='zip'){
  const zip=XLSX.CFB.read(bytes,{type:'buffer'});
  const entries=zip.FileIndex.filter(entry=>/\.xlsx$/i.test(entry.name));
  if(entries.length!==1)throw Error('Meesho ZIP must contain exactly one payment XLSX.');
  if(entries[0].content.length>25_000_000)throw Error('Payment workbook is too large.');bytes=Buffer.from(entries[0].content);
 }
 const wb=XLSX.read(bytes,{type:'buffer',cellDates:true});
 let marketplace,rows;
 if(wb.Sheets['Orders']){marketplace='Flipkart';rows=parseFlipkart(wb,filename);}
 else if(wb.Sheets['Order Payments']){marketplace='Meesho';rows=parseMeesho(wb,filename);}
 else {marketplace='Amazon';rows=parseAmazon(wb,filename);}
 const seen=new Set();rows=rows.map(row=>{if(seen.has(row.duplicateKey))return {...row,status:'Duplicate',reason:'Repeated charge in this report.'};seen.add(row.duplicateKey);return row;});
 return {marketplace,sheets:wb.SheetNames,rows,totalCents:rows.filter(row=>row.status==='Confirmed').reduce((s,row)=>s+row.amountCents,0),reviewCount:rows.filter(row=>row.status==='Needs Review').length};
}
