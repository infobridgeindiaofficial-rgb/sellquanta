import { agentWalletTotals, paymentHistory, ledgerTypeLabel } from './wallet.js';
import { agentWalletBreakdown } from './dashboardStats.js';
const savedUtcDay = (date, timestamp) => {
 if (/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return date;
 const time=Date.parse(timestamp || '');
 return Number.isFinite(time) ? new Date(time).toISOString().slice(0,10) : '';
};

// Dates persisted by the API are UTC calendar days. Timestamp-only legacy rows
// fall back to UTC as well; comparisons include both selected endpoints.
export const walletDay = row => savedUtcDay(row.date, row.createdAt || row.at);
const validDay = day => /^\d{4}-\d{2}-\d{2}$/.test(day || '') && Number.isFinite(Date.parse(day+'T00:00:00Z')) && new Date(day+'T00:00:00Z').toISOString().slice(0,10) === day;
export function walletRange(filter = {}) {
 if (!filter.mode || filter.mode === 'all') return {from:'',to:'',error:''};
 let from=filter.from, to=filter.to;
 if (filter.mode === 'monthly') {
  const year=Number(filter.year), month=Number(filter.month);
  if (!Number.isInteger(year)||year<1900||year>9999||!Number.isInteger(month)||month<1||month>12) return {error:'Select a valid month and year.'};
  from=String(year)+'-'+String(month).padStart(2,'0')+'-01';
  to=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
 }
 if (!validDay(from)||!validDay(to)||from>to) return {error:'Select a valid From Date and To Date, with From Date first.'};
 return {from,to,error:''};
}
const rounded = n => Math.round(n*100)/100;
const delta = row => row.type==='SALE' ? Number(row.amount||0) : ['PAYMENT','SETTLEMENT'].includes(row.type) ? -Number(row.amount||0) : 0;
export function agentWalletPeriod(state, agentId, filter = {}) {
 const range=walletRange(filter);
 if (range.error) return {error:range.error};
 const inside = day => (!range.from||day>=range.from)&&(!range.to||day<=range.to);
 if (!range.from) {
  const resets=(state.walletResets||[]).filter(r=>r.agentId===agentId);
  const wt=agentWalletTotals(state.ledger,agentId,state.walletResets);
  return {error:'',...wt,opening:0,closing:rounded(wt.due-wt.paid),adjustment:0,
   breakdown:agentWalletBreakdown(state,agentId,resets.at(-1)||null),
   history:paymentHistory(state,agentId),transactions:null};
 }
 // Live copies win; archive duplicates never contribute twice.
 const ledger=new Map((state.ledger||[]).filter(l=>l.agentId===agentId).map(l=>[l.id,l]));
 const sales=new Map([...(state.salesHistory||[]),...(state.todaySales||[])].map(s=>[s.id,s]));
 for(const archive of state.monthCloseArchive||[]) {
  for(const l of archive.ledger||[]) if(l.agentId===agentId&&!ledger.has(l.id))ledger.set(l.id,l);
  for(const s of archive.sales||[]) if(!sales.has(s.id))sales.set(s.id,s);
 }
 const events=[...ledger.values()].map(l=>({...l,day:walletDay(l),delta:delta(l)}));
 // Month Close and Wallet Reset start a fresh wallet. Represent their effect as
 // read-only baseline adjustments rather than silently carrying a closed debt.
 const boundaries=[...(state.monthCloseArchive||[]).map(a=>({at:a.closedAt,date:a.date,ids:(a.ledger||[]).filter(l=>l.agentId===agentId).map(l=>l.id),id:a.id,label:'Month Close'})),
 ...(state.walletResets||[]).filter(r=>r.agentId===agentId).map(r=>({at:r.resetAt,date:r.date,ids:r.excludedLedgerIds||[],id:r.id,label:'Wallet Reset'}))].sort((a,b)=>String(a.at||a.date).localeCompare(String(b.at||b.date)));
 const closed=new Set();
 for(const boundary of boundaries){let adjustment=0;for(const id of boundary.ids){if(closed.has(id))continue;closed.add(id);if(ledger.has(id))adjustment-=delta(ledger.get(id));}
  events.push({id:'baseline:'+boundary.id,day:savedUtcDay(boundary.date,boundary.at),createdAt:boundary.at,type:boundary.label,amount:rounded(adjustment),delta:adjustment,baseline:true,note:'Existing wallet baseline change'});
 }
 const period=events.filter(e=>inside(e.day));
 const sum = list => rounded(list.reduce((t,e)=>t+e.delta,0));
 const opening=sum(events.filter(e=>e.day<range.from));
 const due=rounded(period.filter(e=>e.type==='SALE').reduce((t,e)=>t+Number(e.amount||0),0));
 const paid=rounded(period.filter(e=>['PAYMENT','SETTLEMENT'].includes(e.type)).reduce((t,e)=>t+Number(e.amount||0),0));
 const adjustment=sum(period.filter(e=>e.baseline));
 const closing=sum(events.filter(e=>e.day<=range.to));
 const periodState={...state,ledger:[...ledger.values()],todaySales:[...sales.values()].filter(s=>s.agentId===agentId&&inside(savedUtcDay(s.date,s.createdAt))),salesHistory:[],refunds:(state.refunds||[]).filter(r=>r.agentId===agentId&&inside(savedUtcDay(r.refundDate,r.refundedAt)))};
 const breakdown=agentWalletBreakdown(periodState,agentId);
 // Period marketplace/product quantities and revenue use the same net-of-refund
 // tally as the period total, including refunds for sales in earlier periods.
 const sameMarket=(a,b)=>String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase();
 for(const group of breakdown.byProduct){
  const matches=row=>row.productId===group.productId&&sameMarket(row.marketplace,group.marketplace);
  const net=agentWalletBreakdown({...periodState,todaySales:periodState.todaySales.filter(matches),refunds:periodState.refunds.filter(matches)},agentId).totals;
  group.qty=net.qty;group.sales=rounded(net.sales);
 }
 for(const market of breakdown.byMarketplace){const groups=breakdown.byProduct.filter(g=>sameMarket(g.marketplace,market.marketplace));market.qty=groups.reduce((n,g)=>n+g.qty,0);market.sales=rounded(groups.reduce((n,g)=>n+g.sales,0));}
 return {error:'',due,paid,pending:Math.max(0,closing),opening,closing,adjustment,breakdown,
 history:paymentHistory(state,agentId).filter(h=>inside(savedUtcDay(h.date,h.at))),
 transactions:period.sort((a,b)=>String(b.createdAt||b.day).localeCompare(String(a.createdAt||a.day))).map(e=>({...e,label:e.baseline?e.type:ledgerTypeLabel(e)}))};
}
