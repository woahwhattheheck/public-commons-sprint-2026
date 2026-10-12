// SPDX-License-Identifier: MIT
// Pure additions to the existing SensorThings workspace schema.
export const MERCHANT_SCHEMA='stellar-forge.sensorthings-analysis-merchant.v1';
export const MERCHANT_RECORD='stellar-forge.sensorthings-analysis-merchant-record.v1';
export const MERCHANT_SNAPSHOT='stellar-forge.sensorthings-analysis-merchant-history.v1';
export const MERCHANT_ACTIONS=Object.freeze({
  'analysis.merchant.offer':['publicationId','expectedPublicationSha256','exportId','expectedArchiveSha256','title','description','license','reason','origin','routePrefix','payment','companions','actor'],
  'analysis.merchant.buyer.prepare':['offerId','expectedOfferSha256','file','rowIndex','acceptIndex','intentId','responseOut','actor','note'],
  'analysis.merchant.inbox.capture':['projectId','versionId','publicationId','intentIds','actor','note'],
  'analysis.merchant.receive':['projectId','versionId','catalog','handoff','response','rowIndex','acceptIndex','jobId','publicationId','expectedPublicationSha256','decision','reason','operations','actor'],
  'analysis.merchant.start':['offerId','expectedOfferSha256','actor','note'],
  'analysis.merchant.stop':['offerId','actor','note'],
  'analysis.merchant.resume':['originalOperationId','expectedRequestSha256','actor','reason']
});
export const MERCHANT_READS=Object.freeze({
  overview:'/api/analysis/merchant',
  project:'/api/analysis/merchant/projects/<projectId>',
  record:'/api/analysis/merchant/records/<recordId>',
  offer:'/api/analysis/merchant/offers/<recordId>',
  service:'/api/analysis/merchant/services/<recordId>',
  preview:'/api/analysis/merchant/preview?selection=<encoded-json>',
  operations:'/api/analysis/merchant/operations',
  operation:'/api/analysis/merchant/operations/<operationId>',
  input:'/api/analysis/merchant/inputs?selection=<encoded-json>',
  history:'/api/analysis/merchant/history/<historyId>',
  operationsCases:'/api/analysis/merchant/operations-cases',
  operationsCase:'/api/analysis/merchant/operations-cases/<caseId>',
  files:'Original /api/files selection {kind:"analysis",id:<merchant-record ID>,file:<listed exact selector>}'
});
export const MERCHANT_MEANING=Object.freeze({
  source:'An already committed publication and complete original project export. No observations, analysis arithmetic or source reviews are regenerated.',
  terms:'Explicit seller terms compiled by the maintained SF30 responseAsset compiler. A compiled offer is not a payment or customer acceptance.',
  scope:'Original source terms and the operator release/attribution statement remain separate. The complete selected export includes its retained analysis history.',
  buyer:'The existing SF88 review and saved-output readers remain authoritative. Preparation and read-only Inbox export do not dispatch a purchase.',
  receiving:'Exact catalog, selected payment option, original job, verified response bytes and original analysis-project import are bound before receiving completes.',
  operations:'The existing SF47 buyer.receive/source.add/purchase.observe transactions retain independently recorded order, settlement and output facts.',
  recovery:'Continue the exact original request and durable phase IDs. Imported operation histories remain historical; they are never executed on receipt.',
  capacity:'Complete files must fit the actual maintained SF30 file-product limits. No archive, stream or history is truncated to fit.'
});
