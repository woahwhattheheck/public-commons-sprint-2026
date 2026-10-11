// MIT — SF88 privileged operator execution delegates to original source modules.
import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { OperatorApprovedBuyer } from '../sf81-buyer-operator-bridge/bridge.mjs';
import { executeWithEvidence } from '../sf82-checkout-evidence/evidence.mjs';
import { execution, bytes, need } from './config.mjs';

export async function execute(cfg) {
  const { op, owner } = execution(cfg);
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
  const result = await executeWithEvidence({
    buyer,
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
  process.stdout.write(JSON.stringify({
    mode:'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT',
    intentId:op.intentId,
    status:result.result?.status ?? null,
    httpStatus:result.result?.response?.status ?? null,
    sellerReportedSettlement:result.result?.settlement ?? null,
    evidencePath:result.evidencePath,
    originalOutcomeReport:result.report,
    ...(result.error ? {error:{
      code:result.error.code ?? 'NATIVE_BUYER_ERROR',
      paymentSent:result.error.paymentSent === true}} : {})
  },null,2)+'\n');
  if (result.error) process.exitCode = 2;
}
