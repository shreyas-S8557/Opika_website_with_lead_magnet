# Opika lead magnet: personalised Visibility & Growth Review

A prospect answers three quick questions in the review quiz (a popup on the homepage, or **opika.co/free-review**). Gemini researches their business and writes a review following the approved Ethan Construction review. It's rendered as a formal, four-page branded PDF, and MailerLite emails it to them in a letter-style email that names their three opportunities.

```
/free-review (form)
   → POST /api/review                    replies at once: "check your inbox in a few minutes"
       → Gemini + Google Search          researches their website, Google listing, local competitors
       → Gemini (structured JSON)        writes the review, using the Ethan review as the example
       → lead-magnet/lib/template.js     title + executive summary → 3 opportunities → 90-day plan
       → PDF (Chromium)                  3–4 Letter pages (4 for a typical review)
       → Vercel Blob                     private, unguessable link
       → MailerLite                      sets review + quiz-answer fields, adds them to the delivery group → automation emails it
```

## Files

| Path | What it is |
|---|---|
| `review-quiz.js` | **The quiz.** One script that shows it as a popup (same style as "Schedule a call") on any page, or inline. |
| `free-review.html` | Standalone page with the same quiz inline: for ads, emails and social links (`opika.co/free-review`) |
| `api/review.js` | Vercel function the form posts to |
| `lead-magnet/lib/questions.js` | The questions and their validation. Edit questions here and in the form. `npm test` checks they match. |
| `lead-magnet/google-sheets/Code.gs` | The Apps Script for the Google Sheets log of submissions (paste into the Sheet) |
| `lead-magnet/lib/sheets.js` | Sends each submission and its outcome to that sheet |
| `lead-magnet/lib/fallback.js` | The deterministic fallback used when Gemini fails: real checks of their homepage + pre-written sections for each priority |
| `lead-magnet/lib/gemini.js` | Prompts, report schema, research + writing steps |
| `lead-magnet/samples/ethan-report.json` | **The template.** Gemini is shown this as the example to follow. Edit it to change tone or structure. |
| `lead-magnet/lib/template.js` | Turns Gemini's report into the document: page 1 is the title band and executive summary; pages 2–4 hold the three opportunities and "Where we would start" |
| `lead-magnet/lib/render.js`, `layout.js`, `pdf.js` | Opika styling, page layout (running header, footer, page numbers), PDF rendering |
| `lead-magnet/email/review-email.html` | The email to paste into MailerLite |

## Setup

### 1. Keys

Copy `.env.example` to `.env` for local runs, and add the same values in Vercel → Project → Settings → Environment Variables:

