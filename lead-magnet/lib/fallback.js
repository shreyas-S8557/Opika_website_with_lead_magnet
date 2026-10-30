// Deterministic fallback: a complete review without Gemini.
//
// Used when Gemini fails for any reason (no key, quota used up, outage, timeout, unusable output),
// so every prospect still gets a review in their inbox. It is built from:
//   1. their quiz answers (priorities, challenge, first name), and
//   2. real, verifiable checks of their homepage that we run ourselves (title, description,
//      structured data, sitemap, llms.txt, contact form, phone link, call to action, reviews...).
// The output has exactly the shape Gemini returns (see REPORT_SCHEMA), so the same template,
// PDF and email are used. Nothing here is invented: every finding is either a check result or
// general guidance phrased as such.

const { nameFromWebsite } = require('./questions');

const UA = 'Mozilla/5.0 (compatible; OpikaReview/1.0; +https://opika.co)';
const MAX_HTML = 1500000;

async function get(url, { fetchImpl = globalThis.fetch, timeout = 10000 } = {}) {
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
    const text = res.ok ? (await res.text()).slice(0, MAX_HTML) : '';
    return { ok: res.ok, status: res.status, url: res.url || url, text };
  } catch {
    return { ok: false, status: 0, url, text: '' };
  }
}

const strip = (s = '') => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const meta = (html, re) => {
  const m = html.match(re);
  return m ? strip(m[1]) : '';
};

function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      const walk = (x) => {
        if (Array.isArray(x)) x.forEach(walk);
        else if (x && typeof x === 'object') {
          if (x['@type']) out.push(x);
          if (x['@graph']) walk(x['@graph']);
        }
      };
      walk(data);
    } catch {}
  }
  return out;
}

const humanType = (t) =>
  String(Array.isArray(t) ? t[0] : t || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\bAnd\b/g, '&')
    .trim();

/**
 * Check a website's homepage. Every result is a plain fact we can stand behind.
 * Returns { reached, host, name, description, location, industry, checks: {id: true|false} }.
 */
