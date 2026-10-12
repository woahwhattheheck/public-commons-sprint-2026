// MIT. cocart Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { cocartApplication, prepareCocartApplication, cocartStartup } from '../application-cocart.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'cocart', order: 230,
  catalog({ common }) { return [cocartApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, runtimeDirectory } = context;
    const { args, inputs, createDirectories } = applicationPreparation(settings, inputPath);
    let selectedResourceKey;
    const original = await prepareCocartApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
    selectedResourceKey = original.resourceKey;
    return { args, inputs, createDirectories,
      ...(selectedResourceKey ? { resourceKey: selectedResourceKey } : {}) };
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'cocart-managed';
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.cocart-workspace-startup.v1\",")) return null;
      return () => cocartStartup(request, text);
    });
  },
};
