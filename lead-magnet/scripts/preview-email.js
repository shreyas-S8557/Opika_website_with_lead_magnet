#!/usr/bin/env node
// Renders email/review-email.html with sample values → lead-magnet/out/email-preview.png (+ mobile)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const report = require('../samples/ethan-report.json');
  const o = report.opportunities;
  const vals = {
    lm_title: 'Visibility & Growth Review',
    lm_preview: o.map((x) => x.name).join(' · '),
    lm_date: 'October 6, 2026', lm_ref: 'OPK-2610-ETHA-9BE4', lm_pages: '4',
    lm_opp1: o[0].name, lm_opp1_text: o[0].summary, lm_opp2: o[1].name, lm_opp2_text: o[1].summary, lm_opp3: o[2].name, lm_opp3_text: o[2].summary,
    lm_url: '#', name: 'Ethan', company: 'Ethan Construction', unsubscribe: '#',
  };
  const a = (f) => fs.readFileSync(path.join(__dirname, '../assets', f)).toString('base64');
  const tpl = fs.readFileSync(path.join(__dirname, '../email/review-email.html'), 'utf8');
  const html = tpl
    .replace(/\{\$(\w+)(?:\|default\('([^']*)'\))?\}/g, (_, k, d) => vals[k] || d || '')
    .replace(/<link href="https:\/\/fonts[^>]+>/, '')
    .replace('https://opika.co/logo.png', `data:image/png;base64,${a('logo.png')}`)
    .replace('</head>', `<style>@font-face{font-family:'DM Sans';src:url(data:font/woff2;base64,${a('fonts/dm-sans-latin-400-normal.woff2')})}@font-face{font-family:'DM Sans';font-weight:700;src:url(data:font/woff2;base64,${a('fonts/dm-sans-latin-700-normal.woff2')})}@font-face{font-family:'DM Serif Display';src:url(data:font/woff2;base64,${a('fonts/dm-serif-display-latin-400-normal.woff2')})}</style></head>`);
  const out = path.join(__dirname, '../out');
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  for (const [file, width] of [['email-preview.png', 680], ['email-preview-mobile.png', 390]]) {
    const p = await b.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1.5 });
    await p.setContent(html, { waitUntil: 'load', timeout: 8000 }).catch(() => {});
    await p.screenshot({ path: path.join(out, file), fullPage: true });
    console.log(`✓ lead-magnet/out/${file}`);
  }
  await b.close();
})();
