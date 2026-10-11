// Published @nostr-agx/cli 0.3.0 calls custom(payload, task), preserving task.from.
import { authorizedJob } from './provider.mjs';
import { SHA, need, ERROR_SCHEMA, PART_SCHEMA } from './custody.mjs';
export function createHandlers(root) {
  const bind = (fields, operation) => async (payload, task) => {
    try {
      need(task && typeof task.from === 'string' && SHA.test(task.from), 'AUTHENTICATED_TASK_REQUIRED');
      need(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).every(key => fields.includes(key)), 'INVALID_REQUEST');
      const service = await authorizedJob(root, task.from, payload);
      return await operation(service, payload);
    } catch (error) {
      const privateFailure = ['ENOENT', 'ELOOP', 'ENOTDIR', 'INVALID_PEER', 'PRIVATE_DIRECTORY_REQUIRED', 'DIRECTORY_SYMLINK_REJECTED'].includes(error.code);
      const code = privateFailure ? 'JOB_UNAVAILABLE' : /^[A-Z][A-Z0-9_]{1,80}$/.test(error.code ?? '') ? error.code : 'JOB_REQUEST_FAILED';
      return { schema: ERROR_SCHEMA, state: 'REJECTED', error: { code } };
    }
  };
  const jobFields = ['jobId', 'bundleId'];
  return Object.freeze({
    'finance.reconcile': bind(jobFields, (service, p) => service.execute(p)),
    'finance.reconcile.status': bind(jobFields, async (service, p) => {
      const job = await service.getJob(p.jobId);
      need(job.bundleId === p.bundleId, 'JOB_INPUT_CONFLICT');
      return job;
    }),
    'finance.report': bind([...jobFields, 'reportSha256', 'offset', 'length'], async (service, p) => {
      const job = await service.getJob(p.jobId);
      need(job.bundleId === p.bundleId, 'JOB_INPUT_CONFLICT');
      return { schema: PART_SCHEMA, bundleId: p.bundleId, ...await service.readReportChunk(p) };
    }),
  });
}
export default createHandlers(process.env.ERP_AGX_ROOT);
