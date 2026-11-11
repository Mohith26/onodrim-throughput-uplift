import * as L from './src/line.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ic = (n) => `<span class="bp5-icon-standard bp5-icon-${n}" aria-hidden="true"></span>`;
const pct = (x, d = 1) => `${(100 * x).toFixed(d)}%`;
const eur = (x) => `€${Math.round(x / 1000)}k`;
const LS = 'onodrim-throughput-uplift:v1';
const COLORS = { R: '#238551', D: '#cd4246', B: '#c87619', S: '#d3d8de' };
const STCOL = ['#7961db', '#2d72d2', '#d1980b', '#00a396', '#db2c6f', '#8f99a8'];

const app = { mes: null, res: null, twin: null, cal: null, store: null, live: {} };

function loadStore() {
  try { const s = JSON.parse(localStorage.getItem(LS)); if (s && s.v === 1) return s; } catch { /* ignore */ }
  return { v: 1, budget: 100000, delta: 8, alpha: 0.05, approved: null, workorders: [] };
}
const save = () => localStorage.setItem(LS, JSON.stringify(app.store));

function route() {
  const [p, qs] = (location.hash.slice(2) || 'overview').split('?');
  const q = new URLSearchParams(qs || '');
  return { tab: ['overview', 'bottleneck', 'plan', 'twin'].includes(p) ? p : 'overview', station: q.get('station') || app.res.constraint.id, day: Math.max(0, Math.min(19, +(q.get('day') ?? app.mes.ganttDay))), ov: q.get('ov') || 'overview' };
}
function href(patch) {
  const r = { ...route(), ...patch };
  const q = new URLSearchParams({ station: r.station });
  if (r.tab === 'bottleneck') q.set('day', r.day);
  if (r.ov !== 'overview') q.set('ov', r.ov);
  return `#/${r.tab}?${q}`;
}

// ---------- derived data (computed in the browser from the MES export) ----------
function derive() {
  const m = app.mes;
  app.cal = L.calibrate(m.stations);
  app.twin = {
    name: 'Line 2', scrap: m.scrapObserved, qualityAt: m.qualityAt, buffers: [...m.buffers],
    stations: app.cal.map((c, i) => ({ id: c.id, name: m.stations[i].name, ideal: m.stations[i].ideal, cycle: c.cycle, cv: c.cv, mtbf: c.mtbf, mttr: c.mttr })),
  };
  const tot = m.oee.reduce((a, o) => a + o.oee, 0);
  void tot;
}

// ---------- shell ----------
function shell() {
  document.body.insertAdjacentHTML('afterbegin', `
  <header class="mh">
    <div class="tile"><img src="assets/onodrim-icon.svg" alt="Onodrim"></div>
    <h1>Line Throughput Uplift</h1><span class="crumb">Kessler Feinmechanik · Line 2</span>
    <div class="right"><span id="asof"></span><button class="bp5-button bp5-minimal bp5-small" disabled>${ic('edit')}<span class="bp5-button-text">Edit</span></button></div>
  </header>
  <div class="layout">
    <aside class="pane" aria-label="Filters"><div class="ph">${ic('filter')}Filters</div><div class="pb" id="left"></div></aside>
    <main class="pane center" aria-label="Line view"><div class="tabs" role="tablist" id="tabs"></div><div class="pb" id="main"></div></main>
    <aside class="pane" aria-label="Object view"><div class="ph">${ic('cube')}<span class="grow">Object View</span><a class="bp5-button bp5-minimal bp5-small" id="ov-close" href="#" aria-label="Collapse">${ic('minimize')}</a></div><div class="pb" id="right"></div></aside>
  </div>`);
}

