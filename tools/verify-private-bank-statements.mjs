// Opt-in local verification. Never writes raw PDF text, account data, narrations or AI explanations.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseStatement, buildPreview } from '../server/bankStatement.mjs';
import { advisePreview } from '../server/bankStatementAi.mjs';
import * as pdfjs from '../client/node_modules/pdfjs-dist/legacy/build/pdf.mjs';

export async function extractPrivatePdf(file) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
  try {
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number), content = await page.getTextContent();
      pages.push({ pageNumber: number, items: content.items.filter(item => typeof item.str === 'string' && item.str.trim()).map(item => ({ text: item.str, x: item.transform[4], y: item.transform[5] })) });
    }
    return pages;
  } finally { await pdf.destroy(); }
}

const safeWords = new Set('DATE VALUE TRANSACTION TRAN TXN TRANSDATE NARRATION PARTICULARS DESCRIPTION DETAILS CHEQUE CHQ REF REFERENCE NO NUMBER DEBIT CREDIT WITHDRAWAL WITHDRAWALS DEPOSIT DEPOSITS BALANCE RUNNING OPENING CLOSING TOTAL TRANSACTIONS ENTRIES AMOUNT PAGE OF INR DR CR AMAZON HSBC MEESHO FLIPKART INTERNAL A-DAS NEFT IMPS UTR S.NO SERIAL'.split(' '));
const structureText = text => text.split(/\s+/).map(word => safeWords.has(word.toUpperCase().replace(/[:()]/g, '')) ? word.toUpperCase().replace(/[:()]/g, '') : /^[-–—]+$/.test(word) ? '<blank>' : '<private>').join(' ');
function structure(pages) {
  return pages.map(page => {
    const groups = [];
    for (const item of [...page.items].sort((a,b) => b.y-a.y || a.x-b.x)) {
      let line = groups.find(line=>Math.abs(line.y-item.y)<2);
      if (!line) {line={y:item.y,cells:[]};groups.push(line);}
      line.cells.push({x:Math.round(item.x),text:structureText(item.text)});
    }
    return {page:page.pageNumber,lines:groups.length,firstLines:groups.slice(0,24),lastLines:groups.slice(-8)};
  });
}

async function main() {
  const files = process.argv.slice(2).filter(arg=>!arg.startsWith('--'));
  if (!files.length) throw new Error('Provide private local PDF paths.');
  const dataFile = path.resolve('data/stockpilot.json');
  const original = fs.existsSync(dataFile) ? fs.readFileSync(dataFile) : null;
  const existing = original ? JSON.parse(original).bankSettlements || [] : [];
  const summaries = [];
  for (let index=0;index<files.length;index++) {
    if (!fs.existsSync(files[index])) throw new Error(`Statement ${index+1} is missing.`);
    const pages = await extractPrivatePdf(files[index]);
    if (process.argv.includes('--structure')) {console.log(JSON.stringify({statement:index+1,structure:structure(pages)}));continue;}
    const parsed = parseStatement({filename:'private.pdf',pages});
    let preview = buildPreview(parsed,existing);
    if (process.argv.includes('--ollama')) preview = await advisePreview(preview);
    const issueCounts = {};
    for(const issue of parsed.warnings) issueCounts[issue.code]=(issueCounts[issue.code]||0)+1;
    const eligible=parsed.transactions.filter(row=>row.creditCents>0&&!row.debitCents);
    const simulatedStored=eligible.map(row=>({transactionFingerprint:buildPreview({...parsed,transactions:[row]}).rows[0].fingerprint}));
    const reupload=buildPreview(parsed,simulatedStored);
    const exactLegacyMatches=existing.filter(receipt=>parsed.transactions.some(row=>row.date===String(receipt.date).slice(0,10)&&row.creditCents===receipt.amountCents&&row.reference&&receipt.reference&&row.reference.trim().toUpperCase()===receipt.reference.trim().toUpperCase())).length;
    summaries.push({statement:index+1,pages:pages.length,extractedRows:preview.rows.length,uniqueRows:parsed.reconciliation.extracted.count,
      reconciliationChecks:parsed.reconciliation.checks,reconciled:parsed.reconciliation.verified,issueCounts,
      accountIdentityHashed:parsed.accountAvailable,allValueDatesPreserved:parsed.transactions.every(row=>row.valueDate),legacyReceiptCount:existing.length,exactLegacyMatches,
      classifications:Object.fromEntries(['Amazon','Flipkart','Meesho'].map(market=>[market,preview.rows.filter(row=>!row.duplicate&&row.detection.marketplace===market).length])),
      reviewRequired:preview.rows.filter(row=>row.status==='Review required').length,excluded:preview.rows.filter(row=>row.status==='Other / Excluded').length,
      duplicates:preview.rows.filter(row=>row.duplicate).length,advisorySuggestions:preview.rows.filter(row=>row.ai).length,aiStatus:preview.aiStatus||'Not requested',savingEnabled:preview.savingEnabled,
      fingerprintsStable:buildPreview(parseStatement({filename:'private.pdf',pages}),existing).rows.every((row,i)=>row.fingerprint===preview.rows[i].fingerprint),
      reuploadDuplicateCheck:eligible.every(row=>reupload.rows.find(candidate=>candidate.reference===row.reference&&candidate.date===row.date&&candidate.creditCents===row.creditCents)?.duplicate)});
  }
  const unchanged = !original || original.equals(fs.readFileSync(dataFile));
  if(!unchanged) throw new Error('Database changed during verification.');
  if (!process.argv.includes('--structure')) console.log(JSON.stringify({summaries,databaseUnchanged:unchanged}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(()=>{console.error('Private statement verification failed; no document contents were logged.');process.exitCode=1;});
