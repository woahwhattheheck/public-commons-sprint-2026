// MIT. Source-owned merchant provider; the original console retains its writer and actions.
import {defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA} from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {grantPortfolioTools} from './merchant-catalog.mjs';

export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'grant-portfolios',family:'grantPortfolios',
  title:'Grant portfolio reconciliation',order:185,catalogOrder:395,
  configKey:'grantPortfolios',summary:true,dependencies:[],
  maxRequestBytes:1024 * 1024 + 16384,concurrency:'provider',shutdown:'drain',
  configuration:{
    input:'grantPortfolioConnection',privateExports:true,
    read:async (value,{hostPath}) =>
      (await import('./merchant.mjs')).readGrantPortfolioConfiguration(hostPath(value)),
  },
  tools:grantPortfolioTools,
  instructions:[{
    order:70,prefix:'merchant_grant_portfolio_',
    text:'Use the configured original portfolio workspace ID. Read its schema and saved source/portfolio inventory, then select exact immutable source IDs and portfolio revisions. Upload a declared complete native packet handle or a retained export before selecting its returned object SHA. Keep each original action operationId, input and expected revisions through a lost reply; read that request and explicitly resume its saved action when appropriate. Preserve the complete source references, entity/financial semantic hashes, review decision rationale and original currency/value/type/date fields. Page the entire selected table with its returned snapshot. The complete portfolio export includes the original sources, native packets, review history and unresolved rows. Retain its exact manifest and download the whole ZIP with the original merchant file transport. The running Applications console remains the writer; this provider borrows it and closes only its own HTTP/file reads.',
  }],
  load:() => import('./merchant.mjs'),
  create:(module,config,options) => new module.MerchantGrantPortfolios(config,{environment:options.environment}),
  initialize:async options => (await import('./merchant.mjs')).initializeGrantPortfolioMerchant(options),
});
