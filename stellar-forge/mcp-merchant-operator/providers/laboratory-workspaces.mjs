// MIT. Laboratory provider composes original paid merchant and SF88 customer lifetimes.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { labWorkspaceTools } from '../catalog/lab-edd-workspaces.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'laboratory-workspaces', family: 'labWorkspaces',
  title: 'Laboratory EDD review and native receiving', order: 80, catalogOrder: 470,
  configKey: 'labWorkspaces', summary: true, dependencies: ['paidJobWorkspaces'],
  concurrency: 'provider', requestClose: provider => provider.cancel(), maxRequestBytes: 2097152,
  configuration: { input: 'labWorkspaceConnection', privateExports: true, dependencies: ['paidJobWorkspaces'],
    read: async (value, { hostPath, config }) =>
      (await import('../lab-edd-connection.mjs')).readLabWorkspaceConfiguration(hostPath(value),
        { paidJobWorkspaces: config.paidJobWorkspaces }) },
  tools: labWorkspaceTools,
  instructions: [{
    prefix: 'merchant_lab_', order: 30,
    text: 'Laboratory work uses the configured original SF88 customer desk and the same paid-job merchant selected in Applications. Discover and retain the full native function catalogue; create one stable request, upload complete original source/baseline files, then select their five declared slots at current revisions. Inspect source rows and all ambiguous correspondence groups before composing field and matching decisions. Full JSON, CSV/TSV, source comparisons and editors travel as retained files, never shortened tables. Preview through the original profiles; save one immutable review with its exact preview hash; apply it with a stable apply ID so interrupted native uploads resume. Prepare/import uses the original intake; checkout review/execute/recover retains its actual operator approval, buyer and payment. Read exact native task/revision before stop or retry. Fetch the complete original result through the accepted customer entry, then result_open verifies both original inputs, every prepared native member and the saved correspondence before download/reopen. A COMPLETE_FILE reply contains the entire response; use file_read or the typed Lab client to receive it. Use the original merchant worker controls to drain computation. Closing this provider drains its calls and customer lease; the borrowed merchant remains owned by its existing Applications service.',
  }],
  load: () => import('../lab-edd-workspaces.mjs'),
  create: (module, config, options, dependencies) => new module.MerchantLaboratoryWorkspaces(config,
    { ...options, paidJobWorkspaces: dependencies.paidJobWorkspaces }),
  initialize: async options => (await import('../lab-edd-setup.mjs')).initializeLabWorkspaceMerchant(options),
});
