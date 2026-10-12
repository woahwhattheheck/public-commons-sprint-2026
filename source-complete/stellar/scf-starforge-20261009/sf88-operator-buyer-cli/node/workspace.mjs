// MIT — The existing native application bridge owns workspace binding and keys.
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { absolute, object, need, jsonBytes, writeBytes } from './store.mjs';

const bridge = buyer => join(buyer.runtime.directory, 'python', 'bridge.mjs');

export async function readWorkspace(buyer, directory, { configuration, signal } = {}) {
  directory = absolute(directory);
  let temporary, configurationPath;
  try {
    if (configuration !== undefined) {
      if (typeof configuration === 'string') configurationPath = absolute(configuration);
      else {
        need(object(configuration), 'WORKSPACE_REQUEST_CONFIGURATION_REQUIRED');
        const raw = jsonBytes(configuration);
        need(raw.length <= 65536, 'CONFIG_SIZE_LIMIT');
        temporary = await mkdtemp(join(buyer.stateDirectory, '.workspace-import-'));
        configurationPath = join(temporary, 'request.json');
        await writeBytes(configurationPath, raw, { exclusive: true });
      }
    }
    const native = await buyer.runtime.checked(['workspace-read', '--dir', directory,
      ...(configurationPath === undefined ? [] : ['--config', configurationPath])], {
      stateDirectory: buyer.stateDirectory, entryFile: bridge(buyer), signal,
      mode: 'ORIGINAL_PYTHON_WORKSPACE',
    });
    need(native.directory === directory && object(native.configuration) &&
      native.keyCustody === 'ORIGINAL_NODE_WORKSPACE', 'ORIGINAL_WORKSPACE_RESULT_MISMATCH');
    return { directory, configuration: native.configuration };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

export function workspaceCommand(buyer, { directory, configPath, ticketSha256 }, check = false) {
  return { entryFile: bridge(buyer), args: [check ? 'workspace-check' : 'execute-workspace',
    '--dir', absolute(directory), '--config', absolute(configPath),
    '--ticket-sha', ticketSha256 ?? 'none'] };
}

export async function checkWorkspace(buyer, context, { intentId, signal } = {}) {
  const command = workspaceCommand(buyer, context, true);
  const native = await buyer.runtime.checked(command.args, {
    stateDirectory: buyer.stateDirectory, entryFile: command.entryFile, signal,
    mode: 'ORIGINAL_PYTHON_WORKSPACE_READY',
  });
  need(native.intentId === intentId && native.keyCustody === 'ORIGINAL_NODE_WORKSPACE',
    'ORIGINAL_WORKSPACE_RESULT_MISMATCH');
  return native;
}
