/* VT CHARTS — the inline-SVG chart kit the VT Report page paints with (Spec Kit 072, Phase C task C1).
 *
 * WHY A FILE AND NOT A LIBRARY (plan §CH): the apps must run from file:// with no network, and a CDN chart library
 * would bring back the "#cdnWarn Chart library could not load" failure mode the suite deliberately left behind. The
 * five forms this page needs are a few dozen lines of SVG each, so they extend the suite's own inline-SVG kit
 * (index.html "SVG chart kit") instead of growing the 11,158-line shell.
 *
 * THE RULES THIS FILE KEEPS (dataviz skill + plan §CH, non-negotiable):
 *   · NO LITERAL COLOUR. Every fill and stroke is a CSS custom property — `--vtc1…--vtc4` for the four channel series
 *     (defined in BOTH theme blocks of nicks_code/index.html with the validated light and dark steps), `--ink/--ink2/
 *     --muted` for text, `--grid-line/--stroke/--stroke2` for the recessive frame, `--card-bg` for the 2 px surface gap
 *     between touching marks. `--good`/`--crit` are RESERVED for the OK/CHECK verdicts and are never a series.
 *   · Categorical hues in FIXED ORDER, never cycled: hue(i) past the fourth returns the fourth (Other), because a
 *     generated hue would make two different things look alike.
 *   · Colour is never the only carrier of meaning: every form carries direct labels, and every chart carries a text
 *     alternative (<title> + <desc>, read by `role="img"`), so the figures survive colour blindness, print and a
 *     screen reader. The panels beside these charts also print the same numbers as a table — on this page that table
 *     is the required secondary encoding, not a nicety (the tritan separation of the adjacent pairs is 4–6 ΔE).
 *   · Every mark carries a native SVG <title>, which is a hover tooltip in every browser and needs no JavaScript; the
 *     line form adds a crosshair tooltip on top through wire() (called by the page's _wire_ hook).
 *   · prefers-reduced-motion: the only animation is the `anim` class, which index.html's chart CSS switches off under
 *     the media query. Nothing here measures or animates by itself.
 *   · NO ARITHMETIC ON FIGURES. Shares, attainments and totals arrive computed from VTEngine.dashboard(); this file
 *     only turns a number into a length. Formatting is the caller's (`fmt`), so the screen and the .xlsx agree.
 *
 * Loads like its siblings: <script src="vt-charts.js" data-inline> in PULSE → window.VTCharts (works from file://,
 * inlined at build by tools/prepare-site.js); require() in the Node suites → module.exports.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.VTCharts = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

var W = 640;                                     /* every form draws in a 640-wide viewBox and scales with the card */
var GAP = 2;                                     /* the surface gap between touching marks (dataviz marks-and-anatomy) */
var R4 = 4;                                      /* rounded data-ends */
var SERIES = ['var(--vtc1)', 'var(--vtc2)', 'var(--vtc3)', 'var(--vtc4)'];
var INK = 'var(--ink)', INK2 = 'var(--ink2)', MUTED = 'var(--muted)';
var GRID = 'var(--grid-line)', AXIS = 'var(--stroke)', MARK = 'var(--stroke2)', SURFACE = 'var(--card-bg)';
var seq = 0;

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
/* ids follow index.html's CHART_ID counter where it exists, so no two charts on one page can collide */
function uid(p) { if (root && typeof root.CHART_ID === 'number') { root.CHART_ID++; return p + root.CHART_ID; } return p + (++seq); }
/** the fixed categorical order. Past the fourth hue nothing new is invented: it folds into the fourth (Other). */
function hue(i) { return SERIES[i < 0 || i >= SERIES.length ? SERIES.length - 1 : i]; }
function n(v, d) { return typeof v === 'number' && isFinite(v) ? v : (d == null ? 0 : d); }
function pos(v) { return Math.max(0, n(v)); }
function f1(v) { return (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, ''); }
function txt(x, y, s, o) {
  o = o || {};
  return '<text x="' + f1(x) + '" y="' + f1(y) + '"' + (o.anchor ? ' text-anchor="' + o.anchor + '"' : '')
    + ' font-size="' + (o.size || 10.5) + '"' + (o.weight ? ' font-weight="' + o.weight + '"' : '')
    + ' fill="' + (o.fill || MUTED) + '">' + esc(s) + '</text>';
}
/** the text alternative every chart carries: role="img" reads the title then the description (SC-006). */
function frame(h, title, desc, body, cls) {
  var ti = uid('vtt'), di = uid('vtd');
  return '<div class="chartbox vtchart' + (cls ? ' ' + cls : '') + '" data-chart="' + esc(cls || '') + '">'
    + '<svg viewBox="0 0 ' + W + ' ' + h + '" role="img" aria-labelledby="' + ti + ' ' + di + '">'
    + '<title id="' + ti + '">' + esc(title) + '</title><desc id="' + di + '">' + esc(desc) + '</desc>'
    + body + '</svg></div>';
}
/** the legend. Always present for 2+ series (a single series is named by the panel's own title). */
function legend(items) {
  if (!items || items.length < 2) return '';
  return '<div class="legend vt-legend">' + items.map(function (s) {
    return '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + (s.value == null ? '' : ' <b>' + esc(s.value) + '</b>') + '</span>';
  }).join('') + '</div>';
}
function mark(label) { return '<title>' + esc(label) + '</title>'; }
function fmtOf(o) { return (o && o.fmt) || function (v) { return v == null ? '—' : String(v); }; }

