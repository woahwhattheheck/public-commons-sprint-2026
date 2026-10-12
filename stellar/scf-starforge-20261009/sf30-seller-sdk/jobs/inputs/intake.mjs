// MIT. File preparation uses the original intake access and original request capability.
import { canonical, need, HASH, object } from '../intake/protocol.mjs';
import { validateFilePolicy, validateFile, validateUploadPlan, uploadIdentity, fileTokenHash,
  STATUS_SCHEMA } from './protocol.mjs';

export function createInputIntake({ model, catalog, authorized }) {
  const store = model.inputs;
  if (!store) return null;
  function claim(token) { fileTokenHash(token); return token; }
  return Object.freeze({
    async begin(request, { token, accessToken } = {}) {
      claim(token);
      need(object(request) && Object.keys(request).every(key =>
        ['catalogSha256', 'functionSha256', 'plan'].includes(key)) &&
        HASH.test(request.catalogSha256 ?? '') && HASH.test(request.functionSha256 ?? ''),
        'JOB_INPUT_UPLOAD_REQUEST_INVALID');
      const plan = validateUploadPlan(request.plan), id = uploadIdentity(plan);
      need(plan.origin === catalog.publicOrigin, 'JOB_INPUT_MERCHANT_CHANGED', 409);
      try {
        const original = store.plan(id, token);
        need(canonical(original) === canonical(plan), 'JOB_INPUT_UPLOAD_PLAN_CHANGED', 409);
        // Original capabilities can resume their exact retained upload after a
        // general access key rotates. They cannot select a new function or file.
        return store.begin({ plan, token });
      } catch (error) { if (error.code !== 'JOB_INPUT_UPLOAD_NOT_FOUND') throw error; }
      need(authorized(accessToken), 'JOB_INTAKE_ACCESS_DENIED', 401);
      const definition = catalog.functions.find(value => value.id === plan.functionId);
      need(definition && request.catalogSha256 === catalog.catalogSha256 &&
        definition.functionSha256 === request.functionSha256, 'JOB_INTAKE_CATALOG_CHANGED', 409);
      need(definition.inputFiles, 'JOB_INPUT_FUNCTION_FILES_NOT_CONFIGURED', 422);
      validateFile(plan.file, validateFilePolicy(definition.inputFiles), plan.slot);
      return store.begin({ plan, token });
    },
    status(id, token) { return store.status(id, claim(token)); },
    writeChunk(options) { return store.writeChunk({ ...options, token: claim(options.token) }); },
    finish(options) { return store.finish({ ...options, token: claim(options.token) }); },
    discard(options) {
      return store.discard({ id: options.id, token: claim(options.token), expectedRevision: options.expectedRevision });
    },
  });
}
