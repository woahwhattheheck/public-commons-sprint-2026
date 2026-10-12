// MIT. Exact-period analyst measures over the original retained economic source.
import { need, plain, clone, date, exactDifference } from '../model.mjs';

export const BRIEFING_SPEC = 'stellar-forge.fred-briefing-spec.v1';
export const BRIEFING_MODEL = 'stellar-forge.fred-briefing-model.v1';
export const MAX_BRIEFING_ROWS = 10000;
export const BRIEFING_COMPARISONS = Object.freeze(['previous_period', 'year_earlier', 'previous_observation']);
const MONTHS = new Map([['Monthly', 1], ['Quarterly', 3], ['Semiannual', 6], ['Annual', 12]]);
function frequencyPeriod(frequency) {
  if (MONTHS.has(frequency)) return { months: MONTHS.get(frequency) };
  if (frequency === 'Daily') return { days: 1 };
  if (/^Weekly(?:,|$)/.test(frequency)) return { days: 7 };
  if (/^Biweekly(?:,|$)/.test(frequency)) return { days: 14 };
  return null;
}
function exactKeys(input, keys, label) {
  need(plain(input) && Object.keys(input).every(key => keys.includes(key)), 'Use the declared ' + label + ' fields.', 'FRED_BRIEFING_SELECTION_INVALID');
}
function boundedText(value, label, max, empty = false) {
  need(typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) &&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), 'Supply a readable ' + label + '.', 'FRED_BRIEFING_SELECTION_INVALID');
  return value;
}
export function normalizeFredBriefing(input, model) {
  exactKeys(input, ['schema', 'title', 'start', 'end', 'decimalPlaces', 'notes', 'series'], 'briefing');
  need(input.schema === undefined || input.schema === BRIEFING_SPEC, 'Use the supported economic briefing schema.');
  need(model && Array.isArray(model.series) && Array.isArray(model.rows), 'Select the original economic source.');
  const title = boundedText(input.title ?? 'Economic briefing', 'briefing title', 160);
  const notes = boundedText(input.notes ?? '', 'analyst note', 8000, true);
  const start = date(input.start ?? model.selection.start), end = date(input.end ?? model.selection.end);
  need(start <= end, 'The briefing start must precede its end.');
  const decimalPlaces = input.decimalPlaces ?? 6;
  need(Number.isSafeInteger(decimalPlaces) && decimalPlaces >= 0 && decimalPlaces <= 12,
    'Choose between zero and twelve relative-change decimal places.');
  const selected = input.series ?? model.series.map(item => ({ id: item.id }));
  need(Array.isArray(selected) && selected.length >= 1 && selected.length <= 50,
    'Select one to fifty original series for the briefing.');
  const known = new Map(model.series.map(item => [item.id, item])), ids = new Set();
  const series = selected.map(item => {
    exactKeys(item, ['id', 'comparisons', 'relativeChange'], 'briefing series');
    const metadata = known.get(item.id);
    need(metadata && !ids.has(item.id), 'Choose each original series once.'); ids.add(item.id);
    const period = frequencyPeriod(metadata.frequency);
    const comparisons = item.comparisons ?? (MONTHS.has(metadata.frequency)
      ? ['previous_period', 'year_earlier'] : ['previous_observation']);
    need(Array.isArray(comparisons) && comparisons.length >= 1 && comparisons.length <= 3 &&
      new Set(comparisons).size === comparisons.length && comparisons.every(value => BRIEFING_COMPARISONS.includes(value)),
      'Choose unique declared period comparisons.');
    need(!comparisons.includes('previous_period') || period !== null,
      'Choose previous observation for this source frequency; its calendar period is not declared.',
      'FRED_BRIEFING_FREQUENCY_REQUIRED');
    need(!comparisons.includes('year_earlier') || MONTHS.has(metadata.frequency),
      'Year-earlier matching requires monthly, quarterly, semiannual or annual source periods.',
      'FRED_BRIEFING_FREQUENCY_REQUIRED');
    need(item.relativeChange === undefined || typeof item.relativeChange === 'boolean', 'Choose a boolean relative-change selection.');
    return { id: item.id, comparisons: [...comparisons], relativeChange: item.relativeChange ?? false };
  });
  const count = model.rows.filter(row => ids.has(row.series) && row.date >= start && row.date <= end).length;
  need(count > 0 && count <= MAX_BRIEFING_ROWS,
    'Select a briefing interval containing one to 10,000 original observations.', 'FRED_BRIEFING_ROW_CAPACITY');
  return { schema: BRIEFING_SPEC, title, start, end, decimalPlaces, notes, series };
}
function decimal(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) return null;
  const exponent = Number(match[4] ?? 0), fraction = match[3] ?? '';
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return null;
  let integer = BigInt(match[1] + match[2] + fraction), scale = fraction.length - exponent;
  if (scale < 0) { integer *= 10n ** BigInt(-scale); scale = 0; }
  return { integer, scale };
}
export function fredRelativeChange(before, after, decimalPlaces = 6) {
  const a = decimal(before), b = decimal(after);
  need(Number.isSafeInteger(decimalPlaces) && decimalPlaces >= 0 && decimalPlaces <= 12, 'Invalid relative-change precision.');
  if (!a || !b) return { state: 'NUMERIC_LITERAL_UNSUPPORTED', value: null, rounded: false };
  if (a.integer === 0n) return { state: 'ZERO_BASE', value: null, rounded: false };
  const scale = Math.max(a.scale, b.scale);
  let numerator = (b.integer * 10n ** BigInt(scale - b.scale) - a.integer * 10n ** BigInt(scale - a.scale)) *
    100n * 10n ** BigInt(decimalPlaces);
  let denominator = a.integer * 10n ** BigInt(scale - a.scale);
  if (denominator < 0n) { denominator = -denominator; numerator = -numerator; }
  const negative = numerator < 0n, absolute = negative ? -numerator : numerator;
  let quotient = absolute / denominator;
  const remainder = absolute % denominator, twice = remainder * 2n;
  if (twice > denominator || twice === denominator && quotient % 2n === 1n) quotient += 1n;
  const digits = quotient.toString().padStart(decimalPlaces + 1, '0');
  const value = decimalPlaces ? digits.slice(0, -decimalPlaces) + '.' + digits.slice(-decimalPlaces) : digits;
  return { state: 'READY', value: (negative && quotient !== 0n ? '-' : '') + value,
    rounded: remainder !== 0n, decimalPlaces, rounding: 'HALF_EVEN' };
}
function earlierCalendarDate(value, period) {
  const original = new Date(value + 'T00:00:00.000Z');
  if (period.days) {
    original.setUTCDate(original.getUTCDate() - period.days);
    return original.toISOString().slice(0, 10);
  }
  const year = original.getUTCFullYear(), month = original.getUTCMonth(), day = original.getUTCDate();
  const absoluteMonth = year * 12 + month - period.months;
  const earlierYear = Math.floor(absoluteMonth / 12), earlierMonth = (absoluteMonth % 12 + 12) % 12;
  if (earlierYear < 1 || earlierYear > 9999) return null;
  const earlier = new Date(0); earlier.setUTCFullYear(earlierYear, earlierMonth, day); earlier.setUTCHours(0, 0, 0, 0);
  if (earlier.getUTCFullYear() !== earlierYear || earlier.getUTCMonth() !== earlierMonth || earlier.getUTCDate() !== day) return null;
  return earlier.toISOString().slice(0, 10);
}
function measure(current, baseline, baselineDate, method, selected, metadata, precision, retain) {
  let state = 'READY', difference = null;
  if (current.missing) state = 'SOURCE_MISSING';
  else if (baselineDate === null) state = 'CALENDAR_DATE_ABSENT';
  else if (!baseline) state = 'BASE_ABSENT';
  else if (baseline.missing) state = 'BASE_MISSING';
  else if (!decimal(current.value) || !decimal(baseline.value)) state = 'NUMERIC_LITERAL_UNSUPPORTED';
  else difference = exactDifference(baseline.value, current.value);
  const relative = !selected.relativeChange ? { state: 'NOT_SELECTED', value: null, rounded: false }
    : state === 'READY' ? fredRelativeChange(baseline.value, current.value, precision)
      : { state: 'SOURCE_UNAVAILABLE', value: null, rounded: false };
  return { series: current.series, date: current.date, comparison: method, state,
    currentIndex: retain(current), baselineDate, baselineIndex: baseline ? retain(baseline) : null,
    absoluteChange: difference, changeUnits: metadata.units === 'Percent' ? 'Percentage points' : metadata.units,
    relativePercent: relative.value, relativeState: relative.state, relativeRounded: relative.rounded };
}
/** All baselines come from the same retained source, including those outside the displayed interval. */
export function buildFredBriefingModel({ model, captureId, reviewId = null, selection } = {}) {
  const spec = normalizeFredBriefing(selection, model), measures = [], series = [], observations = [], observationIndex = new Map();
  const retain = row => {
    const key = row.series + '\0' + row.date;
    if (!observationIndex.has(key)) { observationIndex.set(key, observations.length); observations.push(clone(row)); }
    return observationIndex.get(key);
  };
  const metadata = new Map(model.series.map(item => [item.id, item])), bySeries = new Map();
  for (const row of model.rows) {
    if (!bySeries.has(row.series)) bySeries.set(row.series, []);
    bySeries.get(row.series).push(row);
  }
  let selectedRows = 0, missing = 0;
  for (const chosen of spec.series) {
    const meta = metadata.get(chosen.id);
    const original = (bySeries.get(chosen.id) ?? []).map(clone).sort((a, b) => a.date.localeCompare(b.date));
    need(new Set(original.map(row => row.date)).size === original.length, 'Original briefing source repeats an observation date.');
    const byDate = new Map(original.map(row => [row.date, row]));
    const visible = original.filter(row => row.date >= spec.start && row.date <= spec.end);
    const first = measures.length;
    for (let index = 0; index < original.length; index++) {
      const current = original[index];
      if (current.date < spec.start || current.date > spec.end) continue;
      need(current.units === meta.units && current.frequency === meta.frequency &&
        current.seasonal_adjustment === meta.seasonalAdjustment, 'Original observation meaning differs from its series.');
      selectedRows++; if (current.missing) missing++;
      for (const method of chosen.comparisons) {
        let baselineDate;
        if (method === 'previous_observation') baselineDate = original[index - 1]?.date ?? null;
        else baselineDate = earlierCalendarDate(current.date, method === 'year_earlier' ? { months: 12 } : frequencyPeriod(meta.frequency));
        const baseline = baselineDate === null ? null : byDate.get(baselineDate) ?? null;
        const value = measure(current, baseline, baselineDate, method, chosen, meta, spec.decimalPlaces, retain);
        if (method === 'previous_observation' && index === 0 && !current.missing) value.state = 'BASE_ABSENT';
        measures.push(value);
      }
    }
    const latest = visible.at(-1) ?? null, available = visible.findLast(row => !row.missing) ?? null;
    const currentMeasures = latest ? measures.slice(first).filter(row => row.date === latest.date) : [];
    series.push({ ...clone(meta), sourceUrl: meta.sourceUrl ?? 'https://fred.stlouisfed.org/series/' + encodeURIComponent(meta.id),
      selection: clone(chosen), selectedRows: visible.length, selectedMissing: visible.filter(row => row.missing).length,
      firstSelectedDate: visible[0]?.date ?? null, lastSelectedDate: latest?.date ?? null,
      latest: latest ? clone(latest) : null, latestAvailable: available ? clone(available) : null, latestMeasures: currentMeasures });
  }
  const totals = {};
  for (const item of measures) totals[item.state] = (totals[item.state] ?? 0) + 1;
  return { schema: BRIEFING_MODEL, captureId, reviewId, title: spec.title, notes: spec.notes, selection: spec,
    source: { sourceMode: model.sourceMode, timeBasis: model.timeBasis, selection: clone(model.selection),
      ...(model.retrievalWindow ? { retrievalWindow: clone(model.retrievalWindow) } : {}),
      sourceRows: model.rowCount, sourceMissing: model.missing },
    calculation: { version: 'FRED_EXACT_PERIOD_V1', relativeFormula: '100 * (current - baseline) / baseline',
      relativeDecimalPlaces: spec.decimalPlaces, relativeRounding: 'HALF_EVEN',
      absoluteChange: 'Exact decimal subtraction in the original units',
      priorPeriod: 'Exact calendar date from the native source frequency',
      yearEarlier: 'Same calendar date twelve months earlier for monthly, quarterly, semiannual and annual series',
      previousObservation: 'Immediately preceding original observation, retaining missing markers',
      baselineSource: 'Same retained capture, including original observations before the displayed interval' },
    selectedRows, missing, measureCount: measures.length, observationCount: observations.length, totals, series, observations, measures };
}
export function pageFredBriefing(report, { offset = 0, limit = 100 } = {}) {
  need(Number.isSafeInteger(offset) && offset >= 0 && offset <= report.measures.length &&
    Number.isSafeInteger(limit) && limit >= 1 && limit <= 500, 'Choose an original briefing measure page.');
  const { measures, observations, series, ...summary } = report;
  const expand = item => ({ ...item, current: clone(observations[item.currentIndex]),
    baseline: item.baselineIndex === null ? null : clone(observations[item.baselineIndex]) });
  return { ...summary, series: series.map(item => ({ ...item, latestMeasures: item.latestMeasures.map(expand) })),
    offset, limit, nextOffset: offset + limit < measures.length ? offset + limit : null,
    measures: measures.slice(offset, offset + limit).map(expand) };
}
