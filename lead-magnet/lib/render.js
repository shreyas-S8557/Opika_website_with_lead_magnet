// Turns a lead-magnet doc ({ blocks, header, footer, ... }) into a print-ready, Opika-branded HTML page.
// Every block type is a small function below; add new ones to BLOCKS.
// lib/layout.js then places the blocks on Letter-size sheets in the browser (see renderHTML).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const asset = (p) => path.join(ROOT, 'assets', p);
const b64 = (p) => fs.readFileSync(asset(p)).toString('base64');

// ---------- text helpers ----------
const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let VARS = {};
const fill = (s = '') =>
  String(s).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (VARS[k] !== undefined ? VARS[k] : ''));

// Inline markdown: **bold**, *italic*, [link](url)
const inline = (s = '') =>
  esc(fill(s))
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');

// Paragraphs separated by blank lines; lines starting with "- " become bullets.
const prose = (s = '') =>
  String(s)
    .split(/\n\s*\n/)
    .map((chunk) => {
      const lines = chunk.split('\n').filter(Boolean);
      if (lines.length && lines.every((l) => l.trim().startsWith('- '))) {
        return `<ul class="bul">${lines.map((l) => `<li>${inline(l.trim().slice(2))}</li>`).join('')}</ul>`;
      }
      return `<p>${inline(chunk.trim())}</p>`;
    })
    .join('');

const level = (v) => {
  const n = { Low: 1, Medium: 2, High: 3 }[v] || 2;
  return `<span class="lvl">${[1, 2, 3].map((k) => `<i class="${k <= n ? 'on' : ''}"></i>`).join('')}</span>`;
};

