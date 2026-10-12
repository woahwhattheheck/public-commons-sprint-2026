#!/usr/bin/env node
// MIT. Complete original SEC operator workspace receiving.
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  reviewEdgarOperator, exportEdgarOperator, inspectEdgarOperatorArchive, receiveEdgarOperator,
} from './operator.mjs';
import { need } from './manifest.mjs';

const HELP = `sec-edgar-workspace review|export|inspect|receive|open
review --workspace DIR [--store DIR]
export --workspace DIR [--store DIR] --out DIR [--review SHA256]
inspect --archive ZIP [--sha256 SHA256]
receive --archive ZIP --sha256 SHA256 --out DIR
open --root DIR [--port N]

Review and export include every original saved revision and imported edition.
The store defaults to WORKSPACE/captures. Supply --store for an external source store.
Receive preserves the original identity and accepts identical history prefixes.
The original Python archive engine requires Python 3.10+; use --python PATH if needed.
`;
export async function main(args = process.argv.slice(2)) {
  const { values: v, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    workspace: { type: 'string' }, store: { type: 'string' }, out: { type: 'string' },
    root: { type: 'string' }, archive: { type: 'string' }, sha256: { type: 'string' },
    review: { type: 'string' }, python: { type: 'string' }, port: { type: 'string' },
    help: { type: 'boolean' },
  } });
  if (v.help || !positionals.length) { process.stdout.write(HELP); return; }
  need(positionals.length === 1 && ['review', 'export', 'inspect', 'receive', 'open'].includes(positionals[0]),
    'EDGAR_PORTABLE_COMMAND_INVALID', HELP);
  const command = positionals[0];
  if (command === 'open') {
    need(v.root, 'EDGAR_PORTABLE_DIRECTORY_REQUIRED', 'Use --root with the complete received directory.');
    const root = resolve(v.root);
    // Validate original files before the native opener can create a new workspace.
    await reviewEdgarOperator({ directory: join(root, 'workspace'), storeDirectory: join(root, 'source-store') });
    const { main: original } = await import('../cli.mjs');
    return original(['workspace', '--workspace', join(root, 'workspace'), '--store', join(root, 'source-store'),
      ...(v.port === undefined ? [] : ['--port', v.port])]);
  }
  let result;
  if (command === 'review' || command === 'export') {
    need(v.workspace, 'EDGAR_PORTABLE_DIRECTORY_REQUIRED', 'Choose the original --workspace directory.');
    const directory = resolve(v.workspace), storeDirectory = resolve(v.store ?? join(directory, 'captures'));
    const input = { directory, storeDirectory, ...(v.python ? { python: v.python } : {}) };
    if (command === 'review') {
      const review = await reviewEdgarOperator(input);
      result = { ...review.summary, manifest: review.manifest };
    } else {
      need(v.out, 'EDGAR_PORTABLE_OUTPUT_REQUIRED', 'Choose --out for the complete retained export.');
      // A repeated named export uses its original review. An explicit --review
      // makes a browser or agent selection exact; new CLI exports review directly.
      let expectedReviewSha256 = v.review;
      if (!expectedReviewSha256) {
        const { completedEdgarOperatorExport } = await import('./operator.mjs');
        try { expectedReviewSha256 = (await completedEdgarOperatorExport({ outputDirectory: resolve(v.out) })).reviewSha256; }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          const { exists, pinnedFile, decodeJson } = await import('./storage.mjs');
          const retained = join(resolve(v.out), 'operator-export-request.json');
          expectedReviewSha256 = await exists(retained)
            ? decodeJson((await pinnedFile(retained, null, 64 * 1024 * 1024)).bytes).reviewSha256
            : (await reviewEdgarOperator(input)).summary.reviewSha256;
        }
      }
      result = await exportEdgarOperator({ ...input, outputDirectory: resolve(v.out), expectedReviewSha256 });
    }
  } else {
    need(v.archive, 'EDGAR_PORTABLE_ARCHIVE_REQUIRED', 'Choose the complete --archive ZIP.');
    const input = { archivePath: resolve(v.archive), expectedArchiveSha256: v.sha256,
      ...(v.python ? { python: v.python } : {}) };
    if (command === 'inspect') result = await inspectEdgarOperatorArchive(input);
    else {
      need(v.out && v.sha256, 'EDGAR_PORTABLE_RECEIVING_REQUIRED', 'Use --sha256 from the export and --out for its receiver.');
      result = await receiveEdgarOperator({ ...input, directory: resolve(v.out) });
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'EDGAR_PORTABLE_COMMAND_FAILED', message: error.message }) + '\n');
    process.exitCode = 1;
  });
}
