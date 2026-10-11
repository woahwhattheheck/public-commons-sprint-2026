// MIT. One original SF30 service and SF98 native journal over the shared job model.
import { startSellerService } from '../serve.mjs';
import { startSellerOperations } from '../operations/server.mjs';
import { jobError } from './config.mjs';

export async function startJobSeller(model, { port = 8423, nativeFactory = null, operationsPort,
  maxInFlight = 64, drainGraceMs = 60000 } = {}) {
  if (!model?.configuration?.service || typeof model.bindNativeFactory !== 'function')
    throw jobError('JOB_MERCHANT_MODEL_REQUIRED');
  if ((await model.snapshot()).mode !== 'STOPPED') throw jobError('JOB_SELLER_ALREADY_RUNNING', 409);
  model.setSellerStatus({ mode: 'STARTING' });
  let seller, operations, closing;
  const close = () => closing ??= (async () => {
    const failures = [];
    try { await seller?.close(); } catch (error) { failures.push(error); }
    try { await operations?.close(); } catch (error) { failures.push(error); }
    model.setSellerStatus({ mode: 'STOPPED' });
    if (failures.length) throw new AggregateError(failures, 'Job seller shutdown failed');
    return { stopped: true };
  })();
  try {
    const handlers = Object.create(null);
    for (const id of Object.keys(model.configuration.functions)) {
      handlers[id + 'Admission'] = context => model.admitJob(id, context);
      handlers[id + 'Submit'] = context => model.stageJob(id, context);
    }
    seller = await startSellerService({ config: model.configuration.service, port, handlers,
      nativeFactory: nativeFactory === null ? null : model.bindNativeFactory(nativeFactory), maxInFlight, drainGraceMs });
    model.setSellerStatus({ mode: seller.mode, url: seller.url });
    if (operationsPort !== undefined) operations = await startSellerOperations(seller,
      { port: operationsPort, deliveryOutbox: model.deliveryOutbox });
    return { seller, operations, url: seller.url, mode: seller.mode, close };
  } catch (error) { await close().catch(() => {}); model.setSellerStatus({ mode: 'STOPPED' }); throw error; }
}