// ---------- blocks ----------
const BLOCKS = {
  titleBand: (b) => `
    <header class="band">
      <div class="band-bar">
        <img class="band-logo" src="data:image/png;base64,${b64('logo-white.png')}" alt="Opika">
        <span class="band-conf">Confidential</span>
      </div>
      <div class="band-label">${inline(b.label)}</div>
      <h1 class="${String(b.company).length > 40 ? 'xl' : String(b.company).length > 26 ? 'l' : ''}">${inline(b.company)}</h1>
      ${b.headline ? `<p class="band-head">${inline(b.headline)}</p>` : ''}
      <dl class="band-meta">
        ${b.meta.map(([k, v]) => `<div><dt>${inline(k)}</dt><dd>${inline(v)}</dd></div>`).join('')}
      </dl>
    </header>`,

  section: (b) => `
    <section class="sec-head">
      <div class="kicker">${b.number ? `<span class="kn">${esc(b.number)}</span><span class="kdiv"></span>` : ''}<span>${inline(b.kicker || '')}</span>${
        b.tags
          ? `<span class="tags">${b.tags.map(([k, v]) => `<span class="tag"><span class="tag-k">${inline(k)}</span>${level(v)}<span class="tag-v">${inline(v)}</span></span>`).join('')}</span>`
          : ''
      }</div>
      <h2>${inline(b.title)}</h2>
      ${b.priority ? `<p class="yourp"><span>Your priority</span>${inline(b.priority)}</p>` : ''}
      ${b.lead ? `<p class="lead">${inline(b.lead)}</p>` : ''}
    </section>`,

  note: (b) => `
    <aside class="pnote avoid">
      <p>${inline(b.text)}</p>
      ${b.by ? `<span class="pnote-by">${inline(b.by)}</span>` : ''}
      ${b.asked ? `<span class="pnote-asked">${inline(b.asked)}</span>` : ''}
    </aside>`,

  lead: (b) => `<div class="lead-text">${prose(b.body)}</div>`,

  h3: (b) => `<h3 class="h3">${inline(b.text)}</h3>`,

  text: (b) => `<div class="prose">${prose(b.body)}</div>`,

  bullets: (b) => `
    <div class="prose">${b.intro ? `<p>${inline(b.intro)}</p>` : ''}
      <ul class="bul">${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>
    </div>`,

  strengths: (b) => `
    <div class="block avoid">
      <div class="mini ruled">${inline(b.title)}</div>
      <div class="strengths s${b.items.length}">
        ${b.items.map((s) => `<div class="strength"><h4>${inline(s.title)}</h4><p>${inline(s.body)}</p></div>`).join('')}
      </div>
    </div>`,

  glanceTable: (b) => `
    <div class="block avoid">
      <div class="mini ruled">${inline(b.title)}</div>
      <table class="tbl glance">
        <thead><tr><th class="c-no">No.</th><th>Opportunity</th><th class="c-r">Impact</th><th class="c-r">Effort</th></tr></thead>
        <tbody>
          ${b.items
            .map(
              (it) => `
            <tr>
              <td class="c-no"><span class="tno">${esc(it.no)}</span></td>
              <td><strong>${inline(it.name)}</strong><span class="sub">${inline(it.summary)}</span></td>
              <td class="c-r">${level(it.impact)}<span class="lv">${inline(it.impact)}</span></td>
              <td class="c-r">${level(it.effort)}<span class="lv">${inline(it.effort)}</span></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      ${b.note ? `<p class="source">${inline(b.note)}</p>` : ''}
    </div>`,

  stats: (b) => `
    <div class="block avoid">
      ${b.intro ? `<p class="pre">${inline(b.intro)}</p>` : ''}
      <div class="stats" style="grid-template-columns:repeat(${Math.min(4, b.items.length)},1fr)">
        ${b.items
          .map(
            (s) => `
          <div class="stat">
            <div class="stat-v">${inline(s.value)}</div>
            <div class="stat-l">${inline(s.label)}</div>
          </div>`
          )
          .join('')}
      </div>
      ${b.source ? `<p class="source">${inline(b.source)}</p>` : ''}
      ${b.takeaway ? `<p class="takeaway">${inline(b.takeaway)}</p>` : ''}
    </div>`,

  factors: (b) => `
    <div class="block">
      ${b.intro ? `<p class="pre">${inline(b.intro)}</p>` : ''}
      <div class="factors">
        ${b.items
          .map(
            (f, i) => `
          <div class="factor avoid">
            <div class="f-no">${b.prefix ? `${esc(b.prefix)}.${i + 1}` : i + 1}</div>
            <div><h4>${inline(f.title)}</h4><p>${inline(f.body)}</p></div>
          </div>`
          )
          .join('')}
      </div>
    </div>`,

  opportunity: (b) => `
    <aside class="opp avoid">
      <div class="opp-label">${inline(b.label || 'Opportunity')}</div>
      ${b.title ? `<h4>${inline(b.title)}</h4>` : ''}
      <div class="prose">${prose(b.body)}</div>
    </aside>`,

  callout: (b) => `
    <aside class="callout avoid">
      ${b.title ? `<h4>${inline(b.title)}</h4>` : ''}
      <div class="prose">${prose(b.body)}</div>
    </aside>`,

  bars: (b) => {
    const max = Math.max(1, ...b.items.map((i) => i.value));
    return `
    <figure class="bars avoid">
      <figcaption class="fig">${b.figure ? `<span>${inline(b.figure)}</span>` : ''}${inline(b.title || '')}</figcaption>
      ${b.items
        .map(
          (it) => `
        <div class="bar-row ${it.highlight ? 'hl' : ''}">
          <div class="bar-l">${inline(it.label)}</div>
          <div class="bar-t"><div class="bar-f" style="width:${Math.max(1.5, (it.value / max) * 100)}%"></div></div>
          <div class="bar-v">${esc(it.value)}</div>
        </div>`
        )
        .join('')}
      ${b.caption ? `<p class="source">${inline(b.caption)}</p>` : ''}
    </figure>`;
  },

  cards: (b) => `
    <div class="cards c${b.columns || 2}">
      ${b.items.map((c) => `<div class="card avoid">${c.tag ? `<span class="mini">${inline(c.tag)}</span>` : ''}<h4>${inline(c.title)}</h4><div class="prose">${prose(c.body)}</div></div>`).join('')}
    </div>`,

  example: (b) => `
    <aside class="example avoid">
      <div class="ex-k">${inline(b.kicker || 'Example')}</div>
      <div>
        <h4>${inline(b.title)}</h4>
        <div class="prose">${prose(b.body)}</div>
      </div>
    </aside>`,

  outputs: (b) => `
    <div class="block avoid">
      ${b.intro ? `<p class="pre">${inline(b.intro)}</p>` : ''}
      <div class="outputs">
        ${b.items.map((o) => `<div class="out"><h4>${inline(o.title)}</h4><p>${inline(o.body)}</p></div>`).join('')}
      </div>
    </div>`,

  firstSteps: (b) => `
    <div class="block avoid">
      <div class="mini ruled">${inline(b.title || 'First steps')}</div>
      <ol class="fsteps fs${b.items.length}">
        ${b.items.map((x, i) => `<li><span class="fs-n">${i + 1}</span><span>${inline(x)}</span></li>`).join('')}
      </ol>
    </div>`,

  roadmap: (b) => `
    <ol class="roadmap">
      ${b.items
        .map(
          (s, i) => `
        <li class="rm avoid">
          <div class="rm-when"><span class="rm-n">${i + 1}</span><span class="rm-w">${inline(s.when || '')}</span></div>
          <div class="rm-b">
            <h4>${inline(s.title)}</h4>
            <p>${inline(s.body)}</p>
          </div>
          ${s.outcome ? `<div class="rm-o"><span>Outcome</span>${inline(s.outcome)}</div>` : ''}
        </li>`
        )
        .join('')}
    </ol>`,

  disclaimer: (b) => `<p class="disclaimer">${inline(b.text)}</p>`,

  statement: (b) => `<blockquote class="statement avoid"><p>${inline(b.text)}</p></blockquote>`,

  quote: (b) => `
    <blockquote class="statement avoid">
      <p>${inline(b.text)}</p>
      ${b.by ? `<cite>${inline(b.by)}</cite>` : ''}
    </blockquote>`,

  cta: (b) => `
    <aside class="cta avoid">
      <div class="cta-txt">
        <h3>${inline(b.title)}</h3>
        <div class="prose">${prose(b.body)}</div>
      </div>
      <div class="cta-act">
        <a class="btn" href="${esc(fill(b.url))}">${inline(b.button)}</a>
        ${b.note ? `<span class="cta-note">${inline(b.note)}</span>` : ''}
      </div>
    </aside>`,

  about: (b) => `
    <div class="about avoid">
      <div class="about-cols">
        ${(b.columns || [{ title: b.title || 'About Opika', body: b.body }])
          .map((c) => `<div><h5>${inline(c.title)}</h5><div class="prose">${prose(c.body)}</div></div>`)
          .join('')}
      </div>
      ${b.contact ? `<p class="about-c">${inline(b.contact)}</p>` : ''}
    </div>`,

  pagebreak: () => `<div class="pb"></div>`,
  spacer: (b) => `<div style="height:${b.size || 12}pt"></div>`,
};

// ---------- styles ----------
function css() {
  const font = (file, fam, weight, style = 'normal') =>
    `@font-face{font-family:'${fam}';src:url(data:font/woff2;base64,${b64('fonts/' + file)}) format('woff2');font-weight:${weight};font-style:${style};}`;
  return `
${font('dm-sans-latin-400-normal.woff2', 'DM Sans', 400)}
${font('dm-sans-latin-400-italic.woff2', 'DM Sans', 400, 'italic')}
${font('dm-sans-latin-500-normal.woff2', 'DM Sans', 500)}
${font('dm-sans-latin-600-normal.woff2', 'DM Sans', 600)}
${font('dm-sans-latin-700-normal.woff2', 'DM Sans', 700)}
${font('dm-serif-display-latin-400-normal.woff2', 'DM Serif Display', 400)}
${font('dm-serif-display-latin-400-italic.woff2', 'DM Serif Display', 400, 'italic')}

:root{
  --pink:#FF4D71; --pink-tint:#fff1f4; --navy:#305A81; --ink:#212C35;
  --text:#3b4651; --muted:#7b8691; --rule:#dce2e8; --rule-strong:#212C35; --tint:#f4f6f8; --bar:#c3ccd6;
}
@page{size:Letter;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:'DM Sans',system-ui,sans-serif;font-size:10.2pt;line-height:1.68;color:var(--text);font-feature-settings:'lnum' 1}
h1,h2,h3{font-family:'DM Serif Display',serif;font-weight:400;color:var(--ink);letter-spacing:-.005em;margin:0}
h4{font-family:'DM Sans';font-weight:700;color:var(--ink);margin:0 0 2pt;font-size:10pt;line-height:1.35}
h5{font-family:'DM Sans';font-weight:700;color:var(--ink);margin:0 0 4pt;font-size:7.4pt;letter-spacing:.16em;text-transform:uppercase}
p{margin:0 0 7pt}
strong{color:var(--ink);font-weight:700}
a{color:var(--pink);text-decoration:none}
.prose p:last-child{margin-bottom:0}
.avoid,.keep{break-inside:avoid}
.mini{font-family:'DM Sans';font-size:7.4pt;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--navy)}
.mini.ruled{display:flex;align-items:center;gap:8pt;margin-bottom:9pt}
.mini.ruled::after{content:'';flex:1;height:1px;background:var(--rule)}
.source{font-size:7.6pt;color:var(--muted);margin:5pt 0 0;font-style:italic}
.pre{color:var(--ink);font-weight:500;margin:0 0 7pt}