async function siteChecks(website, opts = {}) {
  const empty = { reached: false, host: '', name: '', description: '', location: '', industry: '', checks: {} };
  if (!website) return empty;
  let base;
  try {
    base = new URL(website);
  } catch {
    return empty;
  }
  const home = await get(base.origin + base.pathname, opts);
  if (!home.ok || !home.text) return { ...empty, host: base.hostname.replace(/^www\./, '') };
  const html = home.text;
  const finalUrl = new URL(home.url || base.href);
  const [llms, sitemap, robots] = await Promise.all([
    get(finalUrl.origin + '/llms.txt', { ...opts, timeout: 6000 }),
    get(finalUrl.origin + '/sitemap.xml', { ...opts, timeout: 6000 }),
    get(finalUrl.origin + '/robots.txt', { ...opts, timeout: 6000 }),
  ]);

  const ld = jsonLd(html);
  const types = ld.map((x) => [].concat(x['@type'])).flat().map(String);
  const biz = ld.find((x) => x.name && !/^(WebSite|WebPage|BreadcrumbList|FAQPage|ImageObject|SiteNavigationElement)$/.test(String([].concat(x['@type'])[0]))) || {};
  const addr = biz.address && (Array.isArray(biz.address) ? biz.address[0] : biz.address);
  const title = meta(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = meta(html, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || meta(html, /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
  const siteName = meta(html, /<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']*)["']/i);
  const text = strip(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')).toLowerCase();
  const isText = (r) => r.ok && r.text && !/<html/i.test(r.text.slice(0, 500));

  const checks = {
    https: finalUrl.protocol === 'https:',
    title: title.length >= 10 && title.length <= 70,
    description: description.length >= 50,
    h1: /<h1[\s>]/i.test(html),
    mobile: /<meta[^>]+name=["']viewport["']/i.test(html),
    schema: types.length > 0,
    faq: types.includes('FAQPage') || /href=["'][^"']*faq/i.test(html) || /frequently asked/.test(text),
    llms: isText(llms) && llms.text.trim().length > 20,
    sitemap: (sitemap.ok && /<(urlset|sitemapindex)/i.test(sitemap.text)) || /sitemap:/i.test(robots.text || ''),
    phone: /href=["']tel:/i.test(html),
    form: /<form[\s>]/i.test(html) || /calendly|hubspot|typeform|jotform|wufoo|tally\.so/i.test(html),
    cta: /\b(book|schedule|get (a|your) (free )?(quote|estimate)|request (a )?(quote|estimate|consultation)|free consultation|appointment)\b/.test(text),
    proof: /testimonial|what (our )?(clients|customers|patients|homeowners) (say|are saying)|★|\b\d(\.\d)? ?(out of 5|stars?)\b|google reviews|(read|see) (our|more|all) reviews|\d+\+? (five-star |5-star )?reviews/.test(text) || types.includes('AggregateRating') || types.includes('Review') || !!biz.aggregateRating,
    maps: /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|g\.page\//i.test(html),
  };

  return {
    reached: true,
    host: finalUrl.hostname.replace(/^www\./, ''),
    name: strip(String(biz.name || siteName || title.split(/\s[|\-–—:·]\s/)[0] || '')).slice(0, 80),
    description: description.slice(0, 160),
    location: addr ? [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', ') : '',
    industry: biz['@type'] && !/^(Organization|LocalBusiness|Corporation|Thing)$/.test(String([].concat(biz['@type'])[0])) ? humanType(biz['@type']) : '',
    checks,
  };
}

// ── The content library: one opportunity per quiz priority ──────────────────────────────────
// `fails` lists checks whose failure becomes a finding (most important first); `general` is
// guidance used to make up two findings when the site passes, or couldn't be checked.
const LIBRARY = {
  'Getting found on Google & AI': {
    name: 'Get discovered',
    kicker: 'Visibility',
    effort: 'Low',
    title: (co) => `Make ${co} easy for Google and AI to understand.`,
    body: () => 'When someone asks Google or ChatGPT for help, the answer comes from what those tools can read and verify. Clear, consistent signals decide who gets recommended.',
    summary: 'Clear, consistent signals decide who Google and AI assistants recommend.',
    fails: {
      schema: ['No structured data found', 'The homepage has no schema markup telling search engines and AI who you are, what you do and where.'],
      description: ['No search description', 'The homepage has no meta description, so Google writes its own snippet for you.'],
      llms: ['No llms.txt file', 'An llms.txt file gives AI assistants a plain summary of your business. Yours is missing.'],
      faq: ['No FAQ for customers', "We didn't find an FAQ. Answering real customer questions is what AI assistants quote."],
      sitemap: ['No sitemap found', 'Without a sitemap, search engines may miss some of your pages.'],
      title: ['Page title needs work', 'The homepage title is missing or too long to show cleanly in search results.'],
    },
    general: [
      ['Consistency across listings', 'Name, services, hours and area should match everywhere: website, Google profile and directories.'],
      ['Answers to real questions', 'Pages that answer what customers actually ask are what AI assistants cite.'],
    ],
    recommendation: (co) => [`One clear, consistent version of ${co} online`, 'Align listings, add structured data and answer your top customer questions, so Google and AI can recommend you with confidence.'],
    example: (co) => ['Someone asks an AI assistant for a recommendation', `It suggests businesses it can describe with confidence. If ${co}'s services, area and reviews read the same everywhere, ${co} is easier to recommend.`],
    firstSteps: ['Make your name, hours, services and area identical everywhere you appear.', 'Add schema markup and an llms.txt file describing the business.', 'Publish answers to the ten questions customers ask most.'],
    step: ['Fix the visibility foundation', 'Align your listings, add structured data and answer top customer questions.'],
  },
  'More reviews & trust': {
    name: 'Show the proof',
    kicker: 'Proof',
    effort: 'Medium',
    title: (co) => `${co}'s proof should be as visible as its work.`,
    body: () => 'Most buyers compare options before they get in touch, and reviews and real examples are what they compare. Proof grows fastest when collecting it is a routine.',
    summary: 'Make reviews and real results as visible as the work itself.',
    fails: {
      proof: ['No customer proof on the homepage', "We didn't find reviews or testimonials where first-time visitors decide whether to trust you."],
      maps: ['No link to your Google reviews', 'A link to your Google profile lets visitors check your reviews in one click.'],
    },
    general: [
      ['Review requests by routine', 'Asking every happy customer at the right moment is the most reliable way to grow reviews.'],
      ['Results told as stories', 'A short before-and-after story does more than a long list of services.'],
    ],
    recommendation: () => ['Make proof a by-product of every job', 'Ask for a review and capture a short story each time a job is done, so proof grows with the work.'],
    example: (co) => ['A job finishes on a Friday', `The customer gets a thank-you with a one-tap review link that evening, and ${co} adds two photos and a sentence to the website. Each job leaves proof behind.`],
    firstSteps: ['Send a review link to your last five happy customers this week.', 'Add a review request to the moment every job is finished.', 'Put two short customer stories on the homepage.'],
    step: ['Make proof part of every job', 'Ask for a review and capture a short story when each job is done.'],
  },
  'More leads & better follow-up': {
    name: 'Catch every lead',
    kicker: 'Follow-up',
    effort: 'Low',
    title: (co) => `Turn more of ${co}'s visitors into conversations.`,
    body: () => 'People usually contact the first business that responds clearly and quickly. How enquiries are captured and followed up often matters more than more traffic.',
    summary: 'Capture more enquiries and reply faster than competitors.',
    fails: {
      cta: ['No clear next step', "We didn't find a 'book', 'quote' or 'schedule' prompt on the homepage."],
      form: ['No enquiry form on the homepage', 'Visitors ready to ask have to go looking for a way to get in touch.'],
      phone: ["Phone number isn't tap-to-call", 'On mobile, a tap-to-call link removes a step for ready buyers.'],
    },
    general: [
      ['Speed of reply', 'An instant, personal acknowledgement keeps enquiries warm until you can call back.'],
      ['Follow-up after first contact', 'Most enquiries need more than one touch; a simple sequence keeps you front of mind.'],
    ],
    recommendation: () => ['Respond fast and follow up automatically', 'A clear call to action, an instant reply and a short follow-up sequence, so fewer enquiries go cold.'],
    example: (co) => ['An enquiry arrives at 9pm', `An instant reply thanks them by name and offers two call-back times. If they go quiet, a friendly reminder follows two days later, so ${co} stays front of mind.`],
    firstSteps: ['Put one clear call to action at the top of the homepage.', 'Send an instant, personal reply to every new enquiry.', 'Follow up twice with anyone who hasn’t replied within a week.'],
    step: ['Tighten capture and follow-up', 'Add a clear call to action and an instant reply to every enquiry.'],
  },
  'Saving time with AI & automation': {
    name: 'Win back time',
    kicker: 'Automation',
    effort: 'Medium',
    title: (co) => `Give ${co}'s team hours back each week.`,
    body: () => 'In most businesses the same few tasks repeat daily: answering similar questions, chasing information, re-typing details between tools. That is where AI pays off first.',
    summary: 'Hand repetitive weekly tasks to AI and simple automation.',
    fails: {},
    general: [
      ['Repeated questions', 'Common customer questions can get drafted replies that your team simply approves.'],
      ['Re-typing between tools', 'Details copied between email, spreadsheets and software are the easiest wins.'],
      ['Reporting by hand', 'Weekly numbers can be gathered automatically instead of assembled manually.'],
    ],
    recommendation: () => ['Automate one repetitive task, and do it well', 'Start with the task your team repeats most, measure the hours saved, then expand.'],
    example: (co) => ['The same question, ten times a week', `AI drafts the answer from ${co}'s own past replies; someone checks it and presses send. A ten-minute task becomes one minute.`],
    firstSteps: ['List the tasks your team repeats every week, with time spent.', 'Pick the most repetitive one and map how it is done today.', 'Automate it, then measure the hours saved after a month.'],
    step: ['Automate one repetitive task', 'Pick the most repetitive weekly task, automate it and measure the time saved.'],
  },
};
const DEFAULT_ORDER = Object.keys(LIBRARY);

function choose(focus, checks) {
  const picked = (focus || []).filter((f) => LIBRARY[f]);
  // Fill the rest in order of how many problems the site checks found for each, then the default order.
  const failures = (k) => Object.keys(LIBRARY[k].fails).filter((id) => checks[id] === false).length;
  const rest = DEFAULT_ORDER.filter((k) => !picked.includes(k)).sort((a, b) => failures(b) - failures(a) || DEFAULT_ORDER.indexOf(a) - DEFAULT_ORDER.indexOf(b));
  return [...picked, ...rest].slice(0, 3);
}

const STRENGTHS = [
  ['proof', 'Visible proof', 'Customer feedback already appears on your homepage.'],
  ['cta', 'A clear next step', 'Visitors are invited to book or ask for a quote.'],
  ['schema', 'Structured data', 'Your site already describes the business in search engines’ format.'],
  ['faq', 'Answers questions', 'You already answer common customer questions.'],
  ['phone', 'Easy to call', 'Your phone number is one tap away on mobile.'],
  ['description', 'A search snippet', 'Your homepage has its own description for search results.'],
  ['mobile', 'Mobile-ready', 'Your homepage is set up for phones, where most people find you.'],
  ['https', 'Secure website', 'Your site loads over HTTPS, as browsers and Google expect.'],
];
const GENERAL_STRENGTHS = [
  ['Clear priorities', 'You know what you want to improve, so the first steps are obvious.'],
  ['A base to build on', 'The gaps are fixable with focused changes, not a big project.'],
  ['Good timing', 'Acting now puts you ahead of competitors still waiting.'],
];

const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const joinAnd = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');

/** answers + siteChecks() result → a report in the same shape Gemini returns. */
function fallbackReport(answers, site = {}, { date = new Date() } = {}) {
  const checks = site.checks || {};
  const company = (answers.company && !/^https?:/.test(answers.company) && answers.company !== nameFromWebsite(answers.website) && answers.company) || site.name || answers.company || 'Your business';
  const keys = choose(answers.focus, checks);
  const asked = (answers.focus || []).filter((f) => LIBRARY[f]);
  const month = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const opportunities = keys.map((k) => {
    const L = LIBRARY[k];
    const fails = Object.entries(L.fails).filter(([id]) => checks[id] === false).map(([, f]) => f);
    const findings = [...fails, ...L.general].slice(0, 3).map(([title, body]) => ({ title, body }));
    const [opportunity_title, opportunity_body] = L.recommendation(company);
    const o = {
      name: L.name,
      summary: L.summary,
      kicker: L.kicker,
      title: L.title(company),
      body: L.body(company),
      answers_priority: asked.includes(k) ? k : '',
      impact: asked.includes(k) || fails.length >= 2 ? 'High' : 'Medium',
      effort: L.effort,
      findings,
      first_steps: L.firstSteps,
      example: (([title, body]) => ({ title, body }))(L.example(company)),
      opportunity_title,
      opportunity_body,
    };
    if (k === 'Getting found on Google & AI' && site.reached) {
      const ids = Object.keys(L.fails);
      const passed = ids.filter((id) => checks[id]).length;
      o.stats = [
        { value: `${passed}/${ids.length}`, label: 'Search basics in place' },
        { value: checks.schema ? 'Yes' : 'None', label: 'Structured data' },
        { value: checks.llms ? 'Yes' : 'None', label: 'AI summary (llms.txt)' },
      ];
      o.stats_source = `Source: automated check of ${site.host}, ${month}.`;
    }
    return o;
  });

  const strengths = [
    ...STRENGTHS.filter(([id]) => checks[id]).map(([, title, body]) => ({ title, body })),
    ...GENERAL_STRENGTHS.map(([title, body]) => ({ title, body })),
  ].slice(0, 3);

  const first = answers.first_name || 'Hello';
  const challenge = answers.note ? answers.note.replace(/[.\s]+$/, '').slice(0, 90) : '';
  const wants = asked.length ? `you want help with ${joinAnd(asked.map(lc))}` : "you weren't sure where to start";
  const personal_note = `${first}, you told us ${wants}${challenge ? `, and that "${challenge}"` : ''}. ${asked.length ? 'This review starts there.' : "So we've ordered this by where we see the quickest wins."}`;

  return {
    fallback: true,
    business: { name: company, industry: site.industry || '', location: site.location || '', services: site.description || '' },
    personal_note,
    headline: `${company} has a foundation to build on. Let's make more of it.`,
    intro: site.reached
      ? `We checked ${site.host} against the basics that decide who gets found and chosen, and found three practical opportunities, starting with what you said matters most.`
      : 'Based on what you told us, here are three practical opportunities, starting with what you said matters most.',
    strengths,
    sources_reviewed: site.reached ? ['your website (automated checks)', 'your answers'] : ['your answers'],
    opportunities,
    next_steps: keys.map((k, i) => ({ title: LIBRARY[k].step[0], body: LIBRARY[k].step[1], timeframe: ['Days 1–30', 'Days 31–60', 'Days 61–90'][i] })),
    closing: `${company} doesn't need a big project to see progress; a few focused changes, done well, will compound.`,
  };
}

module.exports = { siteChecks, fallbackReport, LIBRARY };