function left(r) {
  const m = app.mes;
  const maxO = 1;
  const stations = m.oee.map((o, i) => `<a class="facet ${r.station === o.id ? 'on' : ''}" href="${href({ station: o.id })}" aria-label="${o.id} OEE ${pct(o.oee, 0)}"><span class="chk"></span><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${o.id} · ${esc(m.stations[i].name)}</span><span class="n">${Math.round(o.oee * 100)}</span><span class="bar"><i style="width:${(100 * o.oee / maxO).toFixed(0)}%"></i></span></a>`).join('');
  const dmax = Math.max(...m.days.map((d) => d.good));
  const W = 230, H = 86, bw = W / m.days.length;
  const bars = m.days.map((d, i) => `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - 16 - (d.good / dmax) * (H - 26)).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${((d.good / dmax) * (H - 26)).toFixed(1)}" fill="${i === r.day && r.tab === 'bottleneck' ? '#215db0' : '#4c90f0'}"><title>Day ${i + 1}: ${d.good} good parts</title></rect>`).join('');
  const wk = m.weekly.map((w, i) => `<text x="${(i * 5 * bw + 2.5 * bw).toFixed(0)}" y="${H - 2}" text-anchor="middle">W${i + 1}</text>`).join('');
  $('#left').innerHTML = `
  <div class="fsec"><h5>Views</h5>
    ${[['overview', 'dashboard', 'Overview'], ['bottleneck', 'timeline-bar-chart', 'Bottleneck'], ['plan', 'predictive-analysis', 'Uplift plan'], ['twin', 'lab-test', 'Twin check']].map(([t, i, l]) => `<a class="navitem ${r.tab === t ? 'on' : ''}" href="${href({ tab: t })}"><span>${ic(i)}${l}</span>${t === 'plan' && app.store.approved ? '<span class="tag green" style="font-size:11px;padding:0 5px">approved</span>' : ''}</a>`).join('')}
  </div>
  <div class="fsec"><h5>Station · OEE (MES) <span>(${m.oee.length})</span></h5>${stations}</div>
  <div class="fsec"><h5>Good parts per day <a href="${href({ tab: 'bottleneck' })}">Gantt</a></h5>
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Good parts per day">${bars}${wk}</svg>
    <div style="font-size:13px;color:var(--gray1);margin-top:4px">${m.window}</div></div>
  <div class="fsec"><h5>Data</h5><div style="font-size:13px;color:var(--gray1);line-height:1.5">MES state log: ${m.stations.reduce((a, s) => a + s.failures.length, 0)} breakdowns, ${m.stations[0].cycleN.toLocaleString()} parts, ${m.hours.length} planned hours. Twin calibrated in your browser.</div></div>`;
}

// ---------- overview ----------
function overview(r) {
  const m = app.mes, R = app.res;
  const lineOEE = m.oee.reduce((a, o) => a + o.oee, 0) / m.oee.length;
  const worst = m.oee.reduce((b, o) => (o.oee < b.oee ? o : b));
  const cons = R.constraint.id;
  const rows = m.oee.map((o, i) => {
    const s = app.cal[i];
    return `<tr class="${r.station === o.id ? 'sel' : ''}" data-href="${href({ station: o.id })}"><td><span class="icn" style="background:${STCOL[i]}">${ic('cog')}</span><span class="lnk">${o.id} · ${esc(m.stations[i].name)}</span></td><td class="num">${pct(o.oee)}</td><td class="num">${pct(o.A, 0)}</td><td class="num">${pct(o.P, 0)}</td><td class="num">${pct(o.down / o.span)}</td><td class="num">${pct(o.blocked / o.span)}</td><td class="num">${pct(o.starved / o.span)}</td><td class="num">${o.id === cons ? `<span class="tag red">${pct(m.bottleneck.sole[i], 0)}</span>` : pct(m.bottleneck.sole[i], 1)}</td><td class="num">${Math.round(s.mtbf)} min</td><td class="num">${s.mttr.toFixed(0)} min</td></tr>`;
  }).join('');
  return `
  <div class="callout warn">${ic('warning-sign')}<b>The lowest-OEE station is not the constraint.</b> ${worst.id} shows ${pct(worst.oee, 0)} OEE because it is blocked ${pct(m.oee.find((o) => o.id === worst.id).blocked / m.oee[0].span, 0)} of the time. ${cons} is the active-period bottleneck ${pct(R.constraint.sole, 0)} of the time; every minute lost there is a minute lost for the line.</div>
  <div class="mlabel">Line 2 · last 4 weeks</div>
  <div class="metrics">
    <div class="metric"><label>Good parts / week</label><div class="v">${Math.round(R.observedWeeklyMean)}</div><div class="s">${m.weekly.join(' · ')}</div></div>
    <div class="metric"><label>Average station OEE</label><div class="v">${pct(lineOEE, 1)}</div><div class="s">MES dashboard view</div></div>
    <div class="metric"><label>Constraint (active period)</label><div class="v red">${cons}</div><div class="s">sole bottleneck ${pct(R.constraint.sole, 0)} of planned time</div></div>
    <div class="metric"><label>€100k plan (twin)</label><div class="v green">+${pct(R.plan.pct, 0)}</div><div class="s">+${R.plan.uplift.toFixed(0)} good parts / week</div></div>
  </div>
  <div class="sec"><div class="h">${ic('th')}<span class="grow">Stations</span><small>click a row for details</small></div>
  <div style="overflow:auto"><table class="ot sortable" aria-label="Stations"><thead><tr>${['Station', 'OEE', 'Avail.', 'Perf.', 'Down', 'Blocked', 'Starved', 'Bottleneck', 'MTBF (busy)', 'MTTR'].map((h, k) => `<th data-s tabindex="0" class="${k ? 'num' : ''}">${h}${ic('double-caret-vertical')}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></div>
  <div class="sec"><div class="h">${ic('timeline-bar-chart')}<span class="grow">Where the time goes</span><small>share of planned time, 4 weeks</small></div><div class="c">${stackBars(m.oee.map((o) => [o.run / o.span, o.down / o.span, o.blocked / o.span, o.starved / o.span]), m.oee.map((o) => o.id), ['Running', 'Down', 'Blocked', 'Starved'], [COLORS.R, COLORS.D, COLORS.B, COLORS.S])}</div></div>`;
}

function stackBars(rows, labels, names, cols) {
  const W = 760, rowH = 26, H = rows.length * rowH + 24, x0 = 60;
  const bars = rows.map((r, i) => {
    let x = x0;
    return `<text x="${x0 - 8}" y="${i * rowH + 17}" text-anchor="end">${labels[i]}</text>` + r.map((v, k) => { const w = v * (W - x0 - 10); const s = `<rect x="${x.toFixed(1)}" y="${i * rowH + 4}" width="${Math.max(0, w).toFixed(1)}" height="18" fill="${cols[k]}"><title>${labels[i]} ${names[k]}: ${pct(v)}</title></rect>`; x += w; return s; }).join('');
  }).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => `<line x1="${x0 + t * (W - x0 - 10)}" x2="${x0 + t * (W - x0 - 10)}" y1="0" y2="${rows.length * rowH + 4}" stroke="#e5e8eb"/><text x="${x0 + t * (W - x0 - 10)}" y="${H - 4}" text-anchor="middle">${t * 100}%</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Time breakdown">${ticks}${bars}</svg><div class="legend">${names.map((n, k) => `<span><i style="background:${cols[k]}"></i>${n}</span>`).join('')}</div>`;
}

