---
name: frontend-design
description: Design and improve the look and usability of the browser-based HTML trading tools (the Coinmate P2P monitor and advisor bot). Use this skill WHENEVER the task involves the UI, layout, styling, colors, fonts, readability, how numbers/prices are displayed, dashboard design, loading/empty/error states, or making a tool look cleaner and more professional. These are functional dashboards watched for hours — clarity and trust beat decoration.
---

# Frontend Design (Coinmate tools)

These tools are working dashboards a trader stares at for long stretches and makes money decisions from. The goal is a calm, clear, trustworthy interface — not a flashy marketing page. Favor readability and consistency over decoration. The user is not a strong coder, so write clean, commented CSS and explain choices in plain language.

## Layout
- Put the most important thing first: the number or recommendation the user is actually watching goes top and biggest. Secondary data sits below or to the side.
- Group related information into clear blocks with consistent spacing. White space is not wasted space; it makes a dense screen readable.
- Keep the layout stable. Numbers update often — the page must not jump, reflow, or shift position when data refreshes.
- Responsive down to mobile, since the user may check on a phone.

## Numbers (this is the core of a trading tool)
- Use a monospaced / tabular-figure font for all prices and figures so digits line up in columns and don't wiggle as values change.
- Format consistently every time: thousands separators, a fixed number of decimals, and the currency or unit shown (e.g. ₱61.75, not 61.75). Pick the format once and apply it everywhere.
- Always show a visible "last updated HH:MM:SS" timestamp so the user can trust how fresh the data is at a glance.

## Color
- A dark theme is fine and easier on the eyes for long sessions. Keep contrast high enough to read comfortably.
- Use color to mean something: e.g. up/down or buy/sell. Never rely on color alone — pair it with an arrow, a + / - sign, or a word, so it's clear even to someone who is color-blind or glancing fast.
- Keep accent colors minimal. One or two purposeful accents; resist decorating.

## States — never show a blank or frozen screen
- Loading: show a clear "Loading…" state, not an empty box.
- Stale / unavailable: if data fails, keep the last good value visible and clearly mark it "Data unavailable — last good HH:MM". Never wipe the screen.
- Errors: explain in plain words what happened and what to do, in the tool's own calm voice. No raw error codes, no apologies, no vagueness.
- Empty: an empty table or list should say what it's waiting for, not just sit blank.

## Typography & motion
- One clean, readable font family for the interface; the tabular font for numbers. Set a clear size hierarchy (big = important).
- Use sentence case and plain labels. Name things by what the user controls ("Refresh prices", "Recommended price"), not by how the code works.
- Go very light on animation. A trader needs steady information, not movement. A subtle fade on update is fine; flashing, sliding, or bouncing is distracting and erodes trust.

## The advisor bot specifically
- Present recommendations clearly as *suggestions*, with the reasoning visible (what competitor prices it saw, why it suggests this number). The human decides and acts.
- Make the recommended action obvious and the reasoning one glance away — but never style it as an automatic action or a button that changes prices on OKX. These tools advise; humans execute.

## Quality floor (always)
- Readable contrast, visible keyboard focus, works on mobile, respects reduced-motion settings.
- Consistent vocabulary: the same thing is called the same name everywhere.
- After changes, describe in plain language what changed and why, so the user can judge it without reading code.
