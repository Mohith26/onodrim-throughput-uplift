// Line throughput uplift: digital twin of an unreliable serial production line,
// calibrated from MES state logs, with statistically guaranteed selection of the
// improvement that adds the most output (Kim-Nelson ranking & selection with
// common random numbers) and active-period bottleneck detection (Roser et al.).
// Dependency-free ES module: runs in the browser and in Node tests.

// ---------- RNG ----------
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.normal = () => { let u = 0, v = 0; while (!u) u = next(); while (!v) v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  next.exp = (mean) => -mean * Math.log(1 - next());
  next.int = (n) => Math.floor(next() * n);
  return next;
}

// ---------- line model ----------
// station: { id, name, cycle (min, mean), cv (cycle CV), mtbf (min of busy time), mttr (min), scrap }
// buffers[i] = capacity between station i and i+1 (length = stations - 1)
export function cloneLine(line) { return JSON.parse(JSON.stringify(line)); }

// lognormal cycle with given mean & CV
function cycleSampler(st, r) {
  const s2 = Math.log(1 + st.cv * st.cv), mu = Math.log(st.cycle) - s2 / 2, s = Math.sqrt(s2);
  return () => Math.exp(mu + s * r.normal());
}

// Exact tandem-line recursion with blocking-after-service and operation-dependent
// failures. Each station gets its own RNG stream (common random numbers across
// scenarios: changing station k does not perturb the randomness of station j).
export function simulate(line, { horizon = 4800, warmup = 480, seed = 1, log = false } = {}) {
  const st = line.stations, K = st.length, B = line.buffers;
  const streams = st.map((_, i) => rng(seed * 7919 + i * 104729 + 13));      // failures + repairs
  const cyc = st.map((_, i) => rng(seed * 6007 + i * 130363 + 29));          // cycle times
  const samp = st.map((s, i) => cycleSampler(s, cyc[i]));
  const nextFail = st.map((s, i) => streams[i].exp(s.mtbf));     // busy time until next failure
  const busy = new Float64Array(K);
  const scrapR = rng(seed * 31 + 5);
  const S = [], D = [];   // S[n][i], D[n][i]
  const intervals = log ? st.map(() => []) : null; // [start,end,state] state: R running, D down, B blocked
  let good = 0, out = 0, scrapped = 0;
  const T = warmup + horizon;
  for (let n = 0; ; n++) {
    const Sn = new Float64Array(K), Dn = new Float64Array(K);
    for (let i = 0; i < K; i++) {
      const arrive = i === 0 ? 0 : Dn[i - 1];
      const free = n === 0 ? 0 : D[n - 1][i];
      const start = Math.max(arrive, free);
      // processing with failures that strike during busy time
      let p = samp[i]();
      let t = start, remaining = p;
      while (busy[i] + remaining >= nextFail[i]) {
        const run = nextFail[i] - busy[i];
        if (log && run > 0) intervals[i].push([t, t + run, 'R', n]);
        t += run; busy[i] += run; remaining -= run;
        const rep = streams[i].exp(st[i].mttr);
        if (log) intervals[i].push([t, t + rep, 'D', n]);
        t += rep;
        nextFail[i] = busy[i] + streams[i].exp(st[i].mtbf);
      }
      if (log && remaining > 0) intervals[i].push([t, t + remaining, 'R', n]);
      t += remaining; busy[i] += remaining;
      const finish = t;
      let dep = finish;
      if (i < K - 1) { const m = n - B[i] - 1; if (m >= 0) dep = Math.max(finish, S[m][i + 1]); }
      if (log && dep > finish) intervals[i].push([finish, dep, 'B', n]);
      Sn[i] = start; Dn[i] = dep;
    }
    S.push(Sn); D.push(Dn);
    const done = Dn[K - 1];
    const isScrap = scrapR() < (line.scrap ?? 0);
    if (done > T) break;
    if (done >= warmup) { out++; if (isScrap) scrapped++; else good++; }
    if (n > 200000) break;
  }
  const res = { good, out, scrapped, perWeek: good * (4800 / horizon), horizon, warmup };
  if (log) { res.intervals = intervals; res.S = S; res.D = D; }
  return res;
}

