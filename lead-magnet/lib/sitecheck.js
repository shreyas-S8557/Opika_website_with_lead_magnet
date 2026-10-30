// A quick, deterministic look at a prospect's website. No AI: plain HTTP requests and pattern
// matching, so every result is a fact we actually observed. Used by the fallback review when
// Gemini is unavailable.
//
// Safety: the URL comes from a public form, so we only fetch public http(s) addresses (no
// localhost or private networks, re-checked on every redirect), with short timeouts and a size cap.

const dns = require('dns').promises;
const net = require('net');

const UA = 'Mozilla/5.0 (compatible; OpikaReviewBot/1.0; +https://opika.co)';
const MAX_BYTES = 1.5 * 1024 * 1024;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && isPrivateIp(v.slice(7));
}

async function assertPublic(url, lookup = dns.lookup) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('not http(s)');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new Error('private host');
  const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('private address');
}

/** GET a public URL, following up to 4 redirects safely. Returns { ok, status, url, text } or null. */
async function safeGet(url, { timeout = 8000, fetchImpl = globalThis.fetch, lookup } = {}) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    try {
      await assertPublic(current, lookup);
    } catch {
      return null;
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetchImpl(current, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'text/html,*/*' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location'), current).toString();
        continue;
      }
      let text = await res.text();
      if (text.length > MAX_BYTES) text = text.slice(0, MAX_BYTES);
      return { ok: res.ok, status: res.status, url: current, text };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

const decode = (s = '') =>
  s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const meta = (html, key) => {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*>`, 'i');
  const tag = (html.match(re) || [''])[0];
  return decode((tag.match(/content=["']([^"']*)["']/i) || [])[1] || '');
};

/** Facts about the site: what's there, what isn't. Never throws; returns { reachable: false } if it can't look. */
async function checkSite(website, opts = {}) {
  if (!website) return { reachable: false };
  const home = await safeGet(website, opts);
  if (!home || !home.ok || !/<html|<body|<head/i.test(home.text)) return { reachable: false, url: website };
  const html = home.text;
  const origin = new URL(home.url).origin;

  const jsonLd = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join(' ');
  const types = [...new Set([...jsonLd.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1]))];
  const bodyText = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));

  const [robots, sitemap, llms] = await Promise.all(
    ['/robots.txt', '/sitemap.xml', '/llms.txt'].map((p) => safeGet(origin + p, { ...opts, timeout: 4000 }))
  );
  const fileOk = (r, test) => !!(r && r.ok && test.test(r.text.slice(0, 2000)));

  return {
    reachable: true,
    url: home.url,
    https: home.url.startsWith('https://'),
    title: decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''),
    siteName: meta(html, 'og:site_name'),
    description: meta(html, 'description') || meta(html, 'og:description'),
    h1: decode(((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '').replace(/<[^>]+>/g, ' ')),
    mobile: /<meta[^>]+name=["']viewport["']/i.test(html),
    schemaTypes: types,
    businessSchema: types.some((t) => /LocalBusiness|Organization|Store|Service|Contractor|Clinic|Dentist|Physician|Restaurant|Attorney|Agency|Plumber|Electrician|RoofingContractor|HomeAndConstructionBusiness|ProfessionalService|MedicalBusiness|Corporation/i.test(t)),
    faqSchema: types.some((t) => /FAQPage/i.test(t)),
    reviewSchema: types.some((t) => /Review|AggregateRating/i.test(t)),
    faqOnPage: /\bFAQs?\b|frequently asked/i.test(bodyText),
    testimonials: /testimonial|what (our )?(clients|customers|patients) say|\breviews?\b|★|5 stars?/i.test(bodyText),
    phoneLink: /href=["']tel:/i.test(html),
    form: /<form[\s>]/i.test(html),
    booking: /calendly\.com|acuityscheduling|squareup\.com\/appointments|book (a|an|your)? ?(call|appointment|consultation|visit)|schedule (a|an|your)? ?(call|appointment|consultation)/i.test(html),
    chat: /intercom|tawk\.to|drift\.com|livechat|crisp\.chat|hubspot.*conversations|tidio|zendesk/i.test(html),
    socialPreview: !!(meta(html, 'og:title') && meta(html, 'og:image')),
    robots: fileOk(robots, /user-agent|sitemap|disallow|allow/i),
    sitemap: fileOk(sitemap, /<urlset|<sitemapindex/i),
    llms: fileOk(llms, /\w/),
    words: bodyText.split(' ').length,
  };
}

module.exports = { checkSite, safeGet, isPrivateIp };
