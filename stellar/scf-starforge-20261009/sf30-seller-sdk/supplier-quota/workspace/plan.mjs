// MIT. Account edits compose only the original supplier declarations and assignments.
import { createHash } from 'node:crypto';
import { compileSupplierAccounts } from '../config.mjs';

export const SOURCE_SCHEMA = 'stellar-forge.seller-upstreams.v1';
export const REVIEW_SCHEMA = 'stellar-forge.supplier-account-review.v1';
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const clone = value => structuredClone(value);
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const digest = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
export const need = (value, code, status) => { if (!value) fail(code, status); };
const alias = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const fields = ['alias', 'directory', 'account', 'apiKeyEnv', 'requestsPerSecond', 'callsPerDay'];
export const identity = account => ({ directory: account.directory, account: account.account,
  apiKeyEnv: account.apiKeyEnv ?? null });
export const identityKey = account => JSON.stringify([account.account, account.apiKeyEnv ?? null]);

export function parseSource(text) {
  need(typeof text === 'string' && Buffer.byteLength(text) <= 1048576, 'SUPPLIER_SOURCE_TOO_LARGE');
  let value;
  try { value = JSON.parse(text); } catch { fail('SUPPLIER_SOURCE_JSON_INVALID'); }
  need(plain(value) && value.schema === SOURCE_SCHEMA && plain(value.bindings), 'SUPPLIER_SOURCE_SCHEMA_INVALID');
  compileSupplierAccounts(value.supplierAccounts, value.bindings);
  return value;
}

