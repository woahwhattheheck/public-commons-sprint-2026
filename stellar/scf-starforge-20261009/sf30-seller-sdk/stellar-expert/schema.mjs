// MIT. Public, descriptor-driven StellarExpert workspace contract.
export const SOURCE_CONTRACT = Object.freeze({
  provider: 'StellarExpert Open API', version: '1.4.0',
  baseUrl: 'https://api.stellar.expert',
  documentation: 'https://github.com/stellar-expert/stellar-expert-explorer/blob/308ef220358192911525272d9ad251225dd1e00b/open-api/openapi.yml',
  repository: 'https://github.com/stellar-expert/stellar-expert-explorer',
  sourceCommit: '308ef220358192911525272d9ad251225dd1e00b',
  openapiBlob: 'f83ee631d9e50a0b7eeb3d7d3ed5db28f92fb1b4',
  terms: 'https://stellar.expert/',
  ratingMeaning: 'Ledger activity popularity indicators, as described by StellarExpert.',
  observationMeaning: 'A retained sequence of provider responses observed over the recorded time interval. The provider does not advertise snapshot isolation across pages.',
  amountMeaning: 'Original numeric tokens are strings. Holder balance and documented traded/payment amounts are stroops; the supply endpoint returns decimal asset units. The AssetInfo supply field is retained without an undocumented unit conversion.'
});
export const CAPTURE_KINDS = [
  {id:'assets',label:'Asset search',paginated:true,fields:['network','search','sort','order','limit']},
  {id:'holders',label:'Asset holders',paginated:true,fields:['network','asset','limit']},
  {id:'rating',label:'Asset activity rating',paginated:false,fields:['network','asset']},
  {id:'supply',label:'Issued supply',paginated:false,fields:['network','asset']},
  {id:'directory',label:'Account directory',paginated:true,fields:['address','tag','search','order','limit']},
  {id:'tags',label:'Directory tag definitions',paginated:false,fields:[]},
  {id:'blocked-domains',label:'Community-reported domains',paginated:true,fields:['search','order','limit']},
  {id:'domain',label:'Domain listing lookup',paginated:false,fields:['domain']},
  {id:'ledger-time',label:'Ledger at or before timestamp',paginated:false,fields:['network','timestamp']},
  {id:'ledger-sequence',label:'Ledger closing time',paginated:false,fields:['network','sequence']}
];
export const COLUMNS = Object.freeze({
  assets:['asset','domain','created','supply','traded_amount','traded_units','payments_amount','payment_units','trustlines_total','trustlines_authorized','trustlines_funded','trades','payments','rating_average','rating_age','rating_trades','rating_payments','rating_trustlines','rating_volume7d','rating_interop','rating_liquidity','toml_json','paging_token'],
  holders:['asset','account','balance_stroops','balance_units','paging_token'],
  rating:['asset','rating_average','rating_age','rating_trades','rating_payments','rating_trustlines','rating_volume7d','rating_interop','rating_liquidity','rating_json'],
  supply:['asset','supply_units'],
  directory:['address','name','domain','tags_json','paging_token'],
  tags:['name','description'],
  'blocked-domains':['domain','paging_token'],
  domain:['domain','blocked'],
  'ledger-time':['sequence','timestamp','date'],
  'ledger-sequence':['sequence','timestamp','date']
});
export const SOURCE_COLUMNS = ['sourcePageSha256','sourceRecord','sourceObservedAt','sourceUrl'];
export const ACTIONS = {
  'watch.add':['network','asset','label','note'], 'watch.remove':['watchId'],
  'capture.start':['query','label','watchId','pageBudget'], 'capture.resume':['captureId','pageBudget'],
  'edition.select':['editionId'], 'edition.compare':['leftId','rightId'],
  'annotation.save':['editionId','subject','note','status'],
  'dataset.prepare':['editionId','name'], 'dataset.query':['datasetId','query'],
  'release.prepare':['datasetId','origin','path','payment'], 'release.inspect':['releaseId'],
  'release.activate':['releaseId','expectedGeneration'],'release.start':['releaseId','expectedGeneration'],
  'release.stop':['releaseId'],'release.rollback':['releaseId','expectedGeneration'],
  'buyer.inspect':['intentIds'], 'buyer.receive':['intentIds'],
  'export.create':['editionId','format']
};
export function workspaceSchema({inboxConfigured=false}={}) {
  return {
    schema:'stellar-forge.stellar-expert-workspace-schema.v1', source:SOURCE_CONTRACT,
    networks:['public','testnet'], captureKinds:CAPTURE_KINDS,
    fields:{
      network:{type:'select',options:['public','testnet'],default:'public'},
      asset:{type:'text',label:'XLM or CODE-GISSUER (optional -1/-2 type suffix)'},
      search:{type:'text'}, address:{type:'array',maxItems:50},tag:{type:'array',maxItems:10},
      sort:{type:'select',options:['rating','created','payments','trades','trustlines','volume','volume7d'],default:'rating'},
      order:{type:'select',options:['asc','desc'],default:'desc'},
      limit:{type:'integer',minimum:1,maximum:200,default:100},
      domain:{type:'text'},timestamp:{type:'text'},sequence:{type:'text',pattern:'^[1-9][0-9]*$'}
    },
    datasetTables:COLUMNS, sourceColumns:SOURCE_COLUMNS,
    paymentFields:['scheme','network','asset','amount','payTo','maxTimeoutSeconds'],
    paymentSchema:{scheme:{type:'select',options:['exact'],default:'exact'},network:{type:'select',options:['stellar:testnet','stellar:pubnet'],default:'stellar:testnet'},
      asset:{type:'text',label:'Explicit SEP-41 token contract'},payTo:{type:'text',label:'Explicit merchant receiving address'},
      amount:{type:'text',label:'Positive atomic units',pattern:'^[1-9][0-9]*$',maximum:'170141183460469231731687303715884105727'},
      maxTimeoutSeconds:{type:'integer',minimum:1,maximum:86400,default:300}},
    actions:ACTIONS, annotationStatuses:['open','reviewed','follow_up'],
    exportFormats:['json','csv','report'], inboxConfigured,
    limits:{pageBudget:1000,pageBytes:8*1024*1024,captureBytes:128*1024*1024,records:250000,rowsPerView:500},
    bootstrap:{fragment:'bearer token',header:'Authorization: Bearer TOKEN',storage:'sessionStorage'},
    revisionPolicy:'Operation identity is reconciled before expectedRevision. New mutations require the current workspace revision.'
  };
}
