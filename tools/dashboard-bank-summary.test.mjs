import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardBankSummary } from '../client/src/dashboardBankSummary.js';
const estimate={amount:1000,inferredQuantity:0,missingQuantity:0};
const receipt=(id,marketplace='Amazon',date='2026-01-20',amountCents=20000)=>({id,marketplace,date,amountCents,version:1});

test('Bank Received counts only active marketplace receipts in receipt month, not wallet/agent payments or duplicate/audit copies',()=>{
 const r=receipt('a');const state={companies:[{id:'c'}],bankSettlements:[r,{...r},receipt('f','Flipkart'),receipt('m','Meesho'),{...receipt('old'),date:'2025-12-30'},{...receipt('deleted'),deletedAt:'2026-01-25'},receipt('other','Other'),{...receipt('wallet'),type:'wallet_transfer'},{...receipt('misc'),kind:'unrelated'}],ledger:[{type:'PAYMENT',amount:99999}],bankingAudit:[{after:r}],bankingRequests:[{result:{settlement:r}}]};
 const before=structuredClone(state),result=dashboardBankSummary(state,'2026-01',estimate);
 assert.equal(result.received,600);assert.equal(result.allocated,0);assert.equal(result.balance,1000);assert.equal(result.provisional,true);assert.deepEqual(state,before);
 assert.equal(dashboardBankSummary(state,'2025-12',estimate).received,200);
});

test('explicit allocations keep company and marketplace scope and use sales month independently of receipt month',()=>{
 const state={companies:[{id:'c1'},{id:'c2'}],bankSettlements:[{...receipt('r','Amazon','2026-02-15',50000),allocations:[{companyId:'c1',marketplace:'Amazon',salesMonth:'2026-01',amountCents:30000},{companyId:'c2',marketplace:'Amazon',salesMonth:'2026-02',amountCents:20000}]}]};
 const january=dashboardBankSummary(state,'2026-01',estimate);assert.equal(january.received,0);assert.equal(january.allocated,300);assert.equal(january.balance,700);assert.equal(january.provisional,false);assert.deepEqual(january.scopes,[{companyId:'c1',marketplace:'Amazon',allocated:300}]);
 const february=dashboardBankSummary(state,'2026-02',estimate);assert.equal(february.received,500);assert.equal(february.allocated,200);assert.equal(february.balance,800);
 state.bankSettlements[0].allocations[0].marketplace='Meesho';const mismatch=dashboardBankSummary(state,'2026-01',estimate);assert.equal(mismatch.allocated,0);assert.equal(mismatch.provisional,true);
});

test('partial, invalid and excessive allocations are provisional; missing estimates remain unavailable; price inference is provisional',()=>{
 const state={companies:[{id:'c'}],bankSettlements:[{...receipt('r'),allocations:[{companyId:'c',marketplace:'Amazon',salesMonth:'2026-01',amountCents:10000}]}]};
 let result=dashboardBankSummary(state,'2026-01',estimate);assert.equal(result.balance,900);assert.equal(result.provisional,true);
 state.bankSettlements[0].allocations[0].amountCents=30000;result=dashboardBankSummary(state,'2026-01',estimate);assert.equal(result.balance,1000);assert.equal(result.allocated,0);
 assert.equal(dashboardBankSummary(state,'2026-01',{...estimate,amount:null,missingQuantity:1}).balance,null);
 assert.equal(dashboardBankSummary({companies:[],bankSettlements:[]},'2026-01',{...estimate,inferredQuantity:2}).provisional,true);
 const correction={...receipt('r'),version:2,amountCents:12345};assert.equal(dashboardBankSummary({bankSettlements:[receipt('r'),correction]},'2026-01',estimate).received,123.45);
});
