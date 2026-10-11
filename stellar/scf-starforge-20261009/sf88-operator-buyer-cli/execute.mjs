// MIT — SF88 privileged operator execution delegates to original source modules.
import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { OperatorApprovedBuyer } from '../sf81-buyer-operator-bridge/bridge.mjs';
import { executeWithEvidence } from '../sf82-checkout-evidence/evidence.mjs';
import { prepareBuyerResponseFile } from '../sf31-buyer-client/response-file.mjs';
import { execution, bytes, need } from './config.mjs';

const codeOf = (error, fallback) => {
  const value = error?.code ?? error?.message;
  return typeof value === 'string' && /^[A-Z0-9_]{1,120}$/.test(value) ? value : fallback;
};
const fileFailure = error => ({ status:'FAILED',
  code:codeOf(error, 'RESPONSE_FILE_FAILED'), bytes:error?.bytes ?? 0,
  partialPath:error?.partialPath ?? null, cleanupWarnings:error?.cleanupWarnings ?? [],
});
const reservationOf = value => {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const key of ['request_id','outcome','network','reserved_atomic_units'])
    if (typeof value[key] === 'string' && value[key].length <= 160) result[key] = value[key];
  return Object.keys(result).length ? result : null;
};

export async function execute(cfg, { signal } = {}) {
  need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
  const { op, owner, download:responseFile } = execution(cfg);
  const directory = await stat(cfg.evidenceDir);
  need(directory.isDirectory() && (process.platform === 'win32' ||
    (directory.mode & 0o077) === 0), 'PRIVATE_EVIDENCE_DIRECTORY_REQUIRED');
  const signerFile = await stat(cfg.signerModule);
  need(signerFile.isFile(), 'SIGNER_MODULE_MUST_EXIST');
  const body = op.bodyFile === undefined ? undefined :
    Uint8Array.from(await bytes(op.bodyFile, 1048576, 'REQUEST_BODY_INVALID'));
  need(!signal?.aborted, 'OPERATOR_ABORTED');

  let output, download, delivery, evidence, evidenceError, nativeResult, nativeError;
  let cleanupError, setupError, setupFailed = false;
  try {
    // Refuse an existing/unusable destination before a buyer can run or sign.
    if (responseFile) output = await prepareBuyerResponseFile(responseFile);
    const signer = await import(pathToFileURL(cfg.signerModule).href);
    const sign = signer.sign ?? signer.default?.sign;
    need(typeof sign === 'function', 'TRUSTED_SIGN_FUNCTION_REQUIRED');
    const buyer = new OperatorApprovedBuyer({
      operator: { ...owner, environment: process.env }
    });
    need(!signal?.aborted, 'OPERATOR_ABORTED');
    const recordingBuyer = {
      async call(options) {
        try { nativeResult = await buyer.call(options); }
        catch (error) { nativeError = error; throw error; }
        if (output) {
          // Start at the original return boundary, before SF82 can await RPC.
          // SF31's response deadline includes consumption of this same stream.
          download = output.save(nativeResult, {signal:options.signal}).then(
            saved => ({status:'SAVED', ...saved}),
            error => {
              // The original writer cancels any stream it owns. For rejected
              // non-2xx/unread responses, close the unused stream here as well.
              const body = nativeResult.response?.body;
              if (body && !body.locked && !nativeResult.response.bodyUsed)
                try { void body.cancel().catch(() => {}); } catch {}
              return {...fileFailure(error), destination:output.destination};
            },
          );
        }
        return nativeResult;
      },
    };
    try {
      evidence = await executeWithEvidence({
        buyer:recordingBuyer,
        call: {
          intentId:op.intentId, url:op.url, method:op.method,
          headers:op.headers, expect:op.expect, body,
          sign: args => sign(args), ...(signal ? {signal} : {}),
        },
        outputDir:cfg.evidenceDir,
        trustedPayer:cfg.trustedPayer,
        // The file writer consumes the original body once; no cloned-body race.
        captureBody:output ? false : cfg.captureBody ?? false,
        bodyCaptureTimeoutMs:cfg.bodyCaptureTimeoutMs ?? 15000,
      });
    } catch (error) {
      evidenceError = error;
      // A failed evidence pipeline must not leave an incomplete stream running.
      // An already published local file remains saved; payment is never retried.
      if (output) try { await output.abort(); } catch (error) { cleanupError = error; }
    }
    delivery = download ? await download : {
      status:output ? 'NOT_STARTED' : 'NOT_REQUESTED',
      ...(output ? {reason:'NO_BUYER_RESPONSE', destination:output.destination} : {}),
    };
  } catch (error) {
    setupError = error;
    setupFailed = true;
  } finally {
    if (output) try { await output.abort(); } catch (error) { cleanupError ??= error; }
  }
  if (setupFailed) {
    if (cleanupError) {
      const code = codeOf(setupError,'OPERATION_FAILED_RECONCILE_ORIGINAL_LEDGER');
      setupError = Object.assign(new Error(code, {cause:setupError}), {code,
        responseCleanupError:{code:codeOf(cleanupError,'RESPONSE_FILE_CLEANUP_FAILED'),
          cleanupWarnings:cleanupError.cleanupWarnings ?? []}});
    }
    throw setupError;
  }
  if (cleanupError && output) delivery = {...delivery,
    cleanupError:codeOf(cleanupError,'RESPONSE_FILE_CLEANUP_FAILED'),
    cleanupWarnings:cleanupError.cleanupWarnings ?? [],
  };

  const result = evidence?.result ?? nativeResult;
  const error = evidence?.error ?? nativeError;
  const summary = {
    mode:'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT',
    intentId:op.intentId,
    status:result?.status ?? null,
    httpStatus:result?.response?.status ?? null,
    sellerReportedSettlement:result?.settlement ?? null,
    evidencePath:evidence?.evidencePath ?? null,
    originalOutcomeReport:evidence?.report ?? null,
    operatorReservation:reservationOf(result?.operatorReservation ?? error?.operatorReservation),
    ...(output ? {responseFile:delivery} : {}),
    interrupted:signal?.aborted === true,
    retry:'NO_AUTOMATIC_RETRY',
    ...(error ? {error:{code:codeOf(error,'NATIVE_BUYER_ERROR'),
      paymentSent:typeof error.paymentSent === 'boolean' ? error.paymentSent : null}} : {}),
    ...(evidenceError ? {evidenceError:{code:codeOf(evidenceError,'EVIDENCE_FAILED_RECONCILE_ORIGINAL_LEDGER')}} : {}),
    ...(cleanupError ? {responseCleanupError:{code:codeOf(cleanupError,'RESPONSE_FILE_CLEANUP_FAILED'),
      cleanupWarnings:cleanupError.cleanupWarnings ?? []}} : {}),
  };
  process.stdout.write(JSON.stringify(summary,null,2)+'\n');
  if (error || evidenceError) process.exitCode = 2;
  else if (delivery.status === 'FAILED' || delivery.cleanupWarnings?.length || cleanupError) process.exitCode = 3;
  return summary;
}
