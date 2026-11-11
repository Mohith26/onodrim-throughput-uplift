import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../src/line.js';
import { TRUE_LINE, ACTIONS } from '../src/config.js';

const mes = JSON.parse(readFileSync(new URL('../data/mes.json', import.meta.url)));
const res = JSON.parse(readFileSync(new URL('../data/results.json', import.meta.url)));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

const simple = (k, cyc, buf = 1000) => ({ scrap: 0, qualityAt: k, buffers: Array(k - 1).fill(buf), stations: cyc.map((c, i) => ({ id: `S${i}`, name: '', cycle: c, ideal: c, cv: 1e-6, mtbf: 1e12, mttr: 0 })) });

test('deterministic line with no failures runs at the slowest station rate', () => {
  const line = simple(3, [2, 5, 3]);
  const r = L.simulate(line, { horizon: 5000, warmup: 500, seed: 1 });
  assert.ok(Math.abs(r.out - 1000) <= 2, `out=${r.out}`);
});

test('state accounting: running + down + blocked + starved = planned time for every station', () => {
  const s = L.simulate(TRUE_LINE, { horizon: 4800, warmup: 480, seed: 9, log: true });
  for (const t of L.stateTotals(s.intervals, 480, 5280)) {
    assert.ok(t.starved >= -1e-6);
    assert.ok(Math.abs(t.run + t.down + t.blocked + t.starved - t.span) < 1e-6);
  }
});

test('flow conservation: no station finishes more parts than its upstream, buffers never overflow (randomized)', () => {
  const r = L.rng(4);
  for (let k = 0; k < 20; k++) {
    const line = L.cloneLine(TRUE_LINE);
    line.buffers = line.buffers.map(() => 1 + r.int(8));
    const s = L.simulate(line, { horizon: 2000, warmup: 0, seed: 100 + k, log: true });
    for (let n = 0; n < s.D.length; n++) for (let i = 1; i < 6; i++) assert.ok(s.S[n][i] >= s.D[n][i - 1] - 1e-9);
    // part n leaves station i only after part n-B-1 entered station i+1
    for (let n = 0; n < s.D.length; n++) for (let i = 0; i < 5; i++) { const m = n - line.buffers[i] - 1; if (m >= 0) assert.ok(s.D[n][i] >= s.S[m][i + 1] - 1e-9); }
  }
});

test('MLE calibration recovers MTBF/MTTR/cycle from a long synthetic log (randomized)', () => {
  const s = L.simulate(TRUE_LINE, { horizon: 4800 * 30, warmup: 480, seed: 77, log: true });
  const stations = TRUE_LINE.stations.map((st, i) => {
    let busy = 0; const failures = []; const per = new Map();
    for (const [a, b, k, n] of s.intervals[i]) { if (k === 'R') { busy += b - a; per.set(n, (per.get(n) || 0) + b - a); } if (k === 'D') failures.push({ dur: b - a }); }
    let sum = 0, sq = 0; for (const v of per.values()) { sum += v; sq += v * v; }
    return { id: st.id, failures, busyMin: busy, cycleSum: sum, cycleSq: sq, cycleN: per.size };
  });
  const cal = L.calibrate(stations);
  cal.forEach((c, i) => {
    const t = TRUE_LINE.stations[i];
    assert.ok(Math.abs(c.cycle / t.cycle - 1) < 0.02, `${c.id} cycle`);
    if (c.failures > 60) { assert.ok(Math.abs(c.mtbf / t.mtbf - 1) < 0.25, `${c.id} mtbf ${c.mtbf}`); assert.ok(Math.abs(c.mttr / t.mttr - 1) < 0.25, `${c.id} mttr`); }
  });
});

test('active-period method finds a planted bottleneck', () => {
  const line = simple(4, [3, 3, 6, 3], 5);
  line.stations.forEach((s) => { s.cv = 0.1; });
  const s = L.simulate(line, { horizon: 3000, warmup: 300, seed: 3, log: true });
  const b = L.bottleneckShares(s.intervals, 300, 3300, 1);
  assert.equal(b.sole.indexOf(Math.max(...b.sole)), 2);
  assert.ok(b.sole[2] > 0.8);
});

