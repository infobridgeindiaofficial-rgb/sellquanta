import crypto from 'node:crypto';
import XLSX from 'xlsx';

export const MARKETS = ['Amazon', 'Flipkart', 'Meesho'];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export const normalized = value => String(value ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
export const redact = value => String(value ?? '').replace(/\b\d{11,}\b/g, number => `••••${number.slice(-4)}`);

export function moneyCents(value) {
  if (value == null || String(value).trim() === '' || /^[-–—]+$/.test(String(value).trim())) return 0;
  let text = String(value).trim().replace(/^(?:INR|RS\.?|₹)\s*/i, '').replace(/\s*(CR|DR)$/i, '');
  const negative = /^\(.*\)$/.test(text) || text.startsWith('-');
  text = text.replace(/^\(|\)$/g, '').replace(/^-/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(text)) throw new Error('Invalid currency cell');
  const [whole, fraction = ''] = text.replace(/,/g, '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('Currency exceeds safe range');
  return negative ? -cents : cents;
}

export function bankDate(value) {
  if (typeof value === 'number' && value > 20000 && value < 100000) {
    const date = XLSX.SSF.parse_date_code(value);
    value = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
  }
  let match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let year, month, day;
  if (match) [, year, month, day] = match;
  else {
    match = String(value ?? '').trim().match(/^(\d{1,2})[\/.-](\d{1,2}|[A-Za-z]{3})[\/.-](\d{2}|\d{4})$/);
    if (!match) return null;
    [, day, month, year] = match;
    if (/[a-z]/i.test(month)) month = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ').indexOf(month.toUpperCase()) + 1;
    if (String(year).length === 2) year = `20${year}`;
  }
  const result = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${result}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === result ? result : null;
}

export function detectMarketplace(transaction) {
  if (!transaction.creditCents || transaction.debitCents) return { marketplace: null, confidence: 1, status: 'Other / Excluded', reason: 'Only credit transactions are eligible.' };
  const text = normalized(transaction.narration);
  if (/INTERNAL\s+A[- ]DAS/.test(text)) return { marketplace: null, confidence: 0, status: 'Review required', reason: 'INTERNAL A-DAS is ambiguous; additional evidence is required.' };
  if (/SUBSID|GOVERNMENT|\bDBT\b|PENSION|BANK CHARGE|INTEREST CREDIT|PERSONAL TRANSFER|SALARY/.test(text)) return { marketplace: null, confidence: 1, status: 'Other / Excluded', reason: 'Unrelated banking credit.' };
  const matches = [];
  if (/\bMEESHO\s+(?:TEC|PAY)\b/.test(text)) matches.push('Meesho');
  if (/\bFLIPKART\s+I\b/.test(text)) matches.push('Flipkart');
  if (/\bIMPS\b.*\/\s*AMAZON\s*\/\s*HSBC\b/.test(text)) matches.push('Amazon');
  if (matches.length === 1) return { marketplace: matches[0], confidence: 1, status: 'Confirmed', reason: 'Matched a user-confirmed settlement narration pattern. Explicit approval is still required.' };
  return { marketplace: null, confidence: 0, status: 'Review required', reason: matches.length > 1 ? 'Conflicting marketplace patterns.' : 'No confirmed settlement pattern; review the credit manually.' };
}

export function fingerprint(transaction) {
  return digest(JSON.stringify([transaction.accountKey || '', transaction.date, normalized(transaction.reference), transaction.creditCents, normalized(transaction.narration)]));
}

const aliases = {
  date: ['date', 'transactiondate', 'txndate', 'trandate', 'postingdate', 'transdate'],
  valueDate: ['valuedate'], narration: ['narration', 'description', 'particulars', 'transactiondetails'],
  reference: ['reference', 'referenceno', 'bankreference', 'utr', 'utrno', 'chequeno', 'chequerefno', 'chqrefno', 'refno', 'chequerefnumber', 'refchequeno', 'chequenumber'],
  debit: ['debit', 'debitamount', 'withdrawal', 'withdrawals', 'withdrawalamount'],
  credit: ['credit', 'creditamount', 'deposit', 'deposits', 'depositamount'],
  balance: ['balance', 'runningbalance', 'closingbalance']
};
const headerName = value => normalized(value).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z]/g, '');
function headerMap(cells) {
  const map = {};
  cells.forEach((cell, index) => {
    for (const [key, names] of Object.entries(aliases)) if (names.includes(headerName(cell))) map[key] = index;
  });
  return ['date', 'narration', 'debit', 'credit'].every(key => key in map) ? map : null;
}
const isMeta = text => /^(?:page\s+\d|statement\b|indian overseas bank\b|iob\b|branch\b|account\b|a\/c\b|customer\b|name\b|address\b|ifsc\b|micr\b|period\b|generated\b|printed\b|continued\b|opening balance\b|closing balance\b|brought forward\b|carried forward\b|total\b|grand total\b|end of statement\b|this is a computer)/i.test(text.trim());

