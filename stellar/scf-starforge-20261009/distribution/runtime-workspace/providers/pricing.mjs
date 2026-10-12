// MIT. pricing Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { pricingApplication, validatePricingSelection, preparePricingApplication, pricingStartup } from "../application-pricing.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "pricing", order: 310,
  catalog({ common, field }) { return [pricingApplication(common)]; },
  validateSettings(type, settings) {
    validatePricingSelection(settings);
  },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const prepared = await preparePricingApplication(settings, { ...context, inputPath, runtimeDirectory });
    args.push(...prepared.args); inputs.push(...prepared.inputs); createDirectories.push(...prepared.createDirectories);
    return { ...prepared, args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "revenue-workspace"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      return () => pricingStartup(request, text);
    });
  },
};
