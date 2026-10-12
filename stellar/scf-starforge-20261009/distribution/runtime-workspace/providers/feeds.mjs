// MIT. feeds Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { rssAtomApplication, prepareRssAtomApplication, rssAtomStartup } from "../application-rss-atom.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "feeds", order: 390,
  catalog({ common, field }) { return [rssAtomApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareRssAtomApplication(settings, {
      inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment,
    });
    args.push(...original.args); inputs.push(...original.inputs);
    return { args, inputs, createDirectories };
  },
  resourceKey(type, settings, { hash }) { return hash({ family: 'xml', directory: settings.workspaceDirectory }); },
  matchRequest(request) { return !request.pythonCommand && request.command === "dataset-feeds"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{')) return null;
      return () => rssAtomStartup(request, text);
    });
  },
};
