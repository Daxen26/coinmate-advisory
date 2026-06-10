/*
 * Coinmate cloud data-pipe Worker
 * --------------------------------
 * Same job as okx-helper.js, but runs on Cloudflare instead of your PC.
 * Serves the app (static asset) AND the signed OKX endpoints the app calls,
 * all on ONE origin (so no CORS headaches). OKX keys live in encrypted Worker
 * secrets (OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE) — never in the page.
 * The daily ledger is stored in KV (binding: LEDGER).
 */
const OKX = 'https://www.okx.com';
const FIAT = 'PHP', BASE = 'USDT';
const API = ['/p2p', '/account', '/orders', '/scan', '/movements', '/ledger-day', '/ledger-balance', '/ledger-file'];

// ---- OKX v5 signing (Web Crypto) ----------------------------------------------------------------
const enc = new TextEncoder();
async function sign(secret, ts, method, reqPath) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(ts + method + reqPath));
  let bin = ''; const b = new Uint8Array(sig); for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin);
}
async function okxGet(env, reqPath, tries) {
  tries = tries || 3; let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const ts = new Date().toISOString();
      const s = await sign(env.OKX_SECRET_KEY, ts, 'GET', reqPath);
      const r = await fetch(OKX + reqPath, { headers: {
        'OK-ACCESS-KEY': env.OKX_API_KEY, 'OK-ACCESS-SIGN': s, 'OK-ACCESS-TIMESTAMP': ts,
        'OK-ACCESS-PASSPHRASE': env.OKX_PASSPHRASE, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'
      } });
      return await r.json();
    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 500)); }
  }
  throw lastErr;
}
function needKeys(env) { return !env.OKX_API_KEY || !env.OKX_SECRET_KEY || !env.OKX_PASSPHRASE; }

// ---- public market data (direct — Cloudflare reaches OKX cleanly, no relay) ----------------------
async function fetchSide(side) {
  const url = OKX + '/v3/c2c/tradingOrders/books?quoteCurrency=' + FIAT + '&baseCurrency=' + BASE.toLowerCase() + '&side=' + side + '&paymentMethod=all&userType=all';
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
  const json = await r.json();
  if (json.code !== 0 && String(json.code) !== '0') throw new Error('OKX code ' + json.code);
  const arr = (side === 'sell') ? json.data.sell : json.data.buy;
  return (arr || []).map(a => ({
    price: parseFloat(a.price), available: parseFloat(a.availableAmount), nick: a.nickName,
    pay: a.paymentMethods || [], rate: parseFloat(a.completedRate || '0'), orders: a.completedOrderQuantity || 0,
    type: a.creatorType || '', min: parseFloat(a.quoteMinAmountPerOrder || '0'), max: parseFloat(a.quoteMaxAmountPerOrder || '0')
  }));
}
async function fetchUsdPhp() {
  const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/USDPHP=X?interval=1d&range=1d', { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
  const m = (await r.json()).chart.result[0].meta;
  return { php: m.regularMarketPrice, prev: m.previousClose, ts: (m.regularMarketTime || 0) * 1000 };
}

// ---- P2P order list (exact rate/fiat/counterparty) -----------------------------------------------
function normP2p(o) {
  const side = String(o.side || '').toLowerCase(), usdt = parseFloat(o.cryptoAmount) || 0, cp = o.counterpartyDetail || {};
  return {
    billId: o.orderId, orderId: o.orderId,
    ts: Number(o.completionTimestamp) || Number(o.createdTimestamp) || 0, side,
    usdt: (side === 'buy' ? 1 : -1) * usdt, php: parseFloat(o.fiatAmount) || 0,
    rate: parseFloat(o.unitPrice) || parseFloat(o.exchangeRate) || 0,
    counterparty: String(cp.realName || cp.nickName || '').trim(), payMethod: o.makerPaymentMethod || '',
    status: String(o.orderStatus || '').toLowerCase()
  };
}
async function fetchP2pCompleted(env, maxPages, stopBeforeTs, windowFrom) {
  const out = []; let truncated = false;
  for (let page = 1; page <= maxPages; page++) {
    const j = await okxGet(env, '/api/v5/p2p/order/list?pageIndex=' + page);
    if (j && String(j.code) !== '0') throw new Error('OKX p2p list page ' + page + ' code ' + j.code + ' ' + (j.msg || ''));
    if (!j || !Array.isArray(j.data) || !j.data.length) break;
    let oldestCreated = Infinity, sawInWindow = false;
    for (const raw of j.data) {
      oldestCreated = Math.min(oldestCreated, Number(raw.createdTimestamp) || Infinity);
      const side = String(raw.side || '').toLowerCase();
      if (String(raw.orderStatus).toLowerCase() === 'completed' && (side === 'buy' || side === 'sell')) {
        const o = normP2p(raw); out.push(o); if (windowFrom && o.ts >= windowFrom) sawInWindow = true;
      }
    }
    if (j.data.length < 20) break;
    if (stopBeforeTs && oldestCreated < stopBeforeTs && !sawInWindow) break;
    if (page === maxPages) { truncated = true; break; }
    await new Promise(r => setTimeout(r, 120));
  }
  out._truncated = truncated; return out;
}

// ---- ledger in KV (binding: LEDGER) --------------------------------------------------------------
async function loadLedger(env) {
  if (!env.LEDGER) return { orders: {}, summaries: {} };
  try { const L = JSON.parse(await env.LEDGER.get('ledger') || '{}'); L.orders = L.orders || {}; L.summaries = L.summaries || {}; return L; }
  catch (e) { return { orders: {}, summaries: {} }; }
}

