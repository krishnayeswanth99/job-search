/*
 * Job Copilot: notice when an application was actually submitted.
 *
 * Only a real confirmation counts: a confirmation page/URL together with confirmation text,
 * or confirmation text appearing within a minute after a Submit click (many ATS confirm on
 * the same page). The service worker then marks the job applied, and can answer a job
 * board's "Did you apply?" with Yes (only for that job, only after this confirmation).
 */
(function (root) {
  const JC = (root.JC = root.JC || {});
  if (JC.applied) return;

  const DONE_TEXT = /(thank(s| you) for (applying|your application|submitting|your interest[^.]{0,40}we('ve| have) received)|application (has been |was |is )?(successfully )?(submitted|received|sent|complete)|we('ve| have) (successfully )?received your application|your application (is|was|has been) (successfully )?(submitted|received|sent|complete)|successfully (applied|submitted)|you('ve| have) (successfully )?applied|application submitted)/i;
  const DONE_URL = /\/(confirmation|confirm|thank[-_]?you|thanks|application[-_]?(confirmation|submitted|complete|success)|success)(\/|\?|#|$)|[?&](submitted|success|applied|show_apply_submit_banner|apply_submitted)=(1|true)/i;
  const SUBMIT_RE = /^(submit|submit application|submit your application|send application|send|finish|complete application|apply now|submit & apply|confirm and submit)\b/i;
  const KEY = 'jcSubmitAt';

  let reported = false;

  function visibleText() {
    return (document.body && document.body.innerText) || '';
  }

  function check() {
    const text = visibleText();
    const m = text.match(DONE_TEXT);
    if (!m) return { confirmed: false };
    let recentSubmit = 0;
    try {
      recentSubmit = Number(sessionStorage.getItem(KEY) || 0);
    } catch (_) {
      /* storage blocked */
    }
    const afterSubmit = Date.now() - recentSubmit < 120000;
    // A confirmation URL, or confirmation text shortly after the user submitted.
    if (DONE_URL.test(location.href) || afterSubmit) return { confirmed: true, text: m[0], url: location.href, afterSubmit };
    return { confirmed: false, maybe: m[0] };
  }

  function report(res) {
    if (reported || !res.confirmed) return;
    reported = true;
    try {
      chrome.runtime.sendMessage({ type: 'jc:applied-confirmed', url: location.href, text: res.text, title: document.title }).catch(() => {});
    } catch (_) {
      /* extension reloaded */
    }
  }

  let polling = null;
  function watch(ms) {
    clearInterval(polling);
    const end = Date.now() + ms;
    polling = setInterval(() => {
      const r = check();
      if (r.confirmed) {
        report(r);
        clearInterval(polling);
      } else if (Date.now() > end) clearInterval(polling);
    }, 1000);
  }

  if (typeof document !== 'undefined') {
    // Submit clicks / form submits: remember (survives a same-site page change) and watch for a confirmation.
    document.addEventListener(
      'click',
      (e) => {
        const b = e.target && e.target.closest && e.target.closest('button, input[type="submit"], [role="button"], a');
        if (!b) return;
        const t = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim();
        if (t.length > 40 || !SUBMIT_RE.test(t)) return;
        // Only on pages that look like an application form, not a job board's "Apply" button.
        const portal = JC.portalForHost(location.hostname);
        if (portal && portal.aggregator) return;
        try {
          sessionStorage.setItem(KEY, String(Date.now()));
        } catch (_) {
          /* ignore */
        }
        watch(60000);
      },
      true
    );
    document.addEventListener(
      'submit',
      () => {
        try {
          sessionStorage.setItem(KEY, String(Date.now()));
        } catch (_) {
          /* ignore */
        }
        watch(60000);
      },
      true
    );
    // A confirmation page reached by navigation (e.g. Greenhouse /confirmation).
    setTimeout(() => report(check()), 1500);
  }

  JC.applied = { check };
})(typeof globalThis !== 'undefined' ? globalThis : self);