function accountIdentity(rows) {
  const numbers = new Set();
  for (const row of rows) {
    const text = row.cells.map(cell => String(cell ?? '')).join(' ');
    const found = text.match(/(?:account(?:\s*(?:number|no\.?))?|a\/c)\s*[:#-]?\s*(\d[\d -]{7,24})/i);
    if (found) numbers.add(found[1].replace(/\D/g, ''));
  }
  return { accountKey: numbers.size === 1 ? digest([...numbers][0]) : null, multipleAccounts: numbers.size > 1 };
}

// Rows retain explicit column positions. Blank debit cells must never turn credits into debits.
function parseRows(rows, { kind, extractionWarnings = [], sourceCount = null, countBasis = 'Statement footer' }) {
  const warnings = [...extractionWarnings], transactions = [], ignoredSources = [];
  const identity = accountIdentity(rows);
  if (identity.multipleAccounts) warnings.push({ code: 'MULTIPLE_ACCOUNTS', message: 'Multiple account identifiers found. Split the statement by account.' });
  let columns = null, pending = null;
  const totals = { creditCents: null, debitCents: null, count: sourceCount };
  const flush = () => {
    if (!pending) return;
    const item = pending; pending = null;
    try {
      if (!item.date) throw new Error('Unreadable transaction date');
      if (!item.narration.trim()) throw new Error('Missing narration');
      item.debitCents = moneyCents(item.debit); item.creditCents = moneyCents(item.credit);
      item.balanceCents = item.balance === '' || item.balance == null ? null : moneyCents(item.balance);
      if (item.debitCents < 0 || item.creditCents < 0 || (item.debitCents > 0 && item.creditCents > 0) || (!item.debitCents && !item.creditCents)) throw new Error('Ambiguous debit/credit cells');
      if (item.valueDateRaw && !item.valueDate) throw new Error('Unreadable value date');
      delete item.debit; delete item.credit; delete item.balance; delete item.valueDateRaw;
      transactions.push(item);
    } catch (error) {
      warnings.push({ code: 'UNREADABLE_ROW', message: error.message, sources: item.sources });
    }
  };
  for (const row of rows) {
    const text = row.cells.map(cell => String(cell ?? '')).join(' ').trim();
    if (!text) continue;
    const header = headerMap(row.cells);
    if (header) { columns = header; ignoredSources.push(row.source); continue; }
    if (/^(?:grand\s+)?total\b/i.test(text)) {
      flush();
      if (columns) {
        try {
          if (String(row.cells[columns.credit] ?? '').trim()) totals.creditCents = moneyCents(row.cells[columns.credit]);
          if (String(row.cells[columns.debit] ?? '').trim()) totals.debitCents = moneyCents(row.cells[columns.debit]);
        } catch { warnings.push({ code: 'UNREADABLE_TOTAL', message: 'Statement total could not be read.', sources: [row.source] }); }
      }
      const count = text.match(/total\s+(?:transactions|entries)\s*[:=]?\s*(\d+)/i);
      if (count) totals.count = Number(count[1]);
      ignoredSources.push(row.source); continue;
    }
    if (isMeta(text)) { ignoredSources.push(row.source); continue; }
    if (!columns) { warnings.push({ code: 'UNMAPPED_ROW', message: 'No supported debit/credit table header before this row.', sources: [row.source] }); continue; }
    const get = key => row.cells[columns[key]] ?? '';
    if (/^(?:opening|closing) balance\b/i.test(String(get('narration')).trim())) { flush(); ignoredSources.push(row.source); continue; }
    const rawDate = get('date');
    if (String(rawDate).trim()) {
      flush();
      pending = { date: bankDate(rawDate), valueDate: get('valueDate') ? bankDate(get('valueDate')) : null, valueDateRaw: get('valueDate'), narration: String(get('narration')), reference: String(get('reference')).trim(), debit: get('debit'), credit: get('credit'), balance: get('balance'), sources: row.sources || [row.source], originalRows: row.originalRows || [row.cells], accountKey: identity.accountKey };
    } else if (pending && String(get('narration')).trim() && !String(get('debit')).trim() && !String(get('credit')).trim() && !String(get('balance')).trim() && !String(get('valueDate')).trim()) {
      pending.narration += `\n${get('narration')}`;
      if (String(get('reference')).trim()) pending.reference += String(get('reference')).trim();
      pending.sources.push(row.source); pending.originalRows.push(row.cells);
    } else {
      warnings.push({ code: 'UNREADABLE_ROW', message: 'Unattached continuation or missing transaction date.', sources: [row.source] });
    }
  }
  flush();
  if (!columns) warnings.push({ code: 'UNSUPPORTED_HEADER', message: 'Explicit Date, Narration, Debit and Credit columns are required; no amounts were guessed.' });
  if (!transactions.length) warnings.push({ code: 'NO_TRANSACTIONS', message: kind === 'PDF' ? 'No reliable transactions found. Image-only statements require OCR; unsupported text layouts need review.' : 'No reliable transactions found.' });
  const unique = [...new Map(transactions.map(transaction => [fingerprint(transaction), transaction])).values()];
  const creditCents = unique.reduce((sum, t) => sum + t.creditCents, 0);
  const debitCents = unique.reduce((sum, t) => sum + t.debitCents, 0);
  if (![creditCents, debitCents].every(Number.isSafeInteger)) throw new Error('Statement totals exceed safe range');
  const hasBalances = unique.length > 1 && unique.every(row => row.balanceCents !== null);
  const forward = unique.every((row, index) => !index || row.balanceCents === unique[index - 1].balanceCents + row.creditCents - row.debitCents);
  const reverse = unique.every((row, index) => index === unique.length - 1 || row.balanceCents === unique[index + 1].balanceCents + row.creditCents - row.debitCents);
  const checks = { count: totals.count == null ? null : totals.count === unique.length, credit: totals.creditCents == null ? null : totals.creditCents === creditCents, debit: totals.debitCents == null ? null : totals.debitCents === debitCents, balances: hasBalances ? forward || reverse : null };
  for (const [name, passes] of Object.entries(checks)) if (passes === false) warnings.push({ code: 'TOTAL_MISMATCH', message: `Extracted ${name} does not match the statement total.` });
  return { transactions, warnings, reconciliation: { sourceTotals: totals, countBasis, extracted: { count: unique.length, rawCount: transactions.length, creditCents, debitCents }, checks, verified: checks.count === true && checks.credit === true && warnings.length === 0 }, ignoredSources, accountAvailable: !!identity.accountKey };
}

function textLines(items) {
  const lines = [];
  for (const item of [...items].filter(item => String(item.text ?? '').trim()).sort((a,b)=>b.y-a.y || a.x-b.x)) {
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y) || typeof item.text !== 'string') throw new Error('Invalid PDF coordinates');
    let line = lines.find(line=>Math.abs(line.y-item.y)<=2);
    if (!line) { line={y:item.y,items:[]};lines.push(line); }
    line.items.push(item);
  }
  lines.forEach(line=>line.items.sort((a,b)=>a.x-b.x));
  return lines;
}

