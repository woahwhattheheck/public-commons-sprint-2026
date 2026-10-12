// MIT. redis Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { redisApplication, prepareRedisApplication, redisStartup } from "../application-redis.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "redis", order: 250,
  catalog({ common, field }) { return [redisApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareRedisApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "redis"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.redis-workspace-startup.v1\",")) return null;
      return () => redisStartup(request, text);
    });
  },
};
