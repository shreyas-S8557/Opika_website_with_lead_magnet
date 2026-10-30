// HTML -> PDF.
// On Vercel it uses puppeteer-core + @sparticuz/chromium (a Chromium build made for
// serverless). Locally it uses Playwright's Chromium (npm i -D playwright).
// Each Letter sheet (cover, running header, footer, page numbers) is built in the page
// by layout.js, so Chromium's own header/footer is switched off.
const { renderHTML } = require('./render');
const { layoutSheets } = require('./layout');

const PAGE_WIDTH_PX = 816; // 8.5in at 96dpi
const LAYOUT_OPTS = { maxPages: Number(process.env.REVIEW_MAX_PAGES || 4), minZoom: Number(process.env.REVIEW_MIN_ZOOM || 0.8) };

const pdfOptions = () => ({
  format: 'Letter',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: false,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});

async function withPuppeteer(html) {
  const chromium = require('@sparticuz/chromium');
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: process.env.CHROMIUM_PATH || (await chromium.executablePath()),
    headless: true,
    defaultViewport: { width: PAGE_WIDTH_PX, height: 1056 },
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMediaType('print');
    const zooms = await page.evaluate(layoutSheets, LAYOUT_OPTS);
    const pdf = await page.pdf(pdfOptions());
    return { pdf: Buffer.from(pdf), pages: zooms.length, zooms };
  } finally {
    await browser.close();
  }
}

async function withPlaywright(html) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: PAGE_WIDTH_PX, height: 1056 } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ media: 'print' });
    const zooms = await page.evaluate(layoutSheets, LAYOUT_OPTS);
    const pdf = await page.pdf(pdfOptions());
    return { pdf, pages: zooms.length, zooms };
  } finally {
    await browser.close();
  }
}

/** Render a template doc ({ blocks, header, footer, ... }) to a PDF buffer. */
async function renderPDF(doc, vars = {}) {
  const html = renderHTML(doc, vars);
  const engine = process.env.PDF_ENGINE || (process.env.VERCEL ? 'puppeteer' : 'playwright');
  const result = engine === 'puppeteer' ? await withPuppeteer(html) : await withPlaywright(html);
  return { ...result, html };
}

module.exports = { renderPDF };