/* ------------------------------------------------------------------ 1 · line with a target series ----
 * Performance Trend (FR-021..024): two count series on ONE axis (never two scales), legend + a direct label on the
 * last point of each series, ≥ 8 px markers, a crosshair tooltip from wire(). A week the model marks `fittedOnly`
 * or `dim` is drawn hollow and said so in the tooltip, so nobody reads a pre-cycle week as a real week. */
function line(o) {
  o = o || {}; var fmt = fmtOf(o), labels = o.labels || [], ss = (o.series || []).filter(function (s) { return s && s.values; });
  var h = o.h || 250, P = { l: 46, r: 16, t: 16, b: 34 };
  var all = ss.reduce(function (a, s) { return a.concat(s.values.filter(function (v) { return typeof v === 'number' && isFinite(v); })); }, []);
  if (!labels.length || !all.length) return empty(o.emptyWords || 'No figures in this view yet');
  var max = Math.max.apply(null, all), min = 0;
  if (max === min) max = min + 1;
  max = max + (max - min) * 0.08;
  var xs = labels.length < 2 ? function () { return P.l + (W - P.l - P.r) / 2; } : function (i) { return P.l + (W - P.l - P.r) * i / (labels.length - 1); };
  var ys = function (v) { return P.t + (h - P.t - P.b) * (1 - (n(v) - min) / (max - min)); };
  var ticks = [0, 0.25, 0.5, 0.75, 1].map(function (t) { return min + (max - min) * t; });
  var grid = ticks.map(function (t) {
    return '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + f1(ys(t)) + '" y2="' + f1(ys(t)) + '" stroke="' + GRID + '"/>'
      + txt(P.l - 8, ys(t) + 3.5, fmt(t), { anchor: 'end', size: 9.5 });
  }).join('');
  var step = Math.ceil(labels.length / 8) || 1;
  var xl = labels.map(function (d, i) { return i % step ? '' : txt(xs(i), h - P.b + 15, String(d), { anchor: 'middle', size: 9 }); }).join('');
  var paths = ss.map(function (s, si) {
    var col = s.color || hue(si), dash = s.dashed ? ' stroke-dasharray="6 4"' : '';
    var pts = s.values.map(function (v, i) { return typeof v === 'number' && isFinite(v) ? [xs(i), ys(v)] : null; });
    var d = pts.map(function (p, i) { return p ? ((i && pts[i - 1]) ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1]) : ''; }).join('');
    var dots = pts.map(function (p, i) {
      if (!p) return '';
      var hollow = !!(o.flags && o.flags[i]);
      return '<circle cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" r="4.5" fill="' + (hollow ? SURFACE : col) + '" stroke="' + col + '" stroke-width="2">'
        + mark(labels[i] + ' · ' + s.name + ' ' + fmt(s.values[i]) + (hollow && o.flagWords ? ' · ' + o.flagWords : '')) + '</circle>';
    }).join('');
    var last = pts.filter(Boolean).slice(-1)[0];
    var tag = last ? txt(last[0] - 6, last[1] - 10, s.name + ' ' + fmt(s.values.filter(function (v) { return v != null; }).slice(-1)[0]), { anchor: 'end', size: 10, weight: 700, fill: col }) : '';
    return '<path class="line" d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' + dash + '/>' + dots + tag;
  }).join('');
  var desc = ss.map(function (s) {
    return s.name + ': ' + labels.map(function (d, i) { return d + ' ' + fmt(s.values[i]); }).join(', ');
  }).join('. ');
  var body = grid + xl + paths
    + '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + (h - P.b) + '" y2="' + (h - P.b) + '" stroke="' + AXIS + '"/>'
    + '<line class="cross" y1="' + P.t + '" y2="' + (h - P.b) + '" stroke="' + MARK + '" stroke-dasharray="3 3" style="display:none"/>'
    + '<rect class="hit" x="' + P.l + '" y="' + P.t + '" width="' + (W - P.l - P.r) + '" height="' + (h - P.t - P.b) + '" fill="transparent"/>';
  var id = uid('vtl');
  var html = frame(h, o.title || 'Trend', desc, body, 'vtc-line').replace('<div class="chartbox', '<div id="' + id + '" class="chartbox');
  return html.replace('</svg></div>', '</svg><div class="tip"></div>'
    + legend(ss.map(function (s, si) { return { name: s.name, color: s.color || hue(si) }; })) + '</div>')
    + '<script type="application/json" class="vtc-cfg" data-for="' + id + '">'
    + JSON.stringify({ labels: labels, series: ss.map(function (s, si) { return { name: s.name, color: s.color || hue(si), values: s.values }; }), P: P, h: h }) + '</script>';
}