/* ---------- sheets (built by layout.js) ---------- */
.flow{width:6.9in;display:flex;flex-direction:column;gap:13pt}
.hard-break{display:none}
.sheet{width:8.5in;height:11in;overflow:hidden;position:relative;break-after:page;display:flex;flex-direction:column;padding:0.5in 0.8in 0.42in}
.sheet:last-child{break-after:auto}
.sh-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:9pt;border-bottom:1px solid var(--rule);margin-bottom:18pt;font-size:7pt;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
.sh-head img{height:15pt;display:block}
.sh-head .sh-t{display:flex;gap:14pt}
.sh-head .sh-t b{color:var(--ink);font-weight:700}
.sh-body{flex:1;min-height:0;position:relative}
.pin{display:flex;flex-direction:column;gap:16pt;transform-origin:top left}
.sh-foot{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--rule);padding-top:8pt;margin-top:14pt;font-size:7pt;color:var(--muted);letter-spacing:.04em}
.sh-foot .pk{color:var(--pink);font-weight:700}

/* glued blocks (heading + intro + chart) */
.keep>.prose+.block,.keep>.prose+.bars{margin-top:16pt}
.keep>.block+.bars,.keep>.bars+.block{margin-top:16pt}

/* ---------- page-1 title band (full bleed, outside the scaled content) ---------- */
.sheet.first-sheet{padding-top:0}
.band{margin:0 -0.8in 22pt;background:linear-gradient(160deg,#305A81 0%,#24384b 58%,#212C35 100%);color:#fff;padding:0.4in 0.8in 0.26in;position:relative;overflow:hidden}
.band::after{content:'';position:absolute;right:-1.6in;top:-2.2in;width:4.6in;height:4.6in;border-radius:50%;border:1px solid rgba(255,255,255,.07);box-shadow:0 0 0 0.45in rgba(255,255,255,.015)}
.band-bar{position:relative;display:flex;justify-content:space-between;align-items:center;margin-bottom:16pt}
.band-logo{height:24pt;display:block}
.band-conf{font-size:7pt;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.6);border:1px solid rgba(255,255,255,.25);padding:3.5pt 8pt;border-radius:2pt}
.band-label{position:relative;display:flex;align-items:center;gap:10pt;font-size:8pt;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:rgba(255,255,255,.72);margin-bottom:10pt}
.band-label::before{content:'';width:26pt;height:2pt;background:var(--pink)}
.band h1{position:relative;color:#fff;font-size:36pt;line-height:1.04;letter-spacing:-.015em}
.band h1.l{font-size:30pt}.band h1.xl{font-size:25pt}
.band-head{position:relative;font-family:'DM Serif Display';font-style:italic;font-size:14pt;line-height:1.32;color:rgba(255,255,255,.8);margin:8pt 0 0;max-width:88%}
.band-meta{position:relative;margin:16pt 0 0;padding-top:11pt;border-top:1px solid rgba(255,255,255,.18);display:grid;grid-template-columns:1fr .7fr 1fr 1.2fr;gap:14pt}
.band-meta dt{font-size:6.6pt;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.55);margin-bottom:2pt}
.band-meta dd{margin:0;font-size:9pt;color:#fff;font-weight:500}

/* ---------- section heads ---------- */
.sec-head{margin:0 0 2pt}
.kicker{display:flex;align-items:center;gap:8pt;font-size:7.6pt;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--navy);margin-bottom:9pt}
.kn{font-family:'DM Serif Display';font-size:13pt;letter-spacing:0;color:var(--pink);line-height:1}
.kdiv{width:1px;height:11pt;background:var(--rule)}
.sec-head h2{font-size:21pt;line-height:1.14;max-width:96%}
.sec-head .lead{font-size:10.4pt;color:var(--text);margin:8pt 0 0}
.tags{display:inline-flex;gap:6pt;margin-left:auto}
.tag{display:inline-flex;align-items:center;gap:5pt;border:1px solid var(--rule);border-radius:2pt;padding:2.5pt 7pt;font-size:7pt;letter-spacing:normal}
.tag-k{font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.tag-v{font-weight:700;color:var(--ink)}
.sec-head::after{content:'';display:block;height:1px;background:var(--rule-strong);margin-top:14pt}
.lvl{display:inline-flex;gap:2pt;vertical-align:middle}
.lvl i{width:5pt;height:5pt;border-radius:50%;background:var(--rule)}
.lvl i.on{background:var(--pink)}
.h3{font-size:14pt;margin:4pt 0 0}

.lead-text p{font-size:10pt}
.lead-text p:first-child{font-family:'DM Serif Display';font-size:13.5pt;line-height:1.4;color:var(--ink);margin-bottom:9pt}
.lead-text p:last-child{margin-bottom:0}

ul.bul{margin:0 0 8pt;padding:0;list-style:none}
ul.bul li{position:relative;padding-left:13pt;margin-bottom:4pt}
ul.bul li::before{content:'';position:absolute;left:1pt;top:6pt;width:4pt;height:4pt;background:var(--pink)}


/* personal note (page 1) */
.pnote{padding:2pt 0 2pt 18pt;border-left:2pt solid var(--pink)}
.pnote p{font-family:'DM Serif Display';font-style:italic;font-size:13.5pt;line-height:1.4;color:var(--ink);margin:0}
.pnote-by{display:block;margin-top:7pt;font-size:7.4pt;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
.pnote-asked{display:block;margin-top:3pt;font-size:8.6pt;color:var(--muted)}
.yourp{display:inline-flex;align-items:center;gap:7pt;margin:9pt 0 0;font-size:8.6pt;color:var(--ink);font-weight:600}
.yourp span{font-size:6.8pt;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#fff;background:var(--pink);padding:2.5pt 6pt;border-radius:2pt}

/* strengths */
.strengths{display:grid;gap:22pt;grid-template-columns:repeat(3,1fr)}
.strengths.s2{grid-template-columns:repeat(2,1fr)}
.strength{border-top:2pt solid var(--ink);padding-top:6pt}
.strength p{margin:0;font-size:9.6pt;line-height:1.55}

/* tables */
.tbl{width:100%;border-collapse:collapse;font-size:9.4pt;line-height:1.5}
.tbl th{font-size:6.8pt;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);text-align:left;padding:0 8pt 6pt 0;border-bottom:1px solid var(--rule-strong)}
.tbl td{padding:8pt 10pt 8pt 0;border-bottom:1px solid var(--rule);vertical-align:top;color:var(--text)}
.tbl .sub{display:block;color:var(--muted);margin-top:2pt}
.tbl .c-no{width:30pt}
.tbl .tno{font-family:'DM Serif Display';color:var(--pink);font-size:12pt;line-height:1}
.tbl .c-r{width:58pt}
.tbl td.c-r .lv{display:block;font-size:7.8pt;color:var(--ink);font-weight:600;margin-top:3pt}
.tbl .c-pg{width:28pt;text-align:right;padding-right:0;color:var(--muted)}
.glance td:nth-child(2){width:auto}
.glance .c-r{width:78pt}

.kv{width:100%;border-collapse:collapse;font-size:8.8pt;line-height:1.4}
.kv th{text-align:left;font-weight:600;color:var(--muted);width:40%;padding:4.5pt 8pt 4.5pt 0;border-bottom:1px solid var(--rule);vertical-align:top}
.kv td{color:var(--ink);padding:4.5pt 0;border-bottom:1px solid var(--rule)}
ul.ticks{list-style:none;margin:0;padding:0}
ul.ticks li{position:relative;padding:4.5pt 0 4.5pt 15pt;border-bottom:1px solid var(--rule);font-size:8.8pt;color:var(--ink);line-height:1.4}
ul.ticks li::before{content:'';position:absolute;left:1pt;top:7.5pt;width:6pt;height:3pt;border-left:1.5px solid var(--pink);border-bottom:1.5px solid var(--pink);transform:rotate(-45deg)}

/* stats */
.stats{display:grid;border-top:1px solid var(--rule-strong);border-bottom:1px solid var(--rule)}
.stat{padding:12pt 14pt 11pt;border-left:1px solid var(--rule)}
.stat:first-child{border-left:0;padding-left:0}
.stat-v{font-family:'DM Serif Display';font-size:26pt;line-height:1;color:var(--ink)}
.stat-l{font-size:6.9pt;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-top:6pt}
.takeaway{margin:9pt 0 0;color:var(--ink);font-weight:700;font-size:9.8pt}

/* findings */
.factors{border-top:1px solid var(--rule)}
.factor{display:grid;grid-template-columns:28pt 1fr;gap:10pt;padding:10pt 0;border-bottom:1px solid var(--rule)}
.f-no{font-family:'DM Serif Display';color:var(--pink);font-size:11.5pt;line-height:1.25}
.factor p{margin:0;font-size:9.8pt}

/* opportunity */
.opp{background:var(--tint);border-left:3pt solid var(--pink);padding:14pt 18pt 15pt}
.opp-label{font-size:7pt;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--pink);margin-bottom:4pt}
.opp h4{font-family:'DM Serif Display';font-weight:400;font-size:14pt;line-height:1.25;margin-bottom:5pt}
.opp .prose{color:var(--ink)}
.callout{background:var(--tint);padding:12pt 16pt}

/* bars */
.bars{margin:0;padding:14pt 16pt 10pt;border:1px solid var(--rule)}
.fig{font-size:8.6pt;font-weight:700;color:var(--ink);margin-bottom:10pt}
.fig span{font-size:7pt;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-right:9pt}
.bar-row{display:grid;grid-template-columns:150pt 1fr 26pt;align-items:center;gap:12pt;margin-bottom:7pt}
.bar-l{font-size:9pt;color:var(--text)}
.bar-t{height:9pt;background:var(--tint)}
.bar-f{height:100%;background:var(--bar)}
.bar-row.hl .bar-f{background:var(--pink)}
.bar-row.hl .bar-l,.bar-row.hl .bar-v{font-weight:700;color:var(--ink)}
.bar-v{font-weight:600;color:var(--ink);text-align:right;font-size:9.2pt;font-variant-numeric:tabular-nums}
.bars .source{margin-top:8pt}

/* cards */
.cards{display:grid;gap:12pt}
.cards.c2{grid-template-columns:1fr 1fr}.cards.c3{grid-template-columns:repeat(3,1fr)}.cards.c1{grid-template-columns:1fr}
.card{border-top:2pt solid var(--ink);padding-top:7pt}
.card .prose{font-size:9pt}

/* example */
.example{display:grid;grid-template-columns:70pt 1fr;gap:14pt;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:12pt 0}
.ex-k{font-size:7pt;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--pink);padding-top:3pt}
.example h4{font-family:'DM Serif Display';font-weight:400;font-size:13pt;margin-bottom:3pt}
.example .prose{font-size:9.2pt}

/* outputs */
.outputs{display:grid;grid-template-columns:1fr 1fr;column-gap:22pt;border-top:1px solid var(--rule)}
.out{padding:5pt 0;border-bottom:1px solid var(--rule)}
.out:last-child:nth-child(odd){grid-column:1 / -1}
.out h4{font-size:9.2pt;margin-bottom:1pt}
.out p{margin:0;font-size:8.8pt;color:var(--muted)}

/* first steps: a row of three short actions */
.fsteps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:18pt}
.fsteps.fs2{grid-template-columns:repeat(2,1fr)}
.fsteps li{display:grid;grid-template-columns:18pt 1fr;gap:7pt;font-size:9.4pt;line-height:1.5;color:var(--ink)}
.fs-n{width:16pt;height:16pt;border:1px solid var(--pink);color:var(--pink);font-size:7.6pt;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:1pt}

