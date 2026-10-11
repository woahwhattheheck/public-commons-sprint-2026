// MIT. Two real merchant functions: a numeric-series report and a downloadable CSV.
import { setImmediate } from 'node:timers/promises';

async function summarize({ values, window }, signal) {
  const width = Math.min(window, values.length);
  let mean = 0, squaredDifference = 0, total = 0, correction = 0, windowTotal = 0;
  let minimum = Infinity, maximum = -Infinity;
  const rows = [];
  for (let index = 0; index < values.length; index++) {
    if (index % 1024 === 0) {
      signal?.throwIfAborted();
      await setImmediate(undefined, signal ? { signal } : undefined);
    }
    const value = values[index], count = index + 1;
    const adjusted = value - correction, nextTotal = total + adjusted;
    correction = nextTotal - total - adjusted; total = nextTotal;
    const difference = value - mean; mean += difference / count;
    squaredDifference += difference * (value - mean);
    minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
    windowTotal += value;
    if (index >= width) windowTotal -= values[index - width];
    rows.push({ index, value, windowMean: windowTotal / Math.min(count, width) });
  }
  signal?.throwIfAborted();
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  return { count: values.length, minimum, maximum, sum: total, mean, median,
    populationStandardDeviation: Math.sqrt(Math.max(0, squaredDifference / values.length)),
    window: width, rows };
}

export async function analyze(input, { signal } = {}) {
  return summarize(input, signal);
}

export async function tabulate(input, { signal } = {}) {
  const report = await summarize(input, signal);
  const lines = ['index,value,window_mean,delta_from_mean'];
  for (const row of report.rows)
    lines.push([row.index, row.value, row.windowMean, row.value - report.mean].join(','));
  signal?.throwIfAborted();
  return lines.join('\n') + '\n';
}
