// MIT. Original retained Kafka datasets in the source-owned Applications lifecycle.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../application-provider.mjs';
import { kafkaApplication, prepareKafkaApplication, kafkaStartup } from '../application-kafka.mjs';

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'kafka',
  order: 165,
  catalog({ common }) { return [kafkaApplication(common)]; },
  async prepare(type, settings, context) {
    const { inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment } = context;
    const original = await prepareKafkaApplication(settings, {
      inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment,
    });
    return { args: original.args, inputs: original.inputs, createDirectories: [] };
  },
  resourceKey(type, settings, { hash }) {
    return hash({ family: 'ndjson', directory: settings.workspaceDirectory });
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'dataset-kafka';
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{')) return null;
      return () => kafkaStartup(request, text);
    });
  },
};