// IOB online statement layout: Date(Value Date), Particulars, Ref/Cheque No,
// Transaction Type, Debit(Rs), Credit(Rs), Balance(Rs). Row bands are anchored
// by their balance cells, not narration lines or centered header positions.
export function iobPdfRows(pages) {
  const findHeader = items => {
    const particulars=items.find(item=>/^Particulars$/i.test(item.text.trim()));
    if(!particulars) return null;
    const band=items.filter(item=>Math.abs(item.y-particulars.y)<12);
    const find=pattern=>band.find(item=>pattern.test(item.text.trim()));
    const date=find(/^Date\(Value$/i), ref=find(/^\/Cheque No$/i), type=find(/^Transaction$/i), debit=find(/^Debit\(Rs\)$/i), credit=find(/^Credit\(Rs\)$/i), balance=find(/^Balance\(Rs\)$/i);
    if(![date,ref,type,debit,credit,balance].every(Boolean)) return null;
    return {bottom:Math.min(...band.map(item=>item.y)), narration:(date.x+particulars.x)/2, reference:ref.x-3, type:type.x-3, debit:debit.x-3, credit:credit.x-3, balance:balance.x-3};
  };
  if(!pages.some(page=>findHeader(page.items))) return null;
  const rows=[], warnings=[];
  let layout=null, dateCount=0, anchorCount=0;
  const isAmount=text=>/^[-–—]$/.test(text.trim()) || /^[\d,]+\.\d{2}(?:\s*(?:CR|DR))?$/i.test(text.trim());
  for(const page of pages) {
    if(!Array.isArray(page.items) || page.items.length>50000) throw new Error('Invalid PDF text items');
    const lines=textLines(page.items);
    if(!lines.length) {warnings.push({code:'OCR_REQUIRED',message:`Page ${page.pageNumber}: OCR is required.`,sources:[{page:page.pageNumber}]});continue;}
    const header=findHeader(page.items);
    if(header) {
      layout=header;
      rows.push({cells:['Date','Value Date','Narration','Reference','Debit','Credit','Balance'],source:{page:page.pageNumber,row:0}});
    }
    // Account numbers can be below their label in the cover, never in UI/log output.
    for(const item of page.items.filter(item=>/^(?:accountno|accountnumber|accno|acno|acnumber)$/.test(headerName(item.text)))) {
      const inline=item.text.match(/\d{8,}/)?.[0];
      const below=page.items.find(value=>Math.abs(value.x-item.x)<8 && value.y<item.y && item.y-value.y<16 && /^:?\s*\d[\d -]{7,23}$/.test(value.text.trim()));
      const beside=page.items.filter(value=>value.x>item.x+60 && value.x<item.x+180 && Math.abs(value.y-item.y)<12 && /^:?\s*\d[\d -]{9,23}$/.test(value.text.trim()));
      const account=inline||below?.text.trim().replace(/\D/g,'')||(beside.length===1 ? beside[0].text.trim().replace(/\D/g,'') : null);
      if(account) rows.push({cells:[`Account No: ${account}`],source:{page:page.pageNumber,row:0}});
    }
    if(!layout) continue; // Cover metadata before the verified table header.
    const tableLines=lines.filter(line=>line.y>35 && (!header || line.y<header.bottom-3));
    const anchors=tableLines.filter(line=>line.items.some(item=>item.x>=layout.balance && isAmount(item.text)));
    dateCount+=tableLines.flatMap(line=>line.items).filter(item=>item.x<layout.narration && /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(item.text.trim())).length;
    anchorCount+=anchors.length;
    const consumed=new Set();
    for(let index=0;index<anchors.length;index++) {
      const anchor=anchors[index];
      const top=index ? (anchors[index-1].y+anchor.y)/2 : (header ? header.bottom-3 : Infinity);
      const bottom=index<anchors.length-1 ? (anchors[index+1].y+anchor.y)/2 : anchor.y-12;
      const band=tableLines.filter(line=>line.y<top && line.y>bottom);
      band.forEach(line=>consumed.add(line));
      const items=band.flatMap(line=>line.items);
      const dates=items.filter(item=>item.x<layout.narration);
      const transactionDate=dates.find(item=>/^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(item.text.trim()));
      const valueDate=dates.find(item=>/^\(\d{1,2}-[A-Za-z]{3}-\d{2,4}\)$/.test(item.text.trim()));
      const getRange=(left,right)=>items.filter(item=>item.x>=left&&item.x<right).sort((a,b)=>b.y-a.y||a.x-b.x).map(item=>item.text).join('\n');
      const cells=[transactionDate?.text.trim()||'',valueDate?.text.trim().slice(1,-1)||'',getRange(layout.narration,layout.reference),getRange(layout.reference,layout.type),getRange(layout.debit,layout.credit),getRange(layout.credit,layout.balance),getRange(layout.balance,Infinity)];
      // Preserve all extracted cells, including the transaction type and split value date.
      rows.push({cells,source:{page:page.pageNumber,row:index+1},sources:band.map(line=>({page:page.pageNumber,row:lines.indexOf(line)+1})),originalRows:band.map(line=>line.items.map(item=>item.text))});
    }
    for(const line of tableLines.filter(line=>!consumed.has(line))) {
      const money=line.items.filter(item=>item.x>=layout.debit && isAmount(item.text));
      if(money.length===2 && money.some(item=>item.x<layout.credit) && money.some(item=>item.x>=layout.credit&&item.x<layout.balance) && line.items.length===2) {
        rows.push({cells:['Total','','','',money.find(item=>item.x<layout.credit).text,money.find(item=>item.x>=layout.credit).text,''],source:{page:page.pageNumber,row:lines.indexOf(line)+1}});
      } else if(line.items.some(item=>item.x>=layout.narration&&item.x<layout.balance) || line.items.some(item=>/^\(?\d{1,2}-[A-Za-z]{3}-\d{2,4}\)?$/.test(item.text.trim()))) {
        warnings.push({code:'UNREADABLE_ROW',message:'An IOB table line could not be attached to a transaction.',sources:[{page:page.pageNumber,row:lines.indexOf(line)+1}]});
      }
      // Full-width notices below the table are metadata, never narration.
    }
  }
  if(dateCount!==anchorCount) warnings.push({code:'SOURCE_COUNT_MISMATCH',message:'IOB transaction-date blocks and balance-row anchors disagree; review missing or extra rows.'});
  return {rows,warnings,sourceCount:dateCount,countBasis:'Independent IOB transaction-date blocks (not a printed count)'};
}

// Geometry-based column assignment avoids splitting narration on its own numbers.
export function pdfRows(pages) {
  const iob=iobPdfRows(pages);
  if(iob) return iob;
  const rows = [], warnings = [];
  let positions = null;
  for (const page of pages) {
    const items = page.items;
    if (!Array.isArray(items) || items.length > 50000) throw new Error('Invalid PDF text items');
    const lines = [];
    for (const item of items.filter(item => String(item.text ?? '').trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
      if (!Number.isFinite(item.x) || !Number.isFinite(item.y) || typeof item.text !== 'string') throw new Error('Invalid PDF coordinates');
      let line = lines.find(line => Math.abs(line.y - item.y) <= 2);
      if (!line) { line = { y: item.y, items: [] }; lines.push(line); }
      line.items.push(item);
    }
    if (!lines.length) warnings.push({ code: 'OCR_REQUIRED', message: `Page ${page.pageNumber}: no usable text. OCR is required.`, sources: [{ page: page.pageNumber }] });
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]; line.items.sort((a, b) => a.x - b.x);
      const rawCells = line.items.map(item => item.text);
      const header = headerMap(rawCells);
      if (header) {
        positions = line.items.map(item => item.x);
        rows.push({ cells: rawCells, source: { page: page.pageNumber, row: index + 1 } });
      } else if (!positions || (isMeta(rawCells.join(' ')) && !/^(?:grand\s+)?total\b/i.test(rawCells.join(' ')))) {
        rows.push({ cells: [rawCells.join(' ')], source: { page: page.pageNumber, row: index + 1 } });
      } else {
        const cells = Array(positions.length).fill('');
        for (const item of line.items) {
          let column = 0;
          for (let i = 1; i < positions.length; i++) if (item.x >= positions[i] - 3) column = i;
          cells[column] += `${cells[column] ? ' ' : ''}${item.text}`;
        }
        rows.push({ cells, source: { page: page.pageNumber, row: index + 1 } });
      }
    }
  }
  return { rows, warnings };
}

