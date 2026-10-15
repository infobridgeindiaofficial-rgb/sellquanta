import {dashboardRecords} from '../../server/financialSnapshot.mjs';
import {saleDay,localToday} from './dashboardStats.js';
import {salesTableFinancials,salesTableTotals} from './salesTableFinancials.js';

export const REPORT_COLUMNS=['Date','Agent','Account / Marketplace','Order ID','Product','Quantity','Invoice Amount','Cost','Estimated Settlement','Estimated Profit','Source'];
export function reportPeriod({mode='daily',date=localToday(),month=date.slice(0,7),from='',to=''}) {
 const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
 let start,end;
 if(mode==='daily'){start=date;end=date;}
 else if(mode==='weekly'){
  if(!valid(date))throw Error('Select a valid date for the week.');
  const day=new Date(date+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);start=day.toISOString().slice(0,10);day.setUTCDate(day.getUTCDate()+6);end=day.toISOString().slice(0,10);
 }else if(mode==='monthly'){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Select a valid month and year.');
  start=month+'-01';const [year,m]=month.split('-').map(Number);end=new Date(Date.UTC(year,m,0,12)).toISOString().slice(0,10);
 }else if(mode==='custom'){start=from;end=to;}
 else throw Error('Select a supported report mode.');
 if(!valid(start)||!valid(end)||start>end)throw Error('Select valid dates with From Date before or equal to To Date.');
 return {from:start,to:end};
}

export function salesReport(state,selection) {
 const period=reportPeriod(selection);
 const archived=(state.monthCloseArchive||[]).flatMap(archive=>archive.sales||[]);
 const {sales}=dashboardRecords({...state,salesHistory:[...archived,...(state.salesHistory||[])]});
 const rows=sales.filter(sale=>saleDay(sale)>=period.from&&saleDay(sale)<=period.to).sort((a,b)=>saleDay(a).localeCompare(saleDay(b))||String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
 const totals=salesTableTotals(rows,state);
 totals.orders=new Set(rows.map(sale=>String(sale.orderId||'').trim().toLowerCase()||`sale:${sale.id}`)).size;
 const name=(list,id)=>list?.find(item=>item.id===id)?.name||'';
 const records=rows.map(sale=>{
  const financial=salesTableFinancials(sale,state);
  const account=name(state.accounts,sale.accountId)||sale.accountName||'';
  return [saleDay(sale),name(state.agents,sale.agentId)||sale.agentName||'', [account,sale.marketplace].filter(Boolean).join(' / '),sale.orderId||'',sale.productName||name(state.products,sale.productId)||sale.productId||'',Number(sale.qty||0),Number(sale.saleAmount||0),financial.cost,financial.settlement,financial.profit,sale.source||''];
 });
 return {period,rows,records,totals};
}