/* ------------------------------------------------------------------ 2 · donut ----
 * Channel Performance. The owner chose a ring over a segmented bar for this one panel (four slices read well at a
 * glance); the plan's own D7 preference survives as `segbar` below, which the Detailed Breakdown rows use. Every
 * slice is separated from its neighbour by a 2 px surface ring, carries a direct label with its name, count and
 * share, and repeats in the legend — so the colour is never doing the work on its own. */
function donut(o) {
  o = o || {}; var fmt = fmtOf(o), slices = (o.slices || []).map(function (s, i) { return { label: s.label, value: n(s.value), share: s.share, color: s.color || hue(i) }; });
  var total = n(o.total, slices.reduce(function (a, s) { return a + s.value; }, 0));
  if (!total) return empty(o.emptyWords || 'No sales in this view yet');
  var h = o.h || 250, cx = 168, cy = h / 2, rO = Math.min(96, (h - 36) / 2), rI = rO * 0.6, acc = -Math.PI / 2, arcs = '', labs = '';
  slices.forEach(function (s) {
    if (s.value <= 0) return;
    var a0 = acc, a1 = acc + Math.PI * 2 * (s.value / total); acc = a1;
    var big = a1 - a0 > Math.PI ? 1 : 0;
    var p = function (r, a) { return f1(cx + r * Math.cos(a)) + ' ' + f1(cy + r * Math.sin(a)); };
    arcs += '<path d="M' + p(rO, a0) + 'A' + rO + ' ' + rO + ' 0 ' + big + ' 1 ' + p(rO, a1) + 'L' + p(rI, a1) + 'A' + rI + ' ' + rI + ' 0 ' + big + ' 0 ' + p(rI, a0) + 'Z"'
      + ' fill="' + s.color + '" stroke="' + SURFACE + '" stroke-width="' + GAP + '">'
      + mark(s.label + ' · ' + fmt(s.value) + (s.share == null ? '' : ' · ' + (o.pct ? o.pct(s.share) : '')) ) + '</path>';
  });
  /* the direct labels: a stacked list beside the ring, each with its swatch, name, count and share */
  var y0 = cy - (slices.length - 1) * 13;
  slices.forEach(function (s, i) {
    var y = y0 + i * 26;
    labs += '<rect x="300" y="' + f1(y - 9) + '" width="10" height="10" rx="3" fill="' + s.color + '"/>'
      + txt(318, y, s.label, { size: 11.5, weight: 650, fill: INK })
      + txt(W - 16, y, fmt(s.value) + (s.share == null || !o.pct ? '' : '  ·  ' + o.pct(s.share)), { anchor: 'end', size: 11.5, weight: 700, fill: INK2 });
  });
  var centre = txt(cx, cy - 2, fmt(total), { anchor: 'middle', size: 22, weight: 800, fill: INK })
    + txt(cx, cy + 15, o.centreLabel || 'in view', { anchor: 'middle', size: 9.5, fill: MUTED });
  var desc = slices.map(function (s) { return s.label + ' ' + fmt(s.value) + (s.share != null && o.pct ? ' (' + o.pct(s.share) + ')' : ''); }).join(', ')
    + '. Total ' + fmt(total) + '.';
  return frame(h, o.title || 'Split', desc, arcs + centre + labs, 'vtc-donut');
}

