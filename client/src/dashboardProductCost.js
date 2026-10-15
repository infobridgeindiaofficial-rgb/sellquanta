import {dashboardRecords} from '../../server/financialSnapshot.mjs';
import {saleDay,inDateRange} from './dashboardStats.js';
import {saleStockCents,refundStockCents} from '../../server/stockCost.mjs';
import {refundDay} from './dashboardStats.js';

// Saved costTotal already includes quantity; never multiply it a second time.
export function dashboardProductCost(state,options) {
  const records=dashboardRecords(state);
  const sales=records.sales.filter(sale=>{
    const date=saleDay(sale);
    return options.allTime || (options.fromDate||options.toDate?inDateRange(date,options.fromDate,options.toDate):date.slice(0,7)===options.month);
  });
  let total=0;
  for(const sale of sales) {
    const cents=saleStockCents(sale);
    if(cents===null||!Number.isSafeInteger(cents)||!Number.isSafeInteger(total+cents))return null;
    total+=cents;
  }
  for(const refund of records.refunds){const day=refundDay(refund);if(!options.allTime&&(options.fromDate||options.toDate?!inDateRange(day,options.fromDate,options.toDate):day.slice(0,7)!==options.month))continue;const cents=refundStockCents(refund,records.saleById);if(cents===null)return null;total-=cents;}
  return total/100;
}
