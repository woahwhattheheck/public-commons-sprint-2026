// MIT. Exact mass-concentration representation; source meaning and qualifiers remain with the caller.
// SI prefix factors: https://www.nist.gov/pml/owm/metric-si-prefixes
export const CONCENTRATION_UNIT_PROFILE = Object.freeze({
  id: 'starforge.mass-concentration.si-prefixes', version: 1,
  dimension: 'mass/volume', scale: 'exact decimal powers of ten',
  source: 'https://www.nist.gov/pml/owm/metric-si-prefixes',
  targetUnits: Object.freeze(['g/L', 'mg/L', 'ug/L', 'ng/L', 'pg/L', 'mg/mL', 'ug/mL', 'ng/mL', 'kg/m3', 'g/m3', 'mg/m3', 'ug/m3']),
});
const registry = new Map();
for (const [mass, power] of [['kg', 3], ['g', 0], ['mg', -3], ['ug', -6], ['µg', -6], ['μg', -6], ['ng', -9], ['pg', -12]]) {
  for (const [volume, exponent] of [['L', 0], ['l', 0], ['mL', -3], ['ml', -3], ['m3', 3], ['m^3', 3], ['m³', 3]]) {
    const symbol = mass + '/' + volume;
    registry.set(symbol, Object.freeze({symbol, dimension: 'mass/volume', gramPerLitrePower: power - exponent}));
  }
}
export function concentrationUnit(value) {
  return typeof value === 'string' ? registry.get(value) ?? null : null;
}
export function concentrationFactor(fromUnit, toUnit) {
  const from = concentrationUnit(fromUnit), to = concentrationUnit(toUnit);
  if (!from || !to) throw Object.assign(new TypeError('Select explicit supported mass-per-volume units. Density-dependent, chemical-basis and logarithmic conversions require their own source contract.'), {code: 'WQX_CONCENTRATION_UNIT'});
  const power10 = from.gramPerLitrePower - to.gramPerLitrePower;
  return Object.freeze({power10, numerator: power10 >= 0 ? '1' + '0'.repeat(power10) : '1',
    denominator: power10 < 0 ? '1' + '0'.repeat(-power10) : '1'});
}
function invalid(message, code = 'WQX_CONCENTRATION_VALUE') {
  throw Object.assign(new TypeError(message), {code});
}
/** Move the decimal point without binary floating-point or rounding. Keep the original string separately. */
export function shiftExactDecimal(value, power10) {
  if (typeof value !== 'string' || value.length > 8192 || !Number.isSafeInteger(power10) || Math.abs(power10) > 64)
    invalid('Supply one exact decimal string and a supported unit factor.');
  const source = value.trim();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!match) invalid('The selected measure is not one decimal or scientific-notation value.');
  const integer = match[2] ?? '0', fraction = match[3] ?? match[4] ?? '';
  const exponent = Number(match[5] ?? '0');
  if (integer.length + fraction.length > 4096 || !Number.isSafeInteger(exponent) || Math.abs(exponent) > 4096)
    invalid('The selected decimal exceeds the supported source precision.');
  if (power10 === 0) return value;
  let digits = integer + fraction, position = integer.length + exponent + power10;
  const zeroes = /^0*/.exec(digits)[0].length;
  digits = digits.slice(zeroes); position -= zeroes;
  if (!digits) return match[1] + '0';
  const length = position <= 0 ? 2 - position + digits.length : Math.max(position, digits.length) + (position < digits.length ? 1 : 0);
  if (length > 8192) invalid('The exact converted representation exceeds the supported value length.');
  const moved = position <= 0 ? '0.' + '0'.repeat(-position) + digits
    : position >= digits.length ? digits + '0'.repeat(position - digits.length)
      : digits.slice(0, position) + '.' + digits.slice(position);
  return match[1] + moved;
}
/** Positive unit factors preserve a reported inequality; an absent or empty quantity stays absent or empty. */
export function convertConcentrationMeasure({value, unit}, targetUnit) {
  const factor = concentrationFactor(unit, targetUnit);
  if (value === null || value === undefined || typeof value === 'string' && value.trim() === '')
    return {original: {value: value ?? null, valuePresent: value !== undefined, unit}, value,
      unit: targetUnit, kind: value === undefined ? 'absent' : value === null ? 'null' : 'empty', factor, exact: true};
  if (typeof value !== 'string') invalid('Keep the original string representation of a reported measure.');
  const bound = /^(\s*)(<=|>=|<|>|≤|≥)(\s*)([\s\S]+)$/.exec(value);
  const numeric = bound ? bound[4] : value;
  const moved = shiftExactDecimal(numeric, factor.power10);
  return {original: {value, valuePresent: true, unit}, value: bound ? bound[1] + bound[2] + bound[3] + moved : moved,
    unit: targetUnit, kind: bound ? ['<', '<=', '≤'].includes(bound[2]) ? 'left-bound' : 'right-bound' : 'decimal',
    comparator: bound?.[2] ?? null, factor, exact: true};
}
/**
 * A reusable source-bound transformation proposal. No source object is mutated.
 * Each reported limit is evaluated independently in its own explicit source unit.
 */
export function convertConcentrationRecord(input, {targetUnit} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.limits) ||
      !input.source || typeof input.source !== 'object' || Array.isArray(input.source))
    invalid('Provide the original source binding, result value/unit and all reported limit records.');
  if (!concentrationUnit(targetUnit)) invalid('Choose a supported target concentration unit.', 'WQX_CONCENTRATION_UNIT');
  const issues = [];
  let result = null;
  try { result = convertConcentrationMeasure({value: input.value, unit: input.unit}, targetUnit); }
  catch (error) { issues.push({scope: 'result', index: null, code: error.code, message: error.message}); }
  const limits = input.limits.map((limit, index) => {
    if (!limit || typeof limit !== 'object' || Array.isArray(limit))
      invalid('Every reported limit must retain its original record.');
    const original = {index, id: limit.id ?? null, type: limit.type ?? null,
      value: limit.value ?? null, valuePresent: limit.value !== undefined, unit: limit.unit ?? null,
      comment: limit.comment ?? null, origin: limit.origin ?? null, source: structuredClone(limit.source ?? null)};
    let converted = null;
    const empty = limit.value === undefined || limit.value === null || typeof limit.value === 'string' && limit.value.trim() === '';
    if (empty && !concentrationUnit(limit.unit)) {
      // An empty metadata slot has no quantity to scale. Keep its exact missing/unit states.
      converted = {original: {value: original.value, valuePresent: original.valuePresent, unit: original.unit},
        value: limit.value, unit: limit.unit, kind: limit.value === undefined ? 'absent' : limit.value === null ? 'null' : 'empty',
        factor: null, exact: true};
    } else {
      try { converted = convertConcentrationMeasure({value: limit.value, unit: limit.unit}, targetUnit); }
      catch (error) { issues.push({scope: 'reported-limit', index, id: original.id, type: original.type,
        code: error.code, message: error.message}); }
    }
    return {original, converted};
  });
  return {schema: 'starforge.concentration-record-transformation.v1', profile: CONCENTRATION_UNIT_PROFILE,
    source: structuredClone(input.source), targetUnit, original: {value: input.value ?? null,
      valuePresent: input.value !== undefined, unit: input.unit ?? null},
    result, limits, issues, state: issues.length ? 'REVIEW_REQUIRED' : 'PREPARED'};
}
