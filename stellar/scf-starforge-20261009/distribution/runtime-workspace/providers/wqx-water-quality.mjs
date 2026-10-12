// MIT. wqx-water-quality Applications registration over the original native implementation.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { wqxWaterQualityApplication, prepareWqxWaterQualityApplication, wqxWaterQualityStartup } from '../application-wqx-water-quality.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'wqx-water-quality', order: 1020,
  catalog({ common }) { return [wqxWaterQualityApplication(common)]; },
  async prepare(type, settings, context) {
    return prepareWqxWaterQualityApplication(settings, { inputPath: context.inputPath, runtimeDirectory: context.runtimeDirectory });
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'water-quality-managed';
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"stellar-forge.wqx-managed-startup.v1",')) return null;
      return () => wqxWaterQualityStartup(request, directory, text, context);
    }, { lineLimit: 32768 });
  },
};
