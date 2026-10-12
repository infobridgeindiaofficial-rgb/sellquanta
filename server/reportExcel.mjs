import XLSX from 'xlsx';
import { salesReturnsReport } from './reports.mjs';
export function buildReportsWorkbook(state,filter){
 const report=salesReturnsReport(state,filter);const workbook=XLSX.utils.book_new();
 const add=(name,rows,headers)=>XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(rows,{header:headers}),name);
 const saleHeaders=['Sale ID','Date','Order ID','Agent','Marketplace','Product','SKU','Quantity','Sales Amount'];
 add('Sales',report.sales.map(s=>({'Sale ID':s.id,Date:s.reportDate,'Order ID':s.orderId||'',Agent:s.agentName,Marketplace:s.marketplace,Product:s.productName,SKU:s.warehouseProductCode||s.sku||'',Quantity:Number(s.qty||0),'Sales Amount':Number(s.saleAmount||0)})),saleHeaders);
 const returnHeaders=['Refund ID','Date','Sale ID','Order ID','Agent','Marketplace','Product','Returned Quantity','Refund Amount'];
 add('Returns',report.returns.map(r=>({'Refund ID':r.id,Date:r.reportDate,'Sale ID':r.saleId||'','Order ID':r.orderId||'',Agent:r.agentName,Marketplace:r.marketplace,Product:r.productName,'Returned Quantity':Number(r.qty||0),'Refund Amount':Number(r.refundAmount||0)})),returnHeaders);
 const summary=(name,groups,label)=>{const headers=[label,'Total Sales','Orders','Units Sold','Returns Count','Returned Units','Return Amount','Net Sales'];add(name,groups.map(g=>({[label]:g.name,'Total Sales':g.totalSalesCents/100,Orders:g.orders,'Units Sold':g.unitsSold,'Returns Count':g.returnsCount,'Returned Units':g.returnedUnits,'Return Amount':g.returnAmountCents/100,'Net Sales':g.netSalesCents/100})),headers);};
 summary('Marketplace Summary',report.marketplaces,'Marketplace');summary('Agent Summary',report.agents,'Agent');summary('Product Summary',report.products,'Product');
 return {workbook,report};
}
