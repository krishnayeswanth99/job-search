# Ashby application

- **URL:** `jobs.ashbyhq.com/<company>/<uuid>/application` (the "Application" tab on the posting).
- **Login:** none. **Pages:** a single page (React).

## Flow
1. Open the Application tab and wait about 1.5 s for it to render.
2. Ashby offers "Autofill from resume": the resume upload sits at the top and parses into the fields. Attach first, wait
   2–3 s, then run `autofill()`.
3. Yes/No questions are **button pairs**, not radios. They show up in `needsInput` (or not at all). Use
   `find("Yes button for <question>")` and click it.
4. Location: a combobox. Type the city and pick a suggestion.
5. Submit: "Submit Application". Success: "Thanks for applying" or "Application submitted".

## Gotchas
- Some companies add a "Have you applied before?" step or a short survey after submitting. Answer it from the profile.
- Ashby validates email and phone formats. Fix any errors it reports and continue.
