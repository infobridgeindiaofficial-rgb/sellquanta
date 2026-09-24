import test from 'node:test';
import assert from 'node:assert/strict';
import { fullySavedSourceFiles, unselectSourceFiles } from './savedLabelSelection.js';

const fileA={name:'label.pdf'}, fileB={name:'label.pdf'}, fileC={name:'other.pdf'};
const labels=[{id:0,file:fileA},{id:1,file:fileB},{id:2,file:fileC}];
const row=(file,saved=false,extra={})=>({_sourceFile:file,_saved:saved,...extra});

test('A saves, A unselects, then selecting B scans only B without dropping files',()=>{
  const scanRows=[row(fileA,true)];
  const selected=unselectSourceFiles(new Set([0]),labels,fullySavedSourceFiles(scanRows));
  assert.equal(selected.size,0);
  selected.add(1);
  assert.deepEqual(labels.filter(r=>selected.has(r.id)).map(r=>r.file),[fileB]);
  assert.equal(labels.length,3);
  assert.equal(scanRows.length,1);
  assert.equal(scanRows[0]._saved,true);
});
test('partial success clears only saved file; failed and unresolved files stay selected',()=>{
  const rows=[row(fileA,true),row(fileB,false,{_saveError:'Not enough stock'}),row(fileC)];
  const initial=new Set([0,1,2]);
  const selected=unselectSourceFiles(initial,labels,fullySavedSourceFiles(rows));
  assert.deepEqual([...selected],[1,2]);
  assert.deepEqual([...initial],[0,1,2]);
});
test('multi-row PDF remains selected until all of its rows save',()=>{
  const rows=[row(fileA,true),row(fileA,false),row(fileB,true)];
  assert.deepEqual([...fullySavedSourceFiles(rows)],[fileB]);
  rows[1]={...rows[1],_saved:true};
  assert.deepEqual([...fullySavedSourceFiles(rows)],[fileA,fileB]);
});
test('PDF with a failed/empty scanned page stays selected even if its other rows saved',()=>{
  assert.equal(fullySavedSourceFiles([row(fileA,true,{_sourceScan:{complete:false}})]).size,0);
});
test('same names/new upload indices never deselect a different File object',()=>{
  const currentLabels=[{id:0,file:fileB}];
  assert.deepEqual([...unselectSourceFiles(new Set([0]),currentLabels,new Set([fileA]))],[0]);
});
test('unsaved, errored or legacy rows do not imply successful source files',()=>{
  assert.equal(fullySavedSourceFiles([row(fileA),row(fileB,false,{_saveError:'rejected'}),{_saved:true}]).size,0);
});
test('confirmed order on another scan satisfies only historical duplicates, not unresolved items',()=>{
  const scan1={complete:true},scan2={complete:true};
  const saved=row(fileA,true,{orderId:'Order-A',_sourceScan:scan1});
  const duplicate=row(fileA,false,{orderId:' order-a ',_sourceScan:scan2});
  assert.deepEqual([...fullySavedSourceFiles([saved,duplicate])],[fileA]);
  assert.equal(fullySavedSourceFiles([saved,{...duplicate,orderId:'order-b'}]).size,0);
  assert.equal(fullySavedSourceFiles([saved,{...duplicate,_sourceScan:scan1}]).size,0);
});