/* roadmap: three columns */
.roadmap{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:22pt}
.rm{display:flex;flex-direction:column;gap:5pt;padding-top:2pt}
.rm-when{display:flex;align-items:baseline;gap:8pt}
.rm-n{font-family:'DM Serif Display';font-size:20pt;line-height:1;color:var(--pink)}
.rm-w{font-size:7pt;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.rm-b h4{font-family:'DM Serif Display';font-weight:400;font-size:12.5pt;line-height:1.25;margin-bottom:4pt}
.rm-b p{margin:0;font-size:9.4pt;line-height:1.55}
.rm-o{display:none}

/* disclaimer */
.disclaimer{margin:0;font-size:7.4pt;line-height:1.5;color:var(--muted);border-top:1px solid var(--rule);padding-top:8pt}

/* statement */
.statement{margin:0;padding:2pt 0 2pt 16pt;border-left:2pt solid var(--pink)}
.statement p{font-family:'DM Serif Display';font-style:italic;font-size:15pt;line-height:1.38;color:var(--ink);margin:0}
.statement cite{display:block;font-style:normal;font-size:8pt;color:var(--muted);margin-top:4pt}

/* cta */
.cta{display:flex;gap:20pt;align-items:center;justify-content:space-between;background:var(--ink);padding:17pt 22pt;color:#fff;position:relative;overflow:hidden}
.cta::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3pt;background:var(--pink)}
.cta h3{color:#fff;font-size:17pt;margin-bottom:4pt}
.cta .prose{color:rgba(255,255,255,.78);font-size:9.4pt}
.cta-act{text-align:center;flex:none}
.btn{display:inline-block;background:var(--pink);color:#fff;font-weight:700;font-size:9.6pt;padding:9pt 18pt;border-radius:3pt;white-space:nowrap}
.cta-note{display:block;font-size:7.2pt;color:rgba(255,255,255,.55);margin-top:6pt}

/* about */
.about{border-top:1px solid var(--rule);padding-top:11pt}
.about-cols{display:grid;grid-template-columns:1fr 1fr;gap:24pt}
.about .prose{font-size:8.2pt;line-height:1.5;color:var(--muted)}
.about-c{margin:10pt 0 0;font-size:8pt;font-weight:600;color:var(--navy);letter-spacing:.02em}
`;
}

// ---------- page ----------
function renderHTML(doc, vars = {}) {
  VARS = { ...(doc.vars || {}), ...vars };
  // Every block becomes a "unit". A section heading is glued to the block after it so a heading
  // never ends a page. lib/layout.js then places each run of units between page breaks on its own
  // Letter sheet (splitting only if it can't fit), and scales it to fill the page.
  const units = [];
  const blocks = doc.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'pagebreak') {
      units.push('<div class="hard-break"></div>');
      continue;
    }
    const fn = BLOCKS[b.type];
    if (!fn) throw new Error(`Unknown block type "${b.type}" in ${doc.slug}`);
    let h = fn(b, doc);
    if (b.type !== 'titleBand' && b.type === 'section' && i + 1 < blocks.length && blocks[i + 1].type !== 'pagebreak') {
      h += BLOCKS[blocks[i + 1].type](blocks[i + 1], doc);
      i++;
      // ...and the intro text to the chart or figures that illustrate it.
      const nxt = blocks[i + 1];
      if (blocks[i].type === 'text' && nxt && ['stats', 'bars', 'factors'].includes(nxt.type)) {
        h += BLOCKS[nxt.type](nxt, doc);
        i++;
      }
    }
    units.push(`<div class="keep${b.type === 'titleBand' ? ' is-band' : ''}${b.optional ? ' optional' : ''}">${h}</div>`);
  }
  const head = doc.header || {};
  const foot = doc.footer || {};
  const sheetHead = `<div class="sh-head"><img src="data:image/png;base64,${b64('logo.png')}" alt="Opika"><span class="sh-t"><span>${inline(head.left || doc.kind || '')}</span><b>${inline(head.right || '')}</b></span></div>`;
  const sheetFoot = `<div class="sh-foot"><span><span class="pk">Opika</span>${inline((foot.left || 'opika.co').replace(/^Opika/, ''))}</span><span>${inline(foot.right || '')}</span><span>Page <span class="pg-n"></span> of <span class="pg-t"></span></span></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(fill(doc.title))}</title><meta name="author" content="Opika"><style>${css()}</style></head>
<body>
<template id="tpl-head">${sheetHead}</template>
<template id="tpl-foot">${sheetFoot}</template>
<div class="flow">${units.join('\n')}</div></body></html>`;
}

function fillVars(s, vars) {
  const prev = VARS;
  VARS = vars || {};
  const out = fill(s);
  VARS = prev;
  return out;
}

module.exports = { renderHTML, fillVars };
