/*
 * Job Copilot: "Record what I do" (debugging aid, off unless started from the popup).
 *
 * While recording a tab, logs what the user clicks, URL changes, pop-ups/overlays that
 * appear (with their links and buttons), and window.open() calls. Tabs opened/closed
 * by the page are logged by the service worker. Never logs typed values; emails and
 * phone numbers are blanked. The report stays in the browser until the user copies it.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});
  if (JC.recorder) return;
  const isTop = window === window.top;
  let on = false;
  let obs = null;
  let urlTimer = null;
  let lastUrl = location.href;
  const seenOverlays = new WeakSet();

  const redact = (s) =>
    String(s || '')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      .replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[number]' : m));

  function sanitize(html, max) {
    return redact(
      String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<svg[\s\S]*?<\/svg>/gi, '<svg/>')
        .replace(/\s(value|data-value)="[^"]*"/gi, ' $1="…"')
        .replace(/\s+/g, ' ')
    ).slice(0, max || 600);
  }

  function unwrap(u) {
    return JC.unwrapUrl ? JC.unwrapUrl(u) : u;
  }

  function cssPath(el) {
    const parts = [];
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 5; n = n.parentElement, i++) {
      let p = n.tagName.toLowerCase();
      if (n.id) {
        parts.unshift(p + '#' + n.id);
        break;
      }
      const cls = [...n.classList].slice(0, 2).join('.');
      if (cls) p += '.' + cls;
      parts.unshift(p);
    }
    return parts.join(' > ');
  }

  function describe(el, htmlMax) {
    if (!el || el.nodeType !== 1) return null;
    const data = {};
    for (const a of el.attributes) if (a.name.startsWith('data-') && a.name !== 'data-jc-ref') data[a.name] = String(a.value).slice(0, 80);
    const href = el.getAttribute('href');
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').slice(0, 160) || undefined,
      role: el.getAttribute('role') || undefined,
      aria: el.getAttribute('aria-label') || undefined,
      text: redact((el.innerText || el.value || '').replace(/\s+/g, ' ').trim()).slice(0, 120) || undefined,
      href: href ? unwrap(new URL(href, location.href).href) : undefined,
      target: el.getAttribute('target') || undefined,
      onclick: el.hasAttribute('onclick') || undefined,
      data: Object.keys(data).length ? data : undefined,
      path: cssPath(el),
      html: sanitize(el.outerHTML, htmlMax),
    };
  }

  function send(ev) {
    ev.t = Date.now();
    ev.frame = isTop ? 'top' : location.href;
    try {
      chrome.runtime.sendMessage({ type: 'jc:rec-event', event: ev }).catch(() => {});
    } catch (_) {
      /* extension reloaded */
    }
  }

  function onClick(e) {
    const t = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
    if (!t) return;
    const clickable = t.closest('a, button, [role="button"], [role="link"], [onclick], input[type="submit"], input[type="button"], label, [tabindex]') || t;
    send({ type: 'click', trusted: e.isTrusted, target: describe(clickable, 600), inner: clickable !== t ? describe(t, 200) : undefined });
  }

  const OVERLAY = '[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"], [class*="modal" i], [class*="popup" i], [class*="popover" i], [class*="drawer" i], [class*="overlay" i], [class*="dialog" i]';

  function overlayInfo(el) {
    const links = [...el.querySelectorAll('a[href]')].slice(0, 15).map((a) => ({ text: redact(a.innerText.trim()).slice(0, 80), href: unwrap(a.href), target: a.getAttribute('target') || undefined }));
    const buttons = [...el.querySelectorAll('button, [role="button"]')].slice(0, 15).map((b) => redact((b.innerText || b.getAttribute('aria-label') || '').trim()).slice(0, 80));
    return Object.assign(describe(el, 2500), { links, buttons });
  }

  function checkOverlays(nodes) {
    setTimeout(() => {
      for (const n of nodes) {
        if (n.nodeType !== 1) continue;
        const cands = [n.matches && n.matches(OVERLAY) ? n : null, ...n.querySelectorAll(OVERLAY)].filter(Boolean);
        for (const c of cands) {
          if (seenOverlays.has(c) || !JC.dom.isVisible(c)) continue;
          if ((c.innerText || '').trim().length < 3) continue;
          // Report the outermost new overlay only.
          if ([...cands].some((o) => o !== c && o.contains(c) && seenOverlays.has(o))) continue;
          seenOverlays.add(c);
          send({ type: 'overlay', overlay: overlayInfo(c) });
        }
      }
    }, 350);
  }

  function onPageMessage(ev) {
    if (ev.source !== window || !ev.data || ev.data.channel !== JC.BRIDGE_CHANNEL || ev.data.dir !== 'rec-open') return;
    send({ type: 'window-open', url: unwrap(String(ev.data.url || '')), rawUrl: String(ev.data.url || '').slice(0, 600), name: ev.data.name || undefined });
  }

  function start(reason) {
    if (on) return;
    on = true;
    document.addEventListener('click', onClick, true);
    window.addEventListener('message', onPageMessage);
    if (isTop) window.postMessage({ channel: JC.BRIDGE_CHANNEL, dir: 'rec', on: true }, '*');
    let bodyScan = null;
    obs = new MutationObserver((muts) => {
      const added = muts.flatMap((m) => [...m.addedNodes]);
      if (added.length) checkOverlays(added);
      // Class/style/open toggles can reveal a pop-up that was already in the page: rescan, throttled.
      if (!bodyScan && muts.some((m) => m.type === 'attributes')) {
        bodyScan = setTimeout(() => {
          bodyScan = null;
          checkOverlays([document.body]);
        }, 500);
      }
    });
    // One observe() call: a second call on the same node would replace these options.
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'open', 'aria-hidden'] });
    if (isTop) {
      urlTimer = setInterval(() => {
        if (location.href !== lastUrl) {
          send({ type: 'url-change', from: lastUrl, to: location.href });
          lastUrl = location.href;
        }
      }, 300);
      send({ type: reason === 'resume' ? 'page-load' : 'recording-started', url: location.href, title: document.title });
    }
  }

  function stop() {
    on = false;
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('message', onPageMessage);
    if (isTop) window.postMessage({ channel: JC.BRIDGE_CHANNEL, dir: 'rec', on: false }, '*');
    if (obs) obs.disconnect();
    clearInterval(urlTimer);
  }

  // Resume after a navigation within a recorded tab.
  try {
    chrome.runtime
      .sendMessage({ type: 'jc:rec-status' })
      .then((r) => r && r.on && start('resume'))
      .catch(() => {});
  } catch (_) {
    /* ignore */
  }

  /** Extension's own steps (followApply / resolveApplyLinks) while recording. */
  function note(detail) {
    if (on) send({ type: 'extension-step', detail });
    // Always-on debug log (no typed values: steps, labels, addresses only).
    try {
      chrome.runtime.sendMessage({ type: 'jc:debug', event: { type: 'extension-step', url: location.href, detail } }).catch(() => {});
    } catch (_) {
      /* extension reloaded */
    }
  }

  JC.recorder = { start, stop, describe, note };
})(typeof globalThis !== 'undefined' ? globalThis : self);
