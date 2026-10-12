// MIT. s3 Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { s3MerchantApplication, prepareS3MerchantApplication, s3MerchantStartup } from "../application-s3-merchant.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "s3", order: 280,
  catalog({ common, field }) { return [s3MerchantApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareS3MerchantApplication(settings, { ...context, inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "s3" && request.args?.[0] === 'workspace'; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.s3-workspace-startup.v1\",")) return null;
      return () => s3MerchantStartup(request, directory, text, context);
    });
  },
};
