// MIT. webdav Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../application-provider.mjs';
import { webdavApplication, prepareWebDavApplication, webdavStartup } from '../application-webdav.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'webdav', order: 60,
  catalog({ common }) { return [webdavApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, runtimeDirectory } = context;
    const { args, inputs, createDirectories } = applicationPreparation(settings, inputPath);
    const original = await prepareWebDavApplication(settings, { inputPath, runtimeDirectory });
    args.push(...original.args); inputs.push(...original.inputs);
    createDirectories.push(...original.createDirectories);
    return { args, inputs, createDirectories };
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'webdav';
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith("{\"schema\":\"stellar-forge.webdav-startup.v1\",")) return null;
      return () => webdavStartup(request, text);
    });
  },
};
