// MIT. mpp Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { mppApplication, prepareMppApplication, mppStartup, MPP_READY_SCHEMA } from "../application-mpp.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "mpp", order: 150,
  appendPort: false,
  catalog({ common, field }) { return [mppApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    let mppBinding;
    const original = await prepareMppApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs); mppBinding = original.binding;
    return { args, inputs, createDirectories,
      ...(mppBinding ? { mppBinding } : {}) };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "mpp"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"' + MPP_READY_SCHEMA + '",')) return null;
      return () => mppStartup(request, text, directory);
    });
  },
};
