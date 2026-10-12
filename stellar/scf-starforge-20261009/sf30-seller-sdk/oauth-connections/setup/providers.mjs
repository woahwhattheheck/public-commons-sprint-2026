// MIT. Native accounting registrations through the selected original OAuth factories.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeOAuthHostConnections } from '../host.mjs';
import { fields, need, text, hex, digest, identity, callbackUri } from './model.mjs';

const PREFIX = 'stellar/scf-starforge-20261009/sf30-seller-sdk/oauth-connections/';
export const OAUTH_SETUP_PROVIDERS = Object.freeze(['quickbooks', 'xero']);
const DEFINITIONS = Object.freeze({
  quickbooks: Object.freeze({label: 'QuickBooks Online', kind: 'intuit-quickbooks',
    factory: 'createQuickBooksProfile', source: 'quickbooksSource', environment: ['sandbox', 'production']}),
  xero: Object.freeze({label: 'Xero accounting', kind: 'xero-accounting',
    factory: 'createXeroProfile', source: 'xeroSource', environment: []}),
});
export function oauthSetupProviderId(value) {
  need(OAUTH_SETUP_PROVIDERS.includes(value), 'INPUT_INVALID',
    'Choose the original QuickBooks or Xero accounting provider.');
  return value;
}
const same = (a, b) => identity(a) === identity(b);
async function originalBytes(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    need(before.isFile() && !(before.mode & 0o022) && before.size > 0 &&
      before.size <= maximum && await realpath(path) === path, 'PROVIDER_UNAVAILABLE',
      'Use the verified original provider source from the selected installed runtime.', 409);
    const raw = await handle.readFile(), after = await handle.stat();
    need(raw.length === before.size && after.size === before.size &&
      after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs,
      'SOURCE_CHANGED', 'The selected original provider source changed while reading.', 409);
    return raw;
  } finally { await handle.close(); }
}

/**
 * sourceRoot is selected by the trusted runtime inspector, never by a browser.
 * Missing provider modules disable only that provider. The returned adapter
 * supplies public source/profile values; it never opens an authorization grant.
 */
