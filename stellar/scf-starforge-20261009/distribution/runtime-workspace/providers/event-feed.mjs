// MIT. event-feed Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { eventFeedApplications, prepareEventFeedApplication, eventFeedOutputReader, eventFeedStartup, verifyEventFeedLaunch } from "../application-event-feed.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "event-feed", order: 120,
  catalog({ common, field }) { return [...eventFeedApplications(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    let eventFeed;
    const selected = await prepareEventFeedApplication(type.id, settings, {
      ...context, runtime: { directory: runtimeDirectory }, inputPath, selectedExecutable,
    });
    args.push(...selected.args); inputs.push(...selected.inputs); eventFeed = selected.identity;
    return { args, inputs, createDirectories,
      ...(eventFeed ? { eventFeed } : {}) };
  },
  matchRequest(request) { return !request.pythonCommand && ['mercury-feed', 'buyer-event-feed'].includes(request.command); },
  verifyLaunch: verifyEventFeedLaunch,
  createObserver(request, directory, context) {
    const parse = eventFeedOutputReader(request);
    return observeApplicationStartup(request, directory, text => {
      return (parse?.(text) ?? []).map(value => () => eventFeedStartup(request, directory, value));
    });
  },
};