// ---------- MES log analytics ----------
// Per-station state time over [t0, t1]: running, down, blocked, starved (idle waiting for upstream).
export function stateTotals(intervals, t0, t1) {
  return intervals.map((iv) => {
    const tot = { R: 0, D: 0, B: 0 };
    for (const [a, b, s] of iv) { const x = Math.max(a, t0), y = Math.min(b, t1); if (y > x) tot[s] += y - x; }
    const span = t1 - t0;
    return { run: tot.R, down: tot.D, blocked: tot.B, starved: Math.max(0, span - tot.R - tot.D - tot.B), span };
  });
}

// OEE per station = availability x performance x quality, the way a plant computes it:
// availability = (planned - down) / planned; performance = ideal_cycle * count / run time... we use
// run share of planned time for "performance x utilization" as MES dashboards do (starved/blocked count as loss).
export function oee(totals, line, counts) {
  return totals.map((t, i) => {
    const s = line.stations[i];
    const A = (t.span - t.down) / t.span;
    const P = Math.min(1, (s.ideal * counts[i]) / Math.max(1e-9, t.span - t.down));
    const Q = i >= line.qualityAt ? 1 - (line.scrap ?? 0) : 1;
    return { A, P, Q, oee: A * P * Q };
  });
}

// Maximum-likelihood calibration from the failure log and cycle records:
// exponential MTBF over busy time, mean repair, lognormal cycle (mean, CV).
export function calibrate(stations) {
  return stations.map((s) => {
    const nf = s.failures.length;
    const mtbf = nf ? s.busyMin / nf : Infinity;
    const mttr = nf ? s.failures.reduce((a, f) => a + f.dur, 0) / nf : 0;
    const mean = s.cycleSum / s.cycleN;
    const v = Math.max(0, s.cycleSq / s.cycleN - mean * mean);
    // 95% CI for MTBF (chi-square approx via Wilson-Hilferty)
    const ci = nf ? [s.busyMin / chi2Quant(0.975, 2 * nf) * 2, s.busyMin / chi2Quant(0.025, 2 * nf) * 2] : [Infinity, Infinity];
    return { id: s.id, cycle: mean, cv: Math.sqrt(v) / mean, mtbf, mttr, failures: nf, mtbfCI: ci };
  });
}

export function chi2Quant(p, k) {
  const z = normQuant(p);
  const h = 2 / (9 * k);
  return k * Math.pow(1 - h + z * Math.sqrt(h), 3);
}

export function normQuant(p) {
  // Acklam's rational approximation
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Active period method (Roser, Nakano & Tanaka 2001): a station is "active" while
// running or down (not starved or blocked). At any moment the station with the
// longest ongoing active period is the bottleneck; overlaps between the current and
// next bottleneck's active periods are "shifting" time. Returns sole/shifting shares.
export function activePeriods(intervals) {
  return intervals.map((iv) => {
    const act = iv.filter(([, , s]) => s === 'R' || s === 'D').map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const [a, b] of act) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b); else merged.push([a, b]);
    }
    return merged;
  });
}

export function bottleneckShares(intervals, t0, t1, step = 1) {
  const ap = activePeriods(intervals);
  const K = ap.length, sole = new Float64Array(K), shift = new Float64Array(K);
  const ptr = new Int32Array(K);
  const timeline = [];
  for (let t = t0; t < t1; t += step) {
    // current active period per station containing t
    let best = -1, bestLen = -1, second = -1, secondLen = -1;
    for (let k = 0; k < K; k++) {
      const p = ap[k];
      while (ptr[k] < p.length && p[ptr[k]][1] < t) ptr[k]++;
      const cur = p[ptr[k]];
      if (cur && cur[0] <= t && t <= cur[1]) {
        const len = cur[1] - cur[0];
        if (len > bestLen) { second = best; secondLen = bestLen; best = k; bestLen = len; }
        else if (len > secondLen) { second = k; secondLen = len; }
      }
    }
    if (best < 0) { timeline.push(-1); continue; }
    // shifting if the runner-up's active period overlaps the leader's start or end
    const bp = ap[best][ptr[best]];
    const sp = second >= 0 ? ap[second][ptr[second]] : null;
    const shifting = sp && (sp[0] <= bp[0] || sp[1] >= bp[1]) && secondLen > 0.8 * bestLen;
    if (shifting) { shift[best] += step / 2; shift[second] += step / 2; } else sole[best] += step;
    timeline.push(best);
  }
  const span = t1 - t0;
  return { sole: [...sole].map((x) => x / span), shifting: [...shift].map((x) => x / span), timeline };
}

