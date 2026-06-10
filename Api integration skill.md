---
name: api-integration
description: Build and debug the API/data layer for browser-based HTML trading tools (the Coinmate monitor and advisor bot) that pull external price data (e.g. OKX P2P) through a Cloudflare Worker proxy. Use this skill WHENEVER the task involves fetching external API data from a front-end, CORS errors, a Cloudflare Worker / data pipe, rate limiting, caching price data, parsing JSON responses, handling API errors gracefully in the UI, or keeping API keys out of front-end code. Always prioritize reliability, safe failure, and the advisory-only rule.
---

# API Integration (Coinmate tools)

How to build the data layer for the browser-based HTML tools reliably. The user is not a strong coder, so favor clear, well-commented code and fail-safe defaults over clever tricks.

## Architecture rule (the most important one)

The browser HTML tools must NOT call external APIs (like OKX) directly. Browsers block cross-origin calls (CORS), and direct calls also leak any keys. **All external data goes through the Cloudflare Worker proxy.**

```
HTML tool (browser)  →  Cloudflare Worker (proxy)  →  External API (OKX P2P)
```

The Worker is the single data pipe shared by both the monitor and the advisor bot.

## Cloudflare Worker rules

When writing or editing the Worker:
- **Add CORS headers** to every response so the browser tools can read it:
  `Access-Control-Allow-Origin` (the tool's origin, or `*` only if the data isn't sensitive), and handle `OPTIONS` preflight requests.
- **Cache responses** for a short window (e.g. 5–15 seconds for price data) so refreshing the tools doesn't hammer the upstream API and trip rate limits. Use the Cache API or a simple in-memory/`caches.default` cache.
- **Keep all secrets in the Worker**, never in the HTML. If an endpoint needs a key, store it as a Worker environment variable/secret. Front-end code is fully visible to anyone, so a key there is a leaked key.
- **Normalize errors**: if the upstream API fails, return a clean JSON error with a status code, not a raw crash, so the front-end can handle it.

## Front-end fetch rules

When writing fetch logic in the HTML tools:
- Always `fetch()` the Worker URL, never the external API directly.
- Wrap every fetch in try/catch. On failure, the UI must show a clear state like "Data unavailable — last updated HH:MM" and keep the last good value, never go blank or freeze.
- Parse JSON defensively: check the response is OK and the expected fields exist before using them. Bad/partial data should not break the page.
- Throttle auto-refresh sensibly (match or exceed the Worker cache window). Don't refresh faster than the data actually changes.
- Show a visible "last updated" timestamp so the user can trust freshness at a glance.

## Rate limits & reliability
- Respect the upstream API's published rate limits; the Worker cache is the main defense.
- Add a small retry with backoff for transient network errors (e.g. retry once after 1–2s), but do not retry in a tight loop.
- Log/handle the case where the upstream returns an unexpected shape (API changed) — fail safe, surface a clear message.

## The advisory-only rule (non-negotiable)
These tools **recommend** price adjustments; they never execute changes on OKX. A human worker always makes the actual price change. Never add code that places, edits, or cancels orders, or that automates trading actions. If asked to, flag it and keep the tool advisory-only.

## Output expectations
When building or fixing the data layer, explain in plain language what each piece does and why, so the user (a non-coder) can follow it. Prefer readable code with comments over compact code. After changes, state clearly how to test that data is flowing (e.g. open the tool, confirm the timestamp updates, confirm a forced error shows the fallback state).
