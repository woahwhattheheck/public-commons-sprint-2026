// MIT. One original SF30 job owner with n8n execution review and recovery.
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openJobMerchant } from '../jobs/model.mjs';
import { startJobSeller } from '../jobs/merchant.mjs';
import { startCustomerServer } from '../jobs/customer.mjs';
import { startJobsWorkspace } from '../jobs/workspace/server.mjs';
import { inspectN8nMerchant } from './prepare.mjs';
import { listDispatches, readDispatch } from './store.mjs';
import { reconcileN8nJob, authorizeN8nRerun } from './runtime.mjs';
import { fail } from './config.mjs';
import { startN8nWorkspace } from './workspace/server.mjs';

export async function openN8nMerchant(directory, { env = process.env } = {}) {
  directory = resolve(directory);
  const prepared = await inspectN8nMerchant(directory, { env });
  const model = await openJobMerchant({ configPath: join(directory, 'merchant.json'),
    directory: prepared.record.jobDirectory, env });
  const dispatchDirectory = prepared.record.dispatchDirectory;
  return {
    model, directory, prepared, services: {},
    async snapshot() {
      return { schema: 'stellar-forge.n8n-merchant-workspace.v1',
        configuration: { configurationSha256: prepared.configurationSha256,
          normalized: prepared.normalized, environment: prepared.environment },
        jobs: await model.snapshot(), dispatches: await listDispatches(dispatchDirectory), services: this.services };
    },
    async exportState() {
      const state = await this.snapshot();
      return { ...state, exportedAt: new Date().toISOString(), jobs: { ...state.jobs,
        jobs: await Promise.all(state.jobs.jobs.map(row => model.get(row.id))) } };
    },
    async get(id) { return { job: await model.get(id), dispatch: await readDispatch(dispatchDirectory, id) }; },
    async reconcile(id, decision) {
      const job = await model.get(id);
      return reconcileN8nJob(prepared.normalized, dispatchDirectory, job, decision, { env });
    },
    async authorizeRerun(id, decision) {
      const job = await model.get(id);
      if (job.revision !== decision.jobRevision) fail('REVISION', 'Refresh the original paid job before authorizing another workflow run.', 409);
      if (!job.settlement) fail('PAYMENT_REQUIRED', 'The original job must have its native settlement before retrying.', 409);
      const dispatch = await authorizeN8nRerun(prepared.normalized, dispatchDirectory, job, decision, { env });
      const resumed = await model.retry({ id, expectedRevision: job.revision, reason: decision.reason });
      return { dispatch, job: resumed };
    },
    close: () => model.close(),
  };
}

export async function serveN8nMerchant({ directory, env = process.env, nativeFactory, nativeFactoryPath,
  sellerPort = 0, customerPort = 0, operatorPort = 0, operationsPort = 0, jobsOperatorPort = 0,
  startWorker = false } = {}) {
  const merchant = await openN8nMerchant(directory, { env });
  const sessions = []; let closing;
  const close = () => closing ??= (async () => {
    const errors = [];
    for (const session of [...sessions].reverse()) {
      try { await session.close(); } catch (error) { errors.push(error); }
    }
    try { await merchant.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'The original merchant did not finish closing.');
  })();
  try {
    if (nativeFactoryPath) {
      const module = await import(pathToFileURL(resolve(nativeFactoryPath)).href);
      nativeFactory = module.nativeFactory ?? module.default;
      if (typeof nativeFactory !== 'function') fail('NATIVE_FACTORY', 'The selected module must export the original native factory.');
    }
    const seller = await startJobSeller(merchant.model, { port: sellerPort, operationsPort, nativeFactory });
    sessions.push(seller);
    const customer = await startCustomerServer({ model: merchant.model, port: customerPort });
    sessions.push(customer);
    const jobsOperator = await startJobsWorkspace({ model: merchant.model, port: jobsOperatorPort });
    sessions.push(jobsOperator);
    merchant.services = { seller: seller.url ?? seller.seller?.url, customer: customer.url ?? customer.origin,
      operations: seller.operations?.url, jobsOperator: jobsOperator.url };
    const workspace = await startN8nWorkspace({ merchant, port: operatorPort });
    sessions.push(workspace);
    if (startWorker) await merchant.model.startWorker();
    return { merchant, workspace, ...merchant.services, url: workspace.url, close };
  } catch (error) { await close().catch(() => {}); throw error; }
}
