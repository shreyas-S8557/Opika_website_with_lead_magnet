// The Visibility & Growth Review, as a template.
// Takes the structured report Gemini writes (see gemini.js → REPORT_SCHEMA) plus the prospect's
// answers, and lays it out as a formal document of 3-4 pages (4 for a typical review):
//
//   Page 1     Title band (prepared for / by, date, reference), a personal note to the reader,
//              summary (what's working, the three opportunities at a glance, sources)
//   Pages 2-3  Opportunities 01 and 02, one per page
//   Page 4     Opportunity 03, then "Where we would start" (90-day plan) and the call to action

const crypto = require('crypto');

const BOOKING_URL = process.env.BOOKING_URL || 'https://calendly.com/aniket-opika/you';

// Generated text may only use **bold** / *italic*. Strip links, HTML and template braces.
const clean = (s = '', max = 1200) =>
  String(s)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\{\{|\}\}/g, '')
    .replace(/https?:\/\/\S+/g, (u) => u.replace(/^https?:\/\//, ''))
    .trim()
    .slice(0, max);

const longDate = (d = new Date()) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

/** A short, stable document reference, e.g. OPK-2610-ETHC-4F1A */
function reference(answers, d = new Date()) {
  const yymm = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0');
  const letters = (String(answers.company || '').toUpperCase().replace(/[^A-Z]/g, '') + 'XXXX').slice(0, 4);
  const hash = crypto.createHash('sha1').update(`${answers.email}|${answers.company}|${d.toISOString().slice(0, 10)}`).digest('hex').slice(0, 4).toUpperCase();
  return `OPK-${yymm}-${letters}-${hash}`;
}

/** The business name for the review: what research found, else what they typed / the domain. */
const businessName = (report, answers) =>
  clean((report && report.business && report.business.name) || answers.company || 'Your business', 120);

function buildReviewDoc(report, answers, { date = new Date() } = {}) {
  const company = businessName(report, answers);
  answers = { ...answers, company };
  const opps = (report.opportunities || []).slice(0, 3);
  if (opps.length !== 3) throw new Error('Report must contain exactly three opportunities');
  const dateText = longDate(date);
  const ref = reference(answers, date);
  const level = (v, ok, d) => (ok.includes(v) ? v : d);

  const blocks = [];
  let figures = 0;

  // ── Page 1: title band, personal note, summary ─────────────────────────────
  blocks.push({
    type: 'titleBand',
    label: 'Visibility & Growth Review',
    company,
    headline: clean(report.headline, 120),
    meta: [
      ['Prepared for', company],
      ['Prepared by', 'Opika'],
      ['Date', dateText],
      ['Reference', ref],
    ],
  });
  if (report.personal_note) {
    const asked = (answers.focus || []).filter((f) => !/^Not sure/.test(f));
    blocks.push({
      type: 'note',
      text: clean(report.personal_note, 300),
      by: 'The Opika team',
      asked: asked.length ? `You asked us to focus on ${asked.map((f) => clean(f, 60)).join(' and ')}` : '',
    });
  }
  blocks.push({ type: 'section', kicker: 'Summary', title: 'Where we see the opportunity' });
  blocks.push({ type: 'text', body: clean(report.intro || [report.intro_strengths, report.intro_findings].filter(Boolean).join(' '), 360) });

  const strengths = (report.strengths || []).filter((x) => x && x.title && x.body).slice(0, 3);
  if (strengths.length) blocks.push({ type: 'strengths', title: 'Already working', items: strengths.map((x) => ({ title: clean(x.title, 40), body: clean(x.body, 110) })) });

  const sources = (report.sources_reviewed || []).map((x) => clean(x, 60)).filter(Boolean).slice(0, 4);
  blocks.push({
    type: 'glanceTable',
    title: 'Three opportunities',
    items: opps.map((o, i) => ({
      no: String(i + 1).padStart(2, '0'),
      name: clean(o.name, 40),
      summary: clean(o.summary, 120),
      impact: level(o.impact, ['High', 'Medium'], 'High'),
      effort: level(o.effort, ['Low', 'Medium', 'High'], 'Medium'),
    })),
    note: `Based on ${(sources.length ? sources : ['your website', 'public listings', 'local competitors']).join(', ')}. Reviewed ${dateText}.`,
  });
  blocks.push({ type: 'pagebreak' });

  // ── Pages 2–4: the opportunities, then the plan ────────────────────────────
  opps.forEach((o, i) => {
    const no = String(i + 1);
    blocks.push({
      type: 'section',
      number: no.padStart(2, '0'),
      kicker: clean(o.kicker, 30),
      title: clean(o.title, 100),
      // "Your priority" when it answers something they picked in the quiz.
      priority: (answers.focus || []).includes(o.answers_priority) ? clean(o.answers_priority, 60) : '',
      tags: [
        ['Impact', level(o.impact, ['High', 'Medium'], 'High')],
        ['Effort', level(o.effort, ['Low', 'Medium', 'High'], 'Medium')],
      ],
    });
    blocks.push({ type: 'text', body: clean(o.body, 340) });

    const stats = (o.stats || []).filter((x) => x && x.value && x.label).slice(0, 4);
    if (stats.length >= 2) {
      blocks.push({ type: 'stats', items: stats.map((x) => ({ value: clean(x.value, 10), label: clean(x.label, 30) })), source: o.stats_source ? clean(o.stats_source, 100) : undefined });
    }

    const comparison = (o.comparison || []).filter((c) => c && c.label && Number.isFinite(c.value)).slice(0, 4);
    if (comparison.length >= 2) {
      blocks.push({
        type: 'bars',
        figure: `Figure ${++figures}`,
        title: clean(o.comparison_title || 'Comparison', 50),
        items: comparison.map((c) => ({ label: clean(c.label, 36), value: Math.max(0, Math.round(c.value)), highlight: !!c.highlight })),
        caption: o.comparison_caption ? clean(o.comparison_caption, 160) : undefined,
      });
    }

    const findings = (o.findings || []).filter((f) => f && f.title && f.body).slice(0, 3);
    if (findings.length) blocks.push({ type: 'factors', prefix: no, items: findings.map((f) => ({ title: clean(f.title, 70), body: clean(f.body, 200) })) });

    if (o.example && o.example.title && o.example.body) {
      blocks.push({ type: 'example', optional: true, kicker: 'For example', title: clean(o.example.title, 60), body: clean(o.example.body, 280) });
    }

    blocks.push({ type: 'opportunity', title: clean(o.opportunity_title, 90), body: clean(o.opportunity_body, 220) });
    // "First steps": shown when the page has room for it (layout drops optional blocks rather than crowd a page).
    const steps = (o.first_steps || []).map((x) => clean(x, 110)).filter(Boolean).slice(0, 3);
    if (steps.length >= 2) blocks.push({ type: 'firstSteps', optional: true, title: 'First steps', items: steps });
    // One opportunity per page; the last one shares its page with the plan.
    if (i < opps.length - 1) blocks.push({ type: 'pagebreak' });
  });

  blocks.push({ type: 'section', number: '04', kicker: 'Next steps', title: 'Where we would start' });
  blocks.push({
    type: 'roadmap',
    items: (report.next_steps || []).slice(0, 3).map((x, i) => ({
      when: clean(x.timeframe || ['Days 1–30', 'Days 31–60', 'Days 61–90'][i], 20),
      title: clean(x.title, 70),
      body: clean(x.body, 160),
    })),
  });
  blocks.push({
    type: 'cta',
    title: 'Want to talk it through?',
    body: `${clean(report.closing, 200)} 30 minutes, no obligation.`.trim(),
    button: 'Book a free call',
    url: BOOKING_URL,
    note: 'calendly.com/aniket-opika',
  });
  blocks.push({
    type: 'disclaimer',
    text: `Based on public information as of ${dateText}. An outside-in view to start a conversation, not a full audit. Opika · opika.co · info@opika.co`,
  });

  return {
    slug: 'visibility-growth-review',
    title: `Visibility & Growth Review: ${company}`,
    kind: 'Visibility & Growth Review',
    header: { left: 'Visibility & Growth Review', right: `${company}  ·  Confidential` },
    footer: { left: `Opika  ·  opika.co`, right: ref },
    reference: ref,
    date: dateText,
    vars: {},
    blocks,
  };
}

module.exports = { buildReviewDoc, businessName, clean, reference };
