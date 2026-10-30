// Offline end-to-end tests: fake Gemini + fake MailerLite, real PDF rendering.
//   npm test
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ethanAnswers = require('../samples/ethan-answers.json');
const ethanReport = require('../samples/ethan-report.json');

// ---------- fake services ----------
// Google Sheets: the real google-sheets/Code.gs, run against an in-memory spreadsheet.
const vm = require('vm');
const sheetRows = []; // row arrays, 1-based in the API
const appsScript = (() => {
  const sheet = {
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((sheetRows[r - 1 + i] || [])[c - 1 + j] ?? ''))),
      setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { (sheetRows[r - 1 + i] = sheetRows[r - 1 + i] || [])[c - 1 + j] = x; })); return this; },
      setValue(x) { (sheetRows[r - 1] = sheetRows[r - 1] || [])[c - 1] = x; return this; },
      setFontWeight() { return this; },
    }),
    appendRow: (row) => sheetRows.push(row),
    getLastRow: () => sheetRows.length,
    setFrozenRows() {},
  };
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => (sheetRows.length ? sheet : null), insertSheet: () => sheet }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'OPIKA_TOKEN' ? 'sheet-secret' : null) }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'google-sheets', 'Code.gs'), 'utf8'), ctx);
  return ctx;
})();
const sheetCol = (name) => sheetRows[0].indexOf(name);