export async function loadOAuthSetupProviders({sourceRoot, profileAuthority} = {}) {
  need(typeof sourceRoot === 'string' && isAbsolute(sourceRoot) &&
    resolve(sourceRoot) === sourceRoot && sourceRoot !== '/' &&
    !/[\x00-\x1f\x7f\\]/.test(sourceRoot), 'INPUT_INVALID',
    'Use the original inspected runtime source root.');
  const profile = profileAuthority ??
    await import(pathToFileURL(join(sourceRoot, PREFIX + 'profile.mjs')).href);
  need(['normalizeOAuthProfile', 'oauthProfileIdentity'].every(name =>
    typeof profile[name] === 'function'), 'PROVIDER_UNAVAILABLE',
    'The selected runtime must expose its original profile authority.', 409);
  const rows = new Map();
  for (const provider of OAUTH_SETUP_PROVIDERS) {
    const spec = DEFINITIONS[provider];
    try {
      const modulePath = join(sourceRoot, PREFIX + provider + '.mjs');
      const sourcePath = join(sourceRoot, PREFIX + provider + '.openapi.json');
      const [moduleRaw, raw] = await Promise.all([
        originalBytes(modulePath, 2 * 1024 * 1024), originalBytes(sourcePath, 65536),
      ]);
      const native = await import(pathToFileURL(modulePath).href);
      need(typeof native[spec.factory] === 'function' && typeof native[spec.source] === 'function',
        'PROVIDER_UNAVAILABLE', 'The selected runtime lacks the original native provider factory.', 409);
      const authority = await native[spec.source]();
      const sourceText = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(raw);
      need(Buffer.from(sourceText).equals(raw) && hex(authority.sha256) &&
        authority.sha256 === digest(raw) && typeof authority.scheme === 'string',
        'SOURCE_CHANGED', 'The original provider factory names different source bytes.', 409);
      const document = JSON.parse(sourceText);
      const flow = document.components?.securitySchemes?.[authority.scheme]?.flows?.authorizationCode;
      need(flow && typeof flow.authorizationUrl === 'string' && typeof flow.tokenUrl === 'string',
        'SOURCE_CHANGED', 'The original provider descriptor has no matching authorization flow.', 409);
      rows.set(provider, {provider, spec, native, sourceText,
        source: {sha256: authority.sha256, bytes: raw.length, scheme: authority.scheme,
          file: provider + '.openapi.json'},
        factorySha256: digest(moduleRaw)});
    } catch {
      rows.set(provider, {provider, spec, unavailable: true});
    }
  }
  function selected(provider) {
    oauthSetupProviderId(provider);
    const row = rows.get(provider);
    need(row && !row.unavailable, 'PROVIDER_UNAVAILABLE',
      'This selected READY runtime does not expose the complete original ' +
      DEFINITIONS[provider].label + ' source and factory. Select a compatible runtime.', 409);
    return row;
  }
  return Object.freeze({
    catalog() {
      return OAUTH_SETUP_PROVIDERS.map(provider => {
        const row = rows.get(provider);
        if (row.unavailable) return {provider, label: row.spec.label, enabled: false,
          reason: 'The selected runtime does not contain the complete original provider source and factory.'};
        return {provider, label: row.spec.label, kind: row.spec.kind, enabled: true,
          source: {...row.source}, factorySha256: row.factorySha256,
          registrationFields: ['label', 'clientId', 'clientSecretEnv', 'callbackOrigin',
            ...(provider === 'quickbooks' ? ['environment'] : [])],
          environments: [...row.spec.environment]};
      });
    },
    async source(provider, expectedSourceSha256) {
      const row = selected(provider);
      need(hex(expectedSourceSha256) && expectedSourceSha256 === row.source.sha256,
        'SOURCE_CHANGED', 'Import the exact original provider source shown by this runtime.', 409);
      return {provider, label: row.spec.label, source: {...row.source},
        factorySha256: row.factorySha256, sourceText: row.sourceText};
    },
    async normalizeDefinition(raw, sourceText, {context} = {}) {
      fields(raw, ['provider', 'alias', 'directoryEnv', 'sourceId', 'label', 'clientId',
        'clientSecretEnv', 'callbackOrigin', 'environment', 'factorySha256',
        'replacesProfileSha256'], 'native accounting registration');
      const row = selected(raw.provider), spec = row.spec;
      try { normalizeOAuthHostConnections([{alias: raw.alias, directoryEnv: raw.directoryEnv}]); }
      catch { need(false, 'INPUT_INVALID', 'Use a distinct alias and directory environment reference.'); }
      need(raw.sourceId === row.source.sha256 && typeof sourceText === 'string' &&
        digest(Buffer.from(sourceText)) === row.source.sha256 &&
        sourceText === row.sourceText, 'SOURCE_CHANGED',
        'Review the exact retained descriptor used by the original native provider factory.', 409);
      need(raw.factorySha256 === undefined || raw.factorySha256 === row.factorySha256,
        'SOURCE_CHANGED', 'This native registration was reviewed with a different provider factory.', 409);
      need(raw.replacesProfileSha256 === undefined || hex(raw.replacesProfileSha256),
        'INPUT_INVALID', 'Confirm the exact prior profile when replacing an alias.');
      if (raw.provider === 'quickbooks')
        need(spec.environment.includes(raw.environment), 'PROFILE_INVALID',
          'Choose the registered QuickBooks sandbox or production environment explicitly.');
      else need(raw.environment === undefined, 'PROFILE_INVALID',
        'Xero accounting does not use a QuickBooks environment selector.');
      const label = text(raw.label ?? spec.label, 'provider label', 160);
      let result;
      try {
        result = await row.native[spec.factory]({
          clientId: raw.clientId, clientSecretEnv: raw.clientSecretEnv,
          callbackOrigin: raw.callbackOrigin, label,
          ...(raw.provider === 'quickbooks' ? {environment: raw.environment} : {}),
        });
        const normalized = profile.normalizeOAuthProfile(result,
          {allowLoopback: context?.allowLoopbackOAuth === true});
        need(same(normalized, result) && result.source.sha256 === row.source.sha256 &&
          result.source.scheme === row.source.scheme && result.provider?.kind === spec.kind,
          'PROFILE_INVALID', 'The original native provider returned a different registered source.');
      } catch (error) {
        if (error.code?.startsWith('OAUTH_SETUP_')) throw error;
        need(false, 'PROFILE_INVALID',
          'Use the original registered client, named client-secret reference and exact callback origin.');
      }
      const profileSha256 = profile.oauthProfileIdentity(result);
      callbackUri(result, profileSha256, context?.port);
      const definition = {provider: raw.provider, alias: raw.alias, directoryEnv: raw.directoryEnv,
        sourceId: row.source.sha256, factorySha256: row.factorySha256, label: result.label,
        clientId: result.clientId, clientSecretEnv: result.clientSecretEnv,
        callbackOrigin: result.callbackOrigin,
        ...(raw.provider === 'quickbooks' ? {environment: result.provider.environment} : {}),
        ...(raw.replacesProfileSha256 === undefined ? {} :
          {replacesProfileSha256: raw.replacesProfileSha256})};
      return {definition, profile: result, profileSha256, sourceId: row.source.sha256};
    },
  });
}
