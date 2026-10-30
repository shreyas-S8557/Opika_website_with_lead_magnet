// Google Sheets log of every submission, through the Apps Script web app in google-sheets/Code.gs.
// Optional: does nothing unless SHEETS_WEBHOOK_URL is set. Never blocks or breaks a review:
// if the sheet can't be reached, it's logged and the review carries on.
//
// Env: SHEETS_WEBHOOK_URL (the web app's /exec URL), SHEETS_TOKEN (same as OPIKA_TOKEN in the script)
const crypto = require('crypto');

const newId = () => 'OPK-' + crypto.randomBytes(5).toString('hex').toUpperCase();

async function post(payload, { fetchImpl = globalThis.fetch } = {}) {
  const url = process.env.SHEETS_WEBHOOK_URL;
  if (!url) return null;
  try {
    // Apps Script answers with a redirect to the result; fetch follows it.
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, token: process.env.SHEETS_TOKEN || '' }),
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.success) console.warn(`[sheets] ${payload.action} failed: ${data.error || res.status}`);
    return data;
  } catch (e) {
    console.warn(`[sheets] ${payload.action} failed: ${e.message}`);
    return null;
  }
}

/** New row, Status "Received". */
const logSubmission = (id, a, opts) =>
  post(
    {
      action: 'create',
      id,
      name: a.first_name,
      email: a.email,
      company: a.company,
      website: a.website || a.site,
      priority: (a.focus || []).join('; '),
      friction: a.note || '',
    },
    opts
  );

/** Update the same row: status, reportUrl, emailStatus, reviewType, error, company. */
const updateSubmission = (id, fields, opts) => post({ action: 'update', id, ...fields }, opts);

module.exports = { newId, logSubmission, updateSubmission };
