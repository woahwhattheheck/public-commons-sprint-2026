#!/usr/bin/env node
/** MIT. Read, export or recover original MCP results without another purchase. */
import {lstat} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SqliteQuoteStore} from './quote-store.mjs';
import {historyPage} from './quote-history.mjs';
import {McpResultStore, importRetainedMcpResult, recoverRetainedMcpResult, readPrivateResultSource} from './result-store.mjs';

const need = (condition, code) => { if (!condition) throw Object.assign(new Error(code), {code}); };
const privateOwned = stat => (stat.mode & 0o077) === 0 &&
  (typeof process.getuid !== 'function' || stat.uid === process.getuid());
const HELP = `Usage: node result-cli.mjs COMMAND --state-dir ABSOLUTE_PRIVATE_DIRECTORY [OPTIONS]

  list     [--limit N] [--cursor CURSOR]
  read     --quote ID [--byte-offset N] [--max-bytes N]
  export   --quote ID --out ABSOLUTE_PRIVATE_FILE
  import   --quote ID --source ORIGINAL_RESULT_FILE [--completion ORIGINAL_STATUS_FILE]
  recover  --quote ID

List, read and export open the existing workspace read-only. Import and recover
take the original writer lease. No command contacts a seller or signs a payment.
Guide: RESULTS.md. Export creates a new file in an existing private directory.`;
export async function runResultCommand(args) {
  const [command, ...rest] = args;
  const fields = {
    list:['--limit','--cursor'], read:['--quote','--byte-offset','--max-bytes'],
    export:['--quote','--out'], import:['--quote','--source','--completion'], recover:['--quote'],
  };
  need(Object.hasOwn(fields, command), 'MCP_RESULT_COMMAND_REQUIRED');
  const options = {}, allowed = new Set(['--state-dir', ...fields[command]]);
  for (let index = 0; index < rest.length; index += 2) {
    need(allowed.has(rest[index]) && rest[index + 1] && !Object.hasOwn(options, rest[index]), 'MCP_RESULT_OPTIONS_INVALID');
    options[rest[index]] = rest[index + 1];
  }
  need(typeof options['--state-dir'] === 'string' && isAbsolute(options['--state-dir']), 'MCP_RESULT_STATE_DIR_REQUIRED');
  const writable = ['import','recover'].includes(command);
  let quotes, results;
  try {
    quotes = new SqliteQuoteStore({directory:options['--state-dir'], readOnly:!writable});
    const records = quotes.load();
    if (command === 'list') {
      const page = historyPage(records.filter(q => q.result?.responseFile?.status === 'SAVED'), {
        limit:Number(options['--limit'] ?? 25), cursor:options['--cursor'],
      }, q => ({quoteId:q.quoteId, status:q.status, toolName:q.invocation?.toolName,
        paymentResponse:q.result.paymentResponse ?? null, responseFile:q.result.responseFile}));
      return {results:page.quotes, total:page.total, nextCursor:page.nextCursor};
    }
    const quote = records.find(q => q.quoteId === options['--quote']);
    need(quote, 'QUOTE_UNKNOWN');
    results = new McpResultStore({directory:join(quotes.directory,'results'), readOnly:!writable});
    if (command === 'read') return await results.read(quote, {
      byteOffset:Number(options['--byte-offset'] ?? 0), maxBytes:Number(options['--max-bytes'] ?? 32768),
    });
    if (command === 'export') {
      const target = options['--out'];
      need(typeof target === 'string' && isAbsolute(target), 'MCP_RESULT_ABSOLUTE_DESTINATION_REQUIRED');
      const parent = await lstat(dirname(target));
      need(parent.isDirectory() && !parent.isSymbolicLink() && privateOwned(parent), 'MCP_RESULT_PRIVATE_DESTINATION_REQUIRED');
      const file = results.file(quote);
      return {quoteId:quote.quoteId, saved:await file.saveAs(target),
        bytes:file.metadata.bytes, sha256:file.metadata.sha256, representation:file.metadata.representation};
    }
    if (command === 'import') return await importRetainedMcpResult({quoteStore:quotes, resultStore:results,
      quoteId:quote.quoteId, bytes:await readPrivateResultSource(options['--source']),
      ...(options['--completion'] ? {completion:JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(
        await readPrivateResultSource(options['--completion'])))} : {})});
    return await recoverRetainedMcpResult({quoteStore:quotes, resultStore:results, quoteId:quote.quoteId});
  } finally { try { await results?.close(); } finally { quotes?.close(); } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    process.stdout.write(args.length === 1 && args[0] === '--help' ? HELP + '\n' :
      JSON.stringify(await runResultCommand(args), null, 2) + '\n');
  }
  catch (error) { process.stderr.write(`MCP result: ${error.code ?? 'OPERATION_FAILED'}: ${error.message}\n`); process.exitCode = 2; }
}