// ---------- improvement actions ----------
export function applyActions(line, actions) {
  const L = cloneLine(line);
  for (const a of actions) {
    const s = a.station != null ? L.stations.find((x) => x.id === a.station) : null;
    if (a.kind === 'mttr') s.mttr *= (1 - a.pct);
    else if (a.kind === 'mtbf') s.mtbf *= (1 + a.pct);
    else if (a.kind === 'cycle') { s.cycle *= (1 - a.pct); s.ideal *= (1 - a.pct); }
    else if (a.kind === 'buffer') L.buffers[a.buffer] += a.slots;
    else if (a.kind === 'scrap') L.scrap *= (1 - a.pct);
  }
  return L;
}

// paired replications under common random numbers
export function replicate(line, reps, { seed0 = 1000, horizon = 4800, warmup = 480 } = {}) {
  const out = [];
  for (let r = 0; r < reps; r++) out.push(simulate(line, { horizon, warmup, seed: seed0 + r }).good);
  return out;
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const varS = (a) => { const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); };

// Kim & Nelson (2001) fully sequential procedure "KN" for selecting the system with
// the largest mean. Guarantees P(correct selection) >= 1 - alpha whenever the best
// is at least delta better than the rest (indifference zone), with normal outputs.
export function knSelect(systems, { alpha = 0.05, delta = 8, n0 = 10, maxReps = 200, sampleFn }) {
  const k = systems.length;
  const X = systems.map(() => []);
  for (let r = 0; r < n0; r++) { const row = sampleFn(r); row.forEach((v, i) => X[i].push(v)); }
  const eta = 0.5 * (Math.pow((2 * alpha) / (k - 1), -2 / (n0 - 1)) - 1);
  const h2 = 2 * eta * (n0 - 1);
  const S2 = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, l) => (i === l ? 0 : varS(X[i].map((x, j) => x - X[l][j])))));
  let alive = systems.map((_, i) => i);
  const elimAt = Array(k).fill(null);
  let r = n0;
  while (alive.length > 1 && r < maxReps) {
    const m = X.map((x) => mean(x));
    const next = alive.filter((i) => alive.every((l) => {
      if (l === i) return true;
      const W = Math.max(0, (delta / (2 * r)) * ((h2 * S2[i][l]) / (delta * delta) - r));
      return m[i] >= m[l] - W;
    }));
    alive.filter((i) => !next.includes(i)).forEach((i) => { elimAt[i] = r; });
    alive = next;
    if (alive.length <= 1) break;
    const row = sampleFn(r); row.forEach((v, i) => X[i].push(v)); r++;
  }
  const means = X.map((x) => mean(x));
  const best = alive.length === 1 ? alive[0] : alive.reduce((b, i) => (means[i] > means[b] ? i : b), alive[0]);
  return { best, alive, elimAt, reps: X.map((x) => x.length), means, totalReps: X.reduce((a, x) => a + x.length, 0), h2, eta };
}

// Paired-difference confidence interval vs baseline (CRN).
export function upliftCI(base, alt, conf = 0.95) {
  const d = alt.map((x, i) => x - base[i]);
  const m = mean(d), s = Math.sqrt(varS(d) / d.length);
  const z = normQuant(1 - (1 - conf) / 2);
  return { mean: m, lo: m - z * s, hi: m + z * s, n: d.length };
}

// Evaluate a candidate set of actions on top of a base plan with CRN replications.
export function evaluate(line, plan, candidates, { reps = 40, seed0 = 5000 } = {}) {
  const base = replicate(applyActions(line, plan), reps, { seed0 });
  return candidates.map((a) => {
    const alt = replicate(applyActions(line, [...plan, a]), reps, { seed0 });
    return { action: a, ...upliftCI(base, alt), baseMean: mean(base) };
  });
}

