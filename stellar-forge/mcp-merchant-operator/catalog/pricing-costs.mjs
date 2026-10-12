// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';
import { MAX_DOCUMENT } from '../../../stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/economics/limits-contracts.mjs';

const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};

const uuid={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'};

const hash={type:'string',pattern:'^[0-9a-f]{64}$'};

const text={type:'string'};

const nullableText={anyOf:[text,{type:'null'}]};

const revision={anyOf:[hash,{type:'null'}]};

const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});

const anyObject={type:'object'};

const base={workspace:alias};

const read={readOnly:true,idempotent:true};

const write={idempotent:true};

const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}};

const delimiter={type:'string',enum:[',','\t',';','|']};

const period=object({from:text,through:text});

const kind={type:'string',enum:['BILL','CREDIT_NOTE','QUOTE','USAGE','ACCOUNTING','SUPPORT']};

const metadata=object({label:text,name:text,kind,supplier:text,reference:text,period:{anyOf:[period,{type:'null'}]},note:text,url:nullableText},['label','name','kind']);

const field={anyOf:[object({column:text,trim:{type:'boolean'}},['column']),object({constant:text,trim:{type:'boolean'}},['constant']),{type:'null'}]};

const mapping=object(Object.fromEntries(['reference','supplier','kind','currency','amount','quantity','unit','description'].map(name=>[name,field])),[]);

const pinnedInput={input:alias,expectedSha256:hash,expectedBytes:{type:'integer',minimum:1,maximum:MAX_DOCUMENT}};

const receivedDraft=object({packageId:uuid,requestId:uuid});
const bookAdjustments=object({label:text,reason:text,periodAlignment:object({confirmed:{type:'boolean'},reason:text}),
  coverage:{type:'array',maxItems:10000,items:anyObject}},[]);
const bookInput={book:anyObject,bookSource:object(pinnedInput),receivedDraft,bookAdjustments};
const receivingSelection={packageId:uuid,expectedPackageSha256:hash,pricingVersion:uuid,expectedPricingReportSha256:hash,
  routeMappings:{type:'array',maxItems:10000,items:object({from:text,to:nullableText})},label:text,reason:text};
const receivingViews={type:'string',enum:['routes','routeCosts','units','lines','allocations','issues','groups','coverage',
  'imports','sources','context','routeMappings','sourceMappings','lineMappings']};

const view={type:'string',enum:['routes','routeCosts','units','lines','allocations','issues','groups','coverage','imports','sources','pricingLinks','context']};

const routeIds={type:'array',minItems:1,maxItems:10000,items:text};

const proposal={edition:uuid,basis:{type:'string',enum:['BILLED','QUOTED']},routeIds};

const fileSelection={...base,kind:{type:'string',enum:['source','edition','export','received']},id:uuid};

