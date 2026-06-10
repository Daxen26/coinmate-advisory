# Coinmate Advisor — Roadmap / Checklist

_Status legend: ✅ done · 🔜 in progress · ⏳ todo · 👤 needs you (OKX side) · 🔒 needs Merchant tier_

## Foundation
- [ ] 🔴👤 **#1 Reliable OKX access** — run a VPN on the host PC, or host the helper on a small cloud VPS so the DITO block stops interrupting live data.

## Money accuracy (read-only key is enough)
- [x] ✅ **#2 Deposits & withdrawals visibility** — surfaced in the activity log. (Note: circulating capital already auto-reflects them via the live wallet, so this is visibility, not a capital fix.)
- [x] ✅ **#3 "Set start of day" control** — explicit baseline button so you control the tracking reference point. (Kept re-baseline-on-Start per your "track from Start" rule; no risky retro-apply of old orders.)
- [x] ✅ **#4 Daily summary / P&L card** — "Today" card: USDT bought/sold, net position, order count, est. ₱ fees.
- [x] ✅ **Manual off-P2P entries** — "+ manual" button on Today: log direct sales/buys (USDT × price → PHP adjust), counted in today's totals, persisted.
- [x] ✅ **Auto rate capture (ad-quantity drop)** — when a client opens an order, your ad's available qty drops; the app PROVISIONALLY records (amount, ad price = real rate). It only becomes a real order when a matching funding bill completes (so manually editing/cancelling your own ad never logs a phantom order; stale captures expire in 2h). Works both buy & sell. Falls back to current price; manual edit + paste-import remain as backups.
- [x] ✅ **Per-order rate + live average cost** — each order shows its rate; wallet shows a LIVE weighted-average buy price from the recent orders feed (+ manual buys).
- [x] ✅ **Profit card (today)** — clean running net = money made on sells − ALL of today's InstaPay (auto-deducted, no line item). Every buy dips it by its InstaPay; sells add the spread. Net of fees, easy to read.
- [x] ✅ **#5 Exact OKX-side fee** — verified: type-117 P2P bills carry NO fee (balChg is the exact net USDT). Nothing to add; capital math already exact on the OKX leg.

## Real-time
- [x] ✅ **#7 (reframed)** — WebSocket NOT viable: OKX only streams the *Trading* account; your P2P money is in *Funding*, which has no WS channel. Instead: polling tightened 60s → **30s** + a **"↻ now"** manual-refresh button. That's the real "more real-time" available.

## Advisor & competitor UX
- [x] ✅ **#8 Collapse duplicate merchants** in the watchlist (each merchant's best ad only).
- [x] ✅ **#9 Filter competitors by order-limit overlap** — "Only competitors matching my order limits" toggle in Rules; applies to both the target pick and the watchlist.
- [x] ✅ **#10 Competitor available quantity** shown in the watchlist meta line.
- [x] ✅ **#11 Rate source = live OKX USDT/PHP market mid** (per your call — conversion + rate strip now use the P2P book mid, not Yahoo forex; USD forex kept only as the "vs USD" premium).
- [x] ✅ **#12 Margin-strip colors tied to your Floor rule** ("Below floor" / "Thin" / "Profitable").

## Ledger & day control
- [x] ✅ **"Start of day" clears the day** — sets a day boundary; recent orders, Today, and Profit reset from that point (default = midnight).
- [x] ✅ **Ledger export** — "⤓ export" on Today writes the day's orders to a **Ledger/** folder as CSV (Date, Time, Type, USDT, Rate, Total ₱, Counterparty, Order/Ref ID). Opens in Excel. Counterparty + OKX order ID come from paste-import.

## Deployment & security
- [ ] 🔴👤 **#13 Rotate the API key** to a fresh one with a Trusted IP whitelist (the old one was shared in chat). Drop it into `okx-keys.json`.
- [x] ✅ **#14 Re-zip the team package** with the latest build.

## Gated behind P2P Merchant API (Diamond/Super tier)
- [ ] 🔒 Active/pending orders feed
- [ ] 🔒 Auto-reprice ads from the advisor
- [ ] 🔒 Exact PHP amount per order
- [ ] 🔒 PDAX live PHP balance (separate — needs PDAX API)
