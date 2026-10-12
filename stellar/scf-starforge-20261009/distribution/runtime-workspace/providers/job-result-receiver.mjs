// MIT. job-result-receiver Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { jobResultReceiverApplication, prepareJobResultReceiverApplication, jobResultReceiverStartup } from "../application-job-result-receiver.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "job-result-receiver", order: 200,
  catalog({ common, field }) { return [jobResultReceiverApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    let jobResultReceiver;
    const original = await prepareJobResultReceiverApplication(settings, {
      inputPath, runtimeDirectory, applicationEnvironment,
    });
    args.push(...original.args); inputs.push(...original.inputs); jobResultReceiver = original.identity;
    return { args, inputs, createDirectories,
      ...(jobResultReceiver ? { jobResultReceiver } : {}) };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "jobs" && request.args?.[0] === 'receiver' && request.args?.[1] === 'serve'; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.job-result-receiver-ready.v1\",")) return null;
      return () => jobResultReceiverStartup(request, text);
    });
  },
};