// ---------- bottleneck ----------
function bottleneck(r) {
  const m = app.mes;
  const W = 900, x0 = 66, rowH = 30, K = m.ganttDays[0].states.length, span = 960, sx = (t) => x0 + (t / span) * (W - x0 - 10);
  const g = m.ganttDays[r.day];
  let gantt = '';
  {
    const sl = m.slot;
    const runs = (str) => { const out = []; let s0 = 0; for (let k = 1; k <= str.length; k++) if (k === str.length || str[k] !== str[s0]) { out.push([s0 * sl, k * sl, str[s0]]); s0 = k; } return out; };
    const lanes = g.states.map((str, i) => `<text x="${x0 - 8}" y="${i * rowH + 19}" text-anchor="end">${m.oee[i].id}</text>` + runs(str).map(([a, b, s]) => `<rect x="${sx(a).toFixed(1)}" y="${i * rowH + 6}" width="${(sx(b) - sx(a) + 0.2).toFixed(1)}" height="18" fill="${COLORS[s]}"><title>${m.oee[i].id} ${{ R: 'running', D: 'down', B: 'blocked', S: 'starved' }[s]} ${a}–${b} min</title></rect>`).join('')).join('');
    const yb = K * rowH + 8;
    const bn = runs(g.bn).filter(([, , k]) => k !== '-').map(([a, b, k]) => `<rect x="${sx(a).toFixed(1)}" y="${yb}" width="${(sx(b) - sx(a) + 0.2).toFixed(1)}" height="12" fill="${STCOL[+k]}"/>`).join('');
    const hrs = Array.from({ length: 17 }, (_, h) => `<line x1="${sx(h * 60)}" x2="${sx(h * 60)}" y1="2" y2="${yb + 14}" stroke="#e5e8eb" stroke-width="${h % 8 ? 0.5 : 1}"/><text x="${sx(h * 60)}" y="${yb + 30}" text-anchor="middle">${String(6 + h).padStart(2, '0')}:00</text>`).join('');
    gantt = `<svg viewBox="0 0 ${W} ${yb + 36}" width="100%" role="img" aria-label="Station state Gantt">${hrs}${lanes}<text x="${x0 - 8}" y="${yb + 10}" text-anchor="end">Bottleneck</text>${bn}</svg>
    <div class="legend"><span><i style="background:${COLORS.R}"></i>Running</span><span><i style="background:${COLORS.D}"></i>Down</span><span><i style="background:${COLORS.B}"></i>Blocked</span><span><i style="background:${COLORS.S}"></i>Starved / idle</span>${m.oee.map((o, i) => `<span><i style="background:${STCOL[i]}"></i>${o.id} is bottleneck</span>`).join('')}</div>`;
  }
  // daily shifting bottleneck
  const dW = 900, dH = 170, bw = (dW - 40) / m.days.length;
  const daily = m.days.map((d, j) => { let y = dH - 22; return d.sole.map((v, k) => { const h = v * (dH - 32); y -= h; return `<rect x="${(30 + j * bw + 2).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${h.toFixed(1)}" fill="${STCOL[k]}" ${j === r.day ? 'stroke="#1c2127" stroke-width="1"' : ''}><title>Day ${j + 1} · ${m.oee[k].id}: ${pct(v)}</title></rect>`; }).join('') + `<a href="${href({ day: j })}"><text x="${(30 + j * bw + bw / 2).toFixed(1)}" y="${dH - 6}" text-anchor="middle" style="${j === r.day ? 'fill:#1c2127;font-weight:600' : ''}">${j + 1}</text></a>`; }).join('');
  const days = m.days.map((d, j) => `<option value="${j}" ${j === r.day ? 'selected' : ''}>Day ${j + 1} (W${Math.floor(j / 5) + 1} ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][j % 5]}) · ${d.good} good</option>`).join('');
  return `
  <div class="callout">${ic('info-sign')}<b>Active period method</b> (Roser, Nakano &amp; Tanaka): a station is active while running or down, not while starved or blocked. At each moment the station with the longest uninterrupted active period limits the line. Computed from the MES state log.</div>
  <div class="sec"><div class="h">${ic('gantt-chart')}<span class="grow">Station states and momentary bottleneck</span><div class="bp5-html-select bp5-minimal"><select id="day" aria-label="Day">${days}</select><span class="bp5-icon bp5-icon-double-caret-vertical"></span></div></div><div class="c">${gantt}</div></div>
  <div class="sec"><div class="h">${ic('stacked-chart')}<span class="grow">Bottleneck share by day</span><small>sole bottleneck time · click a day</small></div><div class="c"><svg viewBox="0 0 ${dW} ${dH}" width="100%" role="img" aria-label="Daily bottleneck share">${[0, 0.5, 1].map((t) => `<line x1="30" x2="${dW - 10}" y1="${dH - 22 - t * (dH - 32)}" y2="${dH - 22 - t * (dH - 32)}" stroke="#e5e8eb"/><text x="24" y="${dH - 18 - t * (dH - 32)}" text-anchor="end">${t * 100}%</text>`).join('')}${daily}</svg></div></div>`;
}

