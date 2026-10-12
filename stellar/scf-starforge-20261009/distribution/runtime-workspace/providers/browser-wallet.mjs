// MIT. browser-wallet Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { browserWalletApplication, prepareBrowserWalletApplication, browserWalletOutputReader, browserWalletStartup, verifyBrowserWalletLaunch } from "../application-browser-wallet.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "browser-wallet", order: 380,
  catalog({ common, field }) { return [browserWalletApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const original = await prepareBrowserWalletApplication(settings, inputPath, runtimeDirectory);
    args.push(...original.args); inputs.push(...original.inputs);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "browser-wallet"; },
  verifyLaunch: verifyBrowserWalletLaunch,
  createObserver(request, directory, context) {
    const parse = browserWalletOutputReader(request);
    return observeApplicationStartup(request, directory, text => {
      return (parse?.(text) ?? []).map(value => () => browserWalletStartup(request, value, directory));
    });
  },
};
