// MIT. job-checkout Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { jobCheckoutApplication, validateJobCheckoutSelection, prepareJobCheckoutApplication, jobCheckoutStartup } from "../application-job-checkout.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "job-checkout", order: 290,
  catalog({ common, field }) { return [jobCheckoutApplication(common)]; },
  validateSettings(type, settings) {
    validateJobCheckoutSelection(settings);
  },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareJobCheckoutApplication(settings, runtimeDirectory, inputPath);
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "job-workspace"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.sf88.job-workspace-launch.v1\",")) return null;
      return () => jobCheckoutStartup(request, text);
    });
  },
};