test('the MES export identifies OP30 as the constraint while OP10 has the lowest OEE', () => {
  const worst = mes.oee.reduce((b, o) => (o.oee < b.oee ? o : b));
  assert.equal(worst.id, 'OP10');
  assert.equal(res.constraint.id, 'OP30');
  assert.ok(res.constraint.sole > 0.8);
});

test('common random numbers: an action that changes nothing has exactly zero uplift', () => {
  const ev = L.evaluate(TRUE_LINE, [], [{ id: 'X', kind: 'buffer', buffer: 0, slots: 0, cost: 1 }], { reps: 10 });
  assert.equal(ev[0].mean, 0);
  assert.equal(ev[0].lo, 0);
});

test('speeding up the true bottleneck beats speeding up a station with spare capacity', () => {
  const ev = L.evaluate(TRUE_LINE, [], [ACTIONS.find((a) => a.id === 'A7'), ACTIONS.find((a) => a.id === 'A9')], { reps: 20 });
  assert.ok(ev[0].lo > 20);
  assert.ok(ev[1].hi < 3);
});

test('KN selection: P(correct selection) >= 1 - alpha under the indifference-zone configuration (randomized)', () => {
  const r = L.rng(21);
  let correct = 0; const trials = 150;
  for (let t = 0; t < trials; t++) {
    const mus = [10, 10, 10, 10, 10 + 2]; // best is delta=2 better (least favourable configuration)
    const out = L.knSelect(mus, { alpha: 0.1, delta: 2, n0: 10, maxReps: 2000, sampleFn: () => mus.map((m) => m + 3 * r.normal()) });
    if (out.best === 4) correct++;
  }
  assert.ok(correct / trials >= 0.85, `PCS ${correct / trials}`);
});

test('normal and chi-square quantiles match known values', () => {
  assert.ok(Math.abs(L.normQuant(0.975) - 1.959964) < 1e-5);
  assert.ok(Math.abs(L.normQuant(0.05) + 1.644854) < 1e-5);
  assert.ok(Math.abs(L.chi2Quant(0.95, 10) - 18.307) < 0.05);
});

test('budgeted plan respects the budget and every step has a positive lower bound', () => {
  for (const B of [30000, 60000]) {
    const p = L.greedyPlan(TRUE_LINE, ACTIONS, B, { reps: 15 });
    assert.ok(p.spent <= B);
    p.steps.forEach((s) => assert.ok(s.lo > 0));
  }
});

test('headline numbers in data/results.json reproduce exactly from the seeded pipeline', async () => {
  const before = JSON.stringify(res);
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [new URL('../scripts/generate.mjs', import.meta.url).pathname], { stdio: 'ignore' });
  const after = JSON.parse(readFileSync(new URL('../data/results.json', import.meta.url)));
  assert.equal(JSON.stringify(after), before);
  assert.equal(after.plan.uplift, 85.67);
  assert.equal(Math.round(after.plan.pct * 100), 14);
  assert.equal(after.kn.best, 'A7');
  assert.ok(after.actions.find((a) => a.id === 'A9').hi < 1, 'speeding up the lowest-OEE station adds nothing');
});

test('parameter-uncertainty interval is wider than the simulation-only CI and covers the hidden line', () => {
  assert.ok(res.robust.p05 < res.plan.lo && res.robust.p95 > res.plan.hi);
  assert.ok(res.robust.p05 <= res.truthCheck.uplift && res.truthCheck.uplift <= res.robust.p95);
  assert.ok(Math.abs(Object.values(res.robust.bestShare).reduce((a, b) => a + b, 0) - 1) < 1e-3);
});

test('plausible twins are centred on the calibrated MTBF (randomized)', () => {
  const r = L.rng(8);
  const twin = { scrap: mes.scrapObserved, qualityAt: 4, buffers: [...mes.buffers], stations: res.calibrated };
  const k = 2; const draws = [];
  for (let b = 0; b < 400; b++) draws.push(1 / L.plausibleTwin(twin, mes.stations, r).stations[k].mtbf);
  const rate = draws.reduce((a, x) => a + x, 0) / draws.length;
  const expect = (mes.stations[k].failures.length + 0.5) / mes.stations[k].busyMin;
  assert.ok(Math.abs(rate / expect - 1) < 0.05, `${rate} vs ${expect}`);
});

test('CSV export escapes commas and quotes', () => {
  assert.equal(L.toCSV([['a,b', 'say "hi"', 3]]), '"a,b","say ""hi""",3');
});
