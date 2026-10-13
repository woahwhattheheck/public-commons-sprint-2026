import {invariant} from './source-json.mjs';

// All monetary inputs remain decimal strings. An explicit exponent is accepted
// for retained original JSON number spellings and expanded exactly.
export function decimalParts(value) {
  invariant(typeof value === 'string' && value.length <= 256, 'DECIMAL_STRING_REQUIRED');
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  invariant(match, 'DECIMAL_INVALID', {value});
  const exponent = Number(match[4] ?? 0);
  invariant(Number.isSafeInteger(exponent) && Math.abs(exponent) <= 100, 'DECIMAL_EXPONENT_RANGE');
  let scale = (match[3] ?? '').length - exponent;
  let coefficient = BigInt((match[1] === '-' ? '-' : '') + match[2] + (match[3] ?? ''));
  if (scale < 0) { coefficient *= 10n ** BigInt(-scale); scale = 0; }
  invariant(scale <= 200, 'DECIMAL_SCALE_RANGE');
  while (scale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
  return {coefficient, scale};
}

export function decimalString({coefficient, scale}) {
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
  const result = scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits;
  return (negative ? '-' : '') + result;
}
export function decimal(value) { return decimalString(decimalParts(value)); }
export function addDecimals(left, right) {
  const a = decimalParts(left), b = decimalParts(right), scale = Math.max(a.scale, b.scale);
  return decimal(decimalString({scale,
    coefficient: a.coefficient * 10n ** BigInt(scale - a.scale) +
      b.coefficient * 10n ** BigInt(scale - b.scale)}));
}
export function subtractDecimals(left, right) {
  const b = decimalParts(right);
  return addDecimals(left, decimalString({...b, coefficient: -b.coefficient}));
}
export function multiplyDecimals(left, right) {
  const a = decimalParts(left), b = decimalParts(right);
  return decimal(decimalString({coefficient: a.coefficient * b.coefficient, scale: a.scale + b.scale}));
}
export function compareDecimals(left, right) {
  const result = decimalParts(subtractDecimals(left, right)).coefficient;
  return result < 0n ? -1 : result > 0n ? 1 : 0;
}
export function exactField(source, field, numberTokens = {}, pointer = '') {
  const raw = source?.[field];
  if (raw === null || raw === undefined) return null;
  const spelling = typeof raw === 'string' ? raw : numberTokens[pointer + '/' + field];
  invariant(typeof spelling === 'string', 'ORIGINAL_NUMERIC_SPELLING_REQUIRED', {field});
  return decimal(spelling);
}

export function csv(rows, columns) {
  const cell = value => {
    let text = value === null || value === undefined ? '' :
      typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Human-opened exports preserve the visible text while preventing formulas.
    if (/^[=+@\t\r]/.test(text) || /^-\D/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [columns.map(cell).join(','), ...rows.map(row => columns.map(key => cell(row[key])).join(','))]
    .join('\r\n') + '\r\n';
}

