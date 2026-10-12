// MIT. Buyer-issued accounting startup in the original accounting provider.
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const sha256={type:'string',pattern:'^[a-f0-9]{64}$'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'};
const name={type:'string',minLength:1,maxLength:160};
const actor={type:'string',minLength:1,maxLength:240};
const base={workspace:alias};
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200}};
const view={type:'string',enum:['summary','allocations','outstanding','captures']};
const readOnly={readOnly:true,idempotent:true};
export const buyerAccountingDefinitions=[
 ['merchant_accounting_buyer_source_preview','Read one host-declared, owner-private original buyer-issued source before initialization. The original source reader validates its complete bytes and native allocations. Page allocations, outstanding reservations or source captures with the same returned sourceSha256; no workspace or provider is opened.',
  {...base,source:alias,sourceSha256:sha256,view,...page},['workspace','source'],readOnly],
 ['merchant_accounting_buyer_initialize','Explicitly initialize the declared buyer-only accountant directory from its reviewed original source and open its existing accounting lifetime. Repeat the same alias, sourceSha256, name and actor after a lost response. The original Store retains the source and stable first-handoff UUID; an accepted retry reads that retained source without requiring the former import file.',
  {...base,source:alias,sourceSha256:sha256,name,actor},['workspace','source','sourceSha256','name','actor'],{idempotent:true}],
 ['merchant_accounting_buyer_startup','Inspect the opened original buyer startup, workspace/source binding and retained first-handoff identity. Retains original source context, native units and named initialization. No new source is imported.',
  base,['workspace'],readOnly],
 ['merchant_accounting_buyer_prepare','Review the opened workspace\'s retained original buyer source and first-handoff UUID. Page the complete original allocations, outstanding reservations and source captures with a pinned sourceSha256. Returns the current workspace revision for an explicit handoff.',
  {...base,sourceSha256:sha256,view,...page},['workspace','sourceSha256'],readOnly],
 ['merchant_accounting_buyer_handoff','Create or recover the original buyer startup\'s first accountant handoff. Keep its retained handoffId, sourceSha256, name and actor unchanged; an accepted same request recovers before checking the old revision. Native issued amounts and all prior returned editions remain unchanged.',
  {...base,handoffId:uuid,sourceSha256:sha256,name,actor,revision:{type:'integer',minimum:1}},
  ['workspace','handoffId','sourceSha256','name','actor','revision'],{idempotent:true}]
];
