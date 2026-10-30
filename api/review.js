// POST /api/review
// The /free-review form posts the prospect's answers here. We reply straight away
// ("check your inbox in a few minutes"), then keep working in the background:
// logged to Google Sheets → Gemini (or the fallback) writes the review → PDF → Vercel Blob →
// MailerLite sends the email → the sheet row is updated.
//
// Env vars (Vercel → Settings → Environment Variables):
//   GEMINI_API_KEY, MAILERLITE_API_KEY, MAILERLITE_GROUP_ID, BLOB_READ_WRITE_TOKEN
//   optional: GEMINI_MODEL, GEMINI_RESEARCH=0, BOOKING_URL, ALERT_WEBHOOK_URL,
//             SHEETS_WEBHOOK_URL + SHEETS_TOKEN (Google Sheets log, see lead-magnet/google-sheets/Code.gs)
const { waitUntil } = require('@vercel/functions');
const { validateAnswers } = require('../lead-magnet/lib/questions');
const { processSubmission } = require('../lead-magnet/lib/pipeline');

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const raw = typeof req.body === 'string' ? req.body : await new Promise((r) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => r(d));
  });
  return JSON.parse(raw || '{}');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  let body;
  try {
    body = await readBody(req);
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid request' });
  }

  // Honeypot field: real people never fill it.
  if (body.website_url) return res.status(200).json({ ok: true });

  const v = validateAnswers(body);
  if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors, error: 'Please check the highlighted fields.' });

  // Logged to the Google Sheet, written, sent, and the sheet row updated, all in the background.
  const job = processSubmission(v.answers).then((r) => {
    if (!r.error) console.log(`[review] ${r.id} sent to ${v.answers.email} (${r.mode}, ${r.pages} pages, ${r.ms} ms)`);
  });
  waitUntil(job);

  return res.status(202).json({ ok: true, message: `Thanks ${v.answers.first_name}! Your review is being written now. It will be in your inbox in a few minutes.` });
};