/* ------------------------------------------------------------------ 3 · ranked horizontal bars ----
 * Campaign Breakdown (FR-028). Largest first, ONE hue, the value printed at the data end, and a roll-up row (Panimax)
 * drawn hollow and labelled as a roll-up so it is never read as another campaign. 7+ rows with two of them 38 and 1
 * is exactly the case a donut hides, which is why this is bars. */
function hbars(o) {
  o = o || {}; var fmt = fmtOf(o), rows = o.rows || [];
  if (!rows.length) return empty(o.emptyWords || 'No campaigns in this view yet');
  var lw = o.labelWidth || 168, vw = 86, pad = 16, bh = 18, gap = 12, h = pad * 2 + rows.length * (bh + gap) - gap;
  var max = Math.max.apply(null, rows.map(function (r) { return pos(r.value); }).concat([1]));
  var x0 = lw + 8, span = W - x0 - vw - 8;
  var body = rows.map(function (r, i) {
    var y = pad + i * (bh + gap), w = Math.max(2, span * (pos(r.value) / max)), col = r.color || o.color || hue(0);
    var bar = r.rollup
      ? '<rect x="' + x0 + '" y="' + y + '" width="' + f1(w) + '" height="' + bh + '" rx="' + R4 + '" fill="transparent" stroke="' + col + '" stroke-width="2" stroke-dasharray="4 3">'
      : '<rect class="anim" x="' + x0 + '" y="' + y + '" width="' + f1(w) + '" height="' + bh + '" rx="' + R4 + '" fill="' + col + '">';
    return txt(lw, y + bh / 2 + 4, r.label, { anchor: 'end', size: 11.5, weight: r.rollup ? 800 : 650, fill: r.rollup ? INK2 : INK })
      + bar + mark(r.label + ' · ' + fmt(r.value) + (r.note ? ' · ' + r.note : '')) + '</rect>'
      + txt(x0 + w + 8, y + bh / 2 + 4, fmt(r.value) + (r.share != null && o.pct ? '  ' + o.pct(r.share) : ''), { size: 11, weight: 700, fill: INK2 });
  }).join('');
  var desc = rows.map(function (r) { return r.label + ' ' + fmt(r.value) + (r.rollup ? ' (roll-up)' : ''); }).join(', ');
  return frame(h, o.title || 'Ranked', desc, body, 'vtc-hbars');
}

/* ------------------------------------------------------------------ 4 · meter list ----
 * Cycle Performance, the five lead-time buckets (FR-029..032): several ratios, one per named row, each against its
 * OWN limit — so a shared axis would be wrong. The target is a 2 px marker on the track, the actual a filled bar,
 * and a bucket the engine calls a structural zero says so in words instead of reading as a miss. */
