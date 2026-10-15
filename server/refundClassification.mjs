export const REFUND_REASONS=['Customer Return','Cancelled','RTO'];
export function requireRefundReason(reason){if(!REFUND_REASONS.includes(reason))throw Error('Select Customer Return, Cancelled or RTO as the refund reason.');return reason;}
const key=value=>String(value??'').trim().toLowerCase();
export function reconcileReturnRows(rows,state){
 const sales=[...(state.todaySales||[]),...(state.salesHistory||[]),...(state.monthCloseArchive||[]).flatMap(archive=>archive.sales||[])];
 const refunds=state.refunds||[];
 return rows.map(row=>{
  const matches=record=>key(record.orderId)===key(row.orderId)&&key(record.marketplace)===key(row.marketplace);
  const foundSales=row.orderId?sales.filter(matches):[];
  const foundRefunds=row.orderId?refunds.filter(refund=>matches({...sales.find(sale=>sale.id===refund.saleId),...refund})):[];
  const reasons=[...new Set(foundRefunds.map(refund=>refund.refundReason||'Not classified'))];
  let appMatchStatus;
  if(reasons.includes('Customer Return')&&reasons.length===1)appMatchStatus='Matched';
  else if(reasons.some(reason=>reason==='Cancelled'||reason==='RTO'))appMatchStatus='Reason Mismatch';
  else if(foundSales.length)appMatchStatus='Sales Found / Return Not Recorded';
  else if(foundRefunds.length)appMatchStatus='Needs Review';
  else appMatchStatus='Order Not Found';
  const review=appMatchStatus!=='Matched'||!foundSales.length;
  return {...row,appMatchStatus,refundReason:reasons.join(' / ')||'Not recorded',salesRecordFound:!!foundSales.length,refundRecordFound:!!foundRefunds.length,
   status:row.status==='Duplicate'?'Duplicate':review?'Needs Review':row.status,
   reason:review?`${row.reason} ${appMatchStatus}. ${foundSales.length?'':'Missing Sale. '}No app records were changed.`:row.reason};
 });
}
