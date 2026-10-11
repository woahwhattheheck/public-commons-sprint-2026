// MIT. Exact PostgreSQL decimal text; no request value crosses JavaScript Number.
import { QueryInputError, record } from '../sqlite/parameters.mjs';

const own = (value, key) => Object.hasOwn(value, key);
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
export const MAX_DECIMAL_LENGTH = 128;

function decimalText(value, field) {
  if (typeof value !== 'string' || value.length > MAX_DECIMAL_LENGTH || !DECIMAL.test(value))
    throw new QueryInputError(field, 'EXPECTED_DECIMAL_STRING');
  return value;
}

function compare(left, right) {
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const a = BigInt(leftWhole + leftFraction.padEnd(scale, '0'));
  const b = BigInt(rightWhole + rightFraction.padEnd(scale, '0'));
  return a < b ? -1 : a > b ? 1 : 0;
}

function scalar(value, spec, field) {
  if (value === null) {
    if (spec.nullable === true) return null;
    throw new QueryInputError(field, 'NULL_NOT_ALLOWED');
  }
  const parsed = decimalText(value, field);
  const [whole, fraction = ''] = parsed.replace(/^-/, '').split('.');
  // Trailing fractional zeroes do not require database scale. Zero itself
  // needs no significant integer digits, including DECIMAL(p,p) declarations.
  if (own(spec, 'maxScale') && fraction.replace(/0+$/, '').length > spec.maxScale)
    throw new QueryInputError(field, 'DECIMAL_SCALE_EXCEEDED');
  if (own(spec, 'maxIntegerDigits') && whole.replace(/^0+/, '').length > spec.maxIntegerDigits)
    throw new QueryInputError(field, 'DECIMAL_INTEGER_DIGITS_EXCEEDED');
  if (own(spec, 'minimum') && compare(parsed, spec.minimum) < 0 ||
      own(spec, 'maximum') && compare(parsed, spec.maximum) > 0)
    throw new QueryInputError(field, 'OUT_OF_RANGE');
  return parsed;
}

/** Preserve the supplied scale and text, comparing bounds/enums mathematically. */
export function bindDecimalParameter(value, spec, field) {
  const parsed = scalar(value, spec, field);
  if (spec.enum && !spec.enum.some(candidate => parsed === null || candidate === null
    ? parsed === candidate : compare(parsed, candidate) === 0))
    throw new QueryInputError(field, 'NOT_IN_ENUM');
  return parsed;
}

/** Validate private declarations before the source or public seller is opened. */
export function compileDecimalParameter(spec, field) {
  if (!record(spec) || spec.type !== 'decimal') throw new TypeError('POSTGRES_DECIMAL_SPEC_INVALID');
  if (own(spec, 'nullable') && typeof spec.nullable !== 'boolean')
    throw new TypeError('POSTGRES_DECIMAL_NULLABLE_INVALID');
  if (own(spec, 'minLength') || own(spec, 'maxLength'))
    throw new TypeError('POSTGRES_DECIMAL_USES_FIXED_TEXT_LIMIT');
  for (const key of ['maxScale', 'maxIntegerDigits']) if (own(spec, key) &&
      (!Number.isInteger(spec[key]) || spec[key] < 0 || spec[key] > MAX_DECIMAL_LENGTH))
    throw new TypeError('POSTGRES_DECIMAL_PRECISION_LIMIT_INVALID:' + key);
  for (const key of ['minimum', 'maximum']) if (own(spec, key)) decimalText(spec[key], field);
  if (own(spec, 'minimum') && own(spec, 'maximum') && compare(spec.minimum, spec.maximum) > 0)
    throw new TypeError('POSTGRES_DECIMAL_MINIMUM_EXCEEDS_MAXIMUM');
  if (own(spec, 'enum')) {
    if (!Array.isArray(spec.enum) || !spec.enum.length || spec.enum.length > 128)
      throw new TypeError('POSTGRES_DECIMAL_ENUM_INVALID');
    for (const candidate of spec.enum) scalar(candidate, spec, field);
  }
  if (own(spec, 'default')) bindDecimalParameter(spec.default, spec, field);
  return structuredClone(spec);
}

/** Let the shared binder retain object/unknown/missing/null input semantics. */
export function decimalScalarParameter(spec) {
  return { type: 'string', minLength: 1, maxLength: MAX_DECIMAL_LENGTH,
    ...(own(spec, 'nullable') ? { nullable: spec.nullable } : {}),
    ...(own(spec, 'default') ? { default: spec.default } : {}) };
}
