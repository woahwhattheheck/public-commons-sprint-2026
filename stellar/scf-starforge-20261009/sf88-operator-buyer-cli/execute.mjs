// MIT — SF88 privileged operator execution delegates to original source modules.
import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { OperatorApprovedBuyer } from '../sf81-buyer-operator-bridge/bridge.mjs';
import { executeWithEvidence } from '../sf82-checkout-evidence/evidence.mjs';
import { prepareBuyerResponseFile } from '../sf31-buyer-client/response-file.mjs';
import { execution, bytes, need } from './config.mjs';

export async function execute(cfg) {
  const { op, owner, download } = execution(cfg);
  const directory = await stat(cfg.evidenceDir);
  need(directory.isDirectory() && (process.platform === 'win32' ||
    (directory.mode & 0o077) === 0), 'PRIVATE_EVIDENCE_DIRECTORY_REQUIRED');
  const signerFile = await stat(cfg.signerModule);
  need(signerFile.isFile(), 'SIGNER_MODULE_MUST_EXIST');
  const signer = await import(pathToFileURL(cfg.signerModule).href);
  const sign = signer.sign ?? signer.default?.sign;
  need(typeof sign === 'function', 'TRUSTED_SIGN_FUNCTION_REQUIRED');
  const body = op.bodyFile === undefined ? undefined :
    Uint8Array.from(await bytes(op.bodyFile, 1048576, 'REQUEST_BODY_INVALID'));
  const buyer = new OperatorApprovedBuyer({
    operator: { ...owner, environment: process.env }
  });
  // Prepare before the original buyer can request approval or sign. The writer
  // owns only the local destination; SF36 still owns the payment reservation.
  const output = download ? await prepareBuyerResponseFile(download) : null;
  let responseSave = null, observedResult = null, result = null, evidenceError = null;
  let delivery = output ? { status:'NOT_STARTED', destination:output.destination } : null;
  const savingBuyer = output ? {
    async call(options) {
      const original = await buyer.call(options);
      observedResult = original;
      // Start immediately: the HTTP transport deadline continues while SF82
      // performs independent RPC verification. Handle rejection at once.
      responseSave = output.save(original, { signal:options.signal }).then(
        saved => ({ status:'SAVED', ...saved }),
        error => ({ status:'FAILED', code:error.code ?? 'RESPONSE_FILE_FAILED',
          destination:output.destination, bytes:error.bytes ?? 0,
          partialPath:error.partialPath ?? null, cleanupWarnings:error.cleanupWarnings ?? [] }),
      );
      return original;
    },
  } : buyer;
  try {
    try {
      result = await executeWithEvidence({
        buyer:savingBuyer,
        call: {
          intentId:op.intentId,
          url:op.url,
          method:op.method,
          headers:op.headers,
          expect:op.expect,
          body,
          sign: args => sign(args)
        },
        outputDir:cfg.evidenceDir,
        trustedPayer:cfg.trustedPayer,
        captureBody:cfg.captureBody ?? false,
        bodyCaptureTimeoutMs:cfg.bodyCaptureTimeoutMs ?? 15000
      });
    } catch (error) {
      if (!output) throw error;
      evidenceError = error;
    }
    if (responseSave) delivery = await responseSave;
  } finally {
    if (output) {
      try { await output.abort(); }
      catch (error) {
        delivery = { ...delivery, cleanupWarnings:error.cleanupWarnings ?? [],
          cleanupError:error.code ?? 'RESPONSE_FILE_CLEANUP_FAILED' };
      }
    }
  }
  const original = result?.result ?? observedResult;
  process.stdout.write(JSON.stringify({
    mode:'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT',
    intentId:op.intentId,
    status:original?.status ?? null,
    httpStatus:original?.response?.status ?? null,
    sellerReportedSettlement:original?.settlement ?? null,
    evidencePath:result?.evidencePath ?? null,
    originalOutcomeReport:result?.report ?? null,
    ...(delivery ? { responseFile:delivery } : {}),
    ...(evidenceError ? { evidenceError:{code:'EVIDENCE_RECORDING_FAILED_RECONCILE_ORIGINAL_LEDGER'} } : {}),
    ...(result?.error ? {error:{
      code:result.error.code ?? 'NATIVE_BUYER_ERROR',
      paymentSent:result.error.paymentSent === true}} : {})
  },null,2)+'\n');
  if (result?.error || evidenceError) process.exitCode = 2;
  else if (delivery?.status === 'FAILED' || delivery?.cleanupError || delivery?.cleanupWarnings?.length)
    process.exitCode = 3;
}
