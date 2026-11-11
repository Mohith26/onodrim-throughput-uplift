// Scenario definition for the synthetic plant (used by scripts/generate.mjs and the tests).
// Hidden "true" line (what the plant actually is). The app never sees these numbers;
// it only sees the MES log generated from them and calibrates its own twin.
export const TRUE_LINE = {
  name: 'Line 2 · Aluminium housings', scrap: 0.03, qualityAt: 4, buffers: [20, 6, 3, 10, 10],
  stations: [
    { id: 'OP10', name: 'Saw & prep', cycle: 3.0, ideal: 2.6, cv: 0.10, mtbf: 1500, mttr: 20 },
    { id: 'OP20', name: '5-axis rough', cycle: 6.2, ideal: 5.8, cv: 0.08, mtbf: 620, mttr: 40 },
    { id: 'OP30', name: '5-axis finish', cycle: 6.6, ideal: 6.2, cv: 0.08, mtbf: 380, mttr: 70 },
    { id: 'OP40', name: 'Deburr & wash', cycle: 5.4, ideal: 4.0, cv: 0.30, mtbf: 900, mttr: 15 },
    { id: 'OP50', name: 'CMM inspect', cycle: 5.0, ideal: 4.6, cv: 0.12, mtbf: 1200, mttr: 30 },
    { id: 'OP60', name: 'Mark & pack', cycle: 3.2, ideal: 2.8, cv: 0.15, mtbf: 2000, mttr: 15 },
  ],
};
export const ACTIONS = [
  { id: 'A1', title: 'OP30 spindle spares kit + repair SOP', kind: 'mttr', station: 'OP30', pct: 0.4, cost: 38000, detail: 'MTTR -40%' },
  { id: 'A2', title: 'OP30 preventive maintenance plan', kind: 'mtbf', station: 'OP30', pct: 0.5, cost: 24000, detail: 'MTBF +50%' },
  { id: 'A3', title: 'Buffer OP30→OP40: +8 slots', kind: 'buffer', buffer: 2, slots: 8, cost: 9000, detail: '3 → 11 parts' },
  { id: 'A4', title: 'Buffer OP20→OP30: +6 slots', kind: 'buffer', buffer: 1, slots: 6, cost: 8000, detail: '6 → 12 parts' },
  { id: 'A5', title: 'OP40 robotic deburr cell', kind: 'cycle', station: 'OP40', pct: 0.25, cost: 120000, detail: 'cycle -25%' },
  { id: 'A6', title: 'OP20 repair SOP + spares', kind: 'mttr', station: 'OP20', pct: 0.4, cost: 30000, detail: 'MTTR -40%' },
  { id: 'A7', title: 'OP30 CAM toolpath + tooling', kind: 'cycle', station: 'OP30', pct: 0.08, cost: 15000, detail: 'cycle -8%' },
  { id: 'A8', title: 'In-process probing at OP30', kind: 'scrap', pct: 0.5, cost: 45000, detail: 'scrap -50%' },
  { id: 'A9', title: 'OP10 second saw blade change cart', kind: 'cycle', station: 'OP10', pct: 0.15, cost: 6000, detail: 'cycle -15%' },
];

