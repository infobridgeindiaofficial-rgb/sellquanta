import XLSX from 'xlsx';
import {writeThemedWorkbook} from './excelTheme.mjs';
import {salesReport,REPORT_COLUMNS} from '../client/src/salesReport.js';

export function buildSalesReportWorkbook(state,selection) {
 const report=salesReport(state,selection),t=report.totals;
 const value=n=>n===null?'Not available':n;
 const content=[['SellQuanta Sales Report'],['From',report.period.from,'To',report.period.to],[],['Total Orders','Total Quantity','Total Invoice Amount','Total Product Cost','Total Estimated Settlement','Total Estimated Profit'],[t.orders,t.qty,t.amount,t.cost,t.settlement,t.profit].map(value),[],REPORT_COLUMNS,...report.records.map(row=>row.map(value))];
 const sheet=XLSX.utils.aoa_to_sheet(content);
 sheet['!cols']=[12,22,30,26,36,12,20,18,24,22,18].map(wch=>({wch}));
 sheet['!autofilter']={ref:`A7:K${Math.max(7,content.length)}`};
 for(let r=7;r<content.length;r++)for(let c=6;c<=9;c++){const cell=sheet[XLSX.utils.encode_cell({r,c})];if(cell?.t==='n')cell.z='"₹"#,##0.00;[Red]-"₹"#,##0.00';}
 for(let c=2;c<=5;c++){const cell=sheet[XLSX.utils.encode_cell({r:4,c})];if(cell?.t==='n')cell.z='"₹"#,##0.00;[Red]-"₹"#,##0.00';}
 const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,sheet,'Sales Report');return workbook;
}

export function registerSalesReportRoutes(app,{readDb}) {
 app.get('/api/reports/sales/export',(req,res)=>{
  try {
   const selection={mode:req.query.mode,date:req.query.date,month:req.query.month,from:req.query.from,to:req.query.to};
   const db=readDb(),report=salesReport(db,selection),workbook=buildSalesReportWorkbook(db,selection);
   res.setHeader('Content-Disposition',`attachment; filename="SellQuanta-Sales-${report.period.from}-to-${report.period.to}.xlsx"`);
   res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
   res.send(writeThemedWorkbook(workbook,{report:true}));
  }catch(error){res.status(400).json({error:error.message});}
 });
}