// ---- minimal .xlsx (Buffer via nodejs_compat) — for on-demand download ---------------------------
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; }
function zipStore(files) {
  const local = [], central = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), data = f.data, crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42); central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  let cdSize = 0; central.forEach(b => cdSize += b.length);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
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
function dayXlsx(L, date) {
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : (v || ''); };
  const orders = Object.values(L.orders).filter(o => o.date === date).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const s = L.summaries[date] || {};
  const rows = [['Coinmate Advisory — Daily Ledger'], ['Date', date], [], ['TRANSACTIONS'],
    ['Time', 'Type', 'USDT', 'Rate (PHP)', 'Total (PHP)', 'Counterparty', 'Payment', 'Order/Ref ID']];
  orders.forEach(o => rows.push([o.time, o.type, num(o.usdt), num(o.rate), num(o.total), o.counterparty, o.payMethod, o.orderId]));
  rows.push([], ['DAY SUMMARY'], ['Orders', num(s.orders)], ['Bought USDT', num(s.boughtUsdt)], ['Sold USDT', num(s.soldUsdt)],
    ['Buy Avg (PHP)', s.buyAvg ? num(s.buyAvg) : ''], ['Sell Avg (PHP)', s.sellAvg ? num(s.sellAvg) : ''],
    ['Gross Profit (PHP)', num(s.grossProfit)], ['InstaPay Fees (PHP)', num(s.fees)], ['Net Profit (PHP)', num(s.netProfit)],
    ['ENDING PHP BALANCE', num(s.endingPhp)]);
  return buildXlsx(rows);
}

// ---- routing -------------------------------------------------------------------------------------
function J(obj, status, origin) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*'
  } });
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    // CORS lock: only this site's own origin (set SITE_ORIGIN after deploy) may call the data pipe.
    const allow = env.SITE_ORIGIN || url.origin;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' } });

    // non-API paths → serve the static app (index.html etc.)
    if (!API.includes(p)) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });

    try {
      if (p === '/p2p') {
        const [sell, buy, usd] = await Promise.all([fetchSide('sell'), fetchSide('buy'), fetchUsdPhp().catch(() => null)]);
        return J({ ok: true, fiat: FIAT, ts: Date.now(), sell, buy, usd }, 200, allow);
      }
      if (needKeys(env)) return J({ ok: false, error: 'OKX keys not set — run: wrangler secret put OKX_API_KEY (and OKX_SECRET_KEY, OKX_PASSPHRASE)' }, 200, allow);

      if (p === '/account') {
        const [funding, trading] = await Promise.all([okxGet(env, '/api/v5/asset/balances'), okxGet(env, '/api/v5/account/balance')]);
        return J({ ok: true, funding, trading }, 200, allow);
      }
      if (p === '/orders') {
        const orders = await fetchP2pCompleted(env, 3, 0); orders.sort((a, b) => b.ts - a.ts);
        return J({ ok: true, orders }, 200, allow);
      }
      if (p === '/scan') {
        const from = Number(url.searchParams.get('from')) || 0, to = Number(url.searchParams.get('to')) || Date.now();
        const all = await fetchP2pCompleted(env, 30, from - 48 * 3600 * 1000, from);
        const orders = all.filter(o => o.ts >= from && o.ts <= to).sort((a, b) => a.ts - b.ts);
        return J({ ok: true, orders, scanned: all.length, truncated: !!all._truncated, from, to }, 200, allow);
      }
      if (p === '/movements') {
        const [dep, wd] = await Promise.all([okxGet(env, '/api/v5/asset/deposit-history?ccy=USDT&limit=20'), okxGet(env, '/api/v5/asset/withdrawal-history?ccy=USDT&limit=20')]);
        const movements = [];
        if (dep && String(dep.code) === '0') (dep.data || []).forEach(d => movements.push({ id: 'D' + d.depId, kind: 'deposit', amt: parseFloat(d.amt), ts: Number(d.ts), state: d.state }));
        if (wd && String(wd.code) === '0') (wd.data || []).forEach(w => movements.push({ id: 'W' + w.wdId, kind: 'withdrawal', amt: parseFloat(w.amt), ts: Number(w.ts), state: w.state }));
        movements.sort((a, b) => b.ts - a.ts);
        return J({ ok: true, movements }, 200, allow);
      }
      if (p === '/ledger-balance') {
        const L = await loadLedger(env); const dates = Object.keys(L.summaries).sort();
        const last = dates.length ? L.summaries[dates[dates.length - 1]] : null;
        return J({ ok: true, endingPhp: last ? last.endingPhp : null, date: last ? last.date : null }, 200, allow);
      }
      if (p === '/ledger-day' && request.method === 'POST') {
        if (!env.LEDGER) return J({ ok: false, error: 'KV not configured' }, 200, allow);
        const body = await request.json(); const L = await loadLedger(env);
        (body.transactions || []).forEach(o => { if (o && o.orderId) L.orders[o.orderId] = o; });
        if (body.summary && body.summary.date) L.summaries[body.summary.date] = body.summary;
        await env.LEDGER.put('ledger', JSON.stringify(L));
        return J({ ok: true, days: Object.keys(L.summaries).length, orders: Object.keys(L.orders).length }, 200, allow);
      }
      if (p === '/ledger-file') {
        const L = await loadLedger(env);
        const date = url.searchParams.get('date') || (Object.keys(L.summaries).sort().pop() || '');
        const buf = dayXlsx(L, date);
        return new Response(buf, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="Coinmate ' + date + '.xlsx"', 'Access-Control-Allow-Origin': allow } });
      }
      return J({ ok: false, error: 'unknown route' }, 404, allow);
    } catch (e) {
      return J({ ok: false, error: String((e && e.message) || e) }, 502, allow);
    }
  }
};
