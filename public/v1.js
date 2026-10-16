/*! WM4D GHL chat loader v1 — https://github.com/Web-Marketing-for-Dentists/ghl-chat */
/*
  One tag per site:

    <script defer src="https://<host>/v1.js"
      data-ghl-widget-id="YOUR_WIDGET_ID"
      data-auto-open="true"
      data-hide-bubble-below="1000"></script>

  Attributes (all optional except the widget ID):
    data-ghl-widget-id     GHL chat widget ID (Sites → Chat Widget → Get Code → data-widget-id).
    data-auto-open         "true" (default), "false", or "desktop" (only at/above the
                           data-hide-bubble-below width, or 1000px when that is unset).
    data-auto-open-delay   Milliseconds before the auto-open, default 3000.
    data-hide-bubble-below Viewport width in px below which GHL's floating bubble is hidden,
                           for sites whose own sticky bar carries a Chat button. Default: never.

  What it does:
    1. Appends the landing page URL to the visitor's first chat message: " [PAGE_URL:...]".
    2. Loads the GHL widget.
    3. Opens the chat once per browser session, after the delay.
    4. Any element with a data-chat-open attribute opens the chat when clicked.
    5. While the chat window is open, <html> carries data-chat="open" so a site can tuck its
       sticky bar away, and "ghl-chat:open" / "ghl-chat:close" events fire on document.
    6. Exposes window.wm4dGhlChat.open() for anything else that needs it.

  Versioning: v1.js only receives backward-compatible fixes. Anything that changes a site's
  markup contract (attribute names, the data-chat attribute, event names) ships as v2.js.
*/
(function () {
  "use strict";

  if (window.wm4dGhlChat) return; // Included twice: the first copy wins.

  /* GHL's own loader. Change these here and every site picks it up within the cache window. */
  var GHL_LOADER = "https://beta.leadconnectorhq.com/loader.js";
  var GHL_RESOURCES = "https://beta.leadconnectorhq.com/chat-widget/loader.js";

  var self = document.currentScript || document.querySelector("script[data-ghl-widget-id]");
  if (!self) return;

  var widgetId = (self.getAttribute("data-ghl-widget-id") || "").trim();
  if (!widgetId) {
    if (window.console) console.warn("[ghl-chat] data-ghl-widget-id is missing; chat not loaded.");
    return;
  }

  var autoOpen = (self.getAttribute("data-auto-open") || "true").toLowerCase();
  var delay = parseInt(self.getAttribute("data-auto-open-delay"), 10);
  if (!(delay >= 0)) delay = 3000;
  var hideBelow = parseInt(self.getAttribute("data-hide-bubble-below"), 10) || 0;

  var root = document.documentElement;

  /* sessionStorage throws in some privacy modes. Treat that as "nothing stored". */
  function get(key) {
    try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
  }
  function set(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch (e) {}
  }

  function widget() {
    return window.leadConnector && window.leadConnector.chatWidget;
  }

  /* Polls every half second until the widget API exists, then runs fn. GHL may hold the widget
     until the visitor first scrolls or taps (its "interaction" load strategy, with an 8s
     fallback), so callers allow well beyond that. */
  function whenReady(fn, tries) {
    var w = widget();
    if (w) return fn(w);
    if (tries > 0) window.setTimeout(function () { whenReady(fn, tries - 1); }, 500);
  }

  function open() {
    whenReady(function (w) { w.openWidget(); }, 30);
  }

  window.wm4dGhlChat = { open: open, version: "1" };

  /* 1. Landing-URL tag on the first message ---------------------------------------------- */
  if (!get("landing_url")) set("landing_url", window.location.href);

  if (!get("url_tracked") && typeof window.fetch === "function") {
    var pageUrl = get("landing_url") || window.location.href;
    var sent = false;
    var originalFetch = window.fetch;

    window.fetch = function (input, init) {
      var url =
        typeof input === "string" ? input :
        input && typeof input.href === "string" ? input.href : "";
      if (!sent && url.indexOf("/live-chat/messages") !== -1 && init && typeof init.body === "string") {
        try {
          var body = JSON.parse(init.body);
          if (body && typeof body.message === "string" && body.message) {
            sent = true;
            set("url_tracked", "1");
            body.message = body.message + " [PAGE_URL:" + pageUrl + "]";
            init = Object.assign({}, init, { body: JSON.stringify(body) });
          }
        } catch (e) {}
      }
      return originalFetch.call(window, input, init);
    };
  }

  /* 2. Load GHL's loader. It reads its settings from its own <script> attributes and mounts
        <chat-widget> into <body> when the tag sits in <head>. */
  var loader = document.createElement("script");
  loader.src = GHL_LOADER;
  loader.setAttribute("data-resources-url", GHL_RESOURCES);
  loader.setAttribute("data-widget-id", widgetId);
  document.head.appendChild(loader);

  /* 3. Auto-open once per browser session. */
  var wide = window.matchMedia("(min-width: " + (hideBelow || 1000) + "px)");
  var shouldAutoOpen = autoOpen === "true" || (autoOpen === "desktop" && wide.matches);
  if (shouldAutoOpen && !get("ghl_chat_opened")) {
    window.setTimeout(function () {
      whenReady(function (w) {
        w.openWidget();
        set("ghl_chat_opened", "1");
      }, 40);
    }, delay);
  }

  /* 4. data-chat-open buttons, including ones a framework renders later. */
  document.addEventListener("click", function (event) {
    var target = event.target;
    var trigger = target && target.closest ? target.closest("[data-chat-open]") : null;
    if (!trigger) return;
    event.preventDefault();
    open();
  });

  /* 5. Watch the widget's shadow DOM: hide the bubble below the breakpoint, and mirror the
        chat window's open state onto <html data-chat="open">. */
  var isOpen = false;

  function attach() {
    var host = document.querySelector("chat-widget");
    var shadow = host && host.shadowRoot;
    if (!shadow) return false;

    if (hideBelow && !shadow.querySelector("#wm4d-hide-bubble")) {
      var style = document.createElement("style");
      style.id = "wm4d-hide-bubble";
      style.textContent =
        "@media (max-width: " + (hideBelow - 0.02) + "px) {" +
        " #lc_text-widget--btn { display: none !important; visibility: hidden !important; } }";
      shadow.appendChild(style);
    }

    var panel = shadow.querySelector("#lc_text-widget");
    if (!panel) return false;

    /* GHL flips data-active on <chat-widget> the moment the window opens or closes; the panel's
       classes only follow once the close animation ends (about a second later). Prefer the
       attribute, and fall back to the classes if a GHL release ever drops it. */
    function sync() {
      var active = host.getAttribute("data-active");
      var now = active !== null
        ? active === "true"
        : panel.classList.contains("lc_text-widget--active") &&
          !panel.classList.contains("lc_text-widget--minimized");
      if (now === isOpen) return;
      isOpen = now;
      if (now) root.setAttribute("data-chat", "open");
      else root.removeAttribute("data-chat");
      document.dispatchEvent(new CustomEvent(now ? "ghl-chat:open" : "ghl-chat:close"));
    }
    new MutationObserver(sync).observe(host, { attributes: true, attributeFilter: ["data-active"] });
    new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ["class"] });
    sync();
    return true;
  }

  var attempts = 0;
  var timer = window.setInterval(function () {
    attempts++;
    if (attach() || attempts > 60) window.clearInterval(timer);
  }, 500);
})();
