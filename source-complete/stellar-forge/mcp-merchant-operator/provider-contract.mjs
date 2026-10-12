// MIT. Metadata and lazy hooks for an original source-owned merchant provider.
export const MERCHANT_PROVIDER_SCHEMA = 'stellar-forge.merchant-provider.v1';
export const CORE_MERCHANT_CONFIG_KEYS = Object.freeze(['schema', 'name', 'releaseStore', 'exportsDirectory', 'sources']);
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const familyPattern = /^[a-z][A-Za-z0-9]{0,63}$/;
const toolPattern = /^[a-zA-Z0-9_.-]{1,128}$/;
const reserved = new Set([...CORE_MERCHANT_CONFIG_KEYS, 'core', 'constructor', 'prototype', '__proto__']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function ensure(value, message) {
  if (!value) throw Object.assign(new TypeError(message), { code: 'MERCHANT_PROVIDER_INVALID' });
}
function name(value, label, pattern = familyPattern) {
  ensure(typeof value === 'string' && pattern.test(value) && !reserved.has(value), 'Invalid merchant provider ' + label + ': ' + value);
  return value;
}
function names(values, label, pattern = familyPattern) {
  ensure(Array.isArray(values), 'Expected merchant provider ' + label + ' array.');
  const result = values.map(value => name(value, label, pattern));
  ensure(new Set(result).size === result.length, 'Duplicate merchant provider ' + label + '.');
  return Object.freeze(result);
}
function order(value, label) {
  ensure(Number.isSafeInteger(value) && value >= 0 && value <= 1000000, 'Invalid merchant provider ' + label + '.');
  return value;
}
function flag(value, label) {
  ensure(typeof value === 'boolean', 'Expected boolean merchant provider ' + label + '.');
  return value;
}
/**
 * Declaration modules import tool metadata only. Native source, configuration
 * readers and setup implementations remain behind the corresponding lazy hooks.
 * Runtime ownership uses MerchantProviderOwners and its original lifecycle ABI.
 */
export function defineMerchantProvider(value) {
  ensure(plain(value) && value.schema === MERCHANT_PROVIDER_SCHEMA, 'Expected an original merchant provider declaration.');
  const fields = new Set(['schema', 'id', 'family', 'title', 'order', 'catalogOrder', 'configKey',
    'configuration', 'summary', 'dependencies', 'load', 'create', 'tools', 'coreToolNames',
    'maxRequestBytes', 'concurrency', 'concurrentTools', 'shutdown', 'requestClose', 'instructions', 'initialize']);
  ensure(Object.keys(value).every(key => fields.has(key)), 'Unknown merchant provider declaration field for ' + value.id + '.');
  name(value.id, 'ID', idPattern); name(value.family, 'family');
  ensure(typeof value.title === 'string' && value.title.trim() && value.title.length <= 160,
    'Expected a merchant provider title for ' + value.id + '.');
  ensure(value.configKey === null || typeof value.configKey === 'string', 'Expected a configuration key or null for ' + value.id + '.');
  if (value.configKey !== null) name(value.configKey, 'configuration key');
  for (const key of ['load', 'create', 'tools']) ensure(typeof value[key] === 'function', 'Expected ' + value.id + '.' + key + ' hook.');
  for (const key of ['initialize', 'requestClose'])
    ensure(value[key] === undefined || typeof value[key] === 'function', 'Expected ' + value.id + '.' + key + ' hook.');
  const concurrency = value.concurrency ?? 'host', shutdown = value.shutdown ?? 'drain';
  ensure(['host', 'provider'].includes(concurrency), 'Unknown concurrency owner for ' + value.id + '.');
  ensure(['drain', 'provider'].includes(shutdown), 'Unknown shutdown owner for ' + value.id + '.');
  const maximum = value.maxRequestBytes ?? 128 * 1024;
  ensure(Number.isSafeInteger(maximum) && maximum > 0, 'Expected a positive original request-byte limit for ' + value.id + '.');
  let configuration = null;
  if (value.configuration !== undefined && value.configuration !== null) {
    const source = value.configuration;
    ensure(plain(source) && Object.keys(source).every(key => ['input', 'read', 'dependencies', 'privateExports'].includes(key)),
      'Unknown configuration declaration for ' + value.id + '.');
    ensure(value.configKey !== null && typeof source.read === 'function', 'Expected a configuration reader for ' + value.id + '.');
    name(source.input, 'host configuration input');
    configuration = Object.freeze({ ...source,
      dependencies: names(source.dependencies ?? [], 'configuration dependency'),
      privateExports: flag(source.privateExports ?? false, 'privateExports') });
  }
  ensure(value.configKey === null || configuration, 'A configured merchant provider must declare its original reader: ' + value.id);
  ensure(Array.isArray(value.instructions ?? []), 'Expected instruction sections for ' + value.id + '.');
  const instructions = (value.instructions ?? []).map(section => {
    ensure(plain(section) && Object.keys(section).every(key => ['order', 'prefix', 'tool', 'text'].includes(key)),
      'Unknown instruction section for ' + value.id + '.');
    ensure(typeof section.text === 'string' && section.text.length > 0 && section.text.length <= 65536,
      'Expected original instruction text for ' + value.id + '.');
    ensure(Object.hasOwn(section, 'prefix') !== Object.hasOwn(section, 'tool'),
      'An instruction selects one prefix or exact tool for ' + value.id + '.');
    if (Object.hasOwn(section, 'prefix')) ensure(section.prefix === null ||
      typeof section.prefix === 'string' && section.prefix.length > 0 && section.prefix.length <= 128,
    'Invalid instruction prefix for ' + value.id + '.');
    if (Object.hasOwn(section, 'tool')) name(section.tool, 'instruction tool', toolPattern);
    return Object.freeze({ ...section, order: order(section.order ?? value.order ?? 1000, 'instruction order') });
  });
  return Object.freeze({ ...value,
    order: order(value.order ?? 1000, 'order'),
    catalogOrder: order(value.catalogOrder ?? value.order ?? 1000, 'catalog order'),
    configuration, summary: flag(value.summary ?? true, 'summary'),
    dependencies: names(value.dependencies ?? [], 'dependency'),
    coreToolNames: names(value.coreToolNames ?? [], 'core tool', toolPattern),
    concurrentTools: names(value.concurrentTools ?? [], 'concurrent tool', toolPattern),
    maxRequestBytes: maximum, concurrency, shutdown, instructions: Object.freeze(instructions) });
}
