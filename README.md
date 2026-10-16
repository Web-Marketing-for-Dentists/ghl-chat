# ghl-chat

One hosted script that puts the GoHighLevel chat widget on any WM4D site, with the agency's
custom behaviour built in. Sites add one tag; fixes ship from here to every site at once.

Deployed as a Cloudflare Worker serving static files only (`public/`), so there is no Worker
code to run, bill or break.

## Add it to a site

```html
<script defer src="https://<host>/v1.js"
  data-ghl-widget-id="YOUR_WIDGET_ID"
  data-auto-open="true"
  data-hide-bubble-below="1000"></script>
```

Put it last in `<body>`. In Astro, mark it `is:inline` so Astro leaves it alone.

| Attribute | Default | Meaning |
|---|---|---|
| `data-ghl-widget-id` | required | GHL → Sites → Chat Widget → Get Code → the `data-widget-id` value. |
| `data-auto-open` | `true` | `true`, `false`, or `desktop` (only at/above the `data-hide-bubble-below` width, else 1000px). Opens once per browser session. |
| `data-auto-open-delay` | `3000` | Milliseconds before the auto-open. |
| `data-hide-bubble-below` | never | Viewport width (px) below which GHL's floating bubble is hidden. Set it to the breakpoint where the site's sticky bar shows, when that bar has a Chat button. |

### Hooks a site can use

- **Chat button:** any element with `data-chat-open` opens the chat. Works for elements rendered later by React islands.
- **Open state:** while the chat window is open, `<html>` carries `data-chat="open"`. Use it to hide a sticky bar the chat window would cover:
  ```css
  html[data-chat="open"] .action-bar { display: none; }
  ```
- **Events:** `ghl-chat:open` and `ghl-chat:close` fire on `document`, e.g. for a GA4 event.
- **API:** `window.wm4dGhlChat.open()`.

### What it does behind the scenes

1. Appends the landing URL (with gclid / UTMs) to the visitor's first chat message: `Hi [PAGE_URL:https://…]`, once per session.
2. Loads GHL's loader (`beta.leadconnectorhq.com`, set in one place at the top of `v1.js`).
3. Auto-opens via `window.leadConnector.chatWidget.openWidget()`, tracks open state from `data-active` on `<chat-widget>`, and hides the bubble by injecting a style into the widget's shadow DOM.

Steps 1 and 3 depend on GHL internals that are **not documented** and can change without
notice: the `/live-chat/messages` request body, `window.leadConnector.chatWidget.openWidget()`,
the `data-active` attribute on `<chat-widget>`, and the `#lc_text-widget--btn` bubble ID (plus the
`#lc_text-widget` class names used as a fallback). If chat stops auto-opening, the bubble reappears on phones, or
leads stop showing `[PAGE_URL:…]`, check those first.

## Change it safely

- `v1.js` only receives **backward-compatible** fixes. Renaming an attribute, the `data-chat`
  hook or an event is a breaking change: copy to `v2.js` and move sites over one by one.
- Every deploy reaches every site within about five minutes (`Cache-Control: max-age=300` in
  `public/_headers`). Test before deploying:
  1. `pnpm dev` and open `http://localhost:8787/?widget=<a real widget ID>`.
  2. Check: the chat loads, auto-opens once, the bar's Chat button opens it, the bar hides while
     it is open, and the first message you send arrives in GHL with `[PAGE_URL:…]`.
  3. Repeat at phone width.
- `pnpm deploy` publishes.
