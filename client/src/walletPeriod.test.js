import test from 'node:test';
import assert from 'node:assert/strict';
import { agentWalletPeriod, walletRange, walletDay } from './walletPeriod.js';
import { agentWalletTotals } from './wallet.js';

const fixture = () => {
 const sale=(id,date,qty,cost,marketplace='Amazon')=>({id,agentId:'a',date,qty,costTotal:cost,saleAmount:cost*2,productId:'p',marketplace,orderId:id});
 const s1=sale('s1','2026-09-30',2,100), s2=sale('s2','2026-10-01',3,60,'Flipkart'), s3=sale('s3','2026-10-31',1,20,'Meesho');
 const ledger=[... [s1,s2,s3].map(s=>({id:'l'+s.id,agentId:'a',type:'SALE',referenceId:s.id,date:s.date,amount:s.costTotal})),
 {id:'p0',agentId:'a',type:'PAYMENT',date:'2026-09-30',amount:25},
 {id:'p1',agentId:'a',type:'PAYMENT',date:'2026-10-15',amount:10},
 {id:'r1',agentId:'a',type:'SALE',kind:'REFUND_REVERSAL',refundId:'r',date:'2026-10-02',amount:-200},
 {id:'credit',agentId:'a',type:'SETTLEMENT',date:'2026-10-20',amount:5},
 {id:'future',agentId:'a',type:'PAYMENT',date:'2026-11-01',amount:7},
 {id:'other',agentId:'b',type:'SALE',date:'2026-10-01',amount:1000}];
 return {products:[{id:'p',name:'Product',sku:'ABC'}],todaySales:[s2,s3],salesHistory:[s1],ledger,walletResets:[],refunds:[{id:'r',agentId:'a',saleId:'s1',productId:'p',marketplace:'Amazon',qty:2,refundAmount:200,dueReversalAmount:200,refundDate:'2026-10-02'}],monthCloseArchive:[]};
};
test('monthly includes both boundary days, refunds and credits; balances reconcile without mutation',()=>{
 const state=fixture(), before=JSON.stringify(state);
 const d=agentWalletPeriod(state,'a',{mode:'monthly',month:10,year:2026});
 assert.equal(d.opening,75); assert.equal(d.due,-120); assert.equal(d.paid,15); assert.equal(d.closing,-60); assert.equal(d.pending,0);
 assert.equal(d.opening+d.due-d.paid+d.adjustment,d.closing);
 assert.equal(d.breakdown.totals.sales,-40); assert.equal(d.breakdown.totals.qty,2);
 assert.deepEqual(d.breakdown.byMarketplace.map(m=>m.marketplace).sort(),['Amazon','Flipkart','Meesho']);
 assert.equal(d.breakdown.byMarketplace.reduce((sum,m)=>sum+m.stockCost,0),d.due);
 assert.equal(d.breakdown.byMarketplace.reduce((sum,m)=>sum+m.qty,0),d.breakdown.totals.qty);
 assert.equal(d.breakdown.byMarketplace.reduce((sum,m)=>sum+m.sales,0),d.breakdown.totals.sales);
 assert.equal(d.history.length,2); assert.equal(d.transactions.length,5);
 assert.equal(JSON.stringify(state),before);
});
test('custom range includes whole To Date, supports one day, and rejects invalid dates',()=>{
 const state=fixture(); const d=agentWalletPeriod(state,'a',{mode:'custom',from:'2026-10-15',to:'2026-10-20'});
 assert.equal(d.opening,-65); assert.equal(d.paid,15); assert.equal(d.closing,-80);
 assert.equal(agentWalletPeriod(state,'a',{mode:'custom',from:'2026-10-31',to:'2026-10-31'}).due,20);
 for(const filter of [{mode:'custom',from:'2026-11-01',to:'2026-10-01'},{mode:'custom',from:'2026-02-30',to:'2026-03-01'},{mode:'custom',from:'',to:''},{mode:'monthly',month:13,year:2026}])assert.ok(walletRange(filter).error);
 assert.equal(walletRange({mode:'monthly',month:2,year:2024}).to,'2024-02-29');
});
test('UTC saved dates take precedence and timestamp fallback handles timezone boundaries',()=>{
 assert.equal(walletDay({createdAt:'2026-10-01T01:00:00+04:00'}),'2026-09-30');
 assert.equal(walletDay({date:'2026-10-01',createdAt:'2026-09-30T23:00:00Z'}),'2026-10-01');
});
test('archive copies are counted once and Month Close clears its historical wallet baseline',()=>{
 const state=fixture(); const archived=state.ledger.filter(l=>l.date==='2026-09-30');
 state.monthCloseArchive=[{id:'close',closedAt:'2026-10-01T12:00:00Z',ledger:archived,sales:[state.salesHistory[0]]}];
 state.ledger=state.ledger.filter(l=>!archived.includes(l));state.salesHistory=[];
 const d=agentWalletPeriod(state,'a',{mode:'monthly',month:10,year:2026});
 assert.equal(d.opening,75);assert.equal(d.adjustment,-75);assert.equal(d.closing,-135);
 assert.equal(d.opening+d.due-d.paid+d.adjustment,d.closing);
 state.ledger.push(...archived);state.salesHistory.push(...state.monthCloseArchive[0].sales);
 assert.equal(agentWalletPeriod(state,'a',{mode:'monthly',month:10,year:2026}).closing,d.closing);
});
test('Wallet Reset adjusts baseline only once, including excluded payments; all-time totals stay unchanged',()=>{
 const state=fixture();state.walletResets=[{id:'reset',agentId:'a',date:'2026-10-01',resetAt:'2026-10-01T00:00:00Z',excludedLedgerIds:['ls1','p0']}];
 const period=agentWalletPeriod(state,'a',{mode:'custom',from:'2026-10-01',to:'2026-10-31'});
 assert.equal(period.adjustment,-75);assert.equal(period.closing,-135);
 const all=agentWalletPeriod(state,'a');const expected=agentWalletTotals(state.ledger,'a',state.walletResets);
 assert.equal(all.due,expected.due);assert.equal(all.paid,expected.paid);assert.equal(all.pending,expected.pending);
 assert.equal(all.history.length,5);
});
test('empty periods retain opening balance and do not invent activity',()=>{
 const d=agentWalletPeriod(fixture(),'a',{mode:'custom',from:'2026-12-01',to:'2026-12-31'});
 assert.equal(d.opening,-67);assert.equal(d.closing,-67);assert.equal(d.due,0);assert.equal(d.paid,0);assert.equal(d.transactions.length,0);
});
