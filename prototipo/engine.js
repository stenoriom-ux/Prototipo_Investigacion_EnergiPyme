(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.EnergiPymeEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function quantile(values, q) {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const position = (sorted.length - 1) * q;
    const base = Math.floor(position);
    const rest = position - base;
    return sorted[base + 1] === undefined
      ? sorted[base]
      : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }

  function seededRandom(seed) {
    let state = seed >>> 0;
    return function () {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error("El archivo debe contener encabezado y al menos una fila.");
    const headers = lines[0].split(",").map((item) => item.trim().toLowerCase());
    const timeIndex = headers.indexOf("timestamp");
    const kwhIndex = headers.indexOf("kwh");
    const tariffIndex = headers.indexOf("tariff_crc_per_kwh");
    if (timeIndex < 0 || kwhIndex < 0) throw new Error("Se requieren las columnas timestamp y kwh.");

    const rows = lines.slice(1).map((line, index) => {
      const cells = line.split(",").map((item) => item.trim());
      const timestamp = new Date(cells[timeIndex]);
      const kwh = Number(cells[kwhIndex]);
      const tariff = tariffIndex >= 0 ? Number(cells[tariffIndex]) : 0;
      if (Number.isNaN(timestamp.getTime()) || !Number.isFinite(kwh) || kwh < 0) {
        throw new Error(`Fila ${index + 2} inválida. Revise timestamp y kwh.`);
      }
      return { timestamp, kwh, tariff: Number.isFinite(tariff) && tariff >= 0 ? tariff : 0 };
    });
    const seen = new Map();
    rows.forEach((row, index) => {
      const key = row.timestamp.getTime();
      if (seen.has(key)) throw new Error(`Fila ${index + 2} repite el timestamp de la fila ${seen.get(key)}.`);
      seen.set(key, index + 2);
    });
    rows.sort((a, b) => a.timestamp - b.timestamp);
    return rows;
  }

  function pathLengthCorrection(n) {
    if (n <= 1) return 0;
    if (n === 2) return 1;
    const euler = 0.5772156649;
    return 2 * (Math.log(n - 1) + euler) - (2 * (n - 1)) / n;
  }

  function buildTree(points, depth, maxDepth, random) {
    if (depth >= maxDepth || points.length <= 1) return { size: points.length };
    const featureCount = points[0].vector.length;
    const feature = Math.floor(random() * featureCount);
    const values = points.map((point) => point.vector[feature]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return { size: points.length };
    const split = min + random() * (max - min);
    const left = points.filter((point) => point.vector[feature] < split);
    const right = points.filter((point) => point.vector[feature] >= split);
    if (!left.length || !right.length) return { size: points.length };
    return {
      feature,
      split,
      left: buildTree(left, depth + 1, maxDepth, random),
      right: buildTree(right, depth + 1, maxDepth, random),
    };
  }

  function pathLength(point, tree, depth) {
    if (tree.size !== undefined) return depth + pathLengthCorrection(tree.size);
    return point.vector[tree.feature] < tree.split
      ? pathLength(point, tree.left, depth + 1)
      : pathLength(point, tree.right, depth + 1);
  }

  function sampleWithoutReplacement(points, size, random) {
    const copy = [...points];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, size);
  }

  function isolationScores(points, options) {
    const trees = options.trees || 80;
    const sampleSize = Math.min(options.sampleSize || 64, points.length);
    const maxDepth = Math.ceil(Math.log2(Math.max(sampleSize, 2)));
    const random = seededRandom(options.seed || 2026);
    const forest = [];
    for (let i = 0; i < trees; i += 1) {
      forest.push(buildTree(sampleWithoutReplacement(points, sampleSize, random), 0, maxDepth, random));
    }
    const correction = pathLengthCorrection(sampleSize) || 1;
    return points.map((point) => {
      const averagePath = forest.reduce((sum, tree) => sum + pathLength(point, tree, 0), 0) / forest.length;
      return Math.pow(2, -averagePath / correction);
    });
  }

  function dataQuality(rows) {
    if (rows.length < 24) return { level: "insuficiente", message: "Se requieren al menos 24 lecturas." };
    const differences = [];
    for (let index = 1; index < rows.length; index += 1) {
      differences.push((rows[index].timestamp - rows[index - 1].timestamp) / 3600000);
    }
    const expected = median(differences);
    const irregular = differences.filter((value) => Math.abs(value - expected) > Math.max(0.1, expected * 0.1)).length;
    const irregularRate = irregular / Math.max(differences.length, 1);
    if (rows.length >= 168 && irregularRate <= 0.05) return { level: "alta", message: "Cobertura de al menos siete días y frecuencia estable." };
    if (rows.length >= 72 && irregularRate <= 0.15) return { level: "media", message: "Cobertura suficiente para una señal preliminar." };
    return { level: "baja", message: "Pocas lecturas o frecuencia irregular; interprete con cautela." };
  }

  function analyze(rows, options = {}) {
    const quality = dataQuality(rows);
    if (quality.level === "insuficiente") return { quality, results: [], summary: null };
    const kwhValues = rows.map((row) => row.kwh);
    const center = median(kwhValues);
    const iqr = Math.max(quantile(kwhValues, 0.75) - quantile(kwhValues, 0.25), 0.01);
    const points = rows.map((row) => {
      const hour = row.timestamp.getHours();
      const day = row.timestamp.getDay();
      const weekend = day === 0 || day === 6 ? 1 : 0;
      return {
        row,
        vector: [
          (row.kwh - center) / iqr,
          Math.sin((2 * Math.PI * hour) / 24),
          Math.cos((2 * Math.PI * hour) / 24),
          weekend,
        ],
      };
    });
    const scores = isolationScores(points, options);
    const groups = new Map();
    rows.forEach((row) => {
      const day = row.timestamp.getDay();
      const key = `${day === 0 || day === 6 ? "weekend" : "weekday"}-${row.timestamp.getHours()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row.kwh);
    });

    const results = rows.map((row, index) => {
      const day = row.timestamp.getDay();
      const key = `${day === 0 || day === 6 ? "weekend" : "weekday"}-${row.timestamp.getHours()}`;
      const baselineValues = groups.get(key);
      const baseline = baselineValues.length >= 2 ? median(baselineValues) : center;
      const deviationKwh = row.kwh - baseline;
      const deviationPct = baseline > 0 ? (deviationKwh / baseline) * 100 : 0;
      const modelFlag = scores[index] >= (options.scoreThreshold || 0.55);
      const contextFlag = Math.abs(deviationPct) >= (options.deviationThreshold || 25);
      const flagged = modelFlag && contextFlag;
      const cost = deviationKwh > 0 && row.tariff > 0 ? deviationKwh * row.tariff : 0;
      let explanation = "Consumo cercano al patrón comparable.";
      if (flagged && deviationKwh > 0) explanation = `Consumo ${Math.abs(deviationPct).toFixed(0)}% mayor que la mediana para una hora y tipo de día comparables.`;
      if (flagged && deviationKwh < 0) explanation = `Consumo ${Math.abs(deviationPct).toFixed(0)}% menor que la mediana para una hora y tipo de día comparables.`;
      return { ...row, score: scores[index], baseline, deviationKwh, deviationPct, cost, flagged, explanation };
    });

    const flagged = results.filter((item) => item.flagged).sort((a, b) => b.score - a.score);
    return {
      quality,
      results,
      summary: {
        readings: rows.length,
        anomalies: flagged.length,
        totalKwh: rows.reduce((sum, row) => sum + row.kwh, 0),
        estimatedExcessCost: flagged.reduce((sum, item) => sum + item.cost, 0),
      },
      anomalies: flagged,
    };
  }

  function compareBeforeAfter(rows, actionDate, options = {}) {
    const cutoff = actionDate instanceof Date ? actionDate : new Date(actionDate);
    if (Number.isNaN(cutoff.getTime())) throw new Error("La fecha de la acción no es válida.");
    const minReadings = options.minReadings || 24;
    const intervals = [];
    for (let index = 1; index < rows.length; index += 1) {
      intervals.push((rows[index].timestamp - rows[index - 1].timestamp) / 3600000);
    }
    const hoursPerReading = median(intervals) || 1;
    const summarize = (list) => {
      const days = (list.length * hoursPerReading) / 24;
      const totalKwh = list.reduce((sum, row) => sum + row.kwh, 0);
      const totalCost = list.reduce((sum, row) => sum + row.kwh * row.tariff, 0);
      return {
        readings: list.length,
        days,
        kwhPerDay: days > 0 ? totalKwh / days : 0,
        costPerDay: days > 0 ? totalCost / days : 0,
      };
    };
    const before = summarize(rows.filter((row) => row.timestamp < cutoff));
    const after = summarize(rows.filter((row) => row.timestamp >= cutoff));
    const sufficient = before.readings >= minReadings && after.readings >= minReadings;
    const deltaKwhPerDay = after.kwhPerDay - before.kwhPerDay;
    return {
      before,
      after,
      sufficient,
      deltaKwhPerDay,
      deltaPct: before.kwhPerDay > 0 ? (deltaKwhPerDay / before.kwhPerDay) * 100 : null,
      deltaCostPerDay: after.costPerDay - before.costPerDay,
      warning: sufficient ? "" : `Hay menos de ${minReadings} lecturas en uno de los periodos; la comparación no es confiable.`,
      note: "La diferencia describe un cambio observado; no demuestra que la acción lo causó ni corrige por días laborales o de cierre.",
    };
  }

  function toDaily(rows) {
    const days = new Map();
    rows.forEach((row) => {
      const t = row.timestamp;
      const key = `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
      if (!days.has(key)) days.set(key, { timestamp: new Date(t.getFullYear(), t.getMonth(), t.getDate()), kwh: 0, tariff: row.tariff });
      days.get(key).kwh += row.kwh;
    });
    return [...days.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  function analyzeDaily(days, options = {}) {
    if (days.length < 14) return { quality: { level: "insuficiente", message: "Se requieren al menos 14 días." }, results: [], anomalies: [] };
    const closedDays = options.closedDays || [0];
    const values = days.map((day) => day.kwh);
    const center = median(values);
    const iqr = Math.max(quantile(values, 0.75) - quantile(values, 0.25), 0.01);
    const points = days.map((day) => {
      const dow = day.timestamp.getDay();
      return { vector: [(day.kwh - center) / iqr, Math.sin((2 * Math.PI * dow) / 7), Math.cos((2 * Math.PI * dow) / 7), closedDays.includes(dow) ? 1 : 0] };
    });
    const scores = isolationScores(points, options);
    const closedValues = days.filter((day) => closedDays.includes(day.timestamp.getDay())).map((day) => day.kwh);
    const closedCap = options.closedCapKwh || Math.round(median(closedValues) * 1.03);
    const results = days.map((day, index) => {
      const dow = day.timestamp.getDay();
      const closed = closedDays.includes(dow);
      const previous = days.slice(0, index).filter((item) => item.timestamp.getDay() === dow).map((item) => item.kwh);
      const baseline = previous.length >= 3 ? median(previous) : null;
      const deviationKwh = baseline === null ? 0 : day.kwh - baseline;
      const deviationPct = baseline ? (deviationKwh / baseline) * 100 : 0;
      const flagged = scores[index] >= (options.scoreThreshold || 0.55) && baseline !== null && Math.abs(deviationPct) >= (options.deviationThreshold || 10);
      return {
        ...day, closed, baseline, deviationKwh, deviationPct, flagged,
        dayType: closed ? "cierre" : dow === 6 ? "medio" : "laboral",
        score: scores[index],
        equivalent: previous.length,
        evidence: previous.length >= 6 ? "media-alta" : previous.length >= 3 ? "media" : "baja",
        cost: deviationKwh > 0 && day.tariff > 0 ? deviationKwh * day.tariff : 0,
        closedWithinBase: closed ? day.kwh <= closedCap : null,
        priority: flagged ? (deviationKwh > 0 ? "alta" : "media") : null,
      };
    });
    const anomalies = results.filter((item) => item.flagged).sort((a, b) => b.cost - a.cost || b.score - a.score);
    const quality = { level: Math.max(...results.map((item) => item.equivalent)) >= 6 ? "media-alta" : "media", message: "Lectura diaria; sin submedición por equipo." };
    return { quality, results, anomalies, closedCap };
  }

  function measureImpact(days, beforeDate, afterDate, subscriptionCrc = 10000) {
    const find = (date) => days.find((day) => day.timestamp.toDateString() === date.toDateString());
    const before = find(beforeDate);
    const after = find(afterDate);
    if (!before || !after) return null;
    const deltaKwh = after.kwh - before.kwh;
    const weeklySaving = Math.round(-deltaKwh * after.tariff);
    const monthlySaving = weeklySaving * 4;
    return {
      beforeKwh: before.kwh, afterKwh: after.kwh, deltaKwh,
      deltaPct: before.kwh ? (deltaKwh / before.kwh) * 100 : 0,
      beforeCost: Math.round(before.kwh * before.tariff), afterCost: Math.round(after.kwh * after.tariff),
      weeklySaving, monthlySaving, subscriptionCrc,
      netMonthly: monthlySaving - subscriptionCrc,
      returnMultiple: subscriptionCrc ? monthlySaving / subscriptionCrc : null,
    };
  }

  function demoDailyRows() {
    const base = [360, 478, 482, 490, 495, 500, 420];
    const fridays = { "2026-8-28": 498, "2026-9-4": 502, "2026-9-11": 500, "2026-9-18": 497, "2026-9-25": 503, "2026-10-2": 500, "2026-10-9": 570, "2026-10-16": 527.25 };
    const rows = [];
    for (let index = 0; index < 56; index += 1) {
      const timestamp = new Date(2026, 7, 24 + index);
      const key = `${timestamp.getFullYear()}-${timestamp.getMonth() + 1}-${timestamp.getDate()}`;
      const kwh = fridays[key] !== undefined ? fridays[key] : base[timestamp.getDay()] + ((index * 37) % 11) - 5;
      rows.push({ timestamp, kwh, tariff: 104.5 });
    }
    return rows;
  }

  function demoRows() {
    const rows = [];
    const start = new Date("2026-08-03T00:00:00");
    for (let index = 0; index < 24 * 14; index += 1) {
      const timestamp = new Date(start.getTime() + index * 3600000);
      const hour = timestamp.getHours();
      const weekend = timestamp.getDay() === 0 || timestamp.getDay() === 6;
      let kwh = hour >= 5 && hour <= 18 ? (weekend ? 3.0 : 4.8) : 1.15;
      kwh += ((index * 37) % 11) / 50;
      if (index === 118) kwh = 11.9;
      if (index === 239) kwh = 9.7;
      rows.push({ timestamp, kwh: Number(kwh.toFixed(2)), tariff: 118.25 });
    }
    return rows;
  }

  return { parseCsv, analyze, compareBeforeAfter, toDaily, analyzeDaily, measureImpact, demoRows, demoDailyRows, median, quantile };
});
