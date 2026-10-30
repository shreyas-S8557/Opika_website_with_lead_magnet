// Minimal MailerLite client (new MailerLite API: https://connect.mailerlite.com/api).
// No dependencies; works in Node 18+ and Vercel serverless functions.
//
// How delivery works:
//   1. The subscriber is created/updated with custom fields that describe the lead
//      magnet (lm_title, lm_url, lm_opp1, lm_ref, ...) and the prospect's quiz answers
//      (lead_website, lead_focus, lead_industry, lead_location, ...) for segmentation and follow-up.
//   2. They are added to the "lead magnet delivery" group.
//   3. A MailerLite automation ("When subscriber joins group") sends the branded
//      email, which reads those fields with {$lm_title}, {$lm_url}, etc.
// Re-sending: we remove + re-add them to the group so the automation fires again.

const API = process.env.MAILERLITE_API_URL || 'https://connect.mailerlite.com/api';

// Read by the delivery email.
const LM_FIELDS = [
  'lm_title', 'lm_subtitle', 'lm_url', 'lm_preview', 'lm_slug', 'lm_date', 'lm_ref', 'lm_pages',
  'lm_opp1', 'lm_opp1_text', 'lm_opp2', 'lm_opp2_text', 'lm_opp3', 'lm_opp3_text',
];
// The prospect's quiz answers plus what research found (industry, location, services),
// for segmenting and qualifying leads in MailerLite.
const LEAD_FIELDS = ['lead_website', 'lead_focus', 'lead_note', 'lead_industry', 'lead_location', 'lead_services'];

