# Login and signup walls

The rule: **the user types secrets, Claude does the rest.** Never enter passwords, one-time codes, or security answers,
and never solve CAPTCHAs.

## Detecting walls

`detect().login` returns `{ required, kind: 'signin' | 'signup', providers: ['google', …], hints: [...] }`. Also treat
these as walls: a "Verify your email" screen, "Enter the code we sent", and SSO redirects
(`accounts.google.com`, `login.microsoftonline.com`).

## The message to send (adjust it to the case)

> **<Site> needs you to <sign in | create an account | verify your email>** before I can continue with *<title> at
> <company>*.
> In the open tab, please <sign in, or use "Continue with Google" | create an account with ada@example.com (I've filled
> the name and email if you wanted that) | enter the code from your inbox>.
> Reply **done** when you see the application form.

Then stop and wait. When the user replies, run `detect()` again.

## Per portal

| Portal | What to expect |
|---|---|
| LinkedIn | You must be signed in for Easy Apply. Auth wall at `/authwall` or as a modal. |
| Indeed | Indeed Apply needs an Indeed account. Login is at `secure.indeed.com`, with an email code or password. |
| Workday | **One account per company tenant.** "Create Account" needs an email, a password, and a password confirmation, and sometimes email verification. The user creates it once per company. Suggest a password manager. |
| iCIMS / Taleo / SuccessFactors | They usually ask you to create an account per company before the form. Same flow as Workday. |
| Greenhouse / Lever / Ashby | No account. If you see a login here, it's probably a company SSO portal, so ask the user. |
| Wellfound / Glassdoor | Site account (Google sign-in is common). |

## Helping with signup forms (only when asked)

The user may say "fill the signup for me". Then:
- Fill the first name, last name, email, phone, and country with `fillField`.
- Leave the password, confirm-password, security questions, and CAPTCHA empty, and point the user to them.
- Never tick "subscribe to marketing" boxes. Leave terms-of-service boxes for the user (safety rule 4).
