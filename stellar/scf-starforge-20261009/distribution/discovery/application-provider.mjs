// MIT. Use the original Applications lifecycle for the installed command finder.
import { createHash } from 'node:crypto';
import { APPLICATION_PROVIDER_SCHEMA, applicationPrivateUrl,
  observeApplicationStartup } from '../runtime-workspace/application-provider.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'operator-discovery',
  order: 990,
  catalog({ common }) {
    return [{
      id: 'operator-discovery', command: 'discover', title: 'Command finder', terminal: false,
      requiredSource: 'stellar/scf-starforge-20261009/distribution/discovery/server.mjs',
      description: 'Search this installed toolkit’s commands, original sources, package exports and declared runtime groups.',
      fields: common.filter(field => field.name === 'port'),
    }];
  },
  async prepare(type, settings, { runtimeDirectory }) {
    return { args: ['serve'], inputs: [], createDirectories: [],
      resourceKey: createHash('sha256').update(JSON.stringify(['operator-discovery', runtimeDirectory])).digest('hex') };
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'discover' && request.args[0] === 'serve';
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, line => {
      let startup;
      try { startup = JSON.parse(line); } catch { return null; }
      if (startup.schema !== 'stellar-forge.operator-discovery-startup.v1' ||
          typeof startup.instanceId !== 'string' || !startup.package?.name) return null;
      const url = applicationPrivateUrl(startup.url);
      if (!url) return null;
      return async () => {
        const response = await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('The command finder listener did not return its original status.');
        const health = await response.json();
        if (health.schema !== 'stellar-forge.operator-discovery-health.v1' ||
            health.instanceId !== startup.instanceId ||
            JSON.stringify(health.package) !== JSON.stringify(startup.package))
          throw new Error('The command finder listener differs from the retained startup.');
        return { url, original: startup };
      };
    });
  },
};
