/*
 * Coinmate OKX Helper
 * -------------------
 * A tiny local bridge between the Coinmate Advisor app and OKX's public P2P feed.
 * It runs on your computer, fetches live PHP/USDT ads from OKX, and hands them to
 * the app (this sidesteps the browser security rule that blocks the app from
 * calling OKX directly).
 *
 * Just leave the window open while you use the app. Nothing here trades for you.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// find this PC's office-network (LAN) address so teammates can open the app
function lanIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}

const PORT = 8787;            // the app talks to http://127.0.0.1:8787
const FIAT = 'PHP';          // Philippine Peso
const BASE = 'USDT';
const APP_FILE = path.join(__dirname, 'coinmate_advisor_bot.html');

// Some networks (e.g. certain PH telcos) intercept okx.com with their own TLS
// certificate, which makes a direct fetch fail. To get around that WITHOUT touching
// the user's connection, we ask OKX through a read-only relay on a different domain
// (r.jina.ai). The relay fetches OKX server-side and hands us back the exact JSON.
// Note: the relay can see this public price data; the app stays advisory and a human
// still verifies prices on OKX before acting, so a bad relay can't trade for you.
const RELAY = 'https://r.jina.ai/';

// --- fetch one side ('sell' = merchants selling USDT, 'buy' = merchants buying USDT) ---
function fetchSide(side) {
  return new Promise((resolve, reject) => {
    const okxUrl = 'https://www.okx.com/v3/c2c/tradingOrders/books'
      + '?quoteCurrency=' + FIAT
      + '&baseCurrency=' + BASE.toLowerCase()
      + '&side=' + side
      + '&paymentMethod=all&userType=all';
    const req = https.get(RELAY + okxUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          // unwrap the relay envelope -> raw OKX JSON string -> OKX object
          const env = JSON.parse(data);
          if (!env || !env.data || typeof env.data.content !== 'string') {
            return reject(new Error('relay returned no data (rate limited?)'));
          }
          const json = JSON.parse(env.data.content);
          if (json.code !== 0) return reject(new Error('OKX returned code ' + json.code));
          const arr = (side === 'sell') ? json.data.sell : json.data.buy;
          // keep only the fields the app needs
          const trimmed = (arr || []).map((a) => ({
            price: parseFloat(a.price),
            available: parseFloat(a.availableAmount),
            nick: a.nickName,
            pay: a.paymentMethods || [],
            rate: parseFloat(a.completedRate || '0'),
            orders: a.completedOrderQuantity || 0,
            type: a.creatorType || '',
            min: parseFloat(a.quoteMinAmountPerOrder || '0'),  // per-order limit, in PHP
            max: parseFloat(a.quoteMaxAmountPerOrder || '0')
          }));
          resolve(trimmed);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => req.destroy(new Error('OKX/relay timed out')));
  });
}

// --- official USD/PHP spot rate (the intraday forex rate Google shows) ---
// Yahoo Finance is not blocked and needs no key; we read the live quote for USDPHP=X.
function fetchUsdPhp() {
  return new Promise((resolve, reject) => {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/USDPHP=X?interval=1d&range=1d';
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const m = JSON.parse(data).chart.result[0].meta;
          resolve({ php: m.regularMarketPrice, prev: m.previousClose, ts: (m.regularMarketTime || 0) * 1000 });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => req.destroy(new Error('FX timed out')));
  });
}

// --- OKX authenticated API (READ-ONLY) ----------------------------------
// Keys come from okx-keys.json sitting next to this file. That file is LOCAL
// ONLY: it is never served to the browser, never in the HTML, never in the
// team zip. If it's absent, the /account endpoint simply reports "no keys".
function loadOkxKeys() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'okx-keys.json'), 'utf8')); }
  catch (e) { return null; }
}
let OKX_KEYS = loadOkxKeys();

const OKX_BASE = 'https://www.okx.com';

// signed GET per OKX v5 spec: sign = base64( HMAC_SHA256(secret, ts+'GET'+path) )
// DITO intermittently blocks okx.com, so retry a few times to ride out short windows.
async function okxGet(reqPath, tries) {
  tries = tries || 5;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await okxGetOnce(reqPath); }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 700)); }
  }
  throw lastErr;
}
function okxGetOnce(reqPath) {
  return new Promise((resolve, reject) => {
    if (!OKX_KEYS || !OKX_KEYS.apiKey || !OKX_KEYS.secretKey || !OKX_KEYS.passphrase
        || /PUT_YOUR/.test(OKX_KEYS.passphrase)) {
      return reject(new Error('okx-keys.json missing/incomplete — need apiKey, secretKey, passphrase'));
    }
    const ts = new Date().toISOString();
    const sign = crypto.createHmac('sha256', OKX_KEYS.secretKey)
      .update(ts + 'GET' + reqPath).digest('base64');
    const req = https.request(OKX_BASE + reqPath, {
      method: 'GET',
      headers: {
        'OK-ACCESS-KEY': OKX_KEYS.apiKey,
        'OK-ACCESS-SIGN': sign,
        'OK-ACCESS-TIMESTAMP': ts,
        'OK-ACCESS-PASSPHRASE': OKX_KEYS.passphrase,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => req.destroy(new Error('OKX API timed out')));
    req.end();
  });
}

// ---- P2P order list: the authoritative source for rate / fiat / counterparty / orderId ----
// GET /api/v5/p2p/order/list returns 20 records per page; paginate with pageIndex (1-based).
// It mixes "new" (pending) and "completed" orders, so we keep ONLY completed. Each completed
// record carries the EXACT unitPrice (₱/USDT), fiatAmount (₱), cryptoAmount (USDT), side,
// counterparty name, payment method and orderId — no estimation needed.
function normP2p(o) {
  const side = String(o.side || '').toLowerCase();            // 'buy' | 'sell'
  const usdt = parseFloat(o.cryptoAmount) || 0;
  const cp = o.counterpartyDetail || {};
  return {
    billId: o.orderId,                                        // the app keys all state by billId
    orderId: o.orderId,
    ts: Number(o.completionTimestamp) || Number(o.createdTimestamp) || 0,
    side: side,
    usdt: (side === 'buy' ? 1 : -1) * usdt,                   // +buy / −sell, matches the app convention
    php: parseFloat(o.fiatAmount) || 0,
    rate: parseFloat(o.unitPrice) || parseFloat(o.exchangeRate) || 0,
    counterparty: String(cp.realName || cp.nickName || '').trim(),
    payMethod: o.makerPaymentMethod || '',
    status: String(o.orderStatus || '').toLowerCase()
  };
}
// Page the P2P order list (newest-first by CREATION). Returns normalized COMPLETED orders.
// The window is defined by COMPLETION time, but the list is ordered by creation — and an order
// can be created well before it completes (slow payers, disputes). So we only stop paging once we
// are past `stopBeforeTs` by creation AND the page held no completion still inside the window
// (windowFrom). A real mid-scan OKX error throws (so /scan can fail loudly instead of returning a
// silently partial day); hitting maxPages sets out._truncated so the caller can warn.
async function fetchP2pCompleted(maxPages, stopBeforeTs, windowFrom) {
  const out = [];
  let truncated = false;
  for (let page = 1; page <= maxPages; page++) {
    const j = await okxGet('/api/v5/p2p/order/list?pageIndex=' + page);
    if (j && String(j.code) !== '0') throw new Error('OKX p2p list page ' + page + ' code ' + j.code + ' ' + (j.msg || ''));
    if (!j || !Array.isArray(j.data) || !j.data.length) break;   // clean end of data
    let oldestCreated = Infinity, sawInWindow = false;
    for (const raw of j.data) {
      oldestCreated = Math.min(oldestCreated, Number(raw.createdTimestamp) || Infinity);
      const side = String(raw.side || '').toLowerCase();
      if (String(raw.orderStatus).toLowerCase() === 'completed' && (side === 'buy' || side === 'sell')) {
        const o = normP2p(raw);
        out.push(o);
        if (windowFrom && o.ts >= windowFrom) sawInWindow = true;
      }
    }
    if (j.data.length < 20) break;                               // genuine last page
    if (stopBeforeTs && oldestCreated < stopBeforeTs && !sawInWindow) break;   // safely past window
    if (page === maxPages) { truncated = true; break; }          // hit cap without a natural stop
    await new Promise(r => setTimeout(r, 120));                  // be gentle with the P2P endpoint
  }
  out._truncated = truncated;
  return out;
}

// ---- persistent multi-day ledger ----------------------------------------------------------------
// JSON is the source of truth (dedupe orders by id, one summary per date); two CSVs are regenerated
// from it on every write so the user can open a friendly, accumulating record in Excel.
const LEDGER_DIR = path.join(__dirname, 'Ledger');
const LEDGER_JSON = path.join(LEDGER_DIR, 'coinmate-ledger.json');
function loadLedger() {
  try { const L = JSON.parse(fs.readFileSync(LEDGER_JSON, 'utf8')); L.orders = L.orders || {}; L.summaries = L.summaries || {}; return L; }
  catch (e) { return { orders: {}, summaries: {} }; }
}
function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function writeLedger(L) {
  if (!fs.existsSync(LEDGER_DIR)) fs.mkdirSync(LEDGER_DIR, { recursive: true });
  fs.writeFileSync(LEDGER_JSON, JSON.stringify(L, null, 2));
  // running history: one row per day — the Today + Profit columns + each day's ENDING PHP balance
  const sHead = ['Date', 'Orders', 'Bought USDT', 'Sold USDT', 'Buy Avg', 'Sell Avg', 'Gross Profit (PHP)', 'InstaPay Fees (PHP)', 'Net Profit (PHP)', 'Ending PHP Balance'];
  const days = Object.values(L.summaries).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const sRows = [sHead].concat(days.map(d => [d.date, d.orders, d.boughtUsdt, d.soldUsdt, d.buyAvg, d.sellAvg, d.grossProfit, d.fees, d.netProfit, d.endingPhp]));
  fs.writeFileSync(path.join(LEDGER_DIR, 'Coinmate Daily Summary.csv'), '﻿' + sRows.map(r => r.map(csvCell).join(',')).join('\r\n'));
}

// ---- minimal .xlsx writer (no dependencies) ------------------------------------------------------
// Builds a genuine Office Open XML workbook: 5 XML parts packed into a "stored" (uncompressed) ZIP.
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; }
function zipStore(files) {
  const local = [], central = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), data = f.data, crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);                  // time 0, date 1980-01-01
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const cdStart = offset; let cdSize = 0; central.forEach(b => cdSize += b.length);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdStart, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...local, ...central, eocd]);
}
function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function colLetter(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function sheetXml(rows) {
  let body = '';
  rows.forEach((row, r) => {
    let cells = '';
    (row || []).forEach((cell, c) => {
      if (cell == null || cell === '') return;
      const ref = colLetter(c) + (r + 1);
      if (typeof cell === 'number' && isFinite(cell)) cells += '<c r="' + ref + '"><v>' + cell + '</v></c>';
      else cells += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(cell) + '</t></is></c>';
    });
    body += '<row r="' + (r + 1) + '">' + cells + '</row>';
  });
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + body + '</sheetData></worksheet>';
}
function buildXlsx(rows) {
  const CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
  const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const WB = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ledger" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const WBR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from(CT, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(RELS, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(WB, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WBR, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml(rows), 'utf8') }
  ]);
}
// one self-contained .xlsx per day: transactions + the day's summary + the ENDING PHP balance
function writeDayXlsx(p) {
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : (v || ''); };
  const t = p.transactions || [], s = p.summary || {}, date = (s.date || p.date || 'day');
  const rows = [];
  rows.push(['Coinmate Advisory — Daily Ledger']);
  rows.push(['Date', date]);
  rows.push([]);
  rows.push(['TRANSACTIONS']);
  rows.push(['Time', 'Type', 'USDT', 'Rate (PHP)', 'Total (PHP)', 'Counterparty', 'Payment', 'Order/Ref ID']);
  t.forEach(o => rows.push([o.time, o.type, num(o.usdt), num(o.rate), num(o.total), o.counterparty, o.payMethod, o.orderId]));
  rows.push([]);
  rows.push(['DAY SUMMARY']);
  rows.push(['Orders', num(s.orders)]);
  rows.push(['Bought USDT', num(s.boughtUsdt)]);
  rows.push(['Sold USDT', num(s.soldUsdt)]);
  rows.push(['Buy Avg (PHP)', s.buyAvg ? num(s.buyAvg) : '']);
  rows.push(['Sell Avg (PHP)', s.sellAvg ? num(s.sellAvg) : '']);
  rows.push(['Gross Profit (PHP)', num(s.grossProfit)]);
  rows.push(['InstaPay Fees (PHP)', num(s.fees)]);
  rows.push(['Net Profit (PHP)', num(s.netProfit)]);
  rows.push(['ENDING PHP BALANCE', num(s.endingPhp)]);
  if (!fs.existsSync(LEDGER_DIR)) fs.mkdirSync(LEDGER_DIR, { recursive: true });
  const safe = ('Coinmate ' + date).replace(/[^a-zA-Z0-9 _-]/g, '_') + '.xlsx';
  fs.writeFileSync(path.join(LEDGER_DIR, safe), buildXlsx(rows));
  return safe;
}

const server = http.createServer(async (req, res) => {
  // permissive headers so the browser is happy talking to this local server
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const url = req.url.split('?')[0];

  if (url === '/p2p') {
    try {
      // FX is optional — a forex hiccup must not break the OKX data, so swallow its error
      const [sell, buy, usd] = await Promise.all([
        fetchSide('sell'), fetchSide('buy'), fetchUsdPhp().catch(() => null)
      ]);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, fiat: FIAT, ts: Date.now(), sell, buy, usd }));
    } catch (e) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    }
    return;
  }

  if (url === '/account') {
    res.setHeader('Content-Type', 'application/json');
    OKX_KEYS = loadOkxKeys();   // re-read each call so editing okx-keys.json needs no restart
    if (!OKX_KEYS) { return res.end(JSON.stringify({ ok: false, error: 'no okx-keys.json found next to the helper' })); }
    try {
      // funding = where P2P money sits; trading = the spot/trading account
      const [funding, trading] = await Promise.all([
        okxGet('/api/v5/asset/balances'),
        okxGet('/api/v5/account/balance')
      ]);
      res.end(JSON.stringify({ ok: true, funding, trading }));
    } catch (e) {
      res.statusCode = 502;
      res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    }
    return;
  }

  if (url === '/orders') {
    res.setHeader('Content-Type', 'application/json');
    OKX_KEYS = loadOkxKeys();
    if (!OKX_KEYS) { return res.end(JSON.stringify({ ok: false, error: 'no okx-keys.json found' })); }
    try {
      // recent completed P2P orders — exact rate/fiat/counterparty. A few pages covers the 30s poll.
      const orders = await fetchP2pCompleted(3, 0);
      orders.sort((a, b) => b.ts - a.ts);                  // newest first
      res.end(JSON.stringify({ ok: true, orders }));
    } catch (e) {
      res.statusCode = 502;
      res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    }
    return;
  }

  if (url === '/scan') {
    res.setHeader('Content-Type', 'application/json');
    OKX_KEYS = loadOkxKeys();
    if (!OKX_KEYS) { return res.end(JSON.stringify({ ok: false, error: 'no okx-keys.json found' })); }
    const qs = (req.url.split('?')[1] || '');
    const params = {};
    qs.split('&').forEach(kv => { const i = kv.indexOf('='); if (i > 0) params[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    const from = Number(params.from) || 0, to = Number(params.to) || Date.now();
    try {
      // page the P2P list until safely past the window start (48h buffer covers orders opened
      // long before they complete — slow payers / disputes), keeping completions inside [from, to]
      const all = await fetchP2pCompleted(30, from - 48 * 3600 * 1000, from);
      const orders = all.filter(o => o.ts >= from && o.ts <= to).sort((a, b) => a.ts - b.ts);
      res.end(JSON.stringify({ ok: true, orders, scanned: all.length, truncated: !!all._truncated, from, to }));
    } catch (e) {
      res.statusCode = 502;
      res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    }
    return;
  }

  if (url === '/movements') {
    res.setHeader('Content-Type', 'application/json');
    OKX_KEYS = loadOkxKeys();
    if (!OKX_KEYS) { return res.end(JSON.stringify({ ok: false, error: 'no okx-keys.json found' })); }
    try {
      const [dep, wd] = await Promise.all([
        okxGet('/api/v5/asset/deposit-history?ccy=USDT&limit=20'),
        okxGet('/api/v5/asset/withdrawal-history?ccy=USDT&limit=20')
      ]);
      const movements = [];
      if (dep.code === '0') (dep.data || []).forEach(d => movements.push({ id: 'D' + d.depId, kind: 'deposit', amt: parseFloat(d.amt), ts: Number(d.ts), state: d.state }));
      if (wd.code === '0') (wd.data || []).forEach(w => movements.push({ id: 'W' + w.wdId, kind: 'withdrawal', amt: parseFloat(w.amt), ts: Number(w.ts), state: w.state }));
      movements.sort((a, b) => b.ts - a.ts);
      res.end(JSON.stringify({ ok: true, movements }));
    } catch (e) {
      res.statusCode = 502;
      res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    }
    return;
  }

  if (url === '/ledger-balance') {
    // the previous day's ENDING PHP balance, carried into the new day at 5am
    res.setHeader('Content-Type', 'application/json');
    try {
      const L = loadLedger();
      const dates = Object.keys(L.summaries).sort();
      const last = dates.length ? L.summaries[dates[dates.length - 1]] : null;
      res.end(JSON.stringify({ ok: true, endingPhp: last ? last.endingPhp : null, date: last ? last.date : null }));
    } catch (e) { res.end(JSON.stringify({ ok: true, endingPhp: null })); }
    return;
  }

  if (url === '/ledger-day' && req.method === 'POST') {
    // record/refresh one trading day: append its transactions (deduped by order id) and replace its
    // summary row (Today + Profit + ending PHP balance). Idempotent — safe to call repeatedly.
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const p = JSON.parse(body || '{}');
        const L = loadLedger();
        (p.transactions || []).forEach(o => { if (o && o.orderId) L.orders[o.orderId] = o; });   // dedupe by id
        if (p.summary && p.summary.date) L.summaries[p.summary.date] = p.summary;                 // one row per date
        writeLedger(L);
        let xlsx = ''; try { xlsx = writeDayXlsx(p); } catch (e) { /* xlsx is a bonus — never fail the write */ }
        res.end(JSON.stringify({ ok: true, dir: LEDGER_DIR, file: xlsx, days: Object.keys(L.summaries).length, orders: Object.keys(L.orders).length }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
      }
    });
    return;
  }

  if (url === '/export' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      try {
        const { filename, csv } = JSON.parse(body || '{}');
        const dir = path.join(__dirname, 'Ledger');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        const safe = String(filename || 'ledger.csv').replace(/[^a-zA-Z0-9._-]/g, '_');
        const fp = path.join(dir, safe);
        fs.writeFileSync(fp, '﻿' + String(csv || ''));   // BOM so Excel reads UTF-8 (₱) correctly
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, path: fp }));
      } catch (e) {
        res.statusCode = 400; res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
      }
    });
    return;
  }

  if (url === '/' || url === '/coinmate_advisor_bot.html') {
    // serve the app itself, so app + data share one origin (no browser blocking)
    fs.readFile(APP_FILE, (err, buf) => {
      if (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Could not find coinmate_advisor_bot.html next to the helper.');
      } else {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(buf);
      }
    });
    return;
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Not found. Open http://127.0.0.1:' + PORT + '/');
});

// 0.0.0.0 = also reachable from other office computers (team mode).
// Windows may ask to "Allow access" the first time — click Allow (Private networks).
server.listen(PORT, '0.0.0.0', () => {
  const ip = lanIP();
  console.log('=================================================');
  console.log('  Coinmate OKX Helper is RUNNING');
  console.log('  Market : ' + BASE + ' / ' + FIAT);
  console.log('');
  console.log('  This computer:   http://127.0.0.1:' + PORT + '/');
  if (ip) {
    console.log('  Teammates open:  http://' + ip + ':' + PORT + '/');
    console.log('  (share that address with the team on the same office Wi-Fi)');
  } else {
    console.log('  (no office network detected — teammates cannot connect yet)');
  }
  console.log('');
  console.log('  >> Leave this window OPEN while you use the app.');
  console.log('  >> Close it (or press Ctrl+C) when you are done.');
  console.log('=================================================');
});
