const assert = require("assert");
const engine = require("./engine.js");

const rows = engine.demoRows();
const first = engine.analyze(rows, { trees: 100, sampleSize: 64, seed: 2026 });
const second = engine.analyze(rows, { trees: 100, sampleSize: 64, seed: 2026 });

assert.strictEqual(rows.length, 336, "El conjunto de demostración debe contener 336 lecturas.");
assert.strictEqual(first.quality.level, "alta", "La cobertura de demostración debe clasificarse como alta.");
assert.ok(first.anomalies.length >= 2, "Las dos desviaciones inyectadas deben ser detectables.");
assert.deepStrictEqual(
  first.anomalies.map((item) => item.score),
  second.anomalies.map((item) => item.score),
  "La semilla debe hacer reproducible el resultado."
);
assert.ok(first.anomalies.every((item) => item.explanation.includes("mediana")), "Cada alerta debe tener explicación contextual.");
const flaggedTimes = first.anomalies.map((item) => item.timestamp.getTime()).sort((a, b) => a - b);
assert.deepStrictEqual(
  flaggedTimes,
  [rows[118].timestamp.getTime(), rows[239].timestamp.getTime()],
  "Las alertas deben ser exactamente las dos lecturas inyectadas (índices 118 y 239)."
);
assert.strictEqual(first.anomalies.length, 2, "No debe haber falsos positivos en el conjunto de demostración.");

assert.throws(
  () => engine.parseCsv("timestamp,kwh\n2026-08-03T00:00:00,1.2\n2026-08-03T00:00:00,1.4"),
  /repite el timestamp/,
  "Un timestamp duplicado debe rechazarse."
);

const series = [];
const base = new Date("2026-08-03T00:00:00");
for (let i = 0; i < 96; i += 1) {
  series.push({ timestamp: new Date(base.getTime() + i * 3600000), kwh: i < 48 ? 2 : 1, tariff: 100 });
}
const cut = new Date(base.getTime() + 48 * 3600000);
const cmp = engine.compareBeforeAfter(series, cut);
assert.strictEqual(cmp.sufficient, true);
assert.strictEqual(cmp.before.kwhPerDay, 48);
assert.strictEqual(cmp.after.kwhPerDay, 24);
assert.strictEqual(cmp.deltaPct, -50);
assert.strictEqual(cmp.deltaCostPerDay, -2400);
const shortCmp = engine.compareBeforeAfter(series, new Date(base.getTime() + 90 * 3600000));
assert.strictEqual(shortCmp.sufficient, false, "Con menos de 24 lecturas posteriores la comparación no es suficiente.");
assert.ok(shortCmp.warning.includes("menos de 24"));
assert.throws(() => engine.compareBeforeAfter(series, "no-es-fecha"), /fecha/);

const daily = engine.toDaily(engine.demoDailyRows());
assert.strictEqual(daily.length, 56);
const dailyAnalysis = engine.analyzeDaily(daily, { trees: 100, sampleSize: 64, seed: 2026, closedCapKwh: 370 });
assert.strictEqual(dailyAnalysis.anomalies.length, 1, "Solo el viernes 9 de octubre debe marcarse.");
const friday = dailyAnalysis.anomalies[0];
assert.strictEqual(friday.timestamp.getTime(), new Date(2026, 9, 9).getTime());
assert.strictEqual(friday.kwh, 570);
assert.strictEqual(friday.baseline, 500);
assert.strictEqual(friday.equivalent, 6);
assert.strictEqual(friday.cost, 7315);
assert.strictEqual(friday.priority, "alta");
assert.strictEqual(friday.evidence, "media-alta");
assert.ok(Math.abs(friday.deviationPct - 14) < 1e-9);
const sunday = dailyAnalysis.results.find((item) => item.timestamp.getTime() === new Date(2026, 9, 11).getTime());
assert.strictEqual(sunday.kwh, 360);
assert.strictEqual(sunday.closedWithinBase, true);
const impact = engine.measureImpact(daily, new Date(2026, 9, 9), new Date(2026, 9, 16), 10000);
assert.strictEqual(impact.afterKwh, 527.25);
assert.ok(Math.abs(impact.deltaPct + 7.5) < 1e-9);
assert.strictEqual(impact.weeklySaving, 4467);
assert.strictEqual(impact.monthlySaving, 17868);
assert.strictEqual(impact.netMonthly, 7868);
assert.strictEqual(engine.measureImpact(daily, new Date(2026, 9, 9), new Date(2027, 0, 1)), null);

console.log(`OK: ${first.summary.readings} lecturas, ${first.summary.anomalies} alertas, calidad ${first.quality.level}.`);
