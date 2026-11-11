// Seeded MES logs + calibration + uplift results. Run: node scripts/generate.mjs
import { writeFileSync } from 'node:fs';
import * as L from '../src/line.js';

import { TRUE_LINE, ACTIONS } from '../src/config.js';

const WEEK = 4800;              // 2 shifts x 8 h x 5 days, minutes of planned time
const WARM = 480;
const WEEKS = 4;
const log = L.simulate(TRUE_LINE, { horizon: WEEK * WEEKS, warmup: WARM, seed: 2026, log: true });
const T0 = WARM, T1 = WARM + WEEK * WEEKS;
const K = TRUE_LINE.stations.length;

// --- MES export the app works from ---
const stations = TRUE_LINE.stations.map((s, i) => {
  const iv = log.intervals[i];
  const failures = []; let busy = 0, lastBusy = 0, cycleSum = 0, cycleSq = 0, cycleN = 0;
  const perPart = new Map();
  for (const [a, b, st, n] of iv) {
    if (st === 'R') { busy += b - a; perPart.set(n, (perPart.get(n) || 0) + (b - a)); }
    if (st === 'D') { failures.push({ t: +a.toFixed(1), dur: +(b - a).toFixed(1), busySince: +(busy - lastBusy).toFixed(1), part: n }); lastBusy = busy; }
  }
  for (const v of perPart.values()) { cycleSum += v; cycleSq += v * v; cycleN++; }
  return { id: s.id, name: s.name, ideal: s.ideal, failures, busyMin: +busy.toFixed(1), cycleSum: +cycleSum.toFixed(2), cycleSq: +cycleSq.toFixed(2), cycleN };
});
const totals = L.stateTotals(log.intervals, T0, T1);
const counts = totals.map(() => log.out);
const oee = L.oee(totals, TRUE_LINE, counts);
// hourly state shares (for charts): 80 planned hours/week
const hours = [];
for (let h = 0; h < (T1 - T0) / 60; h++) hours.push(L.stateTotals(log.intervals, T0 + h * 60, T0 + (h + 1) * 60).map((t) => [t.run, t.down, t.blocked, t.starved].map((x) => +x.toFixed(1))));
// daily good output and bottleneck shares (16 h days)
const days = [];
for (let d = 0; d < WEEKS * 5; d++) {
  const a = T0 + d * 960, b = a + 960;
  const done = log.D.filter((Dn) => Dn[K - 1] >= a && Dn[K - 1] < b).length;
  const bs = L.bottleneckShares(log.intervals, a, b, 1);
  days.push({ day: d, out: done, good: Math.round(done * (1 - TRUE_LINE.scrap)), sole: bs.sole.map((x) => +x.toFixed(4)), shifting: bs.shifting.map((x) => +x.toFixed(4)) });
}
const all = L.bottleneckShares(log.intervals, T0, T1, 1);
// Gantt data for every day at 2-minute resolution (dominant state per slot), plus the
// active-period bottleneck per slot; run-length friendly strings keep the export small.
const SLOT = 2;
const ganttDays = [];
for (let d = 0; d < WEEKS * 5; d++) {
  const a = T0 + d * 960, b = a + 960, n = 960 / SLOT;
  const states = log.intervals.map((iv) => {
    const acc = Array.from({ length: n }, () => ({ R: 0, D: 0, B: 0 }));
    for (const [x, y, st] of iv) {
      if (y <= a || x >= b) continue;
      for (let k = Math.max(0, Math.floor((x - a) / SLOT)); k < Math.min(n, Math.ceil((y - a) / SLOT)); k++) {
        const s0 = a + k * SLOT, ov = Math.min(y, s0 + SLOT) - Math.max(x, s0); if (ov > 0) acc[k][st] += ov;
      }
    }
    return acc.map((c) => { const idle = SLOT - c.R - c.D - c.B; const m = Math.max(c.R, c.D, c.B, idle); return m === c.R ? 'R' : m === c.D ? 'D' : m === c.B ? 'B' : 'S'; }).join('');
  });
  const bn = L.bottleneckShares(log.intervals, a, b, SLOT).timeline.map((k) => (k < 0 ? '-' : String(k))).join('');
  ganttDays.push({ states, bn });
}
const weekly = Array.from({ length: WEEKS }, (_, w) => days.slice(w * 5, w * 5 + 5).reduce((a, d) => a + d.good, 0));

