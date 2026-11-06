/*
 * Job Copilot: login / signup wall detection.
 * The extension never types passwords. When a wall is detected, Claude (or the
 * popup) tells the user to sign in or create an account, then resumes.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});
  const { isVisible, clean, findButton } = JC.dom;

  const URL_SIGNIN = /\/(login|log-in|signin|sign-in|sign_in|auth|authwall|account\/login|sso|oauth)(\/|\?|$|#)/i;
  const URL_SIGNUP = /\/(signup|sign-up|register|registration|create-account|createaccount|join)(\/|\?|$|#)/i;
  const TEXT_SIGNIN = /^(sign in|log in|login|continue with (email|google|linkedin|apple|microsoft)|sign in with)/i;
  const TEXT_SIGNUP = /^(create (an )?account|sign up|register|join now|join to apply)/i;

  function providers() {
    const found = new Set();
    for (const el of document.querySelectorAll('a, button, [role="button"]')) {
      const t = clean(el.innerText || el.getAttribute('aria-label')).toLowerCase();
      if (t.length > 60) continue;
      for (const p of ['google', 'linkedin', 'apple', 'microsoft', 'facebook', 'github', 'indeed']) {
        if (t.includes('with ' + p) || t === p) found.add(p);
      }
    }
    return [...found];
  }

  function detectLogin() {
    const url = location.href;
    const host = location.hostname;
    const hints = [];
    const pw = [...document.querySelectorAll('input[type="password"]')].filter(isVisible);
    if (pw.length) hints.push(`${pw.length} visible password field(s)`);

    let kind = null;
    if (pw.length >= 2) kind = 'signup';
    else if (pw.length === 1) kind = 'signin';

    // Portal-specific walls.
    if (JC.hostMatches(host, 'linkedin.com') && (/\/authwall|\/checkpoint|\/uas\/login/.test(url) || document.querySelector('.authwall-join-form, form.join-form, #join-form'))) {
      kind = kind || 'signin';
      hints.push('LinkedIn auth wall');
    }
    if (/workday/.test(host)) {
      const wd = document.querySelector('[data-automation-id="signInContent"], [data-automation-id="createAccountSubmitButton"], [data-automation-id="signInSubmitButton"]');
      if (wd && isVisible(wd)) {
        kind = document.querySelector('[data-automation-id="createAccountSubmitButton"]') ? 'signup' : 'signin';
        hints.push('Workday sign-in / create-account step');
      }
    }
    if (JC.hostMatches(host, 'indeed.com') && /secure\.indeed\.com\/(auth|account)/.test(url)) {
      kind = kind || 'signin';
      hints.push('Indeed secure login');
    }

    if (!kind && URL_SIGNUP.test(url)) kind = 'signup';
    if (!kind && URL_SIGNIN.test(url)) kind = 'signin';

    // A visible modal/dialog whose headline is "Sign in" etc.
    if (!kind) {
      const dialog = [...document.querySelectorAll('[role="dialog"], dialog[open], .modal')].find(isVisible);
      if (dialog) {
        const head = clean((dialog.querySelector('h1, h2, h3') || {}).innerText || '');
        if (TEXT_SIGNIN.test(head)) kind = 'signin';
        else if (TEXT_SIGNUP.test(head)) kind = 'signup';
        if (kind) hints.push(`dialog: "${head}"`);
      }
    }

    const signInButton = findButton(TEXT_SIGNIN);
    const signUpButton = findButton(TEXT_SIGNUP);
    const emailOnly = !pw.length && kind && document.querySelector('input[type="email"]');
    if (emailOnly) hints.push('email-first login (password or code comes next)');

    return {
      required: !!kind,
      kind, // 'signin' | 'signup' | null
      hints,
      providers: kind ? providers() : [],
      // Present on many job pages even when not required (e.g. "Sign in" in the header).
      signInAvailable: !!signInButton,
      signUpAvailable: !!signUpButton,
      guidance: kind
        ? 'Login required. Ask the user to sign in or create an account in this tab (never type passwords or verification codes for them), then call detect() again.'
        : '',
    };
  }

  JC.login = { detectLogin };
})(typeof globalThis !== 'undefined' ? globalThis : self);