| Variable | Where to get it |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio (aistudio.google.com) → Get API key. Works on the free tier; turn on billing before launch (see below). |
| `MAILERLITE_API_KEY` | MailerLite → Integrations → API. Works with both **new MailerLite** (dashboard.mailerlite.com; tokens start with `eyJ`) and **MailerLite Classic** (app.mailerlite.com; 32-character key). The site detects which from the key; `MAILERLITE_CLASSIC=1` forces Classic. |
| `MAILERLITE_GROUP_ID` | Optional. The site finds the group "Opika · Visibility review delivery" by name |
| Vercel Blob | Vercel → Storage → Create → Blob, with **Public** access (it can't be changed later) → connect it to the project. Nothing to copy: Vercel signs the site in automatically. `BLOB_READ_WRITE_TOKEN` is only for local runs. |

Optional settings:

- `GEMINI_MODEL`: defaults to `gemini-3.8-flash`. If Google retires a model, the code falls back to `gemini-flash-latest`, then `gemini-3.5-flash`, so it keeps working. You can list several, comma-separated.
- `GEMINI_RESEARCH=0`: skips the web research step.
- `GEMINI_TWO_STEP=1`: always use separate research and writing calls (two requests per review instead of one).
- `BOOKING_URL`: defaults to your Calendly.
- `ALERT_WEBHOOK_URL`: a Slack or Zapier webhook that's pinged if a review fails.

### 2. MailerLite (once)

The site sets MailerLite up by itself: on the first submission it creates the custom fields it needs and the group **"Opika · Visibility review delivery"**. So do this **after** deploying:

1. Submit one test review on the live site (use your own email). It won't email you yet, but it creates the fields and the group. (Or run `npm run setup-mailerlite` locally to create them ahead of time.)
2. Build the automation below. The email's merge tags (`{$lm_url}`, `{$lm_opp1}`…) then all exist.
3. Submit a second test review. This time the email arrives.

The fields: `lm_*` (what the email shows: `lm_url`, `lm_date`, `lm_ref`, `lm_pages`, `lm_opp1`…`lm_opp3_text`) and `lead_*` (their answers and what research found: `lead_website`, `lead_focus`, `lead_note`, `lead_industry`, `lead_location`, `lead_services`). Use the `lead_*` fields to segment follow-up, e.g. *lead_focus contains "More leads"*.

Then in MailerLite, go to Automations → Create (Classic: **Automation → Create workflow**):

1. **Trigger:** "When subscriber joins a group" → *Opika · Visibility review delivery* (not "completes a form"). Turn on repeats ("Allow subscribers to repeat this automation", or in Classic "Reactivate the full workflow every time…") so a second request still sends.
2. **Email:**
   - Subject: `Your Visibility & Growth Review: {$company}`
   - Preview text: `Prepared for {$company}: {$lm_preview}`
   - From: Aniket De, Opika (reply-to info@opika.co)
   - Content: the custom HTML editor, with `lead-magnet/email/review-email.html` pasted in. If your plan has no custom HTML, rebuild it in the drag-and-drop editor and use `{$lm_url}` for the button link.
3. Turn the automation on.

Run `npm run preview-email` to see the email with sample values (desktop and mobile screenshots in `lead-magnet/out/`).

### 3. Deploy

Push to the repo connected to Vercel. `vercel.json` already gives `/api/review` up to 300 seconds and 2 GB of memory (Gemini research plus PDF rendering usually takes 30–90 seconds). It also blocks public access to `/lead-magnet/*`, so the sample report and code aren't served.

## Where the quiz appears

On the homepage it opens as a popup from three places: **Free Review** in the nav, the *"Not ready to talk yet? Get a free Visibility & Growth Review →"* line under the hero buttons, and **Get a free review** in the closing call-to-action panel. Its *Prefer to talk first?* link switches to the Schedule a call popup.

To add it to another page (a blog post, the HVAC page…):

```html
<script src="/review-quiz.js" defer></script>
<a class="btn btn-primary" data-open-review href="/free-review">Get a free review</a>
```

Any element with `data-open-review` opens the popup. The `href` is the fallback if JavaScript is off. Linking to any page with `#free-review` on the end (e.g. `opika.co/#free-review`) opens the popup straight away. `opika.co/free-review` shows the quiz on its own page.

## Run it locally

```bash
npx playwright install chromium          # once

# The real thing: Gemini → PDF → email (uses .env)
npm run review -- lead-magnet/samples/ethan-answers.json

# Check Gemini's writing without emailing anyone
npm run review -- my-answers.json --no-send

# Layout only, no Gemini (rebuilds the Ethan sample)
npm run review:sample
```

PDFs land in `lead-magnet/out/` (or Vercel Blob if the token is set). What Gemini wrote, plus its research notes, is saved to `lead-magnet/out/last-report.json`.

`npm test` runs the whole flow against a fake Gemini and a fake MailerLite: form, API, Gemini calls, PDF and delivery.

## The questionnaire

Three questions on one screen, about 30 seconds:

| # | Question | Field |
|---|---|---|
| 1 | Your website *(or business name and town if they have no website)* | `site` |
| 2 | What would help most right now? Pick up to 2: Getting found on Google & AI · More reviews & trust · More leads & better follow-up · Saving time with AI & automation · Not sure yet. Plus an optional one-line "biggest challenge" | `focus`, `note` |
| 3 | Where should we send it? First name + work email | `first_name`, `email` |

Everything else is worked out, not asked:

- **Website:** if they type a business name instead, their work email's domain is used (e.g. ana@brightsmile.com → brightsmile.com). Gmail and other personal addresses are ignored.
- **Business name, industry, location, services:** Gemini identifies these from the website and public listings in the research step. They appear in the review and are saved to MailerLite as `lead_industry`, `lead_location`, `lead_services`, alongside `lead_website`, `lead_focus` and `lead_note`.
- **Reviews, competitors and search visibility:** researched, as before.

To change a question, edit `lib/questions.js` and `review-quiz.js` together. `npm test` fails if they drift apart.

## Google Sheets log

Every submission is logged to a Google Sheet, and the row is updated when the review goes out:

| Status | Meaning |
|---|---|
| Received | Quiz submitted; review being written |
| Sent | Gemini wrote it; PDF link in **Report URL**, email queued in MailerLite |
| Sent (fallback review) | Gemini failed, the automatic fallback was sent; **Error** says why. Worth a personal follow-up |
| Failed | Nothing was sent; **Error** says why (you also get the `ALERT_WEBHOOK_URL` message) |

Columns: Timestamp, Name, Email, Company, Website, Priority, Friction, Status, Report URL, Email Status, Error, Submission ID, Review Type. The first eleven match the original sheet. **Priority** is what they picked in the quiz, **Friction** is their "biggest challenge", and **Company** is updated to the real business name once research finds it.

**Setup (once):**

1. Open the Sheet → **Extensions → Apps Script**. Replace the code with `lead-magnet/google-sheets/Code.gs` and save.
2. **Project Settings → Script properties → Add property:** `OPIKA_TOKEN` = a long random string (e.g. from a password generator). This stops anyone else writing to your sheet.
3. **Deploy → New deployment → Web app.** Execute as: *Me*; Who has access: *Anyone*. Authorise it, then copy the URL ending in `/exec`.
4. In Vercel, add `SHEETS_WEBHOOK_URL` = that URL and `SHEETS_TOKEN` = the same random string. Redeploy.

After editing the script later, use **Deploy → Manage deployments → Edit → New version**, so the `/exec` URL stays the same. Without `SHEETS_WEBHOOK_URL`, logging is simply off. If the sheet can't be reached, reviews still go out.

## If Gemini fails: the fallback review

Every prospect gets a review, even if Gemini is down, the key is wrong, the free quota is used up, it times out (100 seconds per request, 3 minutes in total) or its answer is unusable. In those cases `lib/fallback.js` builds one without any AI:

1. **Checks their homepage**, the same way every time: HTTPS, page title, meta description, H1, mobile viewport, structured data (schema.org), FAQ, `llms.txt`, sitemap, tap-to-call phone link, enquiry form or booking tool, call to action (book / quote / schedule), customer reviews or testimonials, Google Maps link. It also reads the business name, description and location from the page.
2. **Picks three opportunities:** their quiz priorities first, then whichever areas the checks found most problems in.
3. **Fills them from a library of sections** written in Opika's voice (Get discovered, Show the proof, Catch every lead, Win back time). Failed checks become specific findings ("No structured data found"), passed checks become strengths ("Easy to call"), and a "6/6 search basics in place" score appears when the site was checked.
4. **Writes the personal note from their answers**: "Ethan, you told us you want help with getting found on Google & AI, and that 'most work comes from referrals'. This review starts there."

The result has exactly the same shape as Gemini's, so the PDF and email look the same. Nothing in it is invented: every finding is either a check result or general advice. If the site can't be reached, it says the review is based on their answers only.

When the fallback is used, `ALERT_WEBHOOK_URL` gets a message (who, why Gemini failed) so you can follow up personally. Edit the wording in the `LIBRARY` section of `fallback.js`. `REVIEW_FALLBACK=0` turns the fallback off, so failures are only reported. `GEMINI_DEADLINE_MS` and `GEMINI_TIMEOUT_MS` change the time limits.

## Gemini key: free vs paid

**How many requests a review uses.** Normally **one**: Gemini 3 searches Google and writes the structured review in the same request. If that answer is unusable, it falls back to the two-step pipeline (a research call, then a writing call). `GEMINI_TWO_STEP=1` always uses two steps.

**Free tier.** It works, with limits:
- Google no longer publishes free-tier limits; your project's limits are at aistudio.google.com/rate-limit. After Google's December 2025 cuts, free Flash quotas were reported at about **5 requests a minute and 20 a day per model**, so plan on roughly 20 reviews a day.
- When a per-minute limit is hit, the code waits as long as Google asks and retries (up to 3 times).
- When a model's **daily** free quota is used up, it moves to the next model (`gemini-3.8-flash` → `gemini-flash-latest` → `gemini-3.5-flash`). Each has its own quota.
- If every quota is used up, the review fails and `ALERT_WEBHOOK_URL` is pinged so you can send it by hand.
- Google Search grounding: 5,000 free searches a month across Gemini 3 models, then about $14 per 1,000.
- Free-tier prompts may be used by Google to improve its products. The quiz says answers stay private, so turn on billing before real traffic.

**Paid tier.** A few cents a review. Turn on billing in AI Studio when you're ready; nothing in the code changes.

**Temperature.** Not set for Gemini 3 models: Google recommends the default (1.0) and warns that lower values can cause looping. It applies only if you point `GEMINI_MODEL` at an older model.

**Protect the quota.** Each form submission spends requests, so add Vercel's firewall rate limiting on `/api/review` (e.g. 3 requests per IP per hour) before promoting the page.

## Good to know

- **Accuracy:** Gemini is told to use only the prospect's answers and what Google Search actually found. No invented numbers, competitors or reviews. Stats and the review-comparison chart only appear when real numbers exist.
- **Spot-check early ones:** for the first few weeks, open `last-report.json` or the PDFs to see what Gemini writes. Tighten the prompt in `gemini.js` or the example in `samples/ethan-report.json` if needed.
- **Length and spacing:** four pages. Page 1 has the title, a personal note and the summary; opportunities 1 and 2 get a page each; page 4 has opportunity 3 and the 90-day plan. Gemini writes about 550–700 words, with a word limit on every field (see `gemini.js`). Pages are kept full but never crowded: each opportunity has a **First steps** row (three concrete actions) and an optional **For example** box, which appear only when they fit without shrinking the text. Leftover space is spread evenly between blocks, and a clearly short page gets text up to 4% larger. `REVIEW_MAX_PAGES` changes the page limit.
- **Personalisation:** Gemini receives their website, their one or two priorities and their challenge in their own words. The review opens with a personal note to them by first name that connects what they told us to something specific on their site. The opportunities are ordered around their priorities, each one that answers a priority is tagged **Your priority**, and page 1 shows "You asked us to focus on…".
- **Safety:** prospect answers are treated as data, not instructions. Links and HTML in the generated text are stripped. The form has a spam honeypot.
- **No rate limit yet:** add Vercel's firewall rate limiting on `/api/review` if you see abuse.
