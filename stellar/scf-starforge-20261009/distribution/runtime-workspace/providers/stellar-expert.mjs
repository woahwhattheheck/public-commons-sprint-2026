// MIT. stellar-expert Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { stellarExpertApplication, prepareStellarExpertApplication, stellarExpertStartup, STELLAR_EXPERT_READY_SCHEMA } from "../application-stellar-expert.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "stellar-expert", order: 240,
  catalog({ common, field }) { return [stellarExpertApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareStellarExpertApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs); createDirectories.push(...original.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "dataset-workspace" && request.args?.includes('--stellar-expert'); },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"' + STELLAR_EXPERT_READY_SCHEMA + '",')) return null;
      return () => stellarExpertStartup(request, text);
    });
  },
};
