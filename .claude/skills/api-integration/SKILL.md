---
name: api-integration
description: >
  Integrate a third-party REST API (crypto exchanges like OKX/Binance, banking,
  brokerage, or any signed/authenticated HTTP API) into a local-helper-bridged
  browser app. Use when wiring an exchange/financial API key into an app, doing
  HMAC request signing, handling CORS/network blocks, securely storing API
  secrets, reading balances / transaction history, or deciding what a given API
  tier can and cannot do before building a feature.
---

# API Integration (local-helper pattern)

Hard-won patterns for bolting an authenticated third-party API onto a browser
app **without** leaking secrets or fighting the browser. Built from an OKX v5
integration but the shape is general.

## Architecture: a tiny local helper, not direct browser calls

Browsers block a web page from calling most exchange APIs directly (CORS,
mixed content, private-network rules). Don't fight it — run a small **Node
helper** on the user's machine that the page talks to over `http://127.0.0.1`:

```
browser app  ──>  local Node helper (127.0.0.1:PORT)  ──>  exchange API
```

- The helper holds the API keys and does the signing. The browser never sees them.
- Serve the HTML **from the helper** (`GET /`) so app + data share one origin → no CORS.
- For team/LAN use, bind `0.0.0.0` (not just `127.0.0.1`) and print the LAN IP;
  expect Windows Firewall prompts and **office-WiFi client isolation** (devices
  can't reach each other) — if isolation is on, the only fixes are a VPS host or
  each user running their own helper.

## Authenticated requests: HMAC signing

Most exchange APIs sign each request. OKX v5 example (Node):

```js
const ts = new Date().toISOString();
const prehash = ts + 'GET' + requestPath;            // include the FULL path + querystring
const sign = crypto.createHmac('sha256', secretKey).update(prehash).digest('base64');
// headers: OK-ACCESS-KEY, OK-ACCESS-SIGN=sign, OK-ACCESS-TIMESTAMP=ts, OK-ACCESS-PASSPHRASE
```

- The **passphrase** is required and separate from the API key/secret — ask for it explicitly.
- WebSocket private channels sign `GET` + `/users/self/verify` (timestamp in epoch seconds).
- Sign the request path **with** its query string, or you get signature errors.

## Secrets: never in the browser, never in the bundle

- Keep keys in a **local-only file** next to the helper (e.g. `okx-keys.json`),
  loaded by the helper at runtime. Provide a `*.example.json` template.
- **Exclude** the real keys file from any distributable zip/repo. Ship the example only.
- Use **Read-only** keys whenever possible; never enable **Withdraw** (a leaked
  read key exposes data; a leaked withdraw key drains funds). Set a **Trusted IP**.
- Never echo a secret into chat, logs, or a file the user can paste publicly. If a
  secret is exposed, tell the user to **rotate it immediately**.
- Treat "broader permissions" requests skeptically: more scope = more risk, and
  often unlocks nothing the app actually needs (e.g. exchange "Trade" perms don't
  grant P2P/merchant endpoints).

## Network resilience

- Some ISPs **TLS-intercept** specific hosts (seen: a PH telco serving its own
  cert for `okx.com`). Detect via the cert/altname error and handle it:
  - Route **public** GET data through a read-only relay on a non-blocked domain
    (e.g. `r.jina.ai/<url>`, unwrap its JSON envelope). Relays **cannot** carry
    signed/auth requests — those need a clean connection (VPN / different network / VPS).
- Wrap calls in **retry** (e.g. 5 tries, ~700ms apart) for intermittent blocks.
- Make optional data **fail-soft**: one feed hiccup must not break the rest.
  `Promise.all([core, optional.catch(()=>null)])`.

## Before promising a feature: probe what the tier actually exposes

Don't assume an endpoint exists — and don't assume a *missing* one stays missing.
Sign a quick probe, dump full records, and check the HTTP code:

- `404` = endpoint not on this key/tier. But probe **widely**: many guessed paths 404
  while the *real* one works. For OKX, `c2c/orders`, `p2p/orders`, `fiat/orders` all 404,
  yet **`/api/v5/p2p/order/list` returns the full order** (exact `unitPrice`, `fiatAmount`,
  `cryptoAmount`, `side`, `counterpartyDetail.realName`, `makerPaymentMethod`, `orderId`,
  `orderStatus`). Try singular/plural and `…/list`, `…/details`, `…/history` variants.
- **Watch the success-code type.** OKX returns `code: 0` (number); a probe that flagged
  `code === '0'` (string) silently skipped a working endpoint returning 20 records. Compare
  loosely (`String(code) === '0'`) or you'll declare a goldmine endpoint "inaccessible."
- Pagination is often non-obvious: this list ignored `limit`/`after`/`before` and paged only
  via **`pageIndex`** (1-based, 20/page), and **mixed `new`+`completed`** in one feed — so you
  must filter by `orderStatus`. Empirically test pagination params before building a scanner.
- Dump a sample record's `Object.keys()` to see real field names/shapes before coding.
- Funding **bills** (`asset/bills`) give amount + timestamp but **no price / fiat / counterparty
  / order-id** — but that doesn't mean the data is unavailable; it may live in a *different*
  endpoint (here, the P2P order list). Exhaust the API surface before resorting to heuristics.

## When the data you need isn't in the API

**First make sure it really isn't.** We spent effort deriving each P2P order's rate from
an ad-quantity-drop heuristic (watch the user's ad available-qty; a drop = an order opened
at the ad's current price; match to a later bill by amount) — clever, but it produced only
estimates, and the user could *tell* the numbers were slightly off. The real fix was finding
`p2p/order/list`, which had the **exact** rate/fiat/counterparty all along. Lesson: when a
user insists "the numbers are wrong, the data must be there," **re-probe the API exhaustively
before trusting a heuristic.** A heuristic that's 98% right still erodes trust on money.

If the data genuinely isn't exposed, then derive it — but:
- Make inferences **provisional**: only confirm on an authoritative event (a settled bill),
  so user actions (editing/cancelling an ad) don't masquerade as real activity. Expire them.
- Offer manual fallbacks: paste-import (parse the copied order list) and click-to-edit, and
  let a manual override **win over** any inferred value and persist.
- Once the authoritative source is found, keep the override layer but make the API value the
  source of truth; the old heuristic/flagging scaffolding can be retired.

## Checklist

- [ ] Helper holds keys + signs; browser never sees secrets
- [ ] Serve the app from the helper (same origin)
- [ ] Keys in a local-only file; example template shipped; real file gitignored/zip-excluded
- [ ] Read-only key + Trusted IP; Withdraw OFF
- [ ] Retry + fail-soft; relay only for public GETs
- [ ] Probe endpoints and dump field shapes before building
- [ ] Derive missing data carefully + provisionally, with manual fallbacks
