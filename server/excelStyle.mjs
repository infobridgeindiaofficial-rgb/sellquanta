import XLSX from 'xlsx';

export const EXCEL_BRAND = Object.freeze({dark:'FF141414',accent:'FF16A34A',header:'FF166534',light:'FFE9F7EE',white:'FFFFFFFF'});
export const INR_FORMAT = '"₹" #,##0.00;[Red]-"₹" #,##0.00';
export const TABLE_HEADER_ROW = 6;
const moneyHeader = h => /amount|cost|price|value|total sales|net sales/i.test(h) && !/quantity|count|units/i.test(h);
const countHeader = h => /quantity|stock|units|orders|count|alert/i.test(h);
const fill = color => ({type:'pattern',pattern:'solid',fgColor:{argb:color}});
const border = {bottom:{style:'hair',color:{argb:'FFD8E5DC'}}};

// The data builders remain authoritative. This writer only adds presentation;
// strings (including leading-zero identifiers and '=...') never become formulas.
export async function writeBrandedWorkbook(source, options = {}) {
  // Loading the relatively large writer only for exports keeps normal application
  // startup (and all non-export APIs) independent of its initialization cost.
  const {default:ExcelJS}=await import('exceljs');
  const book = new ExcelJS.Workbook(), now = options.generatedAt || new Date();
  book.creator='SellQuanta';book.company='SellQuanta';book.created=now;book.modified=now;
  for (const name of source.SheetNames) {
    const input=source.Sheets[name], rows=XLSX.utils.sheet_to_json(input,{header:1,defval:'',blankrows:true,raw:true});
    const headers=rows[0] || [], width=Math.max(2,headers.length);
    const template=options.template === true;
    const sheet=book.addWorksheet(name,{properties:{tabColor:{argb:EXCEL_BRAND.accent}},views:[{state:'frozen',ySplit:TABLE_HEADER_ROW,showGridLines:false}]});
    const band=(row,text,color,size=11)=>{sheet.mergeCells(row,1,row,width);const c=sheet.getCell(row,1);c.value=text;c.font={name:'Calibri',size,bold:true,color:{argb:EXCEL_BRAND.white}};c.fill=fill(color);c.alignment={vertical:'middle',wrapText:true};sheet.getRow(row).height=row===1?32:36;};
    band(1,'SellQuanta',EXCEL_BRAND.dark,20);
    band(2,options.reportName && options.reportName!==name ? `${options.reportName} · ${name}` : name,EXCEL_BRAND.header,13);
    sheet.mergeCells(3,1,3,width);sheet.getCell('A3').value=`Period: ${options.period || (template?'Data entry template':'All saved records / current snapshot')}`;
    sheet.mergeCells(4,1,4,width);sheet.getCell('A4').value=`Generated: ${now.toISOString().replace('T',' ').replace('Z',' UTC')}`;
    sheet.mergeCells(5,1,5,width);sheet.getCell('A5').value=template?'Enter values below row 6. Keep headers and columns unchanged.':(options.summary || `${Math.max(0,rows.length-1)} records`);
    for(let r=3;r<=5;r++){sheet.getCell(r,1).font={name:'Calibri',size:11,bold:r===5&&!template,color:{argb:EXCEL_BRAND.dark}};sheet.getCell(r,1).alignment={wrapText:true,vertical:'middle'};sheet.getRow(r).height=r===5?32:24;}
    sheet.getRow(TABLE_HEADER_ROW).values=headers;
    const header=sheet.getRow(TABLE_HEADER_ROW);header.height=32;
    headers.forEach((h,i)=>{const c=header.getCell(i+1);c.font={name:'Calibri',size:11,bold:true,color:{argb:EXCEL_BRAND.white}};c.fill=fill(EXCEL_BRAND.header);c.alignment={wrapText:true,vertical:'middle'};c.border=border;
      sheet.getColumn(i+1).width=input['!cols']?.[i]?.wch || (/name|product|notes|error/i.test(h)?34:/id|code|sku/i.test(h)?28:22);
      sheet.getColumn(i+1).numFmt=moneyHeader(h)?INR_FORMAT:countHeader(h)?'#,##0':'General';});
    for(let i=1;i<rows.length;i++) {const row=sheet.getRow(TABLE_HEADER_ROW+i);row.values=rows[i];row.height=30;
      headers.forEach((h,j)=>{const c=row.getCell(j+1);c.font={name:'Calibri',size:11,color:{argb:EXCEL_BRAND.dark}};c.fill=fill(i%2?EXCEL_BRAND.white:EXCEL_BRAND.light);c.border=border;c.alignment={vertical:'middle',wrapText:true,horizontal:typeof c.value==='number'?'right':'left'};});}
    const end=TABLE_HEADER_ROW+Math.max(0,rows.length-1);
    sheet.autoFilter={from:{row:TABLE_HEADER_ROW,column:1},to:{row:end,column:headers.length || 1}};
    // Template sheets have no footer/totals input rows: imports remain unambiguous.
    if(!template){const totals=sheet.getRow(end+2);totals.getCell(1).value='Totals';
      headers.forEach((h,i)=>{const c=totals.getCell(i+1);const authoritative=options.totalsBySheet?.[name]?.[h];if(i && authoritative!==undefined)c.value=authoritative;else if(i && (moneyHeader(h)||countHeader(h)) && !/unit cost|cost price|low stock|opening stock|current stock/i.test(h)){const nums=rows.slice(1).map(r=>r[i]).filter(v=>typeof v==='number');if(nums.length)c.value=nums.reduce((n,v)=>n+v,0);}c.font={name:'Calibri',bold:true,size:11,color:{argb:EXCEL_BRAND.white}};c.fill=fill(EXCEL_BRAND.header);c.border=border;});
      sheet.mergeCells(end+4,1,end+4,width);sheet.getCell(end+4,1).value='SellQuanta · Business reports';sheet.getCell(end+4,1).font={name:'Calibri',size:10,color:{argb:EXCEL_BRAND.header}};}
    sheet.headerFooter={oddHeader:'&L SellQuanta',oddFooter:'&L SellQuanta&C Confidential business report&R Page &P of &N'};
    sheet.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:6'};
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

// Accept legacy row-1 templates, or only our explicitly marked branded layout.
export function importHeaderRow(sheet) {
  return sheet?.A1?.v==='SellQuanta' && String(sheet?.A4?.v || '').startsWith('Generated: ') && String(sheet?.A5?.v || '').startsWith('Enter values below row 6.') ? TABLE_HEADER_ROW-1 : 0;
}
