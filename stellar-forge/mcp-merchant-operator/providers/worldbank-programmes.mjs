// MIT. Original live Analysis service and retained customer files.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { worldBankProgrammeTools, WORLDBANK_PROGRAMME_HTTP_BYTES } from '../catalog/worldbank-programmes.mjs';
export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'worldbank-programmes', family: 'worldbankProgrammes',
  title: 'World Bank customer programmes', order: 720, catalogOrder: 720, configKey: 'worldbankProgrammes',
  summary: true, dependencies: [], concurrency: 'provider', shutdown: 'provider',
  maxRequestBytes: WORLDBANK_PROGRAMME_HTTP_BYTES,
  configuration: { input: 'worldbankProgrammeConnection', privateExports: true,
    read: async (value,{hostPath,base}) => (await import('../worldbank-programme-connection.mjs')).readWorldBankProgrammeConfiguration(hostPath(value,base)) },
  tools: worldBankProgrammeTools, load: () => import('../worldbank-programme-agent.mjs'),
  create: (module,config,options) => new module.MerchantWorldBankProgrammeAgent(config,options.worldbankProgrammes),
  requestClose: provider => provider.requestClose(),
  instructions: [{prefix:'merchant_worldbank_programme_',order:720,text:
    'Use the declared original Analysis workspace and programme. Read every source and history page. '+
    'Preserve programme/source revisions, original operation IDs, full baseline/candidate review, exact numeric/null values and complete source exclusions. '+
    'Prepare first; inspect the complete comparison and review before explicit publication with its digest and note. '+
    'A RUNNING response or elapsed wait is not completion. WORKBOOK_COLUMN_CHOICES_REQUIRED requires original complete column mappings on the same operation. '+
    'After a lost write response read the original operation and retry only its exact accepted intent. Never allocate a new ID to hide uncertainty. '+
    'A restored accepted delivery can produce a linked portable delivery with an explicitly new delivery ID, without rerunning the report. '+
    'Export only a COMPLETE original result and its displayed resultSha256. Receive the full retained manifest and every member through EOF with expected hashes. '+
    'The existing Merchant customer family worldbank-programme receives these files; workflow-series retains their original period, calls and whole profile handover. '+
    'No tool here acquires World Bank source, opens a second Analysis process, schedules work or authorizes a payment.'}]
});
