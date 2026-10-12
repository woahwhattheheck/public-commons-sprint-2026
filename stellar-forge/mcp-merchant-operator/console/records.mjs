// MIT. Canonical original operator records shared by the store and workflow owner.
import { createHash } from 'node:crypto';

export const digest = value => createHash('sha256').update(value).digest('hex');
export function fail(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  const result = JSON.stringify(value);
  if (result === undefined) throw fail('CONSOLE_JSON', 'Use JSON values.', 400);
  return result;
}
