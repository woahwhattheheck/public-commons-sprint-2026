// MIT. merchant-support Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { merchantSupportApplication, prepareMerchantSupportApplication, merchantSupportStartup } from '../application-merchant-support.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'merchant-support', order: 70,
  catalog({ common }) { return [merchantSupportApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, runtimeDirectory } = context;
    const { args, inputs, createDirectories } = applicationPreparation(settings, inputPath);
    const original = await prepareMerchantSupportApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'support-console';
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.support-console-launch.v1\",")) return null;
      return () => merchantSupportStartup(request, text);
    });
  },
};
