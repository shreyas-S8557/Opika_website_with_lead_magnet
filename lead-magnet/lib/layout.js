// Runs inside the headless browser (Playwright locally, Puppeteer on Vercel).
// 1. Splits the units rendered by render.js at each page break.
// 2. Page 1: the full-bleed title band, then the rest of that run, scaled to fit if needed.
// 3. Every other run flows across as many Letter sheets as it needs, at one text size.
//    If that would go past maxPages, the text size is reduced a little (to minZoom) until it fits;
//    blocks marked optional (examples, first steps) are left out whenever keeping them would
//    shrink the text below 95% or not fit, and only then
//    does the text go smaller still. Units are never split, and a heading stays with what follows.
// 4. Balances the content evenly across those pages, then spreads any leftover space evenly
//    between blocks (and, on a clearly short page, enlarges the text by up to 4%), so pages
//    neither end with an empty band nor feel crowded.
// 5. Adds the running header and footer, and fills in "Page X of Y".
function layoutSheets(opts) {
  opts = opts || {};
  const MAX_PAGES = opts.maxPages || 4;
  const MIN = opts.minZoom || 0.8;
  const PREFER_FEWER_MIN = opts.preferFewerMinZoom || 0.9; // drop a page if text stays at least this big
  const KEEP_OPTIONAL_MIN = opts.keepOptionalMinZoom || 0.96; // keep optional blocks (examples, first steps) only if text stays at least this big
  const FLOOR = opts.floorZoom || 0.72; // last resort, only after optional blocks are gone
  const MAX_EXTRA_GAP = opts.maxExtraGap || 40; // px added per gap at most, so leftover space is shared out, not left at the bottom

  const flow = document.querySelector('.flow');
  const head = document.getElementById('tpl-head').innerHTML;
  const foot = document.getElementById('tpl-foot').innerHTML;

  const segs = [[]];
  for (const el of [...flow.children]) {
    if (el.classList.contains('hard-break')) segs.push([]);
    else segs[segs.length - 1].push(el);
  }

  const newSheet = (first) => {
    const sheet = document.createElement('div');
    sheet.className = 'sheet' + (first ? ' first-sheet' : '');
    sheet.innerHTML = (first ? '' : head) + '<div class="sh-body"><div class="pin"></div></div>' + foot;
    document.body.appendChild(sheet);
    return { sheet, pin: sheet.querySelector('.pin'), body: sheet.querySelector('.sh-body'), z: 1 };
  };
  const measure = (sh, z) => {
    sh.pin.style.zoom = z;
    sh.pin.style.width = sh.body.clientWidth / z + 'px';
    return sh.pin.getBoundingClientRect().height;
  };
  const fit = (sh, max = 1) => {
    const H = sh.body.clientHeight;
    if (measure(sh, max) <= H) return max;
    let lo = 0.4, hi = max;
    for (let k = 0; k < 16; k++) {
      const mid = (lo + hi) / 2;
      if (measure(sh, mid) <= H) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  const sheets = [];
  const runs = segs.filter((s) => s.length);
  runs.forEach((seg, ri) => {
    // Page 1: title band outside the scaled area, then the summary.
    if (seg[0].classList.contains('is-band')) {
      const sh = newSheet(true);
      sh.sheet.insertBefore(seg[0], sh.body);
      seg.slice(1).forEach((el) => sh.pin.appendChild(el));
      sh.z = fit(sh);
      sheets.push(sh);
      return;
    }

    // Flowing run: measure every unit once at full size.
    const probe = newSheet(false);
    seg.forEach((el) => probe.pin.appendChild(el));
    measure(probe, 1);
    const H = probe.body.clientHeight;
    const gap = parseFloat(getComputedStyle(probe.pin).rowGap) || 0;
    const hs = seg.map((el) => el.getBoundingClientRect().height);
    probe.sheet.remove();

    const pack = (z, target) => {
      const cap = Math.min(H / z, target || Infinity);
      const pages = [[]];
      let used = 0;
      hs.forEach((h, i) => {
        const add = (pages[pages.length - 1].length ? gap : 0) + h;
        if (pages[pages.length - 1].length && used + add > cap) {
          pages.push([]);
          used = 0;
        }
        pages[pages.length - 1].push(i);
        used += (pages[pages.length - 1].length > 1 ? gap : 0) + h;
      });
      return pages;
    };
    // Pages still to come after this run (one per later run) count against the limit.
    const budget = Math.max(1, MAX_PAGES - sheets.length - (runs.length - ri - 1));
    // Prefer one page fewer when it costs no more than a small reduction in text size
    // (a short review is better as 3 full pages than 4 with a half-empty last one).
    const shrinkTo = (limit, floor) => {
      let zz = 1, pp = pack(zz);
      while (pp.length > limit && zz > floor) {
        zz = Math.max(floor, +(zz - 0.01).toFixed(2));
        pp = pack(zz);
      }
      return { zz, pp };
    };
    let { zz: z, pp: pages } = shrinkTo(budget, MIN);
    if (budget > 1) {
      const fewer = shrinkTo(budget - 1, PREFER_FEWER_MIN);
      if (fewer.pp.length < pages.length) ({ zz: z, pp: pages } = fewer);
    }
    // Breathing room comes first: if keeping the illustrative blocks (marked optional) would
    // shrink the text noticeably, or still not fit, leave them out (last one first) and re-fit.
    for (let i = seg.length - 1; (pages.length > budget || z < KEEP_OPTIONAL_MIN) && i >= 0; i--) {
      if (!seg[i].classList.contains('optional')) continue;
      seg.splice(i, 1);
      hs.splice(i, 1);
      ({ zz: z, pp: pages } = shrinkTo(budget, MIN));
    }
    while (pages.length > budget && z > FLOOR) {
      z = +(z - 0.01).toFixed(2);
      pages = pack(z);
    }
    // Balance: spread the content evenly so the last page isn't left half-empty.
    if (pages.length > 1) {
      const total = hs.reduce((a, h) => a + h, 0) + gap * (hs.length - 1);
      for (const slack of [1.04, 1.08, 1.12, 1.18]) {
        const even = pack(z, (total / pages.length) * slack);
        if (even.length === pages.length) {
          pages = even;
          break;
        }
      }
    }
    pages.forEach((idx) => {
      const sh = newSheet(false);
      idx.forEach((i) => sh.pin.appendChild(seg[i]));
      sh.z = fit(sh, z); // z, or a touch less if a page reflowed taller than measured
      sheets.push(sh);
    });
  });
  flow.remove();

  sheets.forEach((sh, i) => {
    sh.sheet.querySelectorAll('.pg-n').forEach((n) => (n.textContent = i + 1));
    sh.sheet.querySelectorAll('.pg-t').forEach((n) => (n.textContent = sheets.length));
    const H = sh.body.clientHeight;
    // A clearly short page: enlarge the text a touch (at most 4%) rather than leave a gap at the bottom.
    if (measure(sh, sh.z) < H * 0.82) sh.z = fit(sh, Math.min(1.04, sh.z * 1.04));
    const h = measure(sh, sh.z);
    const n = sh.pin.children.length;
    if (n > 1 && H - h > 1) {
      const extra = Math.min((H - h - 1) / (n - 1), MAX_EXTRA_GAP);
      const g = parseFloat(getComputedStyle(sh.pin).rowGap) || 0;
      sh.pin.style.gap = g + extra / sh.z + 'px';
    }
  });
  return sheets.map((sh) => +sh.z.toFixed(3));
}

module.exports = { layoutSheets };