class MailerLiteError extends Error {
  constructor(status, body) {
    super(`MailerLite ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

// MailerLite has two products with different APIs:
//   new MailerLite (dashboard.mailerlite.com)  → token starts with "eyJ", API at connect.mailerlite.com
//   MailerLite Classic (app.mailerlite.com)    → 32-character key, API at api.mailerlite.com/api/v2
// client() picks the right one from the key; MAILERLITE_CLASSIC=1 / 0 forces it.
const isClassicKey = (key) =>
  process.env.MAILERLITE_CLASSIC === '1' || (process.env.MAILERLITE_CLASSIC !== '0' && !/^eyJ/.test(String(key || '').trim()));

function client(apiKey = process.env.MAILERLITE_API_KEY, opts = {}) {
  if (!apiKey) throw new Error('MAILERLITE_API_KEY is not set');
  return isClassicKey(apiKey) ? classicClient(String(apiKey).trim(), opts) : newClient(String(apiKey).trim(), opts);
}

function newClient(apiKey, { fetchImpl = globalThis.fetch } = {}) {

  async function request(method, path, body, attempt = 0) {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get('retry-after') || 2) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      return request(method, path, body, attempt + 1);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) throw new MailerLiteError(res.status, data);
    return data;
  }

  return {
    request,

    async findGroup(name) {
      const r = await request('GET', `/groups?limit=100&filter[name]=${encodeURIComponent(name)}`);
      return (r.data || []).find((g) => g.name === name) || null;
    },

    async ensureGroup(name) {
      return (await this.findGroup(name)) || (await request('POST', '/groups', { name })).data;
    },

    async listFields() {
      const r = await request('GET', '/fields?limit=100');
      return r.data || [];
    },

    async ensureFields(names = LM_FIELDS) {
      const existing = await this.listFields();
      const created = [];
      for (const name of names) {
        if (existing.some((f) => f.key === name || f.name === name)) continue;
        await request('POST', '/fields', { name, type: 'text' });
        created.push(name);
      }
      return created;
    },

    async upsertSubscriber({ email, fields = {}, groups = [] }) {
      const body = { email, fields };
      if (groups.length) body.groups = groups.map(String);
      return (await request('POST', '/subscribers', body)).data;
    },

    async removeFromGroup(subscriberId, groupId) {
      try {
        await request('DELETE', `/subscribers/${subscriberId}/groups/${groupId}`);
      } catch (e) {
        if (e.status !== 404) throw e;
      }
    },

    async addToGroup(subscriberId, groupId) {
      return request('POST', `/subscribers/${subscriberId}/groups/${groupId}`);
    },

    /**
     * Deliver a lead magnet.
     * @param {object} p
     * @param {string} p.email
     * @param {string} [p.name]      first name
     * @param {string} [p.lastName]
     * @param {string} [p.company]
     * @param {object} p.magnet      { slug, title, subtitle, preview, url }
     * @param {string} p.groupId     delivery group (automation trigger)
     * @param {string[]} [p.extraGroups] e.g. a per-magnet "downloaded X" group for segmentation
     * @param {object} [p.extraFields] more subscriber fields, e.g. the lead_* quiz answers
     */
    async deliverLeadMagnet({ email, name, lastName, company, magnet, groupId, extraGroups = [], extraFields = {} }) {
      if (!groupId) throw new Error('groupId (MAILERLITE_GROUP_ID) is required');
      const fields = { ...extraFields };
      for (const [k, v] of Object.entries(magnet)) if (k !== 'url' && k !== 'slug') fields[`lm_${k}`] = v == null ? '' : String(v);
      fields.lm_slug = magnet.slug;
      fields.lm_url = magnet.url;
      if (name) fields.name = name;
      if (lastName) fields.last_name = lastName;
      if (company) fields.company = company;

      // 1) create/update subscriber + fields (and any segmentation groups)
      const sub = await this.upsertSubscriber({ email, fields, groups: extraGroups });
      // 2) (re)join the delivery group so the automation fires every time
      await this.removeFromGroup(sub.id, groupId);
      await this.addToGroup(sub.id, groupId);
      return { subscriberId: sub.id, status: sub.status, fields };
    },
  };
}

const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

// ── MailerLite Classic (api.mailerlite.com/api/v2) ─────────────────────────────────────────────
const CLASSIC_API = process.env.MAILERLITE_CLASSIC_API_URL || 'https://api.mailerlite.com/api/v2';

function classicClient(apiKey, { fetchImpl = globalThis.fetch } = {}) {
  async function request(method, path, body, attempt = 0) {
    const res = await fetchImpl(`${CLASSIC_API}${path}`, {
      method,
      headers: { 'X-MailerLite-ApiKey': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 3) {
      const wait = Number((res.headers.get && res.headers.get('retry-after')) || 2) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      return request(method, path, body, attempt + 1);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) throw new MailerLiteError(res.status, data);
    return data;
  }

  return {
    classic: true,
    request,

    async findGroup(name) {
      const groups = (await request('GET', '/groups?limit=1000')) || [];
      return groups.find((g) => g.name === name) || null;
    },

    async ensureGroup(name) {
      return (await this.findGroup(name)) || (await request('POST', '/groups', { name }));
    },

    async listFields() {
      return (await request('GET', '/fields')) || [];
    },

    // Classic derives the merge-tag key from the title (lower case, underscores); ours already are.
    async ensureFields(names = LM_FIELDS) {
      const existing = await this.listFields();
      const created = [];
      for (const name of names) {
        if (existing.some((f) => f.key === name || f.title === name)) continue;
        await request('POST', '/fields', { title: name, type: 'TEXT' });
        created.push(name);
      }
      return created;
    },

    async deliverLeadMagnet({ email, name, lastName, company, magnet, groupId, extraFields = {} }) {
      if (!groupId) throw new Error('groupId is required');
      const fields = { ...extraFields };
      for (const [k, v] of Object.entries(magnet)) if (k !== 'url' && k !== 'slug') fields[`lm_${k}`] = v == null ? '' : String(v);
      fields.lm_slug = magnet.slug;
      fields.lm_url = magnet.url;
      if (company) fields.company = company;
      if (lastName) fields.last_name = lastName;
      // Leave and re-join the group so the "joins a group" automation fires every time.
      try {
        await request('DELETE', `/groups/${groupId}/subscribers/${encodeURIComponent(email)}`);
      } catch (e) {
        if (e.status !== 404) throw e;
      }
      const sub = await request('POST', `/groups/${groupId}/subscribers`, {
        email,
        name: name || '',
        fields,
        resubscribe: false,
        autoresponders: true, // lets the automation send
        type: 'active',
      });
      return { subscriberId: sub && sub.id, status: sub && sub.type, fields, classic: true };
    },
  };
}

const GROUP_NAME = process.env.MAILERLITE_GROUP_NAME || 'Opika · Visibility review delivery';

// Self-setup, once per server instance: creates any missing custom fields, and finds (or creates)
// the delivery group by name when MAILERLITE_GROUP_ID isn't set. So the only MailerLite setting
// the site needs is MAILERLITE_API_KEY.
const ready = new Map(); // one setup per kind of account (new / Classic)
function ensureSetup(ml) {
  const k = ml.classic ? 'classic' : 'new';
  if (!ready.has(k)) {
    ready.set(
      k,
      (async () => {
        await ml.ensureFields([...LM_FIELDS, ...LEAD_FIELDS]);
        if (process.env.MAILERLITE_GROUP_ID) return process.env.MAILERLITE_GROUP_ID;
        const group = await ml.ensureGroup(GROUP_NAME);
        return String(group.id);
      })().catch((e) => {
        ready.delete(k); // try again next time
        throw e;
      })
    );
  }
  return ready.get(k);
}

module.exports = { client, isClassicKey, ensureSetup, GROUP_NAME, LM_FIELDS, LEAD_FIELDS, MailerLiteError, isEmail };