const ml = { subs: {}, memberships: new Set(), calls: [], fields: ['name', 'company'], groups: [] };
const mlc = { subs: {}, members: new Set(), calls: [], fields: ['email', 'name', 'company'], groups: [{ id: 1, name: 'Opika Subscribe Form' }] };
const gemini = { down: false, hang: false, calls: [], badFirstWrite: false, retired: null, models: [], oneCallFails: false, rateLimitOnce: false, dailyQuota: null };

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const body = init.body ? JSON.parse(init.body) : null;
  const json = (status, data) => ({ ok: status < 300, status, headers: new Map(), json: async () => data, text: async () => (data ? JSON.stringify(data) : '') });

  if (u.hostname === 'generativelanguage.googleapis.com') {
    assert.strictEqual(init.headers['x-goog-api-key'], 'test-gemini');
    const model = u.pathname.split('/').pop().split(':')[0];
    gemini.models.push(model);
    if (gemini.down) return json(400, { error: { code: 400, message: 'API key not valid' } });
    if (gemini.hang) await new Promise((r) => setTimeout(r, 1500));
    if (gemini.retired && model === gemini.retired) return json(404, { error: { message: `models/${model} is no longer available` } });
    if (gemini.dailyQuota && model === gemini.dailyQuota) return json(429, { error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 20', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } });
    if (gemini.rateLimitOnce) {
      gemini.rateLimitOnce = false;
      return json(429, { error: { code: 429, message: 'Resource exhausted', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0.01s' }] } });
    }
    gemini.calls.push(body);
    const oneCall = !!body.tools && !!(body.generationConfig && body.generationConfig.responseSchema);
    const isResearch = !!body.tools && !oneCall;
    let text;
    if (oneCall) text = gemini.oneCallFails ? 'Sorry, here are some notes instead of JSON' : JSON.stringify({ ...ethanReport, research_notes: '- Southlake remodeler, 1 Google review' });
    else if (isResearch) text = '- Website covers kitchens, bathrooms, Southlake and Grapevine pages\n- Google: 1 review, hours 9-5\n- Competitors: Swanson Renovations (23 reviews)';
    else if (gemini.badFirstWrite) {
      gemini.badFirstWrite = false;
      text = '{"headline": "oops"}';
    } else text = JSON.stringify(ethanReport);
    return json(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
  }

  // A prospect's website, for the fallback's site checks.
  if (u.hostname === 'ethanconstruction.example') {
    const page = (status, text) => ({ ok: status < 300, status, url: String(url), headers: new Map(), text: async () => text });
    if (u.pathname === '/') return page(200, `<!doctype html><html><head><title>Ethan Construction | Remodeling in Southlake, TX</title>
      <meta name="viewport" content="width=device-width"></head><body><h1>Kitchen and bath remodeling</h1>
      <a href="/contact">Get a free estimate</a><p>Call us: 817-555-0100</p></body></html>`);
    if (u.pathname === '/robots.txt') return page(200, 'User-agent: *');
    return page(404, 'Not found');
  }

  if (u.hostname === 'script.google.com') {
    const out = appsScript.doPost({ postData: { type: 'application/json', contents: init.body } });
    return { ok: true, status: 200, headers: new Map(), json: async () => JSON.parse(out.text) };
  }

  // MailerLite Classic (api.mailerlite.com/api/v2)
  if (u.hostname === 'api.mailerlite.com') {
    assert.strictEqual(init.headers['X-MailerLite-ApiKey'], '0123456789abcdef0123456789abcdef');
    const p = u.pathname.replace('/api/v2', '');
    const m = init.method;
    mlc.calls.push(`${m} ${p}`);
    if (m === 'GET' && p === '/fields') return json(200, mlc.fields.map((k) => ({ id: 1, title: k, key: k, type: 'TEXT' })));
    if (m === 'POST' && p === '/fields') return mlc.fields.push(body.title), json(200, { id: 2, title: body.title, key: body.title, type: 'TEXT' });
    if (m === 'GET' && p === '/groups') return json(200, mlc.groups);
    if (m === 'POST' && p === '/groups') return mlc.groups.push({ id: 4242, name: body.name }), json(200, { id: 4242, name: body.name });
    const gm = p.match(/^\/groups\/(\d+)\/subscribers(?:\/(.+))?$/);
    if (gm && m === 'DELETE') return mlc.members.delete(gm[1] + ':' + decodeURIComponent(gm[2])) ? json(204) : json(404, { error: { code: 123, message: 'Subscriber not found' } });
    if (gm && m === 'POST') {
      mlc.members.add(gm[1] + ':' + body.email);
      mlc.subs[body.email] = body;
      return json(200, { id: 99, email: body.email, name: body.name, type: 'active', fields: [] });
    }
  }

  if (u.hostname === 'connect.mailerlite.com') {
    const p = u.pathname.replace('/api', '');
    const m = init.method;
    ml.calls.push(`${m} ${p}`);
    if (m === 'GET' && p === '/fields') return json(200, { data: ml.fields.map((k) => ({ key: k, name: k })) });
    if (m === 'POST' && p === '/fields') return ml.fields.push(body.name), json(201, { data: { key: body.name } });
    if (m === 'GET' && p === '/groups') return json(200, { data: ml.groups.filter((g) => g.name === decodeURIComponent((u.search.match(/filter\[name\]=([^&]*)/) || [])[1] || '')) });
    if (m === 'POST' && p === '/groups') return ml.groups.push({ id: '777', name: body.name }), json(201, { data: { id: '777', name: body.name } });
    if (m === 'POST' && p === '/subscribers') {
      const s = ml.subs[body.email] || { id: 'sub' + (Object.keys(ml.subs).length + 1), status: 'active', fields: {} };
      Object.assign(s.fields, body.fields);
      ml.subs[body.email] = s;
      return json(200, { data: s });
    }
    const mm = p.match(/^\/subscribers\/(\w+)\/groups\/(\w+)$/);
    if (mm && m === 'DELETE') return ml.memberships.delete(mm[1] + ':' + mm[2]) ? json(204) : json(404, { message: 'nope' });
    if (mm && m === 'POST') return ml.memberships.add(mm[1] + ':' + mm[2]), json(200, { data: {} });
  }
  return json(404, { message: 'unexpected ' + url });
};

process.env.GEMINI_API_KEY = 'test-gemini';
process.env.MAILERLITE_API_KEY = 'eyJ-test-new-mailerlite-token';
delete process.env.MAILERLITE_GROUP_ID; // the site finds/creates the group by name
process.env.SHEETS_WEBHOOK_URL = 'https://script.google.com/macros/s/TEST/exec';
process.env.SHEETS_TOKEN = 'sheet-secret';
delete process.env.BLOB_READ_WRITE_TOKEN;

const { validateAnswers, QUESTIONS, STEPS } = require('../lib/questions');
const { generateReport } = require('../lib/gemini');
const { buildReviewDoc, clean } = require('../lib/template');
const { runReview } = require('../lib/pipeline');

const pages = (file) => (fs.readFileSync(file, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

async function main() {
  // 1. answers validation (3 questions) and what's derived from them
  let v = validateAnswers(ethanAnswers);
  assert(v.ok, JSON.stringify(v.errors));
  assert.strictEqual(v.answers.website, 'https://ethanconstruction.example');
  assert.strictEqual(v.answers.goal, 'Getting found on Google & AI; More reviews & trust');
  v = validateAnswers({ ...ethanAnswers, email: 'nope', site: '', focus: ['Hack the planet'] });
  assert(!v.ok && v.errors.email && v.errors.site && v.errors.focus);
  v = validateAnswers({ ...ethanAnswers, site: 'www.acme.com/', focus: ['More reviews & trust', 'evil', 'More leads & better follow-up', 'Saving time with AI & automation'] });
  assert(v.ok, JSON.stringify(v.errors));
  assert.strictEqual(v.answers.website, 'https://www.acme.com');
  assert.deepStrictEqual(v.answers.focus, ['More reviews & trust', 'More leads & better follow-up'], 'focus filtered and capped at 2');
  // No website: business name typed instead; a work email's domain becomes the website, a Gmail address doesn't.
  v = validateAnswers({ ...ethanAnswers, site: 'Bright Smile Dental, Austin TX', email: 'ana@brightsmile.com' });
  assert.strictEqual(v.answers.website, 'https://brightsmile.com');
  assert.strictEqual(v.answers.company, 'Bright Smile Dental, Austin TX');
  v = validateAnswers({ ...ethanAnswers, site: 'Bright Smile Dental, Austin TX', email: 'ana@gmail.com' });
  assert.strictEqual(v.answers.website, '');
  console.log('✓ answer validation (3 questions, website or business name, work-email domain)');

  // 2. the quiz (review-quiz.js, used by the homepage popup and /free-review) matches the questions, on one screen
  const form = fs.readFileSync(path.join(ROOT, 'review-quiz.js'), 'utf8');
  for (const q of QUESTIONS) assert(form.includes(`name="${q.id}"`) || form.includes(`checks('${q.id}'`), `quiz is missing field ${q.id}`);
  for (const q of QUESTIONS.filter((x) => x.options)) for (const o of q.options) assert(form.includes(`'${o.replace(/'/g, "\\'")}'`), `quiz is missing option ${o}`);
  assert.strictEqual(STEPS.length, 1);
  assert.strictEqual((form.match(/class="rq-qn">/g) || []).length, 3, 'quiz shows three numbered questions');
  assert(!/rq-step/.test(form), 'quiz is a single screen');
  for (const page of ['index.html', 'free-review.html']) assert(fs.readFileSync(path.join(ROOT, page), 'utf8').includes('/review-quiz.js'), `${page} loads the quiz`);
  console.log('✓ quiz matches lead-magnet/lib/questions.js (3 questions, one screen), loaded on / and /free-review');

  const A = validateAnswers(ethanAnswers).answers;
  const noWait = { wait: async () => {} };

  // 3. Default: ONE request that searches (Google Search tool) and writes structured JSON together
  let out = await generateReport(A, noWait);
  assert.strictEqual(gemini.calls.length, 1, 'one request per review');
  assert.deepStrictEqual(gemini.calls[0].tools, [{ google_search: {} }]);
  assert(gemini.calls[0].generationConfig.responseSchema.properties.personal_note);
  assert.strictEqual(out.mode, 'one-call');
  assert(out.notes.includes('Southlake'), 'research notes kept for spot-checking');
  {
    const text = gemini.calls[0].contents[0].parts[0].text;
    assert(text.includes('Getting found on Google & AI; More reviews & trust'), 'Gemini sees what would help most');
    assert(text.includes('rarely show up when people search'), 'Gemini sees their challenge in their words');
    assert(text.includes('Never reuse its names'), 'example is for structure only');
  }
  console.log('✓ Gemini: one request searches and writes, personalised with their priorities and challenge');

  // 3b. If the one-call answer is unusable, fall back to the two-step pipeline (research, then write; bad JSON retried)
  gemini.calls.length = 0;
  gemini.oneCallFails = true;
  gemini.badFirstWrite = true;
  out = await generateReport(A, noWait);
  gemini.oneCallFails = false;
  assert.strictEqual(out.mode, 'two-step');
  assert.strictEqual(gemini.calls.length, 4, 'one-call + research + failed write + retry');
  assert(!gemini.calls[1].generationConfig || !gemini.calls[1].generationConfig.responseSchema, 'research call is plain text');
  assert(gemini.calls[2].contents[0].parts[0].text.includes('Competitors: Swanson'), 'research notes are passed to the writer');
  assert(gemini.calls[3].contents[0].parts[0].text.includes('rarely show up when people search'));
  assert.strictEqual(out.report.opportunities.length, 3);
  // GEMINI_TWO_STEP=1 forces the two-step pipeline
  gemini.calls.length = 0;
  process.env.GEMINI_TWO_STEP = '1';
  out = await generateReport(A, noWait);
  delete process.env.GEMINI_TWO_STEP;
  assert.strictEqual(gemini.calls.length, 2);
  console.log('✓ Gemini: falls back to research → write (with retry); GEMINI_TWO_STEP=1 forces it');

  // 3c. free-tier limits: a per-minute 429 waits and retries; a used-up daily quota moves to the next model
  gemini.calls.length = 0;
  gemini.models.length = 0;
  gemini.rateLimitOnce = true;
  const waits = [];
  out = await generateReport(A, { wait: async (ms) => waits.push(ms) });
  assert.strictEqual(waits.length, 1);
  assert(waits[0] >= 10 && waits[0] < 1000, 'uses the delay Google asks for');
  assert.strictEqual(out.mode, 'one-call');
  gemini.models.length = 0;
  gemini.dailyQuota = 'gemini-3.8-flash';
  out = await generateReport(A, noWait);
  gemini.dailyQuota = null;
  assert.deepStrictEqual(gemini.models.slice(0, 2), ['gemini-3.8-flash', 'gemini-flash-latest'], 'daily quota used up → next model');
  assert.strictEqual(out.mode, 'one-call');
  console.log('✓ Gemini: waits and retries on rate limits, switches model when a daily free quota runs out');

  // 3d. a retired model (404) falls back to the next one; no temperature override on Gemini 3
  gemini.retired = 'gemini-3.8-flash';
  gemini.models.length = 0;
  await generateReport(A, noWait);
  assert.deepStrictEqual(gemini.models.slice(0, 2), ['gemini-3.8-flash', 'gemini-flash-latest']);
  assert(!('temperature' in gemini.calls[gemini.calls.length - 1].generationConfig), 'no temperature override on Gemini 3');
  gemini.retired = null;
  console.log('✓ Gemini model fallback when a model is retired');

  // 4. template safety
  assert.strictEqual(clean('Visit [our site](https://evil.example) <script>x</script>{{company}} https://x.io/a'), 'Visit our site xcompany x.io/a');
  const doc = buildReviewDoc(ethanReport, ethanAnswers);
  assert.deepStrictEqual(
    doc.blocks.filter((b) => b.type === 'section').map((b) => b.number),
    [undefined, '01', '02', '03', '04']
  );
  assert.strictEqual(doc.blocks[0].type, 'titleBand');
  assert(/^OPK-\d{4}-ETHA-[0-9A-F]{4}$/.test(doc.reference), doc.reference);
  assert.throws(() => buildReviewDoc({ ...ethanReport, opportunities: [] }, ethanAnswers));
  const pa = buildReviewDoc(ethanReport, validateAnswers(ethanAnswers).answers);
  const note = pa.blocks.find((b) => b.type === 'note');
  assert(note && note.text.startsWith('Ethan,') && note.asked.includes('Getting found on Google & AI'), 'personal note + what they asked for');
  assert.deepStrictEqual(pa.blocks.filter((b) => b.type === 'section' && b.number && b.number !== '04').map((b) => b.priority), ['Getting found on Google & AI', 'More reviews & trust', ''], '"Your priority" tags');
  console.log('✓ template mapping + sanitising, personal note and "Your priority" tags');

  // 4b. layout: rich and sparse reports both come out at 3-4 pages
  const { renderPDF } = require('../lib/pdf');
  const sparse = JSON.parse(JSON.stringify(ethanReport));
  sparse.opportunities.forEach((o) => { delete o.stats; delete o.comparison; delete o.example; delete o.outputs; if (!o.findings) o.findings = [{ title: 'A', body: 'B' }, { title: 'C', body: 'D' }]; });
  // A long report: every text field at its maximum length, plus a fourth finding everywhere.
  const long = JSON.parse(JSON.stringify(ethanReport));
  long.opportunities.forEach((o) => {
    o.body = (o.body + ' ').repeat(3).slice(0, 900);
    o.findings = [...(o.findings || []), ...(o.findings || []), { title: 'Extra finding', body: 'x '.repeat(100) }].slice(0, 4);
  });
  for (const [name, rep] of [['rich', ethanReport], ['sparse', sparse], ['long', long]]) {
    const out = await renderPDF(buildReviewDoc(rep, ethanAnswers));
    assert(out.pages >= 3 && out.pages <= 4, `${name} report should be 3-4 pages, got ${out.pages}`);
    assert(Math.min(...out.zooms) >= (name === 'long' ? 0.71 : 0.79), `${name} report text shrunk too far: ${out.zooms}`);
    console.log(`  ${name}: ${out.pages} pages, text at ${Math.round(Math.min(...out.zooms) * 100)}%`);
  }
  console.log('✓ layout: 3-4 pages for rich, sparse and long reports');

  // 4c. deterministic fallback: Gemini fails → real site checks + pre-written sections, same PDF and email
  const { siteChecks, fallbackReport } = require('../lib/fallback');
  const { validate } = require('../lib/gemini');
  const site = await siteChecks('https://ethanconstruction.example');
  assert(site.reached && site.name === 'Ethan Construction', 'business name read from the page title');
  assert.strictEqual(site.checks.description, false, 'no meta description');
  assert.strictEqual(site.checks.schema, false, 'no structured data');
  assert.strictEqual(site.checks.llms, false);
  assert.strictEqual(site.checks.cta, true, '"free estimate" is a call to action');
  assert.strictEqual(site.checks.phone, false, 'number is not a tel: link');
  const fb = fallbackReport(A, site);
  assert.deepStrictEqual(validate(fb), [], 'fallback has the same shape as a Gemini report');
  assert.deepStrictEqual(fb.opportunities.map((o) => o.answers_priority), ['Getting found on Google & AI', 'More reviews & trust', ''], 'their priorities first');
  assert(fb.personal_note.startsWith('Ethan, you told us') && fb.personal_note.includes('rarely show up'), 'personal note uses their answers');
  assert(fb.opportunities[0].findings.some((f) => /structured data/i.test(f.title)), 'findings come from the checks');
  assert(fb.opportunities[0].stats[0].value === '0/6' || /\d\/6/.test(fb.opportunities[0].stats[0].value));
  assert.strictEqual(fallbackReport(A, await siteChecks('')).sources_reviewed.join(), 'your answers', 'no website: answers only, no checks claimed');
  const fbPdf = await renderPDF(buildReviewDoc(fb, A));
  assert(fbPdf.pages >= 3 && fbPdf.pages <= 4);
  // In the pipeline: Gemini down → fallback review is still built and emailed
  gemini.down = true;
  const urlBefore = ml.subs['ethan@ethanconstruction.example'] ? ml.subs['ethan@ethanconstruction.example'].fields.lm_url : null;
  const fr = await runReview(A, { gemini: noWait });
  gemini.down = false;
  assert.strictEqual(fr.mode, 'fallback');
  assert.notStrictEqual(ml.subs['ethan@ethanconstruction.example'].fields.lm_url, urlBefore, 'fallback review was delivered');
  // Gemini hangs → the deadline hands over to the fallback
  gemini.hang = true;
  const t0 = Date.now();
  const hung = await runReview(A, { gemini: noWait, send: false, deadline: 200 });
  gemini.hang = false;
  assert.strictEqual(hung.mode, 'fallback');
  assert(Date.now() - t0 < 1400 + 5000, 'did not wait for the stuck request');
  await new Promise((r) => setTimeout(r, 1600)); // let the stuck fake request finish
  process.env.REVIEW_FALLBACK = '0';
  gemini.down = true;
  await assert.rejects(runReview(A, { gemini: noWait, send: false }), /API key not valid/);
  gemini.down = false;
  delete process.env.REVIEW_FALLBACK;
  console.log(`✓ fallback: site checks → ${fbPdf.pages}-page review in the same format, delivered when Gemini fails (REVIEW_FALLBACK=0 turns it off)`);

  // 5. full pipeline: Gemini → PDF → storage → MailerLite
  ml.calls.length = 0;
  const r = await runReview(validateAnswers(ethanAnswers).answers);
  const file = r.url.replace('file://', '');
  const n = pages(file);
  assert(n >= 3 && n <= 4, `review should be 3-4 pages, got ${n}`);
  const sub = ml.subs['ethan@ethanconstruction.example'];
  assert.strictEqual(sub.fields.lm_url, r.url);
  assert.strictEqual(sub.fields.lm_title, 'Visibility & Growth Review');
  assert.strictEqual(sub.fields.company, 'Ethan Construction');
  assert.strictEqual(sub.fields.name, 'Ethan');
  assert.strictEqual(sub.fields.lm_opp1, 'Get discovered');
  assert.strictEqual(sub.fields.lm_pages, String(n));
  assert(sub.fields.lm_ref.startsWith('OPK-'));
  assert.strictEqual(sub.fields.lead_industry, 'Residential remodeling', 'industry comes from research');
  assert.strictEqual(sub.fields.lead_focus, 'Getting found on Google & AI; More reviews & trust');
  assert(r.url.includes('ethan-construction-'), 'PDF is named after the business research found');
  const { LM_FIELDS, LEAD_FIELDS } = require('../lib/mailerlite');
  for (const k of Object.keys(sub.fields).filter((k) => /^(lm|lead)_/.test(k))) assert([...LM_FIELDS, ...LEAD_FIELDS].includes(k), `field ${k} is not created by setup-mailerlite`);
  const email = fs.readFileSync(path.join(__dirname, '..', 'email', 'review-email.html'), 'utf8');
  for (const k of (email.match(/\{\$(lm_\w+)/g) || []).map((m) => m.slice(2))) assert(k in sub.fields, `email uses {$${k}} but it is never set`);
  assert(ml.memberships.has(`${sub.id}:777`), 'added to the delivery group found/created by name');
  const { LM_FIELDS: LMF, LEAD_FIELDS: LDF } = require('../lib/mailerlite');
  for (const f of [...LMF, ...LDF]) assert(ml.fields.includes(f), `field ${f} was created automatically`);
  assert.strictEqual(ml.groups.length, 1, 'group created once');
  console.log(`✓ pipeline: ${n}-page PDF, MailerLite fields set, added to delivery group`);

  // 6. API route
  const handler = require(path.join(ROOT, 'api', 'review.js'));
  const call = async (body, method = 'POST') => {
    const res = { code: 0, h: {}, setHeader(k, val) { this.h[k] = val; }, status(c) { this.code = c; return this; }, json(d) { this.data = d; return this; } };
    await handler({ method, headers: { 'content-type': 'application/json' }, body }, res);
    return res;
  };
  let res = await call({ ...ethanAnswers, email: 'sam@acme.com', site: 'acmehvac.com', first_name: 'Sam' });
  assert.strictEqual(res.code, 202, JSON.stringify(res.data));
  assert(res.data.message.includes('Sam'));
  for (let i = 0; i < 100 && !ml.subs['sam@acme.com']; i++) await new Promise((t) => setTimeout(t, 200));
  assert(ml.subs['sam@acme.com'], 'background job delivered the review');
  res = await call({ ...ethanAnswers, email: 'bad' });
  assert.strictEqual(res.code, 400);
  assert(res.data.errors.email);
  const before = Object.keys(ml.subs).length;
  res = await call({ ...ethanAnswers, email: 'bot@spam.co', website_url: 'http://spam' });
  assert.strictEqual(res.code, 200);
  await new Promise((t) => setTimeout(t, 500));
  assert.strictEqual(Object.keys(ml.subs).length, before, 'honeypot submissions do nothing');
  res = await call({}, 'GET');
  assert.strictEqual(res.code, 405);
  console.log('✓ /api/review: 202 + background delivery, validation, honeypot, method check');

  // 6b. MailerLite Classic account (app.mailerlite.com): detected from the key, same delivery
  const mailerliteLib = require('../lib/mailerlite');
  assert(mailerliteLib.isClassicKey('0123456789abcdef0123456789abcdef'));
  assert(!mailerliteLib.isClassicKey('eyJ0eXAiOiJKV1Qi.abc'));
  process.env.MAILERLITE_API_KEY = '0123456789abcdef0123456789abcdef';
  const cr = await runReview(A, { gemini: noWait });
  const cs = mlc.subs['ethan@ethanconstruction.example'];
  assert(cs, 'subscriber added through the Classic API');
  assert(mlc.members.has('4242:ethan@ethanconstruction.example'), 'joined the delivery group (created by name)');
  assert.strictEqual(mlc.groups.filter((g) => g.name === 'Opika · Visibility review delivery').length, 1);
  assert.strictEqual(cs.fields.lm_url, cr.url);
  assert.strictEqual(cs.fields.lm_opp1, 'Get discovered');
  assert.strictEqual(cs.fields.company, 'Ethan Construction');
  assert.strictEqual(cs.name, 'Ethan');
  assert.strictEqual(cs.autoresponders, true, 'automations allowed to fire');
  for (const f of [...mailerliteLib.LM_FIELDS, ...mailerliteLib.LEAD_FIELDS]) assert(mlc.fields.includes(f), `Classic field ${f} created`);
  await runReview(A, { gemini: noWait });
  assert(mlc.calls.includes('DELETE /groups/4242/subscribers/ethan%40ethanconstruction.example'), 'second request leaves and re-joins so the automation fires again');
  process.env.MAILERLITE_API_KEY = 'eyJ-test-new-mailerlite-token';
  console.log('✓ MailerLite Classic: detected from the key; fields, group and delivery through api.mailerlite.com/api/v2');

  // 7. Google Sheets log (real Code.gs): a row per submission, updated when the review is sent or fails
  const { processSubmission } = require('../lib/pipeline');
  const sheets = require('../lib/sheets');
  sheetRows.length = 0;
  const ok1 = await processSubmission({ ...A, email: 'lee@leehvac.com', note: '=HYPERLINK("http://evil")' }, { gemini: noWait, send: false });
  assert.deepStrictEqual(sheetRows[0].slice(0, 11), ['Timestamp', 'Name', 'Email', 'Company', 'Website', 'Priority', 'Friction', 'Status', 'Report URL', 'Email Status', 'Error'], 'original columns unchanged');
  let row = sheetRows[1];
  assert.strictEqual(row[sheetCol('Submission ID')], ok1.id);
  assert.strictEqual(row[sheetCol('Status')], 'Sent');
  assert.strictEqual(row[sheetCol('Review Type')], 'Gemini');
  assert.strictEqual(row[sheetCol('Report URL')], ok1.url);
  assert.strictEqual(row[sheetCol('Company')], 'Ethan Construction', 'company updated to the researched name');
  assert.strictEqual(row[sheetCol('Priority')], 'Getting found on Google & AI; More reviews & trust');
  assert(row[sheetCol('Friction')].startsWith("'="), 'formulas typed into the form are neutralised');
  gemini.down = true;
  const fb2 = await processSubmission(A, { gemini: noWait, send: false });
  gemini.down = false;
  row = sheetRows[2];
  assert.strictEqual(row[sheetCol('Status')], 'Sent (fallback review)');
  assert.strictEqual(row[sheetCol('Review Type')], 'Fallback (no AI)');
  assert(row[sheetCol('Error')].includes('API key not valid'), 'why Gemini failed is recorded');
  const failed = await processSubmission(A, { gemini: noWait, send: false, report: { opportunities: [] } });
  assert(failed.error);
  assert.strictEqual(sheetRows[3][sheetCol('Status')], 'Failed');
  assert(sheetRows[3][sheetCol('Error')].includes('three opportunities'));
  // wrong token is refused; no URL configured = sheet logging quietly off
  process.env.SHEETS_TOKEN = 'wrong';
  assert.strictEqual((await sheets.logSubmission('X', A)).error, 'Unauthorized');
  process.env.SHEETS_TOKEN = 'sheet-secret';
  const url = process.env.SHEETS_WEBHOOK_URL;
  delete process.env.SHEETS_WEBHOOK_URL;
  assert.strictEqual(await sheets.logSubmission('X', A), null);
  process.env.SHEETS_WEBHOOK_URL = url;
  assert.strictEqual(sheetRows.length, 4);
  console.log('✓ Google Sheets (real Code.gs): row per submission → Sent / Sent (fallback review) / Failed, token checked, formulas neutralised');

  console.log('\nAll tests passed.');
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
