// MIT. Exact fixed-point arithmetic; reported source values stay unchanged.
const DECIMAL = /^[+-]?\d+(?:\.\d+)?$/;
export function decimalParts(value) {
  if (typeof value !== 'string' || value.length > 512 || !DECIMAL.test(value)) return null;
  const negative = value[0] === '-', unsigned = value.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  return { coefficient: BigInt(whole + fraction) * (negative ? -1n : 1n), scale: fraction.length };
}
export function decimalText({ coefficient, scale }) {
  const negative = coefficient < 0n, text = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
  return (negative ? '-' : '') + (scale ? text.slice(0, -scale) + '.' + text.slice(-scale) : text);
}
export function addDecimals(left, right) {
  const a = decimalParts(left), b = decimalParts(right);
  if (!a || !b) return null;
  const scale = Math.max(a.scale, b.scale);
  return decimalText({ scale, coefficient: a.coefficient * 10n ** BigInt(scale - a.scale) + b.coefficient * 10n ** BigInt(scale - b.scale) });
}
export function subtractDecimals(right, left) {
  const a = decimalParts(left);
  return a ? addDecimals(right, decimalText({ ...a, coefficient: -a.coefficient })) : null;
}
export function equalDecimals(left, right) {
  const difference = subtractDecimals(left, right);
  return difference !== null && decimalParts(difference).coefficient === 0n;
}
export function positiveDecimal(value) {
  const parsed = decimalParts(value);
  return parsed !== null && parsed.coefficient > 0n;
}