function meters(o) {
  o = o || {}; var fmt = fmtOf(o), rows = o.rows || [];
  if (!rows.length) return empty(o.emptyWords || 'Nothing to measure in this view yet');
  var lw = o.labelWidth || 140, vw = 118, pad = 14, bh = 16, gap = 16, h = pad * 2 + rows.length * (bh + gap) - gap;
  var x0 = lw + 8, span = W - x0 - vw - 8;
  var body = rows.map(function (r, i) {
    var y = pad + i * (bh + gap), col = r.color || o.color || hue(0);
    var cap = Math.max(pos(r.value), pos(r.target)) || 1;
    var w = span * (pos(r.value) / cap), tx = r.target == null ? null : x0 + span * (pos(r.target) / cap);
    var track = '<rect x="' + x0 + '" y="' + y + '" width="' + span + '" height="' + bh + '" rx="' + R4 + '" fill="' + GRID + '"/>';
    var bar = '<rect class="anim" x="' + x0 + '" y="' + y + '" width="' + f1(Math.max(2, w)) + '" height="' + bh + '" rx="' + R4 + '" fill="' + col + '">'
      + mark(r.label + ' · ' + fmt(r.value) + (r.target == null ? ' · no target on file' : ' of ' + fmt(r.target)) + (r.note ? ' · ' + r.note : '')) + '</rect>';
    var tgt = tx == null ? '' : '<line x1="' + f1(tx) + '" x2="' + f1(tx) + '" y1="' + (y - 4) + '" y2="' + (y + bh + 4) + '" stroke="' + MARK + '" stroke-width="2"><title>'
      + esc(r.label + ' target ' + fmt(r.target)) + '</title></line>';
    return txt(lw, y + bh / 2 + 4, r.label, { anchor: 'end', size: 11.5, weight: 650, fill: INK }) + track + bar + tgt
      + txt(W - 16, y + bh / 2 + 4, fmt(r.value) + ' / ' + (r.target == null ? '—' : fmt(r.target)), { anchor: 'end', size: 11, weight: 700, fill: INK2 });
  }).join('');
  var desc = rows.map(function (r) { return r.label + ' ' + fmt(r.value) + ' against a target of ' + (r.target == null ? 'none on file' : fmt(r.target)); }).join(', ');
  return frame(h, o.title || 'Against target', desc, body, 'vtc-meters');
}

/* ------------------------------------------------------------------ 5 · meter with a forecast marker ----
 * Sales vs budget (FR-035/036): the actual on the budget track, with the straight-line forecast as a SECOND marker.
 * There is no spend figure in any source, so nothing here is a cost and the panel never implies one. */
function meter(o) {
  o = o || {}; var fmt = fmtOf(o), h = o.h || 116, bh = 26, y = 44, x0 = 16, span = W - 32;
  var cap = Math.max(pos(o.value), pos(o.target), pos(o.marker && o.marker.value)) || 1;
  var w = span * (pos(o.value) / cap), col = o.color || hue(0);
  var at = function (v) { return x0 + span * (pos(v) / cap); };
  var body = txt(x0, 22, o.label || 'Actual', { size: 11.5, weight: 650, fill: INK })
    + txt(W - 16, 22, fmt(o.value) + (o.target == null ? '' : ' of ' + fmt(o.target)), { anchor: 'end', size: 12.5, weight: 800, fill: INK })
    + '<rect x="' + x0 + '" y="' + y + '" width="' + span + '" height="' + bh + '" rx="' + R4 + '" fill="' + GRID + '"/>'
    + '<rect class="anim" x="' + x0 + '" y="' + y + '" width="' + f1(Math.max(2, w)) + '" height="' + bh + '" rx="' + R4 + '" fill="' + col + '">'
    + mark((o.label || 'Actual') + ' ' + fmt(o.value) + (o.target == null ? '' : ' of ' + fmt(o.target))) + '</rect>';
  if (o.target != null) body += '<line x1="' + f1(at(o.target)) + '" x2="' + f1(at(o.target)) + '" y1="' + (y - 6) + '" y2="' + (y + bh + 6) + '" stroke="' + MARK + '" stroke-width="2"><title>'
    + esc('Budget ' + fmt(o.target) + (o.targetLabel ? ' · ' + o.targetLabel : '')) + '</title></line>'
    + txt(at(o.target), y + bh + 19, 'budget ' + fmt(o.target), { anchor: 'middle', size: 9.5 });
  if (o.marker && o.marker.value != null) {
    var mx = at(o.marker.value);
    body += '<polygon points="' + f1(mx - 6) + ',' + (y - 10) + ' ' + f1(mx + 6) + ',' + (y - 10) + ' ' + f1(mx) + ',' + (y - 2) + '" fill="' + hue(2) + '"><title>'
      + esc(o.marker.label + ' ' + fmt(o.marker.value)) + '</title></polygon>'
      + txt(mx, y - 14, o.marker.label, { anchor: 'middle', size: 9.5, weight: 700, fill: hue(2) });
  }
  var desc = (o.label || 'Actual') + ' ' + fmt(o.value) + (o.target == null ? ', no budget on file' : ' against a budget of ' + fmt(o.target))
    + (o.marker && o.marker.value != null ? ', ' + o.marker.label + ' ' + fmt(o.marker.value) : '') + '.';
  return frame(h, o.title || 'Against budget', desc, body, 'vtc-meter');
}

