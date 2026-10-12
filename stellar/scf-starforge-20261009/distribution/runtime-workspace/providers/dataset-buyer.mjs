// MIT. dataset-buyer Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { datasetBuyerApplication, prepareDatasetBuyerApplication, datasetBuyerStartup } from "../application-dataset-buyer.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "dataset-buyer", order: 300,
  catalog({ common, field }) { return [datasetBuyerApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const prepared = await prepareDatasetBuyerApplication(settings, { inputPath, selectedExecutable, runtimeDirectory });
    args.push(...prepared.args); inputs.push(...prepared.inputs); createDirectories.push(...prepared.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "buyer-dataset-workspace"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      return datasetBuyerStartup(request, text);
    });
  },
};
