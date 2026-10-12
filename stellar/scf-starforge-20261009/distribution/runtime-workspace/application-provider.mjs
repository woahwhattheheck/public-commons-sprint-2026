// MIT. Shared mechanics for source-owned original Applications adapters.
import { StringDecoder } from 'node:string_decoder';
import { access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { need, plain, saveJSON, now } from './storage.mjs';

export const APPLICATION_PROVIDER_SCHEMA = 'stellar-forge.runtime-application-provider.v1';
export const applicationField = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });
export const applicationCommonFields = Object.freeze([
  applicationField('port', 'Local port', 'port', false,
    'Use 0 to let the original application choose an available port.'),
  applicationField('environmentFile', 'Private environment JSON', 'path', false,
    'Optional private file containing environment names and string values. Values stay on this host.'),
]);

/** Original path and argv helpers for adapters moved out of the shared dispatcher. */
export function applicationPreparation(settings, inputPath) {
  const args = [], inputs = [], createDirectories = [];
  return {
    args, inputs, createDirectories,
    async path(name, kind = 'directory', missing = false, privateOnly = false) {
      if (!settings[name]) return;
      const value = await inputPath(settings[name], kind, missing, privateOnly);
      inputs.push(value); return value;
    },
    option(name, value) {
      if (value !== undefined && value !== '') args.push(name, String(value));
    },
  };
}

/** Keep the original common port, private environment and terminal preparation. */
export async function prepareProviderApplication(provider, type, settings, context) {
  const selected = await provider.prepare(type, settings, context);
  need(plain(selected) && Array.isArray(selected.args) &&
    selected.args.every(value => typeof value === 'string') &&
    Array.isArray(selected.inputs) && Array.isArray(selected.createDirectories),
  'APPLICATION_PROVIDER_PREPARATION_INVALID', 'The ' + provider.id + ' provider returned an invalid original command.');
  if (provider.completeCommand === true) {
    need(selected.command === type.command && selected.terminal === type.terminal,
      'APPLICATION_PROVIDER_COMMAND_CHANGED', 'The original provider command differs from its catalog.');
    return selected;
  }
  const args = [...selected.args], inputs = [...selected.inputs];
  let terminalPython;
  if (type.terminal) {
    terminalPython = await realpath(settings.terminalPython ?? '/usr/bin/python3');
    inputs.push(await context.inputPath(terminalPython, 'file'));
    await access(terminalPython, constants.X_OK);
  }
  if (provider.appendPort !== false && settings.port !== undefined && settings.port !== '')
    args.push('--port', String(settings.port));
  if (settings.environmentFile) inputs.push(await context.inputPath(settings.environmentFile, 'file'));
  const environment = await context.applicationEnvironment(settings.environmentFile);
  return { ...selected, command: type.command, args, inputs, terminal: type.terminal,
    ...(type.terminal ? { terminalPython } : {}),
    ...(settings.environmentFile ?
      { environmentFile: settings.environmentFile, environmentSha256: environment.sha256 } : {}) };
}

export function applicationPrivateUrl(text) {
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
        Number(url.port || 80) < 1 || Number(url.port || 80) > 65535 ||
        url.username || url.password || text.length > 4096) return null;
    return url.href;
  } catch { return null; }
}

/**
 * A provider synchronously reads original normalized startup lines. It returns a URL,
 * {url, original?, links?}, a deferred resolver function, an array of those values, or null.
 * Defer asynchronous source checks so ignored later announcements never run them. Stateful original
 * multi-line readers live in that provider. This one writer retains the first
 * accepted announcement, its original identity and the shared operation ID.
 */
export function observeApplicationStartup(request, directory, readLine, { lineLimit = 16384 } = {}) {
  need(typeof readLine === 'function', 'APPLICATION_PROVIDER_OBSERVER_REQUIRED');
  need(Number.isSafeInteger(lineLimit) && lineLimit >= 1 && lineLimit <= 1024 * 1024,
    'APPLICATION_PROVIDER_LINE_LIMIT_INVALID');
  let buffer = '', seen = false, closed = false, saveError = null, saving = Promise.resolve();
  const decoder = new StringDecoder('utf8');
  function line(value) {
    if (seen || !request.applicationId) return;
    const text = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
    let result;
    try { result = readLine(text); }
    catch (error) { saveError = error; return; }
    for (const selected of Array.isArray(result) ? result : [result]) {
      if (!selected) continue;
      saving = saving.then(async () => {
        if (seen) return;
        const candidate = typeof selected === 'function' ? await selected() : await selected;
        const startup = typeof candidate === 'string' ? { url: candidate } : candidate;
        const url = startup && applicationPrivateUrl(startup.url);
        if (!url) return;
        seen = true;
        await saveJSON(join(directory, 'application-url.json'), {
          schema: 'stellar-forge.application-url.v1', applicationId: request.applicationId,
          operationId: directory.split('/').at(-1), command: request.command,
          source: 'original-command-stdout', observedAt: now(), url,
          ...(Object.hasOwn(startup, 'links') ? { links: startup.links } : {}),
          ...(Object.hasOwn(startup, 'original') ? { original: startup.original } : {}),
        });
      }).catch(error => { if (error.code !== 'EEXIST') saveError = error; });
    }
  }
  return {
    write(bytes) {
      if (!request.applicationId || seen || closed) return;
      buffer += decoder.write(bytes);
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const text of lines) line(text);
      if (buffer.length > lineLimit) buffer = buffer.slice(-lineLimit);
    },
    async close() {
      if (!closed) { closed = true; buffer += decoder.end(); if (buffer) line(buffer); }
      await saving; if (saveError) throw saveError;
    },
  };
}