/* ------------------------------------------------------------------ 6 · grouped bars with a reference line ----
 * Forecast vs Actual per channel (FR-039/040): two series on one axis plus the budget as a dashed reference rule per
 * group, each bar directly labelled. The forecast is a pace, never a prediction — the panel says so in words. */
function grouped(o) {
  o = o || {}; var fmt = fmtOf(o), groups = o.groups || [], names = o.names || [];
  if (!groups.length) return empty(o.emptyWords || 'No channels in this view yet');
  var h = o.h || 250, P = { l: 46, r: 16, t: 22, b: 40 };
  var all = [];
  groups.forEach(function (g) { (g.bars || []).forEach(function (b) { if (b.value != null) all.push(n(b.value)); }); if (g.ref != null) all.push(n(g.ref)); });
  if (!all.length) return empty(o.emptyWords || 'No figures in this view yet');
  var max = Math.max.apply(null, all) * 1.15 || 1;
  var base = h - P.b, top = P.t, gw = (W - P.l - P.r) / groups.length;
  var ys = function (v) { return base - (base - top) * (pos(v) / max); };
  var ticks = [0, 0.5, 1].map(function (t) { return max * t; });
  var grid = ticks.map(function (t) {
    return '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + f1(ys(t)) + '" y2="' + f1(ys(t)) + '" stroke="' + GRID + '"/>'
      + txt(P.l - 8, ys(t) + 3.5, fmt(t), { anchor: 'end', size: 9.5 });
  }).join('');
  var body = groups.map(function (g, gi) {
    var bars = (g.bars || []).filter(function (b) { return b && b.value != null; });
    var bw = Math.min(34, (gw - 24) / Math.max(1, bars.length) - GAP), x0 = P.l + gi * gw + (gw - (bars.length * (bw + GAP) - GAP)) / 2;
    var out = bars.map(function (b, bi) {
      var x = x0 + bi * (bw + GAP), y = ys(b.value), col = b.color || hue(bi);
      return '<rect class="anim" x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(bw) + '" height="' + f1(Math.max(2, base - y)) + '" rx="' + R4 + '" fill="' + col + '"'
        + (b.hollow ? ' fill-opacity=".35" stroke="' + col + '" stroke-width="2"' : '') + '>'
        + mark(g.label + ' · ' + b.name + ' ' + fmt(b.value)) + '</rect>'
        + txt(x + bw / 2, y - 6, fmt(b.value), { anchor: 'middle', size: 9.5, weight: 700, fill: INK2 });
    }).join('');
    if (g.ref != null) out += '<line x1="' + f1(P.l + gi * gw + 10) + '" x2="' + f1(P.l + (gi + 1) * gw - 10) + '" y1="' + f1(ys(g.ref)) + '" y2="' + f1(ys(g.ref))
      + '" stroke="' + MARK + '" stroke-width="2" stroke-dasharray="5 3"><title>' + esc(g.label + ' ' + (o.refName || 'budget') + ' ' + fmt(g.ref)) + '</title></line>';
    /* TWO THINGS THAT COLLIDED UNDER THE BARS (25 Nov 2026, the owner: "the format ... look at the gaps").
       1. The rule's value was printed under EVERY group. Where one rule covers the whole chart - Scheduler pivots
          draws the scope's own average against six schedulers - that was the same sentence six times, overlapping
          its neighbours. It is now printed only where it CHANGES, so a per-bucket budget still labels every bucket
          and a single shared average labels the first group alone; the legend names the dashed rule either way.
       2. A group label wider than its slot ran into the next one ("devamani vanessa pillay" beside "luvo mawundu"
          at ~70px per group). It is clipped to what the slot holds, with the full name on hover and in the
          description line that screen readers read, so nothing is lost - only the overlap. */
    var sameAsPrev = gi > 0 && groups[gi - 1].ref === g.ref;
    var per = 10.5 * 0.55, room = Math.max(4, Math.floor((gw - 4) / per));
    var lab = String(g.label == null ? '' : g.label);
    var shown = lab.length > room ? lab.slice(0, Math.max(1, room - 1)).replace(/\s+$/, '') + '…' : lab;
    return out + '<g><title>' + esc(lab) + '</title>'
      + txt(P.l + gi * gw + gw / 2, h - P.b + 16, shown, { anchor: 'middle', size: 10.5, weight: 650, fill: INK2 }) + '</g>'
      + (g.ref == null || sameAsPrev ? '' : txt(P.l + gi * gw + gw / 2, h - P.b + 30, (o.refName || 'budget') + ' ' + fmt(g.ref), { anchor: 'middle', size: 9 }));
  }).join('');
  var desc = groups.map(function (g) {
    return g.label + ': ' + (g.bars || []).map(function (b) { return b.name + ' ' + fmt(b.value); }).join(', ')
      + (g.ref == null ? ', no budget on file' : ', ' + (o.refName || 'budget') + ' ' + fmt(g.ref));
  }).join('. ');
  var leg = names.map(function (nm, i) { return { name: nm, color: hue(i) }; }).concat([{ name: (o.refName || 'budget') + ' (dashed rule)', color: MARK }]);
  return frame(h, o.title || 'Actual and forecast', desc,
    grid + body + '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + base + '" y2="' + base + '" stroke="' + AXIS + '"/>', 'vtc-grouped')
    .replace('</svg></div>', '</svg>' + legend(leg) + '</div>');
}

/* ------------------------------------------------------------------ 7 · thin segmented bar ----
 * One row of the Detailed Breakdown table: the channel's outcome mix as a 10 px bar with a 2 px surface gap between
 * segments and NO text on it — the row's own cells carry every figure, so this is a shape, not a second claim. */
function segbar(o) {
  o = o || {}; var fmt = fmtOf(o), parts = (o.parts || []).filter(function (p) { return p && pos(p.value) > 0; });
  var total = n(o.total, parts.reduce(function (a, p) { return a + pos(p.value); }, 0));
  var h = o.h || 12, w = o.width || 120, x = 0, body = '';
  if (!total) return '<span class="vtc-seg-empty" title="' + esc(o.emptyWords || 'nothing in this row') + '">—</span>';
  parts.forEach(function (p, i) {
    var pw = Math.max(1, (w - GAP * Math.max(0, parts.length - 1)) * (pos(p.value) / total));
    body += '<rect x="' + f1(x) + '" y="1" width="' + f1(pw) + '" height="' + (h - 2) + '" rx="3" fill="' + (p.color || hue(i)) + '">'
      + mark(p.label + ' ' + fmt(p.value)) + '</rect>';
    x += pw + GAP;
  });
  return '<span class="chartbox vtchart vtc-segbar" data-chart="vtc-segbar" style="display:inline-block;width:' + w + 'px;vertical-align:middle">'
    + '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(parts.map(function (p) { return p.label + ' ' + fmt(p.value); }).join(', ')) + '">'
    + '<title>' + esc(parts.map(function (p) { return p.label + ' ' + fmt(p.value); }).join(' · ')) + '</title>' + body + '</svg></span>';
}

/* ------------------------------------------------------------------ 8 · sparkline + ring ----
 * The KPI cards' week series (the model's own weeks[], never a figure computed here) and the Target Achieved ring. */
function spark(o) {
  o = o || {}; var vs = (o.values || []).map(function (v) { return typeof v === 'number' && isFinite(v) ? v : null; });
  var real = vs.filter(function (v) { return v != null; });
  var w = o.width || 112, h = o.h || 30;
  if (real.length < 2) return '<span class="vtc-spark-none" title="' + esc(o.emptyWords || 'not enough weeks to show a trend yet') + '"></span>';
  var min = Math.min.apply(null, real), max = Math.max.apply(null, real), span = (max - min) || 1, col = o.color || hue(0);
  var pts = vs.map(function (v, i) { return v == null ? null : [(i / (vs.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 9)]; });
  var d = pts.filter(Boolean).map(function (p, i) { return (i ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1]); }).join('');
  var last = pts.filter(Boolean).slice(-1)[0];
  return '<span class="chartbox vtchart vtc-spark" data-chart="vtc-spark" style="display:inline-block;width:' + w + 'px">'
    + '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(o.label || 'by week') + '"><title>' + esc(o.label || 'by week') + '</title>'
    + '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
    + '<circle cx="' + f1(last[0]) + '" cy="' + f1(last[1]) + '" r="2.6" fill="' + col + '"/></svg></span>';
}
/** the Target Achieved meter: one ratio against one limit, with the ratio printed inside and never colour alone. */
function ring(o) {
  o = o || {}; var size = o.size || 104, r = size / 2 - 9, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
  var pctv = o.value == null ? null : Math.max(0, Math.min(1, n(o.value)));
  var col = o.color || hue(0), on = pctv == null ? 0 : C * pctv;
  var ti = uid('vtt'), di = uid('vtd');
  return '<div class="chartbox vtchart vtc-ring" data-chart="vtc-ring" style="width:' + size + 'px">'
    + '<svg viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-labelledby="' + ti + ' ' + di + '">'
    + '<title id="' + ti + '">' + esc(o.title || 'Target achieved') + '</title>'
    + '<desc id="' + di + '">' + esc(o.desc || o.text || '') + '</desc>'
    + '<circle cx="' + cx + '" cy="' + cy + '" r="' + f1(r) + '" fill="none" stroke="' + GRID + '" stroke-width="9"/>'
    + (pctv == null ? '' : '<circle cx="' + cx + '" cy="' + cy + '" r="' + f1(r) + '" fill="none" stroke="' + col + '" stroke-width="9" stroke-linecap="round"'
      + ' stroke-dasharray="' + f1(on) + ' ' + f1(C) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"><title>' + esc(o.text || '') + '</title></circle>')
    + '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="19" font-weight="800" fill="' + INK + '">' + esc(o.centre || '—') + '</text>'
    + '<text x="' + cx + '" y="' + (cy + 19) + '" text-anchor="middle" font-size="8.5" fill="' + MUTED + '">' + esc(o.centreLabel || 'of budget') + '</text>'
    + '</svg></div>';
}

function empty(words) { return '<div class="empty vtc-empty">' + esc(words) + '</div>'; }

/* ------------------------------------------------------------------ wire: the line form's crosshair ----
 * Called by the page after it paints (PAGES._wire_vt_report). Reads the config the chart wrote beside itself, so the
 * markup stays a pure string and the suites can render the page without a browser event loop. */
function wire(doc) {
  doc = doc || (root && root.document); if (!doc || !doc.querySelectorAll) return 0;
  var cfgs = doc.querySelectorAll('script.vtc-cfg[data-for]'), done = 0;
  for (var i = 0; i < cfgs.length; i++) {
    var box = doc.getElementById(cfgs[i].getAttribute('data-for'));
    if (!box || box.__vtcWired) continue;
    var cfg = null; try { cfg = JSON.parse(cfgs[i].textContent); } catch (e) { cfg = null; }
    if (!cfg) continue;
    box.__vtcWired = true; done++;
    wireOne(box, cfg);
  }
  return done;
}
function wireOne(box, cfg) {
  var svg = box.querySelector('svg'), hit = box.querySelector('.hit'), cross = box.querySelector('.cross'), tip = box.querySelector('.tip');
  if (!svg || !hit || !tip) return;
  var L = cfg.labels, P = cfg.P;
  var show = function (e) {
    var rb = svg.getBoundingClientRect(), fx = (e.clientX - rb.left) / rb.width * W;
    var i = Math.max(0, Math.min(L.length - 1, Math.round((fx - P.l) / (W - P.l - P.r) * (L.length - 1))));
    var cxv = P.l + (W - P.l - P.r) * i / (L.length - 1);
    if (cross) { cross.style.display = 'block'; cross.setAttribute('x1', cxv); cross.setAttribute('x2', cxv); }
    var bx = box.getBoundingClientRect();
    tip.style.display = 'block';
    tip.style.left = Math.min(bx.width - 165, Math.max(0, e.clientX - bx.left + 14)) + 'px';
    tip.style.top = Math.max(0, e.clientY - bx.top - 14) + 'px';
    tip.innerHTML = '<div class="t">' + esc(L[i]) + '</div>' + cfg.series.map(function (s) {
      return '<div class="r"><span><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span><b>'
        + esc(s.values[i] == null ? '—' : String(Math.round(s.values[i] * 10) / 10)) + '</b></div>';
    }).join('');
  };
  hit.addEventListener('mousemove', show);
  hit.addEventListener('mouseleave', function () { tip.style.display = 'none'; if (cross) cross.style.display = 'none'; });
}

return { W: W, SERIES: SERIES, hue: hue, legend: legend, esc: esc,
  line: line, donut: donut, hbars: hbars, meters: meters, meter: meter, grouped: grouped, segbar: segbar, spark: spark, ring: ring,
  empty: empty, wire: wire };
});