export function parseStatement(input) {
  const extension = String(input.filename ?? '').split('.').pop().toLowerCase();
  if (extension === 'pdf') {
    if (!Array.isArray(input.pages) || input.pages.length < 1 || input.pages.length > 300) throw new Error('Use a PDF with 1–300 pages');
    const { rows, warnings, sourceCount, countBasis } = pdfRows(input.pages);
    return parseRows(rows, { kind: 'PDF', extractionWarnings: warnings, sourceCount, countBasis });
  }
  if (!['csv', 'xlsx'].includes(extension)) throw new Error('Use a PDF, CSV or XLSX statement');
  if (typeof input.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw new Error('Invalid statement file');
  const buffer = Buffer.from(input.base64, 'base64');
  if (!buffer.length || buffer.length > 15 * 1024 * 1024) throw new Error('Statement must be between 1 byte and 15 MB');
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true, cellDates: false, dense: true });
  const rows = [];
  for (const sheet of workbook.SheetNames) {
    const values = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, defval: '', raw: true, blankrows: true });
    if (values.length + rows.length > 20000) throw new Error('Statement exceeds 20,000 rows');
    values.forEach((cells, index) => rows.push({ cells, source: { sheet, row: index + 1 } }));
  }
  return parseRows(rows, { kind: extension.toUpperCase() });
}