const mes = {
  site: 'Plant Kessler Feinmechanik (synthetic) · Line 2', product: 'Machined 6061-T6 aluminium electronics enclosures', window: '4 weeks · 2 shifts × 5 days', plannedMinPerWeek: WEEK,
  buffers: TRUE_LINE.buffers, scrapObserved: +(log.scrapped / log.out).toFixed(4), qualityAt: TRUE_LINE.qualityAt,
  stations, oee: oee.map((o, i) => ({ id: TRUE_LINE.stations[i].id, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(4)])), ...Object.fromEntries(Object.entries(totals[i]).map(([k, v]) => [k, +v.toFixed(1)])) })),
  hours, days, weekly, bottleneck: { sole: all.sole.map((x) => +x.toFixed(4)), shifting: all.shifting.map((x) => +x.toFixed(4)) },
  ganttDays, ganttDay: 3, slot: SLOT, actions: ACTIONS,
};
writeFileSync(new URL('../data/mes.json', import.meta.url), JSON.stringify(mes));

// --- calibrated twin (what the app builds) ---
const cal = L.calibrate(stations);
const twin = { name: TRUE_LINE.name, scrap: mes.scrapObserved, qualityAt: TRUE_LINE.qualityAt, buffers: [...TRUE_LINE.buffers], stations: cal.map((c, i) => ({ id: c.id, name: TRUE_LINE.stations[i].name, ideal: TRUE_LINE.stations[i].ideal, cycle: +c.cycle.toFixed(4), cv: +c.cv.toFixed(4), mtbf: +c.mtbf.toFixed(2), mttr: +c.mttr.toFixed(3) })) };
const REPS = 40;
const twinWeeks = L.replicate(twin, REPS, { seed0: 900 });
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const ev = L.evaluate(twin, [], ACTIONS, { reps: REPS, seed0: 5000 });
const kn = L.knSelect(ACTIONS, { alpha: 0.05, delta: 8, n0: 10, maxReps: 200, sampleFn: (r) => { const base = null; void base; return ACTIONS.map((a) => L.simulate(L.applyActions(twin, [a]), { seed: 20000 + r }).good); } });
const plan = L.greedyPlan(twin, ACTIONS, 100000, { reps: REPS, seed0: 7000 });
// hold-out truth check: apply the chosen plan to the hidden true line (fresh seeds)
const trueBase = L.replicate(TRUE_LINE, REPS, { seed0: 30000 });
const truePlan = L.replicate(L.applyActions(TRUE_LINE, ACTIONS.filter((a) => plan.plan.includes(a.id))), REPS, { seed0: 30000 });
const truth = L.upliftCI(trueBase, truePlan);
const worstOEE = mes.oee.reduce((b, o) => (o.oee < b.oee ? o : b));
const results = {
  generated: 'node scripts/generate.mjs (seeded; deterministic)', reps: REPS,
  observedWeekly: weekly, observedWeeklyMean: mean(weekly),
  twinWeeklyMean: +mean(twinWeeks).toFixed(2), twinWeeklySd: +Math.sqrt(twinWeeks.reduce((s, x) => s + (x - mean(twinWeeks)) ** 2, 0) / (REPS - 1)).toFixed(2),
  calibrated: twin.stations,
  actions: ev.map((e) => ({ id: e.action.id, mean: +e.mean.toFixed(2), lo: +e.lo.toFixed(2), hi: +e.hi.toFixed(2), pct: +(e.mean / e.baseMean).toFixed(4) })),
  baseMean: +ev[0].baseMean.toFixed(2),
  kn: { best: ACTIONS[kn.best].id, alive: kn.alive.map((i) => ACTIONS[i].id), elimAt: Object.fromEntries(ACTIONS.map((a, i) => [a.id, kn.elimAt[i]])), totalReps: kn.totalReps, alpha: 0.05, delta: 8 },
  plan: { budget: 100000, ids: plan.plan, steps: plan.steps.map((s) => ({ ...s, uplift: +s.uplift.toFixed(2), lo: +s.lo.toFixed(2), hi: +s.hi.toFixed(2) })), spent: plan.spent, uplift: +plan.total.mean.toFixed(2), lo: +plan.total.lo.toFixed(2), hi: +plan.total.hi.toFixed(2), baseMean: +plan.baseMean.toFixed(2), pct: +(plan.total.mean / plan.baseMean).toFixed(4) },
  truthCheck: { uplift: +truth.mean.toFixed(2), lo: +truth.lo.toFixed(2), hi: +truth.hi.toFixed(2), base: +mean(trueBase).toFixed(2), pct: +(truth.mean / mean(trueBase)).toFixed(4) },
  worstOEE: { id: worstOEE.id, oee: worstOEE.oee },
  constraint: { id: TRUE_LINE.stations[all.sole.indexOf(Math.max(...all.sole))].id, sole: Math.max(...all.sole) },
};
writeFileSync(new URL('../data/results.json', import.meta.url), JSON.stringify(results, null, 1));
console.log(JSON.stringify({ observed: weekly, twin: results.twinWeeklyMean, kn: results.kn, plan: results.plan, truth: results.truthCheck, worst: results.worstOEE, constraint: results.constraint, actions: results.actions }, null, 1));