const costToolDefinitions=[
  ['merchant_pricing_cost_state','Read exact native cost/pricing revisions, counts and declared source/booking aliases. Whole source and history lists have separate paged operations.',base,['workspace'],read],
  ['merchant_pricing_cost_list','Page the complete native originals, pricing reviews, cost editions or export receipts. after is the original opaque cursor; it does not change source identities.',{...base,kind:{type:'string',enum:['SOURCES','PRICING','EDITIONS','EXPORTS','RECEIVED']},after:nullableText,limit:page.limit},['workspace','kind'],read],
  ['merchant_pricing_cost_inputs','List host-declared original source or complete cost-book files. This reveals aliases and labels; it does not read their contents or expose filesystem paths.',{...base,kind:{type:'string',enum:['SOURCE','BOOK','PACKAGE']},...page},['workspace'],read],
  ['merchant_pricing_cost_input','Inspect the exact current SHA-256 and byte count of one host-declared source or complete cost book before selecting it. No source is imported.',{...base,kind:{type:'string',enum:['SOURCE','BOOK','PACKAGE']},input:alias},['workspace','kind','input'],read],
  ['merchant_pricing_cost_upload','Retain one inspected original host file in the native immutable source store. Keep the exact expected bytes/hash, metadata and requestId across retry. Confirmed source IDs reopen even after the host file moves.',{...base,...pinnedInput,requestId:uuid,metadata},['workspace','input','expectedSha256','expectedBytes','requestId','metadata'],write],
  ['merchant_pricing_cost_receive','Receive the complete original COST_EDITION TAR selected by its host-declared PACKAGE alias, byte count and SHA-256. Retain requestId, label and name across retry. The committed package and all original files reopen after the host input moves.',{...base,input:alias,expectedSha256:hash,expectedBytes:{type:'integer',minimum:1,maximum:512*1024*1024},requestId:uuid,label:text,name:text},['workspace','input','expectedSha256','expectedBytes','requestId','label','name'],write],
  ['merchant_pricing_cost_received','Reopen a complete received cost package and page its original report, supplier sources, exact file set or local receiving drafts. Original TAR bytes use the received manifest/download kind.',{...base,packageId:uuid,view:{type:'string',enum:['routes','routeCosts','units','lines','allocations','issues','groups','coverage','imports','sources','files','drafts']},...page},['workspace','packageId'],read],
  ['merchant_pricing_cost_receiving_review','Review every explicit original-to-local route mapping against a selected saved local pricing report. Original amounts remain exact; unassigned routes retain their money, and local coverage/period assessment starts unconfirmed. No local cost draft is written.',{...base,...receivingSelection,view:receivingViews,...page},['workspace',...Object.keys(receivingSelection)],read],
  ['merchant_pricing_cost_receiving_draft','Retain the exact reviewed supplier originals through the native source store and save the complete local receiving draft. Its stable receivedDraft selector can feed cost_preview/cost_save with explicit local coverage and alignment adjustments.',{...base,...receivingSelection,reviewSha256:hash,requestId:uuid},['workspace',...Object.keys(receivingSelection),'reviewSha256','requestId'],write],
  ['merchant_pricing_cost_capture','Capture the configured original supplier-usage or accounting file. This retains its native units and independent accounting groups; it does not infer an invoice or FX conversion.',{...base,kind:{type:'string',enum:['USAGE','ACCOUNTING']},requestId:uuid,label:text,reference:text,period:{anyOf:[period,{type:'null'}]},supplier:text,note:text},['workspace','kind','requestId'],write],
  ['merchant_pricing_cost_source','Inspect a retained source with bounded CSV or native source rows. Whole original bytes remain downloadable; oversized display cells are explicitly marked and never rewrite them.',{...base,sourceId:uuid,delimiter,view:{type:'string',enum:['rows','headers','accounts','bindings','routes','options','keys','totals']},...page},['workspace','sourceId'],read],
  ['merchant_pricing_cost_mapping','Apply an explicit original column/constant mapping and page every resulting sourceUUID:row line. The original file remains byte-identical and all row dispositions belong to the next native cost edition.',{...base,sourceId:uuid,delimiter,mapping,...page},['workspace','sourceId','mapping'],read],
  ['merchant_pricing_cost_weights','Use the original exact signed allocation engine with explicit operator weights or retained HTTP-2xx counts. Quota dispatch units and billed money stay separate.',{...base,pricingVersion:uuid,line:object({amount:text,quantity:nullableText},['amount']),basis:{type:'string',enum:['OPERATOR_WEIGHT','HTTP_2XX_WEIGHT']},reason:text,routeIds,weights:{type:'array',minItems:1,maxItems:10000,items:object({routeId:text,weight:text})},...page},['workspace','pricingVersion','line','basis','reason'],read],
  ['merchant_pricing_cost_preview','Review an inline cost book or an exact host-declared complete book through the original native validator. Page full source, route, line, allocation, coverage and issue lists; no edition is saved.',{...base,...bookInput,view,...page},['workspace'],read],
  ['merchant_pricing_cost_save','Save the complete reviewed book as an immutable native edition under the original compare-and-swap. Keep requestId, expectedRevision and the exact book contents across an ambiguous reply; a host book avoids the MCP request-size limit.',{...base,...bookInput,requestId:uuid,expectedRevision:revision},['workspace','requestId','expectedRevision'],write],
  ['merchant_pricing_cost_request','Find a committed native source, cost edition or export by its original requestId. UNKNOWN means no committed match is visible; it does not claim an interrupted write never ran.',{...base,kind:{type:'string',enum:['SOURCE','EDITION','EXPORT','RECEIVED']},requestId:uuid},['workspace','kind','requestId'],read],
  ['merchant_pricing_cost_edition','Reopen one exact native cost edition and page its original normalized inputs, report, source binding and pricing links. Complete files remain available through the cost manifest/file operations.',{...base,edition:uuid,view,...page},['workspace','edition'],read],
  ['merchant_pricing_cost_compare','Compare exact retained native cost reports and page changed lines, routes or currency/basis groups. Different input periods and missing amounts remain explicit.',{...base,before:uuid,after:uuid,view:{type:'string',enum:['changes','routes','groups']},...page},['workspace','before','after'],read],
  ['merchant_pricing_cost_proposal','Review original cost-per-fulfilled proposals for explicitly selected routes and either quoted or billed USD. The native hash binds the whole selection; no price or payment term is changed.',{...base,...proposal,view:{type:'string',enum:['changes','originalRoutes','issues']},...page},['workspace','edition','basis','routeIds'],read],
  ['merchant_pricing_cost_apply','Save an explicitly reviewed cost proposal through the original pricing model. Native per-route eligibility, exact proposal hash, original pricing expectedRevision and stable requestId remain authoritative; atomic payment amounts are unchanged.',{...base,...proposal,proposalSha256:hash,requestId:uuid,expectedPricingRevision:revision,label:text},['workspace','edition','basis','routeIds','proposalSha256','requestId','expectedPricingRevision','label'],write],
  ['merchant_pricing_cost_export','Create the original complete cost-edition TAR or closed pricing/cost/scenario workspace backup. Repeat the same requestId and exact selectors after interruption, then download its original immutable archive.',{...base,kind:{type:'string',enum:['COST_EDITION','WORKSPACE_BACKUP']},requestId:uuid,edition:uuid},['workspace','kind','requestId'],write],
  ['merchant_pricing_cost_manifest','Inspect an immutable original source, cost-edition file set or completed native export with exact file bytes and hashes. Export is the requestId from the original native package receipt.',fileSelection,['workspace','kind','id'],read],
  ['merchant_pricing_cost_file','Read a bounded SHA-pinned chunk of the inspected original source, edition or native archive. Preserve kind/id/file/manifest hash, expected file hash, readId and nextOffset when continuing. Archives stream from the native verified descriptor.',{...fileSelection,file:text,expectedManifestSha256:hash,expectedSha256:hash,readId:uuid,offset:page.offset,limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['workspace','kind','id','file','expectedManifestSha256'],read],
  ['merchant_pricing_cost_file_release','Release only the selected workspace’s temporary original-file/archive read. This never removes an original or saved package.',{...base,readId:uuid},['workspace','readId'],read],
];

export { costToolDefinitions, base, read, nullableText, page, alias, pinnedInput, uuid, metadata, write, text, period, delimiter, mapping, object, routeIds, bookInput, view, revision, proposal, hash, fileSelection, kind, field, anyObject };
