// SPDX-License-Identifier: MIT
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { qwcApplication, prepareQwcApplication, qwcStartup } from '../application-qwc.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'stac-qwc', order: 260,
  catalog({ common }) { return [qwcApplication(common)]; },
  async prepare(type, settings, context) {
    const prepared = await prepareQwcApplication(settings, context);
    return { args: prepared.args, inputs: prepared.inputs, createDirectories: [] };
  },
  resourceKey(type, settings, { hash }) {
    return hash({ family: 'stac-qwc', directory: settings.workspaceDirectory });
  },
  matchRequest(request) { return !request.pythonCommand && request.command === 'stac-qwc'; },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text =>
      text.startsWith('{') ? () => qwcStartup(request, text) : null);
  },
};
