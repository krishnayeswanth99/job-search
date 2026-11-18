# Indeed Apply ("Easily apply")

- **Trigger:** `#indeedApplyButton` on a `viewjob` page. It opens `smartapply.indeed.com` in a new tab or an overlay.
- **Login:** an Indeed account (an email code or password). **Pages:** contact info → resume → questions → (optional
  work experience) → review.

## Flow
1. Click **Apply now**. Switch to the new tab if one opens (`tabs_context_mcp`).
2. If it asks for login, hand it to the user (`references/login-and-signup.md`).
3. **Contact information:** comes prefilled from the Indeed profile. Run `autofill()` for anything that's empty.
4. **Resume:** choose between the "Indeed Resume" and an uploaded file. Prefer the uploaded tailored PDF via the upload
   option, using `attachFile`.
5. **Employer questions:** yes/no, numeric, and free text. Use `autofill()`, then drafts.
6. **Review:** screenshot, confirm, then "Submit your application".
7. Success: "Your application has been submitted".

## Gotchas
- Cloudflare checks are common. The user handles them.
- Some employers add "screener" questions that knock you out automatically. Answer them truthfully, never strategically.
