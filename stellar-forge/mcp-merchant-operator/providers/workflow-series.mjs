// MIT. Source-owned recurring-work tools; the original Console owns execution.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { workflowSeriesAgentTools, WORKFLOW_SERIES_AGENT_HTTP_BYTES } from '../catalog/workflow-series.mjs';
export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'workflow-series', family: 'workflowSeries',
  title: 'Recurring customer work', order: 710, catalogOrder: 710, configKey: 'workflowSeries',
  summary: true, dependencies: [], concurrency: 'provider', shutdown: 'provider',
  maxRequestBytes: WORKFLOW_SERIES_AGENT_HTTP_BYTES,
  configuration: { input: 'workflowSeriesConnection', privateExports: true,
    read: async (value, { hostPath, base }) =>
      (await import('../workflow-series-connection.mjs')).readWorkflowSeriesConfiguration(hostPath(value, base)) },
  tools: workflowSeriesAgentTools,
  load: () => import('../workflow-series-agent.mjs'),
  create: (module, config, options) => new module.MerchantWorkflowSeriesAgent(config, options.workflowSeries),
  requestClose: provider => provider.requestClose(),
  instructions: [{ prefix: 'merchant_workflow_series_', order: 710, text:
    'Use the declared original Console and customer profile. Read its current host and saved profile before binding. ' +
    'Use the complete existing workflow or prepare and install its original recipe. ' +
    'Save recurring work with a stable request ID, exact workflow revision, complete customer inputs and dated cadence. ' +
    'Read every agenda/history page. Prepare the actual period with its source edition, reason and previous-cycle link. ' +
    'Retain the complete cycle preparation, save it unchanged, then obtain and dispatch its complete first-start preparation. ' +
    'The original Console owns native execution and recovery. Repeated starts reopen the existing run. ' +
    'Read the run and original calls after an interrupted reply; resume only from its saved current revision. ' +
    'Use original pause, resolve and handover controls for an existing run. ' +
    'Receive the completed customer export, then capture a named complete handover. ' +
    'Read profile.json, selection.json, handover.json and every customer member through EOF using the displayed SHA256 values. ' +
    'A captured handover retains its first complete profile snapshot; choose a new handover ID for a later edition. ' +
    'Receive the same complete handover on the declared destination Console and review the host binding before new work. ' +
    'Calendar proposals and iCalendar export retain the original dates and never dispatch a new run by themselves.' }],
});
