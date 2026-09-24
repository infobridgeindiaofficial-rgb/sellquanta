import { detectMarketplace } from './labelDetectors.js';
import { parseFlipkartLines } from './flipkartText.js';
import { extractStructured, verifyAiRows } from './labelScan.js';

// Only explicit single-order, single-item layouts qualify. Never infer a missing
// quantity or selling amount from defaults, prices, tax or Product Master.
const unique = values => [...new Set(values)];
const one = values => { const found = unique(values); return found.length === 1 ? found[0] : null; };
const number = value => Number(value.replace(/,/g, ''));
const orderPatterns = {
  Amazon: /\b\d{3}-\d{7}-\d{7}\b/g,
  Flipkart: /\bOD\d{9,}\b/gi,
  Meesho: /\b\d{15,19}_\d{1,3}\b/g
};

export function parsePdfLines(lines, perf) {
  const text = lines.join('\n');
  const detectionEnd = perf?.begin('marketplace_detection');
  const detection = detectMarketplace(text);
  // Supplement the existing detector locally; do not change file segregation.
  const signals = new Set();
  if (/\bamazon\b|amazon\.in/i.test(text)) signals.add('Amazon');
  if (/e-?kart\s+logistics|SKU ID\s*\|\s*Description|\bflipkart\b/i.test(text)) signals.add('Flipkart');
  if (/SKU\s+Size\s+Qty\s+Color\s+Order No\.?|Original\s+For\s+Recipient|\bmeesho\b/i.test(text)) signals.add('Meesho');
  for (const [market, pattern] of Object.entries(orderPatterns)) {
    if (text.match(pattern)) signals.add(market);
  }
  if (detection.marketplace) signals.add(detection.marketplace);
  detectionEnd?.({marketplace:signals.size === 1 ? [...signals][0] : null,signals:[...signals],confidence:detection.confidence});
  if (signals.size !== 1 || detection.reason === 'ambiguous') return null;
  const marketplace = [...signals][0];
  const orderId = one(text.match(orderPatterns[marketplace]) || []);
  if (!orderId) return null;

  const amounts = [...text.matchAll(/^(?:grand\s+total|total(?:\s+(?:amount|price|value))?|(?:order|invoice)\s+total|amount\s+payable)\s*:?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:INR|Rs\.?|₹)?\s*$/gim)].map(m => number(m[1]));
  let amazonInvoiceItem = null;
  if (marketplace === 'Amazon' && /Sl\. Unit Net Tax Tax Tax Total\nDescription Qty\nNo Price Amount Rate Type Amount Amount/.test(text)) {
    // Amazon invoice columns: ASIN (seller SKU), unit price, qty, net,
    // tax rate/type, tax amount, final amount. TOTAL repeats tax then final.
    // Require one numbered item, one complete item row, and matching totals.
    const header = lines.indexOf('Sl. Unit Net Tax Tax Tax Total');
    const totalIndex = lines.findIndex((l,i) => i > header && /^TOTAL:/.test(l));
    if (totalIndex < 0) return null;
    const numberedItems = lines.slice(header + 3, totalIndex).filter(l=>/^\d+\s/.test(l));
    const invoiceItems = [...text.matchAll(/^[A-Z0-9]{10}\s+\(\s*([^\s()]+)\s*\)\s+₹[\d,]+\.\d{2}\s+(\d+)\s+₹[\d,]+\.\d{2}\s+\d+(?:\.\d+)?%\s+(?:IGST|CGST|SGST)\s+₹([\d,]+\.\d{2})\s+₹([\d,]+\.\d{2})\s*$/gm)];
    const totals = [...text.matchAll(/^TOTAL:\s*₹([\d,]+\.\d{2})\s+₹([\d,]+\.\d{2})\s*$/gm)];
    // Exactly one item row (one ASIN row) whose amounts equal the invoice TOTAL. A wrapped product title can put
    // a line starting with a number ("400 ml, Pack of 2 |") inside the description, so numbered lines are not
    // counted as items; only the first must be Sl. No 1. Two real items would give two ASIN rows and fail here.
    if (!/^1\s/.test(numberedItems[0] || '') || invoiceItems.length !== 1 || totals.length !== 1) return null;
    amazonInvoiceItem = invoiceItems[0];
    if (number(amazonInvoiceItem[3]) !== number(totals[0][1]) || number(amazonInvoiceItem[4]) !== number(totals[0][2])) return null;
    amounts.push(number(totals[0][2]));
  }
  if (marketplace === 'Meesho'
      && /TAX INVOICE\s+Original For Recipient/i.test(text)
      && /Description\s+HSN\s+Qty\s+Gross Amount\s+Discount\s+Taxable Value\s+Taxes\s+Total/i.test(text)) {
    // Verified Meesho tax invoices print "Total Rs.<tax> Rs.<invoice total>".
    // The final column includes other charges; the first amount is tax only.
    // Keep both forms in the same confidence check so conflicting totals reject.
    for (const m of text.matchAll(/^Total\s+Rs\.\s*[\d,]+\.\d{2}\s+Rs\.\s*([\d,]+\.\d{2})\s*$/gim)) amounts.push(number(m[1]));
  }
  const saleAmount = one(amounts);
  if (saleAmount === null || !Number.isFinite(saleAmount) || saleAmount < 0) return null;

  let sku, productName = '';
  const quantities = [...text.matchAll(/^(?:total\s+)?(?:qty|quantity)\s*:?\s*(\d+)\s*$/gim)].map(m=>Number(m[1]));
  if (amazonInvoiceItem) {
    sku = amazonInvoiceItem[1];
    quantities.push(Number(amazonInvoiceItem[2]));
  } else if (marketplace === 'Flipkart') {
    const parsed = parseFlipkartLines(lines);
    if (!parsed || parsed.length !== 1) return null;
    sku = parsed[0].sku;
    productName = parsed[0].productName;
    // Validate explicit quantity independently: the older parser defaults to 1.
    const header = lines.findIndex(l=>/SKU ID\s*\|\s*Description/i.test(l));
    const item = lines.slice(header+1).find(l=>/^\d{1,2}\s+.+?\s*\|/.test(l));
    const qty = item?.match(/\|.*\s+(\d{1,4})\s*$/)?.[1];
    if (qty) quantities.push(Number(qty));
  } else if (marketplace === 'Meesho' && /SKU\s+Size\s+Qty\s+Color\s+Order No/i.test(text)) {
    const header = lines.findIndex(l=>/SKU\s+Size\s+Qty\s+Color\s+Order No/i.test(l));
    // Whitespace-delimited table: SKU, size (possibly "Free Size"), qty,
    // color, sub-order. Wrapped or ambiguous rows deliberately use the image.
    const items = lines.slice(header+1).map(l=>l.match(/^(\S+)\s+(.+?)\s+(\d+)\s+([^\d]+?)\s+(\d{15,19}_\d{1,3})\s*$/)).filter(Boolean);
    if (items.length !== 1 || items[0][5] !== orderId) return null;
    sku = items[0][1];
    quantities.push(Number(items[0][3]));
  } else {
    const skus = [...text.matchAll(/^(?:seller\s+|marketplace\s+)?SKU(?:\s+ID)?\s*:\s*(\S+)\s*$/gim)].map(m=>m[1]);
    // Multiple SKU entries could represent multiple items, even if identical.
    if (skus.length !== 1) return null;
    sku = skus[0];
  }
  const qty = one(quantities);
  if (!sku || !Number.isSafeInteger(qty) || qty <= 0) return null;
  return [{marketplace, orderId, sku, productName, qty, saleAmount, source:'pdf-text', layout:marketplace.toLowerCase()}];
}

