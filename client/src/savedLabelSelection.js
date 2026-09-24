// Session-only File identities, never names/indices or persisted sales fields.
export function fullySavedSourceFiles(scanRows) {
  const orderKey=row=>String(row.orderId || '').trim().toLowerCase();
  const savedByFile=new Map();
  for (const row of scanRows) {
    if (!row._sourceFile || !row._saved || !orderKey(row)) continue;
    if (!savedByFile.has(row._sourceFile)) savedByFile.set(row._sourceFile,[]);
    savedByFile.get(row._sourceFile).push(row);
  }
  const files=new Map();
  for (const row of scanRows) {
    if (!row._sourceFile) continue;
    // A rescan leaves an unsaved duplicate in history. A confirmed save of the
    // same order from another attempt satisfies that duplicate, but never a
    // different order or another item in the same scan attempt.
    const savedOnAnotherScan=!!row._sourceScan && (savedByFile.get(row._sourceFile) || []).some(saved=>
      saved._sourceScan && saved._sourceScan !== row._sourceScan && orderKey(saved) === orderKey(row));
    const saved=(!!row._saved || savedOnAnotherScan) && row._sourceScan?.complete !== false;
    files.set(row._sourceFile,(files.get(row._sourceFile) ?? true) && saved);
  }
  return new Set([...files].filter(([,saved])=>saved).map(([file])=>file));
}

export function unselectSourceFiles(selected, labelRows, savedFiles) {
  const next=new Set(selected);
  for (const row of labelRows) if (savedFiles.has(row.file)) next.delete(row.id);
  return next.size === selected.size ? selected : next;
}
