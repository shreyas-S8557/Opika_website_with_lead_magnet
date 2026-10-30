// answers → Gemini review (or the deterministic fallback) → branded PDF → hosted link → MailerLite email
const { generateReport } = require('./gemini');
const { siteChecks, fallbackReport } = require('./fallback');
const { buildReviewDoc, businessName } = require('./template');
const { renderPDF } = require('./pdf');
const { storePDF } = require('./storage');
const mailerlite = require('./mailerlite');
const sheets = require('./sheets');

async function alert(text) {
  const hook = process.env.ALERT_WEBHOOK_URL; // optional: Slack/Discord/Zapier webhook
  if (!hook) return;
  try {
    await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  } catch {}
}

// Gemini gets this long in total (research, writing, retries) before the fallback takes over.
// Leaves room within Vercel's 300-second limit for the site checks, PDF and email.
const GEMINI_DEADLINE_MS = Number(process.env.GEMINI_DEADLINE_MS || 180000);

function withDeadline(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Gemini took longer than ${ms >= 1000 ? Math.round(ms / 1000) + 's' : ms + 'ms'}`)), ms);
    }),
  ]);
}

/**
 * Gemini first; if it fails for any reason, the deterministic fallback (lib/fallback.js):
 * real checks of their homepage + pre-written sections for their priorities.
 * REVIEW_FALLBACK=0 turns the fallback off (failures are then reported, not sent).
 */
async function writeReview(answers, o = {}) {
  if (o.report) return { report: o.report, notes: '', mode: 'given' };
  try {
    return await withDeadline(generateReport(answers, o.gemini), o.deadline || GEMINI_DEADLINE_MS);
  } catch (err) {
    if (process.env.REVIEW_FALLBACK === '0') throw err;
    console.warn('[review] Gemini failed, sending the fallback review:', err.message);
    const site = await siteChecks(answers.website, o.fetch ? { fetchImpl: o.fetch } : {});
    await alert(
      `Gemini couldn't write the review for ${answers.company || answers.website} <${answers.email}> (${err.message}). ` +
        `They were sent the automatic fallback review instead${site.reached ? `, based on checks of ${site.host}` : ''}. Worth a personal follow-up.`
    );
    return { report: fallbackReport(answers, site), notes: `Fallback review (Gemini failed: ${err.message}). Site checks: ${JSON.stringify(site.checks)}`, mode: 'fallback' };
  }
}

async function notifyFailure(answers, err) {
  console.error('[review] failed for', answers.email, err && err.stack ? err.stack : err);
  await alert(`Lead magnet failed for ${answers.company} <${answers.email}>: ${err.message}`);
}

/** Quiz answers + what research found about the business, as MailerLite fields (see LEAD_FIELDS). */
const leadFields = (a, report = {}) => {
  const biz = report.business || {};
  return {
    lead_website: a.website || '',
    lead_focus: (a.focus || []).join('; '),
    lead_note: (a.note || '').slice(0, 250),
    lead_industry: biz.industry || '',
    lead_location: biz.location || '',
    lead_services: (biz.services || '').slice(0, 250),
  };
};

/**
 * @param {object} answers  validated answers (see questions.js)
 * @param {object} [o]
 * @param {boolean} [o.send=true]  deliver through MailerLite
 * @param {object} [o.report]      skip Gemini and use this report (testing)
 */
async function runReview(answers, o = {}) {
  const t0 = Date.now();
  const { report, notes, mode } = await writeReview(answers, o);
  const company = businessName(report, answers);
  const doc = buildReviewDoc(report, answers);
  const { pdf, pages } = await renderPDF(doc);
  const url = await storePDF(pdf, company);

  let delivery = null;
  if (o.send !== false) {
    const ml = mailerlite.client(undefined, o.mailerlite);
    const groupId = await mailerlite.ensureSetup(ml); // creates missing fields; finds the group
    const opps = report.opportunities;
    delivery = await ml.deliverLeadMagnet({
      email: answers.email,
      name: answers.first_name,
      company,
      groupId,
      magnet: {
        slug: 'visibility-growth-review',
        title: 'Visibility & Growth Review',
        subtitle: `Three opportunities to make more of what ${company} has already built`,
        preview: opps.map((x) => x.name).join(' · '),
        url,
        date: doc.date,
        ref: doc.reference,
        pages,
        opp1: opps[0].name,
        opp1_text: opps[0].summary || '',
        opp2: opps[1].name,
        opp2_text: opps[1].summary || '',
        opp3: opps[2].name,
        opp3_text: opps[2].summary || '',
      },
      extraFields: leadFields(answers, report),
    });
  }
  return { url, pages, company, report, notes, mode, delivery, ms: Date.now() - t0 };
}

/**
 * Everything that happens after someone submits the quiz (run in the background by /api/review):
 * log it to the Google Sheet, write and send the review, then update the sheet row.
 */
async function processSubmission(answers, o = {}) {
  const id = sheets.newId();
  await sheets.logSubmission(id, answers);
  try {
    const r = await runReview(answers, o);
    await sheets.updateSubmission(id, {
      status: r.mode === 'fallback' ? 'Sent (fallback review)' : 'Sent',
      reportUrl: r.url,
      emailStatus: r.delivery ? 'Queued in MailerLite' : 'Not sent',
      reviewType: r.mode === 'fallback' ? 'Fallback (no AI)' : 'Gemini',
      company: r.company,
      error: r.mode === 'fallback' ? String(r.notes || '').slice(0, 500) : '',
    });
    return { id, ...r };
  } catch (err) {
    await sheets.updateSubmission(id, { status: 'Failed', emailStatus: 'Not sent', error: String(err.message || err).slice(0, 500) });
    await notifyFailure(answers, err);
    return { id, error: err };
  }
}

module.exports = { runReview, writeReview, processSubmission, notifyFailure, leadFields };