export async function scanPdfPage(page, _detectCtx, scanLabel, perf) {
  const text = page.lines.join(' ');
  const withText = rows => rows.map(row=>({...row, _docText:text, _pageText:rows.length === 1 ? text : ''}));
  // Stage 1: strict single-item parser (unchanged).
  const parsed = perf ? perf.sync('fastPdfParser',()=>parsePdfLines(page.lines,perf)) : parsePdfLines(page.lines);
  const decisionEnd = perf?.begin('fallback_decision');
  const diag = { page: page.pageNumber, stages: [], ollama: { called: false } };
  let rows, method, reason;
  if (parsed) {
    method = 'FAST_PDF_PARSER'; reason = 'required text fields confidently extracted';
    rows = parsed.map(r => ({ ...r, _verified: { orderId: true, sku: true, qty: true, amount: true }, _holds: {} }));
    diag.stages.push('strict');
  } else {
    // Stage 2: tolerant structured parsing of the same text layer (multi-line titles, CGST/SGST, repeated items...).
    const structured = perf ? perf.sync('structuredPdfParser',()=>extractStructured(page.lines)) : extractStructured(page.lines);
    diag.stages.push('structured'); diag.signals = structured.signals; diag.notes = structured.notes;
    if (structured.complete) {
      method = 'PDF_TEXT_STRUCTURED'; reason = 'all fields verified from the PDF text';
      rows = structured.rows;
    } else {
      // Stage 3: Ollama reads the page image; every AI value is verified against the page text (verifyAiRows).
      method = page.lines.some(l => String(l).trim()) ? 'OLLAMA_VERIFIED' : 'OLLAMA_FALLBACK';
      reason = structured.rows.length ? 'text fields incomplete - AI used for the missing fields' : 'text fields missing or ambiguous';
      perf?.source(method);
      decisionEnd?.({fallbackRequired:true,reason,parsedRows:0});
      diag.ollama.called = true;
      const started = Date.now();
      let result;
      try {
        const imageBase64=await page.render();
        const request=()=>scanLabel({imageBase64});
        if (perf) perf.state.ollamaCalled=true;
        result=perf ? await perf.async('ollama_request',request,{page:page.pageNumber}) : await request();
        diag.ollama = { called: true, ok: true, ms: Date.now() - started, model: result?.model || '', rows: (result?.rows || []).length };
      } catch (error) {
        diag.ollama = { called: true, ok: false, ms: Date.now() - started, error: error.message };
        console.warn('[Daily Sales PDF] Ollama failed:', error.message);
        // Keep what the text layer already proved; without it there is nothing reliable to show.
        if (!structured.rows.length) throw error;
        method = 'PDF_TEXT_PARTIAL'; reason = `AI unavailable (${error.message}) - only text-verified fields used`;
        rows = structured.rows;
      }
      if (result) {
        const found = result.rows || [];
        rows = verifyAiRows(found, page.lines, structured);
        diag.stages.push('ollama+verify');
      }
      rows = withText(rows).map(row=>({...row, _scanMethod:method, _scanReason:reason, _diag:{...diag, verifyNotes: row._verifyNotes || []}}));
      console.debug('[Daily Sales PDF]', {method, reason, orderId:rows[0]?.orderId});
      return rows;
    }
  }
  perf?.source(method);
  decisionEnd?.({fallbackRequired:false,reason,parsedRows:rows.length});
  console.debug('[Daily Sales PDF]', {method, reason, orderId:rows[0]?.orderId});
  perf?.log('fallback_preparation_skipped',{page:page.pageNumber,canvasCreated:false,imageEncodingSkipped:true,ollamaRequestSkipped:true});
  return withText(rows).map(row=>({...row, _scanMethod:method, _scanReason:reason, _diag:diag}));
}