export function duplicateCheck(transaction, existing, seen = new Set()) {
  const key = fingerprint(transaction);
  let duplicate = seen.has(key) ? 'Repeated transaction within this statement.' : null;
  if (!duplicate && existing.some(receipt => receipt.transactionFingerprint === key)) duplicate = 'Previously imported transaction (including archived/deleted receipt).';
  // Legacy records lack account/narration: conservatively flag possible overlaps instead of claiming a unique match.
  if (!duplicate && existing.some(receipt => {
    if (receipt.amountCents !== transaction.creditCents || String(receipt.date).slice(0, 10) !== transaction.date) return false;
    const referenceMatches = transaction.reference && receipt.reference && normalized(transaction.reference) === normalized(receipt.reference);
    const noReference = !transaction.reference || !receipt.reference;
    return referenceMatches || noReference;
  })) duplicate = 'Possible overlap with a legacy receipt; reconcile before importing.';
  seen.add(key);
  return { fingerprint: key, duplicate };
}

export const SAVE_BLOCK_REASON = 'Confirm & Save is blocked: legacy bank receipts lack account/narration/import provenance, and source-statement reconciliation has not been completed. No receipts will be saved.';

export function buildPreview(parsed, existing = []) {
  const seen = new Set();
  const rows = parsed.transactions.map((transaction, index) => {
    const detection = detectMarketplace(transaction);
    const duplicate = duplicateCheck(transaction, existing, seen);
    return { ...transaction, id: `row-${index + 1}`, detection, ...duplicate, status: duplicate.duplicate ? 'Duplicate' : detection.status, marketplace: detection.marketplace, approved: false, ai: null };
  });
  return { ...parsed, transactions: undefined, rows, savingEnabled: false, saveBlockedReason: SAVE_BLOCK_REASON };
}
