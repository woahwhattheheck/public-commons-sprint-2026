// MIT. Whole original selection search and complete streaming result export.
import { resolve } from 'node:path';
import { writeApplicationOutputDownload } from './application-output.mjs';
import { need } from './storage.mjs';
const source = ['--workspace', '--operation-id', '--selection', '--query', '--query-file', '--context-bytes'];
const page = ['--cursor', '--limit', '--max-bytes'];
export const outputSearchCommands = {
  'output-search': [...source, '--runtime-id', '--log-file', ...page],
  'output-search-export': [...source, '--runtime-id', '--log-file', '--output'],
  'application-output-search': [...source, '--application-id', ...page],
  'application-output-search-export': [...source, '--application-id', '--output'],
};
export const outputSearchHelp = `
  runtime-workspace output-search --workspace DIRECTORY (--operation-id UUID | --runtime-id ID --log-file FILENAME) (--query TEXT | --query-file UTF8_FILE) [--selection TOKEN] [--cursor TOKEN] [--context-bytes 96] [--limit 100] [--max-bytes 8388608]
  runtime-workspace output-search-export --workspace DIRECTORY (--operation-id UUID | --runtime-id ID --log-file FILENAME) (--query TEXT | --query-file UTF8_FILE) [--selection TOKEN] --output NEW_JSONL
  runtime-workspace application-output-search --workspace DIRECTORY --application-id ID --operation-id UUID (--query TEXT | --query-file UTF8_FILE) [--selection TOKEN] [--cursor TOKEN]
  runtime-workspace application-output-search-export --workspace DIRECTORY --application-id ID --operation-id UUID (--query TEXT | --query-file UTF8_FILE) [--selection TOKEN] --output NEW_JSONL
`;
export async function runOutputSearchCommand(model, command, options) {
  need((options['--query'] !== undefined) !== (options['--query-file'] !== undefined), 'OUTPUT_SEARCH_QUERY_REQUIRED');
  const input = {};
  for (const [flag, name] of [['application-id', 'applicationId'], ['operation-id', 'operationId'], ['runtime-id', 'runtimeId'],
    ['log-file', 'logFile'], ['selection', 'selection'], ['cursor', 'cursor']])
    if (options['--' + flag] !== undefined) input[name] = options['--' + flag];
  if (options['--query-file'] !== undefined) {
    // The query is tiny; read one extra byte, never an arbitrarily large file.
    const { open } = await import('node:fs/promises');
    const handle = await open(resolve(options['--query-file']), 'r');
    try {
      const buffer = Buffer.alloc(4097); let count = 0;
      while (count < buffer.length) {
        const part = await handle.read(buffer, count, buffer.length - count, count);
        if (!part.bytesRead) break; count += part.bytesRead;
      }
      const bytes = buffer.subarray(0, count);
      need(bytes.length > 0 && bytes.length <= 4096, 'OUTPUT_SEARCH_QUERY_INVALID');
      input.query = bytes.toString('utf8');
      need(Buffer.from(input.query).equals(bytes), 'OUTPUT_SEARCH_QUERY_UTF8_INVALID');
    } finally { await handle.close(); }
  } else input.query = options['--query'];
  for (const [flag, name] of [['context-bytes', 'contextBytes'], ['limit', 'limit'], ['max-bytes', 'maxBytes']]) {
    if (options['--' + flag] === undefined) continue;
    need(/^(?:0|[1-9][0-9]*)$/.test(options['--' + flag]) && Number.isSafeInteger(Number(options['--' + flag])),
      'OUTPUT_SEARCH_NUMBER_INVALID');
    input[name] = Number(options['--' + flag]);
  }
  const method = (command.startsWith('application-') ? 'applications' : 'runtime') + 'OutputSearch';
  if (!command.endsWith('-export')) return model[method](input);
  need(options['--output'], 'OUTPUT_SEARCH_DESTINATION_REQUIRED');
  return writeApplicationOutputDownload(await model[method + 'Download'](input), resolve(options['--output']));
}
