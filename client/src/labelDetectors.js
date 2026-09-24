// Shipping-label marketplace + date detection rules.
//
// This is a direct, behavior-for-behavior port of the StockPilot Shipping Label Segregator's proven detector module
// (pdf-segregator-detectors.js) into an ES module for StockPilot's Daily Sales screen. The rules, weights and
// comments below are UNCHANGED from that module (only the export style differs: named ES exports instead of
// CommonJS/window globals) - this is deliberate: it is reused here, not re-derived, so the Label Segregator groups
// files exactly the way the PDF Segregator already does.
//
// NOTE: These rules were written from publicly known label conventions (Amazon/Flipkart/Meesho order-id formats,
// common label header text). Meesho's rules were additionally checked against 13 real "Sub_Order_Labels_*.pdf"
// samples. Ambiguous or weak matches deliberately fall back to "Needs Review" rather than guessing.
//
// Nothing in this file calls Ollama, the network, or anything StockPilot-specific - it only reads plain text.

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};
const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MIN_YEAR = 2015;
const MAX_YEAR = 2035;

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function makeIso(year, month, day) {
  if (!(month >= 1 && month <= 12)) return null;
  if (!(year >= MIN_YEAR && year <= MAX_YEAR)) return null;
  if (!(day >= 1 && day <= daysInMonth(year, month))) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---- Marketplace detection -------------------------------------------------

const MARKETPLACE_RULES = {
  Amazon: [
    { pattern: /\b\d{3}-\d{7}-\d{7}\b/, weight: 2 }, // Amazon order-id format, e.g. 171-1234567-1234567
    { pattern: /amazon\.in/i, weight: 2 },
    { pattern: /fulfilled\s+by\s+amazon/i, weight: 2 },
    { pattern: /\bFBA\b/, weight: 1 },
    { pattern: /\bamazon\b/i, weight: 1 }
  ],
  Flipkart: [
    { pattern: /\bOD\d{9,}\b/, weight: 2 }, // Flipkart order-id format, e.g. OD123456789012345
    { pattern: /flipkart\.com/i, weight: 2 },
    { pattern: /flipkart internet private limited/i, weight: 2 },
    { pattern: /\bFSN\b/, weight: 1 },
    { pattern: /\bflipkart\b/i, weight: 1 }
  ],
  Meesho: [
    // Real Meesho "Sub_Order_Labels_*.pdf" invoices (13 verified samples) never print the word "Meesho" anywhere -
    // the seller generates the bill of supply, not the marketplace. These structural signals were confirmed present
    // in all 13 real samples and absent from every real Amazon/Flipkart sample checked.
    { pattern: /\b\d{15,19}_\d{1,3}\b/, weight: 2 }, // Meesho sub-order id, e.g. 330000000000000003_1
    { pattern: /original\s+for\s+recipient/i, weight: 2 }, // Meesho's own invoice template heading
    { pattern: /enrolment\s*no\.?\s*-/i, weight: 1 }, // Meesho GST composition-scheme seller field
    { pattern: /product\s*details/i, weight: 1 }, // Meesho item-table heading
    { pattern: /meesho\.com/i, weight: 2 },
    { pattern: /fulfilled\s+by\s+meesho/i, weight: 2 },
    { pattern: /\bmeesho\b/i, weight: 1 }
  ]
};

const CONFIDENCE_THRESHOLD = 2;

// Returns { marketplace: 'Amazon'|'Flipkart'|'Meesho'|null, confidence: 'high'|'low', scores: {...} }
export function detectMarketplace(text) {
  const source = String(text || "");
  const scores = {};
  for (const name of Object.keys(MARKETPLACE_RULES)) {
    let score = 0;
    for (const rule of MARKETPLACE_RULES[name]) {
      if (rule.pattern.test(source)) score += rule.weight;
    }
    scores[name] = score;
  }

  const qualifying = Object.keys(scores).filter(name => scores[name] >= CONFIDENCE_THRESHOLD);

  if (qualifying.length === 1) {
    return { marketplace: qualifying[0], confidence: "high", scores };
  }
  if (qualifying.length > 1) {
    // Multiple marketplaces both cleared the bar - ambiguous, do not guess.
    return { marketplace: null, confidence: "low", scores, reason: "ambiguous" };
  }
  return { marketplace: null, confidence: "low", scores, reason: "no-match" };
}

// ---- Date detection ---------------------------------------------------------

// Explicit priority order of "meaningful" date labels, highest priority first. "Order Date" is ranked first based on
// real Amazon invoice/label samples: it is the one field that is reliably present and correctly reflects the useful
// order/shipment date across every sample seen.
const DATE_LABEL_PRIORITY = [
  /order\s*date/i,
  /shipment\s*date/i,
  /shipp?ing\s*date/i,
  /dispatch\s*date/i,
  /label\s*date/i,
  /invoice\s*date/i,
  /order\s*placed/i,
  /pickup\s*date/i,
  /packed\s*on/i
];

// How far past a label's end a date value is allowed to be to count as "belonging" to that label, e.g.
// "Order Date: 12.08.2026" - label ends right before the value.
const LABEL_WINDOW = 40;

// Each entry: regex with capture groups resolved by resolve(match) -> iso string | null
const DATE_PATTERNS = [
  {
    // 22 Sep 2026 / 22-Sep-2026 / 22/Sep/2026
    regex: /\b(\d{1,2})[\s\-\/]([A-Za-z]{3,9})[\s\-\/,]+(\d{4})\b/g,
    resolve: m => {
      const month = MONTHS[m[2].toLowerCase()];
      if (!month) return null;
      return makeIso(Number(m[3]), month, Number(m[1]));
    }
  },
  {
    // Sep 22, 2026 / September 22 2026
    regex: /\b([A-Za-z]{3,9})[\s\-]+(\d{1,2}),?\s+(\d{4})\b/g,
    resolve: m => {
      const month = MONTHS[m[1].toLowerCase()];
      if (!month) return null;
      return makeIso(Number(m[3]), month, Number(m[2]));
    }
  },
  {
    // 2026-09-22 (ISO)
    regex: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
    resolve: m => makeIso(Number(m[1]), Number(m[2]), Number(m[3]))
  },
  {
    // 22/09/2026, 22-09-2026 or 22.08.2026 (day-month-year, the common Indian convention). The "." separator is
    // needed because real Amazon invoices print e.g. "Order Date: 12.08.2026".
    regex: /\b(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})\b/g,
    resolve: m => {
      const a = Number(m[1]), b = Number(m[2]), year = Number(m[3]);
      // Prefer day-month-year; if the first part can't be a day (>31) or the second can't be a month (>12),
      // don't guess a swapped reading.
      if (a > 31 || b > 12) return null;
      return makeIso(year, b, a);
    }
  }
];

