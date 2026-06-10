# Plan — Connect Coinmate Advisor to OKX live P2P data

_Last updated: 2026-06-05_

## Decisions (chosen by you)
- **Data helper:** runs locally on your computer (a small Node.js program).
- **Your prices:** found automatically by matching your OKX merchant nickname in the live feed.
- **Market:** PHP / USDT (Philippines).
- **Style:** advisory only — the app tells *you* what to change; you change it manually on OKX.

### Competitor filtering (who counts as competition)
- **Payment method:** ONLY merchants whose ad lists the **"Bank Transfer"** option
  (raw value `bank`). Merchants without Bank Transfer (GCash-only, Maya-only, etc.)
  are ignored — they don't compete for your bank-paying customers.
- **Merchant type:** ALL merchants (no badge/tier filter for now).
- **Min competitor USDT:** keep the app's existing rule (ignore tiny ads).
- **Optional, can add later:** skip low completion-rate or very-new merchants.

## How it will work (the big picture)
1. A tiny helper program runs on your PC. Every ~10 seconds it asks OKX's public
   P2P feed for the current PHP/USDT ads (both buy side and sell side).
2. The helper hands that data to your HTML app (this avoids the browser security
   block that stops the app from calling OKX directly).
3. The app:
   - finds **your** ad by your nickname → shows "Your prices"
   - finds the **best competitor** (lowest sell price, highest buy price), skipping
     your own ad and skipping ads below your "Min competitor USDT" rule
   - applies your existing rules (undercut, margin floor) exactly as it does now
   - shows the same buy/sell advice + sound + the "I changed both — confirm" button

The app's brain (rules, signals, safety floor, sounds) stays the same — we're just
swapping the fake simulated market for the real OKX market.

## Build steps
1. **Install Node.js** (one-time, free). I'll give you the exact link + click-by-click.
2. **I write the helper program** (`okx-helper.js`) — fetches OKX, serves it locally.
3. **You start the helper** by double-clicking a `start.bat` file I'll make for you.
4. **I rewire the app** to read from the helper instead of the random simulation,
   including a "Your OKX nickname" box and a live/offline connection indicator.
5. **Test together** with your real ad live on OKX, and tune filters
   (payment methods, merchant type, min orders) to match how you actually trade.

## What I need from you to build it
- Your exact **OKX P2P merchant nickname** (as it appears on your ads).
- Whether the "best competitor" should consider **all** merchants or only certain
  types (e.g. Diamond/Super only) and/or specific payment methods (GCash, Maya…).

## Honest caveats (please read)
- **Unofficial feed:** this is the public feed OKX's own website uses. It works today,
  but OKX could change it without notice. If it ever breaks, the app falls back to
  showing "offline" — it won't give wrong advice. The official P2P API needs
  Super/Diamond Merchant status; we can switch to it later if you qualify.
- **Be polite / ToS:** we poll gently (~10s) and the app is advisory — a human acts.
  OKX discourages bots that auto-target P2P orders; staying advisory keeps you on the
  right side of that. We will not auto-trade.
- **Nickname matching:** if your nickname isn't unique or your ad is filtered out of a
  view, auto-detect may miss it; we'll add a manual price fallback just in case.
- **Reliability:** the helper must be running for live data. When it's off, the app
  clearly shows "offline" rather than stale numbers.
