#!/usr/bin/env node
/*
  Run the whole lead magnet locally, the same way the website does.

    node lead-magnet/scripts/generate.js answers.json            # Gemini → PDF → MailerLite email
    node lead-magnet/scripts/generate.js answers.json --no-send  # Gemini → PDF only (check the writing first)
    node lead-magnet/scripts/generate.js answers.json --report report.json --no-send   # skip Gemini

  answers.json uses the same fields as the form (see lead-magnet/lib/questions.js and
  lead-magnet/samples/ethan-answers.json). Settings come from .env in the repo root.
  The PDF is saved to lead-magnet/out/ (or Vercel Blob if BLOB_READ_WRITE_TOKEN is set),
  and the Gemini report JSON is saved next to it so you can review what it wrote.
*/
require('../lib/env');
const fs = require('fs');
const path = require('path');
const { validateAnswers } = require('../lib/questions');
const { runReview } = require('../lib/pipeline');

(async () => {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--report');
  if (!file) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace('#!/usr/bin/env node\n/*', ''));
    process.exit(1);
  }
  const reportIdx = args.indexOf('--report');
  const report = reportIdx >= 0 ? JSON.parse(fs.readFileSync(args[reportIdx + 1], 'utf8')) : undefined;
  const v = validateAnswers(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!v.ok) {
    console.error('✗ Answers are invalid:', v.errors);
    process.exit(1);
  }
  const r = await runReview(v.answers, { send: !args.includes('--no-send'), report });
  const out = path.join(__dirname, '..', 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'last-report.json'), JSON.stringify({ report: r.report, research: r.notes }, null, 2));
  console.log(`✓ ${r.pages}-page review in ${(r.ms / 1000).toFixed(1)}s${r.mode === 'fallback' ? ' (fallback: Gemini failed, see last-report.json)' : ''}`);
  console.log(`  PDF: ${r.url}`);
  console.log(`  Report JSON: lead-magnet/out/last-report.json`);
  if (r.delivery) console.log(`  Emailed via MailerLite → ${v.answers.email} (subscriber ${r.delivery.subscriberId})`);
})().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
