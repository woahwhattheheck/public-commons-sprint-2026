// MIT. One complete setup document for the browser and native operator CLI.
import { createSetupDraft, updateSetupDraft, parseSetupDocument } from './application-setup.mjs';
export const FAMILY_SCHEMA = 'stellar-forge.application-setup-drafts.v1';
const clone = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => {
  const ordered = value => Array.isArray(value) ? value.map(ordered) :
    value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
};
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
export function validateSetupFamily(family) {
  ensure(family?.schema === FAMILY_SCHEMA && typeof family.workspaceId === 'string' &&
    typeof family.active === 'string' && Array.isArray(family.entries) &&
    family.entries.length > 0 && family.entries.length <= 512, 'The document has no complete setup draft family.');
  const form = value => value && typeof value.label === 'string' && typeof value.runtimeId === 'string' &&
    typeof value.kind === 'string' && value.settings && typeof value.settings === 'object' &&
    !Array.isArray(value.settings) && Object.entries(value.settings).every(([key, raw]) =>
      !['__proto__', 'constructor', 'prototype'].includes(key) && raw && typeof raw.value === 'string' && typeof raw.checked === 'boolean');
  const first = family.entries[0];
  for (const entry of family.entries) ensure(entry.workspaceId === family.workspaceId &&
    typeof entry.contextId === 'string' && entry.contextId === first.contextId &&
    typeof entry.kind === 'string' && entry.id === entry.contextId + '/' + entry.kind &&
    entry.applicationId === first.applicationId && (entry.applicationId === null ? entry.baseRevision === null : !!entry.baseRevision) &&
    (entry.applicationId === null || typeof entry.applicationId === 'string') &&
    (entry.baseRevision === null || typeof entry.baseRevision === 'string') &&
    typeof entry.updatedAt === 'string' && form(entry.form) && entry.form.kind === entry.kind && form(entry.baseline),
    'A retained setup variant has an invalid source or field value.');
  ensure(new Set(family.entries.map(entry => entry.id)).size === family.entries.length &&
    family.entries.some(entry => entry.id === family.active), 'The document has duplicate or missing draft selections.');
  return clone(family);
}
export function setupConfiguration(form, catalog) {
  const fields = catalog[form.kind]?.fields ?? [];
  return { label: form.label, runtimeId: form.runtimeId, kind: form.kind,
    settings: Object.fromEntries(Object.entries(form.settings).map(([name, raw]) => [
      name, fields.find(field => field.name === name)?.type === 'boolean' ? raw.checked : raw.value,
    ])) };
}
export function setupDocumentFamily(document) {
  const family = validateSetupFamily(document.originalDrafts);
  ensure(family.workspaceId === document.workspaceId, 'The document and its drafts name different workspaces.');
  const active = family.entries.find(entry => entry.id === family.active);
  ensure(same(setupConfiguration(active.form, document.catalog), document.configuration),
    'The selected fields differ from the complete document. Use the original exported setup file.');
  ensure((document.baseline?.applicationId ?? null) === active.applicationId &&
    (document.baseline?.revision ?? null) === active.baseRevision, 'The opening application revision differs from its retained draft.');
  return family;
}
export function createSetupDocument(sourceFamily, title = '', { catalog: declarations = [], runtimes = [] } = {}) {
  const family = validateSetupFamily(sourceFamily);
  const active = family.entries.find(entry => entry.id === family.active);
  const history = active.portableHistory ?? {};
  const catalog = { ...(history.catalog ?? {}) };
  for (const entry of family.entries) {
    if (entry.sourceCatalog?.id && !catalog[entry.sourceCatalog.id]) catalog[entry.sourceCatalog.id] = clone(entry.sourceCatalog);
  }
  for (const declaration of declarations) {
    if ((family.entries.some(entry => entry.kind === declaration.id) || active.baseline.kind === declaration.id) && !catalog[declaration.id])
      catalog[declaration.id] = clone(declaration);
  }
  const input = setupConfiguration(active.form, catalog);
  let application = null, baselineComplete = true;
  if (active.applicationId) {
    const openingEntry = family.entries.find(entry => entry.applicationId === active.applicationId &&
      entry.baseRevision === active.baseRevision && entry.baseline.kind === entry.kind);
    const original = active.applicationBaseline ?? openingEntry?.applicationBaseline;
    application = original && original.id === active.applicationId && original.revision === active.baseRevision ?
      clone(original) : { id: active.applicationId, revision: active.baseRevision, ...setupConfiguration(openingEntry?.baseline ?? active.baseline, catalog) };
    baselineComplete = !!original || !!openingEntry || active.baseline.kind === active.kind;
  }
  const runtime = runtimes.find(value => value.id === input.runtimeId) ?? null;
  let document = createSetupDraft({ workspaceId: family.workspaceId, application, configuration: input,
    catalog: Object.values(catalog), runtime });
  document = updateSetupDraft(document, input, { catalog: Object.values(catalog), runtime });
  document.title = title.trim() || history.title || input.label || catalog[input.kind]?.title || input.kind || 'Application setup';
  document.catalog = catalog; document.baselineComplete = baselineComplete;
  document.variants = Object.fromEntries(family.entries.filter(entry => entry.kind)
    .map(entry => [entry.kind, setupConfiguration(entry.form, catalog).settings]));
  document.originalDrafts = family;
  document.receivedFrom = clone(history.receivedFrom ?? []);
  document.reconciliations = clone(history.reconciliations ?? []);
  return parseSetupDocument(JSON.stringify(document));
}
export function readSetupFile(source, options = {}) {
  ensure(typeof source === 'string' && new TextEncoder().encode(source).byteLength <= 2 * 1024 * 1024, 'Choose a setup file no larger than 2 MiB.');
  const input = JSON.parse(source);
  if (input.schema === 'stellar-forge.application-setup.v1') {
    const document = parseSetupDocument(source);
    setupDocumentFamily(document);
    return document;
  }
  ensure(input.schema === 'stellar-forge.application-setup-draft.v1', 'Choose a Starforge setup or retained draft JSON file.');
  return createSetupDocument({ schema: FAMILY_SCHEMA, workspaceId: input.workspaceId, active: input.id, entries: [input] }, '', options);
}
