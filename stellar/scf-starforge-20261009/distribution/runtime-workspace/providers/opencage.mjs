// MIT. opencage Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { opencageApplication, prepareOpenCageApplication, opencageStartup } from '../application-opencage.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'opencage', order: 50,
  catalog({ common }) { return [opencageApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, runtimeDirectory } = context;
    const { args, inputs, createDirectories } = applicationPreparation(settings, inputPath);
    const original = await prepareOpenCageApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'opencage-workbench';
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.opencage-application-startup.v1\",")) return null;
      return () => opencageStartup(request, text);
    });
  },
};
