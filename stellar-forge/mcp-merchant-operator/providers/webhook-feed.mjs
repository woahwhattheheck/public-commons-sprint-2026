// MIT. Source-owned original webhook operator and complete customer receiving.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../provider-contract.mjs';
import {webhookFeedTools} from '../../../products/webhook-feed/catalog.mjs';
export default defineMerchantProvider({
 schema:MERCHANT_PROVIDER_SCHEMA,id:'webhook-feed',family:'webhookFeeds',title:'Webhook event operations',order:1170,catalogOrder:1170,configKey:'webhookFeeds',summary:true,dependencies:[],maxRequestBytes:1024*1024,concurrency:'provider',shutdown:'provider',
 configuration:{input:'webhookFeedConnection',privateExports:true,read:async(value,{hostPath})=>value==null?null:(await import('../../../products/webhook-feed/connection.mjs')).readWebhookFeedConfiguration(hostPath(value))},
 tools:webhookFeedTools,
 instructions:[{prefix:'merchant_webhook_feed_',order:1170,text:'Use the configured original Webhook operations application and its retained event store. Read current state before saving complete source, feed or merchant definitions with their expected revision. Native source signatures, event identities, cursor pages, merchant terms and retention guards remain authoritative. A new snapshot is a named original SQLite backup; retain its name and inspect the complete download manifest before receiving. Download every original file through manifest/file/file_release with the unchanged expected hashes, or select a configured receiver for the full native restore. Receiving the same snapshot again reopens the existing customer store and preserves subsequent customer edits. After a transport failure, read the original state or snapshot name before deciding whether a mutation needs repeating.'}],
 load:()=>import('../../../products/webhook-feed/provider.mjs'),
 create:(module,config)=>new module.MerchantWebhookFeeds(config),
 initialize:async options=>(await import('../../../products/webhook-feed/setup.mjs')).initializeWebhookFeedMerchant(options)
});
