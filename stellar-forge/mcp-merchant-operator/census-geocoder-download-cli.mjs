// MIT. Complete Census edition receiving with the original merchant and dataset engines.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectCensusGeocoderEdition, downloadCensusGeocoderEdition,
  reopenCensusGeocoderDownload, queryCensusGeocoderDownload } from './census-geocoder-download.mjs';

const HELP = 'Census complete edition receiver\n\n' +
  '  starforge census-geocoder-download inspect --url MCP_URL --workspace ALIAS --edition UUID\n' +
  '  starforge census-geocoder-download download --url MCP_URL --workspace ALIAS --edition UUID --out DIRECTORY\n' +
  '  starforge census-geocoder-download reopen --dir DIRECTORY\n' +
  '  starforge census-geocoder-download query --dir DIRECTORY [--query URL_QUERY]\n\n' +
  'Remote options: --token-env NAME (default MCP_ACCESS_TOKEN), --workspace-id ORIGINAL_UUID,\n' +
  '                --manifest-sha256 REVIEWED_SHA256\n' +
  'Download option: --chunk-bytes 1..196608\n' +
  'Local options: --workspace-id ORIGINAL_UUID, --edition ORIGINAL_UUID,\n' +
  '               --manifest-sha256 REVIEWED_SHA256\n\n' +
  'Start the original Census managed application or open its native MCP workspace first.\n' +
  'Inspect returns the exact native workspace/edition/snapshot and manifest digest.\n' +
  'Download receives every source, review, dataset and optional seller file. Run the\n' +
  'same command with the same output directory to resume a durable partial prefix;\n' +
  'a changed port is accepted only for the same original workspace and edition.\n' +
  'Reopen and query use the original native edition/dataset parsers locally.\n' +
  'Bearer credentials come from the selected environment variable, never a CLI value.\n' +
  'These commands do not capture source, publish a seller or run a payment.\n';

function problem(message) {
  return Object.assign(new TypeError(message), { code: 'CENSUS_GEOCODER_DOWNLOAD_CONFIGURATION' });
}
function parse(args) {
  if (args.includes('--help') || args.includes('-h') || args.length === 0) return { help: true };
  const [command, ...tail] = args;
  if (!['inspect', 'download', 'reopen', 'query'].includes(command)) throw problem('Choose inspect, download, reopen or query; use --help.');
  const remote = ['inspect', 'download'].includes(command);
  const allowed = new Set(remote
    ? ['--url', '--workspace', '--edition', '--workspace-id', '--token-env', '--manifest-sha256',
      ...(command === 'download' ? ['--out', '--chunk-bytes'] : [])]
    : ['--dir', '--workspace-id', '--edition', '--manifest-sha256', ...(command === 'query' ? ['--query'] : [])]);
  const values = new Map();
  for (let index = 0; index < tail.length; index += 2) {
    const key = tail[index], value = tail[index + 1];
    if (!allowed.has(key) || values.has(key) || value === undefined || value.startsWith('--'))
      throw problem('Use each supported option once with its value; use --help.');
    values.set(key, value);
  }
  for (const key of remote ? ['--url', '--workspace', '--edition', ...(command === 'download' ? ['--out'] : [])] : ['--dir'])
    if (!values.get(key)) throw problem('Supply ' + key + '.');
  const options = {
    ...(values.has('--workspace-id') ? { expectedWorkspaceId: values.get('--workspace-id') } : {}),
    ...(values.has('--manifest-sha256') ? { expectedManifestSha256: values.get('--manifest-sha256') } : {}),
    ...(remote ? { url: values.get('--url'), workspace: values.get('--workspace'), editionId: values.get('--edition'),
      tokenEnv: values.get('--token-env') ?? 'MCP_ACCESS_TOKEN' }
      : { directory: values.get('--dir'), ...(values.has('--edition') ? { expectedEditionId: values.get('--edition') } : {}) }),
  };
  if (command === 'download') {
    options.directory = values.get('--out');
    if (values.has('--chunk-bytes')) {
      const raw = values.get('--chunk-bytes');
      if (!/^[1-9][0-9]{0,5}$/.test(raw) || Number(raw) > 196608) throw problem('Chunk size must be an integer from 1 through 196608.');
      options.chunkSize = Number(raw);
    }
  }
  if (command === 'query') options.query = values.get('--query') ?? '';
  return { command, options };
}
export async function main(args = process.argv.slice(2)) {
  const selected = parse(args);
  if (selected.help) { process.stdout.write(HELP); return; }
  const controller = new AbortController();
  const interrupt = signal => controller.abort(Object.assign(new Error('Census file receiving interrupted by ' + signal +
    '. Reuse the original download directory to continue.'), { code: 'CENSUS_GEOCODER_DOWNLOAD_INTERRUPTED' }));
  const sigint = () => interrupt('SIGINT'), sigterm = () => interrupt('SIGTERM');
  process.once('SIGINT', sigint); process.once('SIGTERM', sigterm);
  try {
    const functions = { inspect: inspectCensusGeocoderEdition, download: downloadCensusGeocoderEdition,
      reopen: reopenCensusGeocoderDownload, query: queryCensusGeocoderDownload };
    const result = await functions[selected.command]({ ...selected.options, signal: controller.signal,
      ...(selected.command === 'download' ? { onProgress: progress => process.stderr.write(JSON.stringify(progress) + '\n') } : {}) });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.response?.status >= 400) process.exitCode = 2;
    return result;
  } finally { process.off('SIGINT', sigint); process.off('SIGTERM', sigterm); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ code: error.code ?? 'CENSUS_GEOCODER_DOWNLOAD_FAILED', message: error.message }) + '\n');
    process.exitCode = 2;
  });
}
