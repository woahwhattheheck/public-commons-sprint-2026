// MIT. Input preparation borrows the one original merchant model and its durable store.
import { timingSafeEqual } from 'node:crypto';
import { compileJobIntake } from './config.mjs';
import { CATALOG_SCHEMA, RESPONSE_SCHEMA, REQUEST_PATH, WITHDRAW_PATH, need, sha256,
  functionDigest, catalogDigest, validateCatalog, validateRequest, validateWithdrawal } from './protocol.mjs';

export function createJobIntake({ model, intakeConfig, env = process.env } = {}) {
  need(model && typeof model.createJob === 'function' && typeof model.withdrawPrepared === 'function' &&
    typeof model.customerStatus === 'function',
    'JOB_INTAKE_MERCHANT_REQUIRED');
  const configuration = model.configuration;
  const settings = intakeConfig === undefined ? configuration.intake : compileJobIntake(intakeConfig, configuration.functions);
  if (!settings?.enabled) return null;
  let accessDigest = null;
  if (settings.accessTokenEnvironment) {
    const token = env[settings.accessTokenEnvironment];
    need(typeof token === 'string' && /^[\x21-\x7e]{16,1024}$/.test(token), 'JOB_INTAKE_ACCESS_TOKEN_REQUIRED', 503);
    accessDigest = Buffer.from(sha256(token), 'hex');
  }
  const describe = id => {
    const source = configuration.functions[id];
    const value = { id, description: source.description ?? '', inputSchema: structuredClone(source.inputSchema),
      example: structuredClone(source.example), maxInputBytes: source.maxInputBytes,
      maxOutputBytes: source.maxOutputBytes, timeoutMs: source.timeoutMs,
      output: structuredClone(source.output), payment: structuredClone(source.payment),
      purchaseUrl: source.offer.resource.url };
    return { ...value, functionSha256: functionDigest(value) };
  };
  const functions = settings.functions.map(describe);
  const catalog = { schema: CATALOG_SCHEMA, publicOrigin: configuration.publicOrigin,
    serviceName: configuration.serviceName, authentication: accessDigest ? 'access-token' : 'none',
    requestUrl: configuration.publicOrigin + REQUEST_PATH, withdrawalUrl: configuration.publicOrigin + WITHDRAW_PATH,
    functions };
  catalog.catalogSha256 = catalogDigest(catalog);
  validateCatalog(catalog);
  let tail = Promise.resolve();
  const serial = work => { const pending = tail.then(work); tail = pending.catch(() => {}); return pending; };
  const authorized = token => !accessDigest || typeof token === 'string' && /^[\x21-\x7e]{16,1024}$/.test(token) &&
    timingSafeEqual(accessDigest, Buffer.from(sha256(token), 'hex'));
  return Object.freeze({
    catalog() { return structuredClone(catalog); },
    prepare(input, { accessToken } = {}) {
      const request = validateRequest(input), selected = functions.find(item => item.id === request.functionId);
      const definition = selected ?? (Object.hasOwn(configuration.functions, request.functionId) ? describe(request.functionId) : null);
      need(definition && request.functionSha256 === definition.functionSha256, 'JOB_INTAKE_CATALOG_CHANGED', 409);
      const access = authorized(accessToken), current = selected && request.catalogSha256 === catalog.catalogSha256;
      return serial(async () => {
        if (!access || !current) {
          // Catalog selection and access keys may change while an HTTP reply is
          // lost. Only the capability of an already-existing original job can
          // recover that same request after such a change; it cannot create one.
          let existing;
          try { existing = await model.customerStatus({ id: request.reference, token: request.claimToken }); }
          catch (error) {
            if (error.code !== 'JOB_NOT_FOUND') throw error;
            need(access, 'JOB_INTAKE_ACCESS_DENIED', 401);
            need(false, 'JOB_INTAKE_CATALOG_CHANGED', 409);
          }
          need(existing.functionId === request.functionId, 'JOB_INTAKE_REFERENCE_FUNCTION_CHANGED', 409);
        }
        // Original createJob rechecks input, function and claim on an existing
        // reference, and applies its configured queue/store limits to a new one.
        const handoff = await model.createJob({ functionId: request.functionId, input: request.input,
          label: request.label, reference: request.reference, claimToken: request.claimToken });
        need(handoff.job.label === request.label, 'JOB_INTAKE_REFERENCE_LABEL_CHANGED', 409);
        return { schema: RESPONSE_SCHEMA, reference: request.reference,
          catalogSha256: request.catalogSha256, functionSha256: definition.functionSha256, handoff };
      });
    },
    withdraw(input) {
      const request = validateWithdrawal(input);
      // Original job capability is sufficient to withdraw its still-unsubmitted
      // record even if the merchant rotated the general intake access token.
      return serial(() => model.withdrawPrepared({ id: request.reference, token: request.claimToken,
        expectedRevision: request.expectedRevision, reason: request.reason }));
    },
    async drain() { await tail; },
  });
}
