#!/usr/bin/env node
// MIT. Offline transport for the original Atlas workspace and original saved bytes.
import { createReadStream } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAtlasWorkspace } from './workspace.mjs';
import { writeWorkspaceTransfer, receiveWorkspaceTransfer, inspectWorkspaceTransfer } from './workspace-transfer.mjs';

const HELP = `Atlas workspace transfer

  node workspace-cli.mjs export  --workspace /private/atlas --output /private/atlas.ndjson
  node workspace-cli.mjs inspect --input /private/atlas.ndjson
  node workspace-cli.mjs receive --input /private/atlas.ndjson --workspace /private/received [--resume]

Export checks the same core-owned file manifest across both passes. Receive creates a new private
workspace; --resume continues only the same transfer and preserves matching files.
Run server.mjs with --workspace /private/received to reopen it in the Atlas browser.
`;
function argumentsFor(argv) {
  if (!argv.length || argv.includes('--help')) return { help: true };
  const [command, ...rest] = argv;
  const accepted = command === 'export' ? ['--workspace', '--output']
    : command === 'receive' ? ['--workspace', '--input', '--resume']
      : command === 'inspect' ? ['--input'] : [];
  if (!accepted.length) throw new Error('Choose export, inspect, or receive');
  const values = { command };
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (!accepted.includes(key) || Object.hasOwn(values, key.slice(2))) throw new Error(`Unexpected option: ${key}`);
    if (key === '--resume') values.resume = true;
    else {
      const value = rest[++i];
      if (!value || !isAbsolute(value)) throw new Error(`${key} requires an absolute path`);
      values[key.slice(2)] = resolve(value);
    }
  }
  for (const key of accepted.filter(key => key !== '--resume'))
    if (!values[key.slice(2)]) throw new Error(`Missing ${key}`);
  return values;
}
export async function runWorkspaceCli(argv = process.argv.slice(2)) {
  const options = argumentsFor(argv);
  if (options.help) { console.log(HELP); return; }
  let workspace, input;
  try {
    let result;
    if (options.command === 'export') {
      workspace = await openAtlasWorkspace({ directory: options.workspace, create: false });
      result = await writeWorkspaceTransfer(workspace, options.output);
    } else {
      input = createReadStream(options.input);
      if (options.command === 'inspect') result = await inspectWorkspaceTransfer(input);
      else {
        result = await receiveWorkspaceTransfer(input, options.workspace, { resume: options.resume });
        workspace = await openAtlasWorkspace({ directory: options.workspace, create: false });
        result.workspace = await workspace.summary();
      }
    }
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally { input?.destroy(); await workspace?.close?.(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runWorkspaceCli().catch(error => {
    console.error(`${error.code ?? 'ATLAS_WORKSPACE_TRANSFER_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  });
