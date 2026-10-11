/**
 * SF85: import a genuine operator-provided HTTP response header dump.
 * Unlike capture.mjs this adapter makes NO network request and never asserts
 * that it established TLS or determined when the response was captured.
 * SPDX-License-Identifier: MIT
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs as validateExistingCaptureArgs } from './capture.mjs';
import { parseHeaderTrace } from './header-trace.mjs';
import { inspectBytes } from '../sf84-mpp-market-intake/inspect.mjs';

export function parseImportArgs(argv) {
  const index = argv.indexOf('--headers-file');
  if (index < 0 || index + 1 >= argv.length || !argv[index + 1]
      || argv.lastIndexOf('--headers-file') !== index) {
    throw Object.assign(new Error('MISSING_OR_DUPLICATE_HEADERS_FILE'), { code: 'MISSING_OR_DUPLICATE_HEADERS_FILE' });
  }
  const headersFile = argv[index + 1];
  if (!isAbsolute(headersFile) || headersFile.includes('\0')) {
    throw Object.assign(new Error('HEADERS_FILE_MUST_BE_ABSOLUTE'), { code: 'HEADERS_FILE_MUST_BE_ABSOLUTE' });
  }
  const rest = [...argv.slice(0, index), ...argv.slice(index + 2)];
  const { target, method, out } = validateExistingCaptureArgs(rest);
  if (headersFile === out) {
    throw Object.assign(new Error('SOURCE_AND_OUTPUT_MUST_DIFFER'), { code: 'SOURCE_AND_OUTPUT_MUST_DIFFER' });
  }
  return { headersFile, target, method, out };
}

export function run(argv) {
  const args = parseImportArgs(argv);
  const trace = parseHeaderTrace(readFileSync(args.headersFile));
  const capture = {
    schema: 'scf.sf85.capture.v1',
    captureSource: 'operator-exported-http-response-headers',
    // A file import cannot establish when the original HTTP call occurred.
    collectedAtUtc: null,
    importedAtUtc: new Date().toISOString(),
    sourceHeaderSha256: trace.sourceHeaderSha256,
    sourceHeaderBytes: trace.sourceHeaderBytes,
    discardedPreludeBlocks: trace.discardedPreludeBlocks,
    url: args.target.href,
    // Asserted by the operator. The server response dump has no request line.
    method: args.method,
    requestMethodSource: 'operator-declared',
    status: trace.status,
    headers: trace.headers,
  };
  const bytes = Buffer.from(JSON.stringify(capture, null, 2) + '\n', 'utf8');
  const report = inspectBytes(bytes);
  // Fail before writing on malformed intake. Never clobber prior evidence.
  writeFileSync(args.out, bytes, { flag: 'wx', mode: 0o600 });
  return {
    originalCapture: args.out,
    sourceHeaderSha256: trace.sourceHeaderSha256,
    capturedSha256: report.capturedSha256,
    httpStatus: report.httpStatus,
    classification: report.classification,
    x402: { status: report.x402.status, optionCount: report.x402.offer?.optionCount ?? 0, error: report.x402.error },
    mpp: { status: report.mpp.status, challengeCount: report.mpp.challenges.length, error: report.mpp.error },
    review: report.review,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { console.log(JSON.stringify(run(process.argv.slice(2)), null, 2)); }
  catch (error) {
    console.error('SF85_HEADER_IMPORT_ERROR: ' + (error.code ?? 'FILE_OR_RUNTIME_ERROR'));
    process.exitCode = 2;
  }
}
