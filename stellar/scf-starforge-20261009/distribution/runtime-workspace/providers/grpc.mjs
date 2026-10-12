// MIT. grpc Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { grpcApplication, prepareGrpcApplication, grpcStartup } from "../application-grpc.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "grpc", order: 80,
  catalog({ common, field }) { return [grpcApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareGrpcApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "grpc-workspace"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.grpc-workspace-launch.v1\",")) return null;
      return () => grpcStartup(request, text, directory);
    });
  },
};
