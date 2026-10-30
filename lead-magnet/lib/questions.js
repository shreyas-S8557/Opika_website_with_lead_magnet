// The review quiz: three quick questions on one screen (/review-quiz.js: the homepage popup and
// /free-review). The API validates against this list, and `npm test` checks the quiz contains
// every field and option, so the two can't drift apart.
//
// We ask only what research can't find. Everything else (business name, what they do, where
// they serve, reviews, competitors) comes from their website and public listings: Gemini works
// it out in the research step, and it's saved back to MailerLite with the answers.

const FOCUS_OPTIONS = [
  'Getting found on Google & AI',
  'More reviews & trust',
  'More leads & better follow-up',
  'Saving time with AI & automation',
  'Not sure yet: find the biggest win',
];

const QUESTIONS = [
  // 1. The business. A website, or (no website) the business name and town.
  { id: 'site', label: 'Your website', type: 'site', required: true, max: 200, placeholder: 'yourbusiness.com' },
  // 2. What they want. Tap up to two.
  { id: 'focus', label: 'What would help most right now?', type: 'checkbox', required: true, maxChoices: 2, options: FOCUS_OPTIONS },
  // Optional one-liner, shown under question 2.
  { id: 'note', label: "What's your biggest challenge?", type: 'text', required: false, max: 300, placeholder: 'Optional, e.g. most work comes from referrals' },
  // 3. Where to send it.
  { id: 'first_name', label: 'First name', type: 'text', required: true, max: 60, autocomplete: 'given-name' },
  { id: 'email', label: 'Work email', type: 'email', required: true, max: 254, autocomplete: 'email' },
];

const STEPS = [{ n: 1, title: 'Get your free Visibility & Growth Review', fields: QUESTIONS.map((q) => q.id) }];

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

// Personal mailboxes: their domain says nothing about the business.
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|proton|protonmail|pm|gmx|mail|zoho|yandex|comcast|verizon|att|sbcglobal|bellsouth|cox|charter|rediffmail|qq|163)\./i;

/** "ethanconstruction.com", "https://www.x.co/about" → normalised URL, or '' if it isn't a web address. */
function asUrl(v) {
  const s = String(v || '').trim();
  if (!s || /\s/.test(s.replace(/^https?:\/\//i, '').replace(/\/.*$/, ''))) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(u.hostname)) return '';
    return u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''));
  } catch {
    return '';
  }
}

/** A readable name from a domain, used until research finds the real one: ethan-construction.com → "Ethan Construction". */
function nameFromWebsite(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').split('.')[0];
    return host.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return '';
  }
}

/**
 * Validate + clean a submission. Returns { ok, answers } or { ok: false, errors }.
 * answers has the raw fields plus what we can derive straight away:
 *   website   the URL from `site`, or their email's domain when `site` is a name
 *   company   the business name they typed, or a provisional one from the domain
 *   goal      the focus choices as one line
 */
function validateAnswers(input = {}) {
  const answers = {};
  const errors = {};
  for (const q of QUESTIONS) {
    let v = input[q.id];
    if (q.type === 'checkbox') {
      let arr = (Array.isArray(v) ? v : v ? [v] : []).map(String).filter((x) => q.options.includes(x));
      arr = [...new Set(arr)];
      if (q.maxChoices) arr = arr.slice(0, q.maxChoices);
      if (q.required && !arr.length) errors[q.id] = 'Please choose at least one.';
      answers[q.id] = arr;
      continue;
    }
    v = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
    if (!v) {
      if (q.required) errors[q.id] = 'This field is required.';
      answers[q.id] = '';
      continue;
    }
    if (q.max && v.length > q.max) v = v.slice(0, q.max);
    if (q.type === 'email') {
      v = v.toLowerCase();
      if (!isEmail(v)) errors[q.id] = 'Please enter a valid email address.';
    }
    answers[q.id] = v;
  }

  // Derived fields.
  const url = asUrl(answers.site);
  const domain = answers.email.includes('@') ? answers.email.split('@')[1] : '';
  const workDomain = domain && !FREE_MAIL.test(domain) ? domain : '';
  answers.website = url || (workDomain ? `https://${workDomain}` : '');
  answers.company = url ? nameFromWebsite(url) : answers.site;
  if (!url && answers.site && answers.site.length < 3) errors.site = 'Please enter your website, or your business name and town.';
  answers.goal = answers.focus.join('; ');

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, answers };
}

module.exports = { QUESTIONS, STEPS, FOCUS_OPTIONS, validateAnswers, isEmail, asUrl, nameFromWebsite };