export function configurationView(config) {
  const compiled = compileSupplierAccounts(config.supplierAccounts, config.bindings);
  return {
    accounts: Object.entries(config.supplierAccounts ?? {}).map(([name, value]) => ({
      alias: name, ...clone(value), apiKeyEnv: value.apiKeyEnv ?? null, bindings: [...compiled[name].bindings],
    })).sort((a, b) => a.alias.localeCompare(b.alias)),
    bindings: Object.entries(config.bindings).map(([name, value]) => ({
      name, supplierAccount: value.supplierAccount ?? null,
      method: typeof value.method === 'string' ? value.method : 'GET',
    })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** A previously selected ledger identity stays with its alias, including after retirement. */
export function retainIdentities(previous, config) {
  const known = clone(previous ?? {});
  for (const [name, account] of Object.entries(config.supplierAccounts ?? {})) {
    const selected = identity(account);
    if (Object.hasOwn(known, name))
      need(equal(known[name], selected), 'SUPPLIER_ACCOUNT_IDENTITY_CHANGED', 409);
    for (const [other, retained] of Object.entries(known)) {
      if (other === name) continue;
      need(retained.directory !== selected.directory && identityKey(retained) !== identityKey(selected),
        'SUPPLIER_ACCOUNT_IDENTITY_ALREADY_RETAINED', 409);
    }
    Object.defineProperty(known, name, { value: selected, enumerable: true, configurable: true, writable: true });
  }
  return known;
}

export function proposalFrom(config) {
  const view = configurationView(config);
  return {
    accounts: view.accounts.map(({ bindings, ...account }) => account),
    assignments: view.bindings.map(binding => ({ binding: binding.name, account: binding.supplierAccount })),
  };
}

/** Unknown original source fields and every unselected binding field survive. */
export function composeProposal(config, proposal, retained = {}) {
  need(plain(proposal) && Array.isArray(proposal.accounts) && proposal.accounts.length <= 64 &&
    Array.isArray(proposal.assignments), 'SUPPLIER_PROPOSAL_INVALID');
  const next = clone(config), accounts = Object.create(null), seen = new Set();
  for (const row of proposal.accounts) {
    need(plain(row) && Object.keys(row).every(key => fields.includes(key)) &&
      alias.test(row.alias ?? '') && !['__proto__', 'constructor', 'prototype'].includes(row.alias) &&
      !Object.hasOwn(accounts, row.alias), 'SUPPLIER_ACCOUNT_INVALID');
    const { alias: name, ...value } = row;
    if (value.apiKeyEnv === null || value.apiKeyEnv === '') delete value.apiKeyEnv;
    accounts[name] = clone(value);
  }
  const names = Object.keys(config.bindings);
  need(proposal.assignments.length === names.length, 'SUPPLIER_BINDING_INVENTORY_CHANGED', 409);
  for (const row of proposal.assignments) {
    need(plain(row) && Object.keys(row).every(key => ['binding', 'account'].includes(key)) &&
      typeof row.binding === 'string' && Object.hasOwn(next.bindings, row.binding) && !seen.has(row.binding),
    'SUPPLIER_BINDING_INVENTORY_CHANGED', 409);
    seen.add(row.binding);
    if (row.account === null) delete next.bindings[row.binding].supplierAccount;
    else {
      need(typeof row.account === 'string' && Object.hasOwn(accounts, row.account), 'SUPPLIER_BINDING_ACCOUNT_INVALID');
      next.bindings[row.binding].supplierAccount = row.account;
    }
  }
  if (Object.keys(accounts).length || Object.hasOwn(config, 'supplierAccounts')) next.supplierAccounts = accounts;
  else delete next.supplierAccounts;
  compileSupplierAccounts(next.supplierAccounts, next.bindings);
  retainIdentities(retainIdentities(retained, config), next);
  need(Buffer.byteLength(json(next)) <= 1048576, 'SUPPLIER_SOURCE_TOO_LARGE');
  return next;
}

function stripOwned(value) {
  const result = clone(value);
  delete result.supplierAccounts;
  for (const binding of Object.values(result.bindings)) delete binding.supplierAccount;
  return result;
}
export function verifyOwnedChange(before, after) {
  need(equal(stripOwned(before), stripOwned(after)), 'SUPPLIER_UNRELATED_SOURCE_CHANGED', 409);
}

export function accountChanges(before, after) {
  const left = before.supplierAccounts ?? {}, right = after.supplierAccounts ?? {};
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap(name => {
    const old = Object.hasOwn(left, name) ? left[name] : null, next = Object.hasOwn(right, name) ? right[name] : null;
    return equal(old, next) ? [] : [{ alias: name, kind: old === null ? 'ADDED' : next === null ? 'RETIRED' : 'UPDATED',
      before: clone(old), after: clone(next) }];
  });
}
export function assignmentChanges(before, after) {
  return Object.keys(before.bindings).sort().flatMap(name => {
    const old = before.bindings[name].supplierAccount ?? null, next = after.bindings[name].supplierAccount ?? null;
    return old === next ? [] : [{ binding: name, before: old, after: next }];
  });
}

export function makeReview({ id, createdAt, source, before, after, note, restores = null, rebases = null, targetText }) {
  verifyOwnedChange(before, after);
  const accounts = accountChanges(before, after), assignments = assignmentChanges(before, after);
  need(accounts.length + assignments.length > 0, 'SUPPLIER_CHANGE_EMPTY');
  need(typeof note === 'string' && note.length <= 4000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note),
    'SUPPLIER_CHANGE_NOTE_INVALID');
  const afterText = targetText ?? json(after);
  need(equal(parseSource(afterText), after), 'SUPPLIER_REVIEW_TARGET_CHANGED');
  const review = {
    schema: REVIEW_SCHEMA, id, createdAt, restores, rebases, note,
    source: { path: source.path, sha256: source.sha256, bytes: source.bytes,
      device: source.device, inode: source.inode },
    target: { sha256: digest(afterText), bytes: Buffer.byteLength(afterText) },
    accounts, assignments,
    effect: 'SAVED_UPSTREAM_CONFIGURATION',
    activation: 'The maintained merchant loads the saved configuration on its next normal start.',
    usage: 'Existing quota directories, dispatch history and supplier cooldowns are retained.',
  };
  return { review, reviewSha256: digest(json(review)), afterText };
}

/** Undo the selected change only where its reviewed result is still current.
 * Later edits to unrelated accounts, assignments and upstream fields survive. */
export function restoreProposal(current, before, after, retained) {
  const next = clone(current);
  next.supplierAccounts ??= {};
  for (const change of accountChanges(before, after)) {
    const present = Object.hasOwn(next.supplierAccounts, change.alias) ? next.supplierAccounts[change.alias] : null;
    if (change.before !== null && change.after !== null) {
      need(present !== null && equal(identity(present), identity(change.after)), 'SUPPLIER_RESTORE_ACCOUNT_CHANGED', 409);
      for (const key of new Set([...Object.keys(change.before), ...Object.keys(change.after)])) {
        if (equal(change.before[key], change.after[key])) continue;
        need(equal(present[key], change.after[key]), 'SUPPLIER_RESTORE_ACCOUNT_CHANGED', 409);
        if (Object.hasOwn(change.before, key)) present[key] = clone(change.before[key]);
        else delete present[key];
      }
    } else {
      need(equal(present, change.after), 'SUPPLIER_RESTORE_ACCOUNT_CHANGED', 409);
      if (change.before === null) delete next.supplierAccounts[change.alias];
      else Object.defineProperty(next.supplierAccounts, change.alias,
        { value: clone(change.before), enumerable: true, configurable: true, writable: true });
    }
  }
  for (const change of assignmentChanges(before, after)) {
    need(Object.hasOwn(next.bindings, change.binding) &&
      (next.bindings[change.binding].supplierAccount ?? null) === change.after,
    'SUPPLIER_RESTORE_BINDING_CHANGED', 409);
    if (change.before === null) delete next.bindings[change.binding].supplierAccount;
    else next.bindings[change.binding].supplierAccount = change.before;
  }
  return composeProposal(current, proposalFrom(next), retained);
}
