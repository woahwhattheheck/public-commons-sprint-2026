#!/usr/bin/env node
// MIT. The original route worksheet from a complete saved request file.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openMerchantFileClient } from './retained-download.mjs';
import { downloadOpenApiRouteWorksheet } from './openapi-route-worksheet-client.mjs';
import { sf61Failure as fail, sf61Plain as plain } from './sf61-connection.mjs';
const commands = { inventory: 'merchant_openapi_routes', reconcile: 'merchant_openapi_route_sheet_reconcile',
  review: 'merchant_openapi_route_sheet_review', save: 'merchant_openapi_route_sheet_save' };
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!Object.hasOwn(commands, command) && command !== 'export')
    throw fail('INVALID_PARAMS', 'Choose inventory, reconcile, review, save or export.');
  const allowed = new Set(['--url','--request-file','--token-env',...(command === 'export' ? ['--out','--worksheet-sha256','--chunk-bytes'] : [])]);
  const options = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    if (!allowed.has(rest[index]) || options.has(rest[index]) || typeof rest[index + 1] !== 'string' || rest[index + 1].startsWith('--'))
      throw fail('INVALID_PARAMS', 'Use each declared option once with its value.');
    options.set(rest[index], rest[index + 1]);
  }
  if (!options.get('--url') || !options.get('--request-file')) throw fail('INVALID_PARAMS', 'Provide --url and a complete --request-file.');
  const bytes = await readFile(options.get('--request-file'));
  if (bytes.length > 131072) throw fail('INVALID_PARAMS', 'Keep the request within 128 KiB; declare complete source, plan and worksheet files in the original host configuration.');
  const request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!plain(request)) throw fail('INVALID_PARAMS', 'The request file must contain one original worksheet argument object.');
  const connection = { url: options.get('--url'), tokenEnv: options.get('--token-env') ?? 'MCP_ACCESS_TOKEN' };
  let result;
  if (command === 'export') {
    if (!options.get('--out')) throw fail('INVALID_PARAMS', 'Choose the complete worksheet destination with --out.');
    const { workspace, ...selected } = request;
    result = await downloadOpenApiRouteWorksheet({ ...connection, workspace, request: selected, path: options.get('--out'),
      expectedWorksheetSha256: options.get('--worksheet-sha256'),
      ...(options.has('--chunk-bytes') ? { chunkBytes: Number(options.get('--chunk-bytes')) } : {}) });
  } else {
    const client = await openMerchantFileClient({ ...connection, errorPrefix: 'OPENAPI_WORKSHEET', clientName: 'starforge-route-worksheet-cli' });
    result = await client.call(commands[command], request);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { process.stderr.write(JSON.stringify({ code: error.code ?? 'OPENAPI_WORKSHEET_ERROR', reason: error.message }) + '\n'); process.exitCode = 1; });