function findAllDates(text) {
  const found = []; // { iso, index }
  for (const { regex, resolve } of DATE_PATTERNS) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(text))) {
      const iso = resolve(m);
      if (iso) found.push({ iso, index: m.index });
    }
  }
  return found;
}

// Walks DATE_LABEL_PRIORITY in order and, for the first label that has a date value shortly after it in the text,
// returns that date. This is an explicit priority order based on label meaning - not "whichever date appears first".
function findLabeledDate(text, allDates) {
  for (const labelPattern of DATE_LABEL_PRIORITY) {
    const re = new RegExp(labelPattern.source, "gi");
    let m;
    while ((m = re.exec(text))) {
      const labelEnd = m.index + m[0].length;
      const candidates = allDates
        .filter(d => d.index >= labelEnd && d.index - labelEnd <= LABEL_WINDOW)
        .sort((a, b) => a.index - b.index);
      if (candidates.length) return candidates[0].iso;
    }
  }
  return null;
}

// Returns { date: 'YYYY-MM-DD'|null, confidence: 'high'|'low', reason? }
export function detectDate(text) {
  const source = String(text || "");
  const all = findAllDates(source);
  if (all.length === 0) {
    return { date: null, confidence: "low", reason: "no-match" };
  }

  const labeled = findLabeledDate(source, all);
  if (labeled) {
    return { date: labeled, confidence: "high" };
  }

  const distinct = Array.from(new Set(all.map(d => d.iso)));
  if (distinct.length === 1) {
    return { date: distinct[0], confidence: "high" };
  }

  return { date: null, confidence: "low", reason: "ambiguous" };
}

export function formatDisplayDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTH_NAMES[m]} ${y}`;
}

// ---- Order-identifier extraction (display / duplicate-detection only) ------
// Used solely to build a short display label and a duplicate-detection key for the Segregator UI; does not affect
// detectMarketplace/detectDate at all, and is never sent to the actual scanner or the sales API - the real orderId
// used for a sale always comes from the existing scan pipeline, unchanged. Deliberately reuses the exact same
// order-id patterns already relied on as strong marketplace signals above, so the extracted value is consistent with
// the evidence that classified the file in the first place - no separate/looser matching is introduced.
export function extractOrderIdentifier(text, marketplace) {
  const source = String(text || "");
  if (marketplace === "Amazon") {
    const m = /\b(\d{3}-\d{7}-\d{7})\b/.exec(source);
    return m ? m[1] : null;
  }
  if (marketplace === "Flipkart") {
    const m = /\b(OD\d{9,})\b/i.exec(source);
    return m ? m[1].toUpperCase() : null;
  }
  if (marketplace === "Meesho") {
    // The most specific identifier available: the sub-order id (parent order number + "_N" suffix), e.g.
    // "330000000000000003_1". Two labels sharing the same parent order but a different sub-order suffix are
    // legitimately separate shipments, not duplicates - so the full "<order>_<n>" string is the key.
    const m = /\b(\d{15,19}_\d{1,3})\b/.exec(source);
    return m ? m[1] : null;
  }
  return null;
}