// Budgeted plan: repeatedly add the action with the best uplift per euro (re-simulated
// on top of what is already chosen, so interactions and bottleneck shifts are captured).
export function greedyPlan(line, actions, budget, { reps = 40, seed0 = 7000 } = {}) {
  const plan = []; let spent = 0; const steps = [];
  for (let guard = 0; guard < actions.length; guard++) {
    const left = actions.filter((a) => !plan.includes(a) && spent + a.cost <= budget);
    if (!left.length) break;
    const ev = evaluate(line, plan, left, { reps, seed0 });
    const scored = ev.filter((e) => e.lo > 0).map((e) => ({ ...e, perK: e.mean / (e.action.cost / 10000) }));
    if (!scored.length) break;
    scored.sort((a, b) => b.perK - a.perK);
    plan.push(scored[0].action); spent += scored[0].action.cost;
    steps.push({ action: scored[0].action.id, uplift: scored[0].mean, lo: scored[0].lo, hi: scored[0].hi, spent });
  }
  const base = replicate(line, reps, { seed0: seed0 + 1 });
  const fin = replicate(applyActions(line, plan), reps, { seed0: seed0 + 1 });
  return { plan: plan.map((a) => a.id), steps, spent, total: upliftCI(base, fin), baseMean: mean(base) };
}

export function toCSV(rows) {
  return rows.map((r) => r.map((x) => (typeof x === 'string' && /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(',')).join('\n');
}

// ---------- input uncertainty (parameter uncertainty from a short log) ----------
// Gamma(shape k) sampler (Marsaglia-Tsang)
export function gammaSample(k, r) {
  if (k < 1) return gammaSample(k + 1, r) * Math.pow(r(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = r.normal(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// One plausible twin: failure rate ~ Gamma(n_fail, busy) posterior (Jeffreys-ish, n>=1),
// repair mean by bootstrap of observed repairs, cycle mean ~ Normal(mean, sd/sqrt(n)).
export function plausibleTwin(twin, stations, r) {
  const T = cloneLine(twin);
  T.stations.forEach((s, i) => {
    const d = stations[i]; const nf = d.failures.length;
    const rate = gammaSample(Math.max(nf, 1) + 0.5, r) / d.busyMin;
    s.mtbf = 1 / rate;
    if (nf) { let sum = 0; for (let j = 0; j < nf; j++) sum += d.failures[r.int(nf)].dur; s.mttr = sum / nf; }
    const se = (s.cv * s.cycle) / Math.sqrt(d.cycleN);
    s.cycle = s.cycle + se * r.normal();
  });
  return T;
}

// Robustness of a decision under parameter uncertainty: for B plausible twins, the plan's
// uplift (CRN, `reps` weeks each) and which single action ranks first.
export function robustness(twin, stations, actions, planIds, { B = 40, reps = 8, seed = 99 } = {}) {
  const r = rng(seed);
  const uplifts = [], bestCount = Object.fromEntries(actions.map((a) => [a.id, 0]));
  const planActs = actions.filter((a) => planIds.includes(a.id));
  for (let b = 0; b < B; b++) {
    const T = plausibleTwin(twin, stations, r);
    const base = replicate(T, reps, { seed0: 40000 + b * 100 });
    const withPlan = replicate(applyActions(T, planActs), reps, { seed0: 40000 + b * 100 });
    uplifts.push(mean(withPlan) - mean(base));
    let best = null, bestV = -Infinity;
    for (const a of actions) { const v = mean(replicate(applyActions(T, [a]), reps, { seed0: 40000 + b * 100 })) - mean(base); if (v > bestV) { bestV = v; best = a.id; } }
    bestCount[best]++;
  }
  const s = [...uplifts].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  return { B, reps, uplift: { mean: mean(uplifts), p05: q(0.05), p95: q(0.95) }, bestShare: Object.fromEntries(Object.entries(bestCount).map(([k, v]) => [k, v / B])), uplifts };
}