// ---------- uplift plan ----------
function ciBar(e, lo, hi) {
  const sx = (v) => ((v - lo) / (hi - lo)) * 96;
  return `<span class="ci" title="95% CI ${e.lo.toFixed(1)} to ${e.hi.toFixed(1)}"><span class="ax"></span><span class="z" style="left:${sx(0).toFixed(1)}px"></span><span class="rg" style="left:${sx(e.lo).toFixed(1)}px;width:${Math.max(2, sx(e.hi) - sx(e.lo)).toFixed(1)}px"></span><span class="pt" style="left:${(sx(e.mean) - 1).toFixed(1)}px"></span></span>`;
}

function plan(r) {
  const R = app.res, m = app.mes, st = app.store;
  const live = app.live.plan;
  const P = live || { ids: R.plan.ids, steps: R.plan.steps, spent: R.plan.spent, uplift: R.plan.uplift, lo: R.plan.lo, hi: R.plan.hi, pct: R.plan.pct, budget: R.plan.budget };
  const kn = app.live.kn || R.kn;
  const acts = m.actions.map((a) => ({ a, e: R.actions.find((x) => x.id === a.id) }));
  const lo = Math.min(0, ...acts.map((x) => x.e.lo)) - 2, hi = Math.max(...acts.map((x) => x.e.hi)) + 2;
  const worst = m.oee.reduce((b, o) => (o.oee < b.oee ? o : b));
  const rows = acts.map(({ a, e }) => {
    const inPlan = P.ids.includes(a.id);
    const status = kn.best === a.id ? '<span class="tag green">best (KN)</span>' : kn.elimAt[a.id] != null ? `<span class="tag gray">out at rep ${kn.elimAt[a.id]}</span>` : '<span class="tag blue">in contention</span>';
    return `<tr class="${inPlan ? 'sel' : ''}" data-href="${href({ station: a.station || (a.kind === 'buffer' ? m.oee[a.buffer + 1].id : r.station) })}"><td><div>${esc(a.title)}${a.station === worst.id ? ' <span class="tag orange">lowest OEE</span>' : ''}</div><div style="font-size:12px;color:var(--gray1)">${esc(a.detail)}</div></td><td class="num">${eur(a.cost)}</td><td class="num">${e.mean >= 0 ? '+' : ''}${e.mean.toFixed(1)}</td><td>${ciBar(e, lo, hi)}</td><td class="num">${e.mean > 0 ? (e.mean / (a.cost / 10000)).toFixed(1) : '—'}</td><td>${status}</td><td>${inPlan ? `<span class="tag green">step ${P.ids.indexOf(a.id) + 1}</span>` : ''}</td></tr>`;
  }).join('');
  const approved = st.approved;
  const steps = P.steps.map((s, i) => { const a = m.actions.find((x) => x.id === s.action); return `<tr><td>${i + 1}</td><td>${esc(a.title)}</td><td class="num">${eur(a.cost)}</td><td class="num">+${s.uplift.toFixed(1)} <span style="color:var(--gray1)">(${s.lo.toFixed(1)} to ${s.hi.toFixed(1)})</span></td><td class="num">${eur(s.spent)}</td></tr>`; }).join('');
  return `
  <div class="callout ${approved ? 'success' : ''}">${ic(approved ? 'tick-circle' : 'predictive-analysis')}${approved ? `<b>Plan approved</b> (${approved.ids.join(', ')}, ${eur(approved.spent)}). ${st.workorders.length} work orders created for the plant team.` : `<b>Each action is simulated on a twin calibrated from your MES log</b>, with common random numbers so differences are measured on identical weeks. Ranking uses the Kim–Nelson procedure: P(pick the best) ≥ ${pct(1 - st.alpha, 0)} if it is at least ${st.delta} parts/week better than the rest.`}</div>
  <div class="sec"><div class="h">${ic('properties')}<span class="grow">Candidate actions</span><small>uplift in good parts / week vs current line, 95% CI, ${R.reps} paired weeks</small></div>
  <div style="overflow:auto"><table class="ot sortable" aria-label="Candidate actions"><thead><tr>${['Action', 'Cost', 'Uplift', '95% CI', 'Per €10k', 'Selection', 'Plan'].map((h, k) => `<th data-s tabindex="0" class="${[1, 2, 4].includes(k) ? 'num' : ''}">${h}${ic('double-caret-vertical')}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></div>
  <div class="sec"><div class="h">${ic('build')}<span class="grow">Budgeted plan</span>
    <div class="controls"><label for="budget">Budget</label><div class="bp5-html-select"><select id="budget">${[30000, 60000, 100000, 150000, 250000].map((b) => `<option value="${b}" ${b === (P.budget || st.budget) ? 'selected' : ''}>${eur(b)}</option>`).join('')}</select><span class="bp5-icon bp5-icon-double-caret-vertical"></span></div>
    <button class="bp5-button" data-act="replan">${ic('refresh')}<span class="bp5-button-text">Re-plan</span></button>
    <button class="bp5-button" data-act="csv">${ic('export')}<span class="bp5-button-text">Export CSV</span></button>
    <button class="bp5-button bp5-intent-primary" data-act="approve" ${approved && approved.ids.join() === P.ids.join() ? 'disabled' : ''}>${ic('endorsed')}<span class="bp5-button-text">${approved && approved.ids.join() === P.ids.join() ? 'Approved' : 'Approve plan'}</span></button></div></div>
  <div class="c"><div class="metrics" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:12px">
    <div class="metric"><label>Added good parts / week</label><div class="v green">+${P.uplift.toFixed(0)}</div><div class="s">95% CI ${P.lo.toFixed(0)} to ${P.hi.toFixed(0)} · ${P.ids.length} actions</div></div>
    <div class="metric"><label>Line output</label><div class="v">+${pct(P.pct, 1)}</div><div class="s">vs ${R.plan.baseMean.toFixed(0)} / week on the twin</div></div>
    <div class="metric"><label>Spend</label><div class="v">${eur(P.spent)}</div><div class="s">greedy by uplift per euro, re-simulated each step</div></div></div>
  <table class="ot" aria-label="Plan steps"><thead><tr><th>Step</th><th>Action</th><th class="num">Cost</th><th class="num">Added on top of earlier steps</th><th class="num">Cumulative spend</th></tr></thead><tbody>${steps || '<tr><td colspan="5" style="color:var(--gray1)">No action fits this budget with a positive lower confidence bound.</td></tr>'}</tbody></table>
  ${st.workorders.length ? `<div class="mlabel" style="margin-top:16px">Work orders</div><table class="ot"><thead><tr><th>ID</th><th>Action</th><th>Owner</th><th>Status</th></tr></thead><tbody>${st.workorders.map((w) => `<tr><td>${w.id}</td><td>${esc(w.title)}</td><td>${esc(w.owner)}</td><td><span class="tag blue">${w.status}</span></td></tr>`).join('')}</tbody></table>` : ''}
  </div></div>`;
}

// ---------- twin check ----------
function twin() {
  const R = app.res, m = app.mes;
  const rows = app.cal.map((c, i) => `<tr><td>${c.id} · ${esc(m.stations[i].name)}</td><td class="num">${c.cycle.toFixed(2)} min</td><td class="num">${(c.cv * 100).toFixed(0)}%</td><td class="num">${c.failures}</td><td class="num">${Math.round(c.mtbf)} <span style="color:var(--gray1)">(${Math.round(c.mtbfCI[0])}–${Math.round(c.mtbfCI[1])})</span></td><td class="num">${c.mttr.toFixed(1)} min</td></tr>`).join('');
  return `
  <div class="callout">${ic('lab-test')}<b>Is the twin good enough to plan with?</b> Parameters are maximum-likelihood estimates from the MES log (exponential failures over busy time, lognormal cycles). The twin then has to reproduce the weekly output it was never fit to.</div>
  <div class="metrics" style="grid-template-columns:repeat(3,minmax(0,1fr))">
    <div class="metric"><label>Observed good parts / week</label><div class="v">${R.observedWeeklyMean.toFixed(0)}</div><div class="s">${R.observedWeekly.join(' · ')}</div></div>
    <div class="metric"><label>Twin good parts / week</label><div class="v">${R.twinWeeklyMean.toFixed(0)}</div><div class="s">sd ${R.twinWeeklySd.toFixed(0)} over ${R.reps} simulated weeks (${pct(R.twinWeeklyMean / R.observedWeeklyMean - 1)})</div></div>
    <div class="metric"><label>Plan on the hidden “true” line</label><div class="v green">+${R.truthCheck.uplift.toFixed(0)}</div><div class="s">twin predicted +${R.plan.uplift.toFixed(0)} (CI ${R.plan.lo.toFixed(0)}–${R.plan.hi.toFixed(0)}): conservative</div></div>
  </div>
  <div class="sec"><div class="h">${ic('derive-column')}<span class="grow">Calibrated parameters</span><small>MTBF 95% interval from the χ² likelihood</small></div><div style="overflow:auto"><table class="ot"><thead><tr><th>Station</th><th class="num">Cycle (mean)</th><th class="num">Cycle CV</th><th class="num">Breakdowns</th><th class="num">MTBF, busy min</th><th class="num">MTTR</th></tr></thead><tbody>${rows}</tbody></table></div></div>
  <div class="foot">Truth check: the demo's log was generated from a hidden parameter set (scripts/generate.mjs). Applying the approved plan to that hidden line on fresh random weeks gives +${R.truthCheck.uplift.toFixed(1)} parts/week (95% CI ${R.truthCheck.lo.toFixed(1)}–${R.truthCheck.hi.toFixed(1)}), above the twin's estimate: 4 weeks of data understate how often ${R.constraint.id} fails.</div>`;
}

// ---------- object view ----------
function objectView(r) {
  const m = app.mes; const i = m.oee.findIndex((o) => o.id === r.station); if (i < 0) { $('#right').innerHTML = '<div class="fsec">No station selected.</div>'; return; }
  const o = m.oee[i], c = app.cal[i], s = m.stations[i];
  const tabs = [['overview', 'Overview'], ['properties', 'Properties'], ['failures', 'Breakdown log']];
  let body = '';
  if (r.ov === 'failures') {
    body = `<table class="flog">${s.failures.slice().sort((a, b) => b.dur - a.dur).slice(0, 40).map((f) => `<tr><td>Day ${Math.floor((f.t - 480) / 960) + 1}, ${String(6 + Math.floor(((f.t - 480) % 960) / 60)).padStart(2, '0')}:${String(Math.floor((f.t - 480) % 60)).padStart(2, '0')}</td><td>after ${Math.round(f.busySince)} busy min</td><td>${f.dur.toFixed(0)} min</td></tr>`).join('')}</table><div class="foot">${s.failures.length} breakdowns, longest first (top 40).</div>`;
  } else if (r.ov === 'properties') {
    body = `<dl class="props"><dt>Station</dt><dd>${o.id}</dd><dt>Name</dt><dd>${esc(s.name)}</dd><dt>Ideal cycle (routing)</dt><dd>${s.ideal.toFixed(1)} min</dd><dt>Observed cycle</dt><dd>${c.cycle.toFixed(2)} min</dd><dt>Cycle CV</dt><dd>${(c.cv * 100).toFixed(0)}%</dd><dt>Parts processed</dt><dd>${s.cycleN.toLocaleString()}</dd><dt>Busy minutes</dt><dd>${Math.round(s.busyMin).toLocaleString()}</dd><dt>Breakdowns</dt><dd>${c.failures}</dd><dt>Upstream buffer</dt><dd>${i ? m.buffers[i - 1] + ' parts' : 'raw stock'}</dd><dt>Downstream buffer</dt><dd>${i < m.buffers.length ? m.buffers[i] + ' parts' : 'shipping'}</dd></dl>`;
  } else {
    const acts = m.actions.filter((a) => a.station === o.id || (a.kind === 'buffer' && (a.buffer === i || a.buffer === i - 1)));
    body = `<div class="sec" style="margin:0 0 12px"><div class="h">${ic('properties')}<span class="grow">Properties</span></div><div class="c"><dl class="props">
      <dt>OEE (MES)</dt><dd>${pct(o.oee)}</dd><dt>Availability</dt><dd>${pct(o.A)}</dd><dt>Performance</dt><dd>${pct(o.P)}</dd>
      <dt>Blocked</dt><dd>${pct(o.blocked / o.span)}</dd><dt>Starved</dt><dd>${pct(o.starved / o.span)}</dd>
      <dt>Sole bottleneck</dt><dd>${o.id === app.res.constraint.id ? `<span class="tag red">${pct(m.bottleneck.sole[i], 0)}</span>` : pct(m.bottleneck.sole[i], 1)}</dd>
      <dt>MTBF (busy)</dt><dd>${Math.round(c.mtbf)} min</dd><dt>MTTR</dt><dd>${c.mttr.toFixed(1)} min</dd></dl></div></div>
      <div class="sec" style="margin:0"><div class="h">${ic('link')}<span class="grow">Linked actions</span></div><div class="c">${acts.length ? acts.map((a) => { const e = app.res.actions.find((x) => x.id === a.id); return `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--lg3)"><a href="${href({ tab: 'plan' })}" class="lnk" style="color:var(--bp-blue-dark);text-decoration:none">${esc(a.title)}</a><span class="tag ${e.lo > 0 ? 'green' : 'gray'}">${e.mean >= 0 ? '+' : ''}${e.mean.toFixed(1)}/wk</span></div>`; }).join('') : '<span style="color:var(--gray1)">No candidate actions on this station.</span>'}</div></div>`;
  }
  $('#right').innerHTML = `<div class="ov-head"><span class="icn" style="background:${STCOL[i]}">${ic('cog')}</span><div><b>${o.id} · ${esc(s.name)}</b><small>Station (Line 2)</small></div></div>
  <div class="ov-tabs">${tabs.map(([k, l]) => `<a class="${r.ov === k ? 'on' : ''}" href="${href({ ov: k })}">${l}</a>`).join('')}</div><div style="padding:14px 16px">${body}</div>`;
}

// ---------- actions ----------
function toast(msg) { document.querySelectorAll('.toast').forEach((t) => t.remove()); document.body.insertAdjacentHTML('beforeend', `<div class="toast" role="status">${esc(msg)}</div>`); setTimeout(() => document.querySelectorAll('.toast').forEach((t) => t.remove()), 3000); }
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

function currentPlan() {
  const R = app.res; return app.live.plan || { ids: R.plan.ids, steps: R.plan.steps, spent: R.plan.spent, uplift: R.plan.uplift, lo: R.plan.lo, hi: R.plan.hi, pct: R.plan.pct, budget: R.plan.budget };
}

function onAct(b) {
  const act = b.dataset.act;
  if (act === 'replan') {
    const budget = +$('#budget').value; app.store.budget = budget; save();
    b.disabled = true; b.querySelector('.bp5-button-text').textContent = 'Simulating…';
    setTimeout(() => {
      const res = L.greedyPlan(app.twin, app.mes.actions, budget, { reps: app.res.reps, seed0: 7000 });
      app.live.plan = { ids: res.plan, steps: res.steps, spent: res.spent, uplift: res.total.mean, lo: res.total.lo, hi: res.total.hi, pct: res.total.mean / res.baseMean, budget };
      render();
    }, 30);
  } else if (act === 'approve') {
    const P = currentPlan();
    app.store.approved = { ids: P.ids, spent: P.spent, uplift: P.uplift };
    app.store.workorders = P.ids.map((id, k) => { const a = app.mes.actions.find((x) => x.id === id); return { id: `WO-${2611 + k}`, title: a.title, owner: a.kind === 'buffer' ? 'Plant engineering' : a.kind === 'cycle' ? 'Manufacturing engineering' : 'Maintenance', status: 'Open' }; });
    save(); render(); toast(`Plan approved: ${P.ids.length} work orders created`);
  } else if (act === 'csv') {
    const P = currentPlan();
    const rows = [['action', 'title', 'cost_eur', 'uplift_parts_per_week', 'ci_lo', 'ci_hi', 'in_plan', 'plan_step']];
    for (const a of app.mes.actions) { const e = app.res.actions.find((x) => x.id === a.id); rows.push([a.id, a.title, a.cost, e.mean, e.lo, e.hi, P.ids.includes(a.id), P.ids.indexOf(a.id) + 1 || '']); }
    download('line2-uplift-plan.csv', L.toCSV(rows), 'text/csv');
  }
}

function sortTable(th) {
  const table = th.closest('table'); const idx = [...th.parentNode.children].indexOf(th);
  const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
  th.parentNode.querySelectorAll('th').forEach((x) => { delete x.dataset.dir; x.removeAttribute('aria-sort'); });
  th.dataset.dir = dir; th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
  const key = (tr) => { const t = tr.children[idx]?.textContent.trim() ?? ''; const n = parseFloat(t.replace(/[^0-9.\-]/g, '')); return /^[+\-€]?[0-9]/.test(t) && !Number.isNaN(n) ? n : t.toLowerCase(); };
  const rows = [...table.tBodies[0].rows];
  rows.sort((a, b) => { const x = key(a), y = key(b); const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)); return dir === 'asc' ? c : -c; });
  rows.forEach((r) => table.tBodies[0].appendChild(r));
}

// live Gantt for days other than the stored one: re-simulate the hidden-day log is not
// available in the browser, so other days show the stored daily shares only.
function render() {
  const r = route();
  $('#tabs').innerHTML = [['overview', 'Overview'], ['bottleneck', 'Bottleneck'], ['plan', 'Uplift plan'], ['twin', 'Twin check']].map(([t, l]) => `<a role="tab" href="${href({ tab: t })}" aria-selected="${r.tab === t}">${l}</a>`).join('');
  left(r);
  let body;
  try {
    body = r.tab === 'bottleneck' ? bottleneck(r) : r.tab === 'plan' ? plan(r) : r.tab === 'twin' ? twin(r) : overview(r);
  } catch (e) { console.error(e); body = `<div class="callout warn">${ic('error')}<b>Could not render this view.</b> ${esc(e.message)}</div>`; }
  $('#main').innerHTML = `<div class="body">${body}<div class="foot">Unofficial concept demo by Mohith Gajjela. Not affiliated with Onodrim. Synthetic data: a simulated 6-station machining line; MES log, breakdowns and costs are generated from seeded assumptions. <a href="https://github.com/Mohith26/onodrim-throughput-uplift">Source</a></div></div>`;
  objectView(r);
  document.title = `Line Throughput Uplift · ${r.tab[0].toUpperCase() + r.tab.slice(1)} · Workshop`;
}

document.addEventListener('click', (e) => {
  const th = e.target.closest('table.sortable th[data-s]'); if (th) { sortTable(th); return; }
  const b = e.target.closest('[data-act]'); if (b && !b.disabled) { onAct(b); return; }
  const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('a')) { location.hash = tr.dataset.href; return; }
  if (e.target.closest('#ov-close')) { e.preventDefault(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches?.('th[data-s]')) sortTable(e.target); });
document.addEventListener('change', (e) => { if (e.target.id === 'day') location.hash = href({ day: +e.target.value }); });
window.addEventListener('hashchange', render);

async function boot() {
  shell();
  $('#main').innerHTML = `<div class="body"><div class="skel" style="height:96px;margin-bottom:16px"></div><div class="skel" style="height:320px"></div></div>`;
  try {
    const [m, r] = await Promise.all([fetch('data/mes.json').then((x) => x.json()), fetch('data/results.json').then((x) => x.json())]);
    app.mes = m; app.res = r; app.store = loadStore();
    derive();
    if (app.store.budget !== r.plan.budget) {
      const p = L.greedyPlan(app.twin, m.actions, app.store.budget, { reps: r.reps, seed0: 7000 });
      app.live.plan = { ids: p.plan, steps: p.steps, spent: p.spent, uplift: p.total.mean, lo: p.total.lo, hi: p.total.hi, pct: p.total.mean / p.baseMean, budget: app.store.budget };
    }
    $('#asof').textContent = 'MES data as of Fri, 6 Nov 2026 22:00';
    render();
  } catch (e) {
    console.error(e);
    $('#main').innerHTML = `<div class="body"><div class="callout warn">${ic('error')}<b>Could not load MES data.</b> ${esc(e.message)}. Serve this folder over HTTP.</div></div>`;
  }
}
boot();
