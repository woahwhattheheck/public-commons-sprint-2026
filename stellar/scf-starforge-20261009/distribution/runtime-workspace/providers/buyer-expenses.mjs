// MIT. buyer-expenses Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { plain } from "../storage.mjs";

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "buyer-expenses", order: 490,
  catalog({ common, field }) { return [{ id: 'buyer-expenses', command: 'buyer-expenses',
    requiredSource: 'stellar/scf-starforge-20261009/sf36-spend-governor/expense-workspace/server.py',
    title: 'Buyer expenses', terminal: false,
    description: 'Reopen statement captures, cost centers, allocations, period reviews and accountant editions.',
    fields: [field('stateDirectory', 'Private buyer expense workspace', 'path', true,
      'Reopen the original or received workspace, or create one directory in an existing private parent.'), ...common] }]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, applicationEnvironment, runtimeDirectory } = context;
    const { args, inputs, createDirectories, path, option } = applicationPreparation(settings, inputPath);
    const state = await path('stateDirectory', 'directory', true, true);
    if (!state.exists) createDirectories.push(state.path);
    option('--state', settings.stateDirectory);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === "buyer-expenses"; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      try {
        const ready = JSON.parse(text), stateIndex = request.args.indexOf('--state');
        const portIndex = request.args.indexOf('--port');
        if (plain(ready) && stateIndex >= 0 && ready.state === request.args[stateIndex + 1] && typeof ready.url === 'string') {
          const address = new URL(ready.url), selectedPort = portIndex < 0 ? 0 : Number(request.args[portIndex + 1]);
          if (address.protocol === 'http:' && address.hostname === '127.0.0.1' && address.pathname === '/' &&
              !address.search && /^[#][A-Za-z0-9_-]{43}$/.test(address.hash) && Number.isInteger(selectedPort) &&
              (selectedPort === 0 || Number(address.port || 80) === selectedPort)) return ready.url;
        }
      } catch {}
      return null;
    });
  },
};
