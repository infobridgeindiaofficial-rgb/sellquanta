import test from 'node:test';
import assert from 'node:assert/strict';
import { salesForDate, undoEligibility, localToday } from '../client/src/salesHistoryFilter.js';
const row=(id,date,batchId=id)=>({id,date,batchId,createdAt:date+'T12:00:00+04:00',productId:'p'});

test('date history includes open and archived sales, deduplicates records and never mutates data',()=>{
 const s=row('s','2026-10-14'),old=row('old','2026-10-13');const state={todaySales:[s,row('second','2026-10-14')],salesHistory:[old,{...s}]};const before=structuredClone(state);
 assert.equal(salesForDate(state,'2026-10-14').length,2);assert.equal(salesForDate(state,'2026-10-13')[0].id,'old');assert.equal(salesForDate(state,'2026-10-15').length,0);assert.equal(salesForDate(state,'2020-01-01').length,0);assert.deepEqual(state,before);
});
test('Dubai local business midnight uses saved timestamps, with stored date fallback and no UTC picker conversion',()=>{
 const prior=process.env.TZ;process.env.TZ='Asia/Dubai';
 try {
  const state={todaySales:[{id:'before',createdAt:'2026-10-13T19:59:59Z'},{id:'midnight',createdAt:'2026-10-13T20:00:00Z'},{id:'end',createdAt:'2026-10-14T19:59:59Z'},{id:'next',createdAt:'2026-10-14T20:00:00Z'},{id:'legacy',date:'2026-10-14'}]};
  assert.deepEqual(salesForDate(state,'2026-10-14').map(s=>s.id).sort(),['end','legacy','midnight']);assert.equal(localToday(new Date('2026-10-13T20:00:00Z')),'2026-10-14');
 } finally {if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}
});
test('undo mirrors the global latest batch and preserves archive, refund, product and selected-date restrictions',()=>{
 const state={todaySales:[row('old','2026-10-13'),row('new','2026-10-14')],salesHistory:[],refunds:[],products:[{id:'p'}]};
 assert.equal(undoEligibility(state,'2026-10-13').enabled,false);assert.equal(undoEligibility(state,'2026-10-14').batchId,'new');
 state.refunds=[{saleId:'new'}];assert.equal(undoEligibility(state,'2026-10-14').enabled,false);state.refunds=[];
 state.salesHistory.push(row('archived','2026-10-15'));assert.match(undoEligibility(state,'2026-10-15').reason,/archived/);state.salesHistory=[];
 state.products=[];assert.equal(undoEligibility(state,'2026-10-14').enabled,false);state.products=[{id:'p'}];
 state.todaySales.push({...row('split','2026-10-13'),batchId:'new'});assert.equal(undoEligibility(state,'2026-10-14').enabled,false);
});
