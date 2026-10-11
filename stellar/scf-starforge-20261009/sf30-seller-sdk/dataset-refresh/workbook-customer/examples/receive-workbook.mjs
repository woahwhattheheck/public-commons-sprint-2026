// MIT. Complete customer composition around one original native Buyer/session.
import { WorkbookCustomer, WorkbookAnalysis } from '../index.mjs';
import { need } from '../../../../sf88-operator-buyer-cli/node/store.mjs';

/** Host application entrypoint. All paths are absolute; buyer is the original
 * initialized Node Buyer. sessionDirectory reuses the team's same acquisition.
 */
export async function receiveWorkbook({buyer, packetDirectory, reviewFile, configFile,
  datasetId, sessionDirectory, acquisition, deliveryDirectory, portableDirectory,
  analysis:analysisOptions, signal, progress} = {}) {
  const customer = await WorkbookCustomer.create({directory:packetDirectory,
    reviewFile, configFile, datasetId, buyer});
  const initialized = sessionDirectory === undefined
    ? await customer.initialize({...acquisition, signal})
    : await customer.attach({session:sessionDirectory, signal});
  let acquisitionResult = await customer.inspect({signal});
  if (acquisitionResult.native.status !== 'COMPLETE') {
    acquisitionResult = await customer.run({signal});
    need(acquisitionResult.native.status === 'COMPLETE', 'WORKBOOK_ORIGINAL_ACQUISITION_INCOMPLETE');
  }
  const delivery = await customer.deliver(deliveryDirectory, {signal});
  const portable = await delivery.copyTo(portableDirectory, {signal, progress});
  let analysisResult = null;
  if (analysisOptions !== undefined) {
    const {database, alias, ...request} = analysisOptions;
    const analysis = new WorkbookAnalysis({customer, room:deliveryDirectory, alias});
    try {
      if (database !== undefined) await analysis.register(database);
      analysisResult = await analysis.receive({...request, signal, progress});
    } finally { await analysis.close(); }
  }
  return {customer, initialized, acquisitionResult, delivery, portable, analysisResult};
}
