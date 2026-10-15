import XLSX from 'xlsx';
export const BULK_HEADER_INDEX=4;
export function bulkHeaderIndex(sheet){
 return sheet?.A1?.v==='SELLQUANTA'&&['PRODUCT MASTER BULK UPLOAD','WAREHOUSE BULK UPLOAD'].includes(sheet?.A2?.v)&&sheet?.A3?.v==='Enter data below and upload the completed file to SellQuanta.'?BULK_HEADER_INDEX:0;
}
export function buildBulkTemplate(name,columns){
 const title=name==='WAREHOUSE'?'WAREHOUSE BULK UPLOAD':'PRODUCT MASTER BULK UPLOAD';
 const sheet=XLSX.utils.aoa_to_sheet([['SELLQUANTA'],[title],['Enter data below and upload the completed file to SellQuanta.'],[],columns]);
 sheet['!merges']=[0,1,2].map(r=>({s:{r,c:0},e:{r,c:columns.length-1}}));
 sheet['!cols']=columns.map(h=>({wch:/product_name/.test(h)?44:/code|sku/i.test(h)?32:/stock/i.test(h)?20:28}));
 sheet['!rows']=Array.from({length:105},(_,i)=>({hpt:i===0?34:i===1?28:i===2?24:i===3?8:i===4?32:26}));
 for(let r=5;r<105;r++)for(let c=0;c<columns.length;c++)sheet[XLSX.utils.encode_cell({r,c})]={t:'s',v:'',z:/code|sku|product_name/.test(columns[c])?'@':/stock/i.test(columns[c])?'0.##':'"₹"#,##0.00;[Red]-"₹"#,##0.00'};
 sheet['!ref']=`A1:${XLSX.utils.encode_cell({r:104,c:columns.length-1})}`;
 sheet['!autofilter']={ref:`A5:${XLSX.utils.encode_cell({r:104,c:columns.length-1})}`};
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,name);return book;
}
