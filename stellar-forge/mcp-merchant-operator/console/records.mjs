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

// Scalar contracts used by both the original store and complete archive validation.
export const plainConsoleRecord = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export const consoleIdentifier = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))
    throw fail('CONSOLE_ID', 'Use the original record identifier.', 400);
  return value;
};
export const consoleRecordTitle = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\u0000-\u001f]/.test(value))
    throw fail('CONSOLE_NAME', 'Use a name from 1 to 160 characters.', 400);
  return value.trim();
};
export const consoleRevision = value => {
  if (!Number.isSafeInteger(value) || value < 1) throw fail('CONSOLE_REVISION', 'Use the displayed revision.', 400);
  return value;
};
export const consoleSha256 = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw fail('CONSOLE_DIGEST', 'Use the displayed SHA-256.', 400);
  return value;
};
