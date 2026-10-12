// MIT. Material and supplier tools use the original OpenSearch catalog and request journal.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const alias = {type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const id = {type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$'};
const digest = {type:'string',pattern:'^[0-9a-f]{64}$'};
const revision = {type:'integer',minimum:1};
const offset = {type:'integer',minimum:0};
const limit = {type:'integer',minimum:1,maximum:100};
const cursor = {type:'string',minLength:1,maxLength:2048};
const object = {type:'object',additionalProperties:true};
const text = maximum => ({type:'string',minLength:1,maxLength:maximum});
const page = {offset,limit};
const keyset = {cursor,limit};
const history = {id,beforeRevision:revision,limit};
const savedCatalog = {requestId:id,catalogId:id,expectedRevision:revision};
const index = {type:'string',pattern:'^[a-z0-9][a-z0-9._-]{0,199}$'};
const readId = {type:'string',minLength:1,maxLength:160};
const inputFormat = {type:'object',properties:{
  kind:{type:'string',enum:['csv','tsv','jsonl','json','xchange-json']},
  delimiter:{type:'string',minLength:1,maxLength:1},hasHeader:{type:'boolean'},
  columns:{type:'array',minItems:1,maxItems:512,uniqueItems:true,items:text(512)},
  rowsPath:{type:'string',maxLength:2048}
},additionalProperties:false};
const provenance = {type:'object',properties:{url:text(2048),revision:text(2048),publisher:text(2048),kind:text(2048),note:text(4000)},additionalProperties:false};
export const MATERIAL_EXPORT_FORMATS = Object.freeze(['catalog.csv','catalog.jsonl','approved-matches.csv','index.json','bulk.ndjson','delta.ndjson','facets.json','search-client.ts','source.json','catalog-bundle.jsonl']);
export const SUPPLIER_EXPORT_FORMATS = Object.freeze(['review.json','issues.csv','products.jsonl','bmecat.xml','xchange.json','recipient.jsonl','impact.csv']);

export function openSearchMaterialTools(tool) {
  const read={readOnly:true,idempotent:true},write={idempotent:true};
  const fields=value=>({workspace:alias,...value});
  const make=(name,description,properties,required=[],annotations=read)=>
    tool('merchant_opensearch_'+name,description,fields(properties),['workspace',...required],annotations);
  return [
    make('material_inputs','List host-declared original input aliases, byte counts, SHA-256 and names. Private host paths remain in the host configuration.',{}),
    make('material_list','Page original material catalogs, input sources, immutable editions or customer decisions. Continue nextCursor within the same workspace, collection and catalog.',{collection:{type:'string',enum:['catalogs','sources','editions','decisions']},catalogId:id,...keyset},['collection']),
    make('material_catalog','Read the current original catalog or one immutable mapping revision. Keep its catalog ID, tenant and revision when continuing.',{catalogId:id,revision},['catalogId']),
    make('material_history','Page original catalog mapping or customer-decision revisions, newest first. Continue returned nextRevision as beforeRevision.',{kind:{type:'string',enum:['catalog','decision']},...history},['kind','id']),
    make('material_decision_get','Read one full current customer decision or original immutable historical revision, including its customer description, material hash and review note.',{decisionId:id,revision},['decisionId']),
    make('material_source','Read an original retained source manifest, format, provenance, columns and sample. Complete original bytes are included in catalog-bundle.jsonl.',{sourceId:id},['sourceId']),
    make('material_edition','Read a complete immutable edition review, original source/dependency hashes, material root and change counts.',{editionId:id},['editionId']),
    make('material_rows','Page the complete saved edition by original material identifier. The optional search matches saved identifiers and titles.',{editionId:id,...page,search:{type:'string',maxLength:2000}},['editionId']),
    make('material_changes','Page original added, removed and changed material records against the edition’s retained comparison base.',{editionId:id,...page},['editionId']),
    make('material_get','Read one original material by its immutable edition and full material-key hash.',{editionId:id,materialKey:digest},['editionId','materialKey']),
    make('material_facets','Page one saved edition’s actual category, manufacturer or unit values and counts without loading the full distinct-value set.',{catalogId:id,editionId:id,facet:{type:'string',enum:['category','manufacturer','unit']},...page},['catalogId','facet']),
    make('material_suggest','Page candidates from the selected original edition using saved customer decisions, exact part references and catalog text. Original customer identifiers remain text.',{catalogId:id,text:{type:'string',maxLength:2000},customerId:{type:'string',maxLength:256},category:text(256),manufacturer:text(256),unit:text(256),...page},['catalogId','text']),
    make('material_quantity','Convert exact decimal quantity through the material’s declared original unit ratio. Requires the current material hash; decimal input remains text.',{catalogId:id,materialKey:digest,expectedMaterialSha256:digest,quantity:{type:'string',pattern:'^(?:0|[1-9][0-9]{0,39})(?:\\.[0-9]{1,18})?$'},unit:text(256)},['catalogId','materialKey','expectedMaterialSha256','quantity','unit']),
    make('material_save','Save a complete original catalog mapping. New catalogs omit catalogId and expectedRevision; updates keep both. Tenant identity remains fixed.',{...savedCatalog,title:text(120),tenantId:text(256),mapping:object},['requestId','title','tenantId','mapping'],write),
    make('material_upload','Stream one host-declared original input into the existing catalog store, preserving declared bytes, hash, format and provenance. Retain the same request ID after interruption.',{requestId:id,inputId:alias,format:inputFormat,provenance},['requestId','inputId','format'],write),
    make('material_preview','Build a complete saved full or delta edition through the original streaming importer and current mapping. Select its reviewed result separately.',{...savedCatalog,sourceId:id,mode:{type:'string',enum:['full','delta']},baseEditionId:{type:['string','null'],pattern:id.pattern}},['requestId','catalogId','expectedRevision','sourceId'],write),
    make('material_select','Select the exact reviewed edition for the original catalog, checking mapping, tenant, material root and complete review hash.',{...savedCatalog,editionId:id,reviewSha256:digest},['requestId','catalogId','expectedRevision','editionId','reviewSha256'],write),
    make('material_decision','Save an approved or rejected customer-to-material decision with original description and reason. Existing decisions require their ID and current revision.',{requestId:id,catalogId:id,expectedCatalogRevision:revision,customerId:text(256),description:text(2000),materialKey:digest,expectedMaterialSha256:digest,status:{type:'string',enum:['APPROVED','REJECTED']},note:{type:'string',maxLength:4000},decisionId:id,expectedRevision:revision},['requestId','catalogId','expectedCatalogRevision','customerId','description','materialKey','expectedMaterialSha256','status'],write),
    make('material_draft','Create the original named merchant query from the selected catalog edition and mapping. Same-request recovery keeps its original catalog selection.',{...savedCatalog,index,variant:{type:'string',enum:['baseline','identifiers']},title:text(120)},['requestId','catalogId','expectedRevision','index'],write),
    make('material_receive','Receive a complete original catalog-bundle.jsonl from a host-declared input alias into this workspace, preserving histories, decisions, source bytes and supplier deliveries.',{requestId:id,inputId:alias},['requestId','inputId'],write),
    make('material_export','Retain complete selected material, index, client, decision and portable exports from one original SQLite read snapshot. Reuse the same request ID to recover the exact files.',{requestId:id,catalogId:id,expectedCatalogRevision:revision,editionId:id,index,formats:{type:'array',minItems:1,maxItems:MATERIAL_EXPORT_FORMATS.length,uniqueItems:true,items:{type:'string',enum:[...MATERIAL_EXPORT_FORMATS]}}},['requestId','catalogId','expectedCatalogRevision','formats'],write),
    make('supplier_templates','Read the original supplier profile, bindings, source and complete native xChange catalog mapping. Omit target for the existing Sonepar/BMEcat profile.',{target:{type:'string',enum:['xchange-2.0','2ba-xchange-2.0']}}),
    make('supplier_list','Page saved supplier submissions, immutable reviews or corrections in the original catalog. Preserve the returned collection and scope cursor.',{collection:{type:'string',enum:['plans','reviews','corrections']},catalogId:id,planId:id,...keyset},['collection']),
    make('supplier_plan','Read the original current supplier submission or one immutable revision, including its profile, bindings and selected edition.',{planId:id,revision},['planId']),
    make('supplier_history','Page immutable original supplier submission or correction revisions. Continue returned nextRevision as beforeRevision.',{kind:{type:'string',enum:['plan','correction']},...history},['kind','id']),
    make('supplier_product','Read the original material, mapped product, base-product hash and current reasoned correction for this saved submission.',{planId:id,materialKey:digest},['planId','materialKey']),
    make('supplier_correction_get','Read one original saved reasoned correction and its exact material/base-product hashes.',{correctionId:id,revision},['correctionId']),
    make('supplier_review_get','Read an immutable complete supplier review, whole-edition findings and original submission and correction identities.',{reviewId:id},['reviewId']),
    make('supplier_rows','Page the complete immutable supplier review by saved product status and search text, preserving original row findings.',{reviewId:id,...page,status:{type:'string',enum:['all','errors','warnings','ready']},search:{type:'string',maxLength:1024}},['reviewId']),
    make('supplier_recipient_rows','Page the complete retained xChange recipient state and FULL/CHANGE effects by record kind, change and original identifier. Each row preserves the full before/after records and their hashes.',{reviewId:id,...page,kind:{type:'string',enum:['all','product','tradeItem']},change:{type:'string',enum:['all','added','changed','unchanged','expired','deleted']},search:{type:'string',maxLength:1024}},['reviewId']),
    make('supplier_row','Read one complete immutable reviewed supplier product and its original findings.',{reviewId:id,materialKey:digest},['reviewId','materialKey']),
    make('supplier_save','Save a complete recipient profile, explicit field bindings and original edition selection. Updates retain the original submission ID and expected revision.',{requestId:id,planId:id,expectedRevision:revision,catalogId:id,editionId:id,title:text(120),profile:object,bindings:object,previousReviewId:{type:['string','null'],pattern:id.pattern}},['requestId','catalogId','editionId','title','profile','bindings'],write),
    make('supplier_correction','Save reasoned product-field replacements against exact current material, mapped base and correction revisions. An empty patch array clears prior corrections.',{requestId:id,planId:id,expectedPlanRevision:revision,materialKey:digest,expectedMaterialSha256:digest,expectedBaseProductSha256:digest,expectedRevision:{type:'integer',minimum:0},patches:{type:'array',maxItems:512,items:{type:'object',properties:{path:text(2048),value:{},reason:text(2000)},required:['path','value','reason'],additionalProperties:false}}},['requestId','planId','expectedPlanRevision','materialKey','expectedMaterialSha256','expectedBaseProductSha256','expectedRevision','patches'],write),
    make('supplier_review','Review every original product against the saved profile, whole-edition identifiers, relations, recipient rules and correction hashes. Retain the original request for replay.',{requestId:id,planId:id,expectedRevision:revision},['requestId','planId','expectedRevision'],write),
    make('supplier_export','Retain original supplier review, products, BMEcat or xChange delivery and complete recipient effects from one read snapshot. Native delivery requires a ready review and its exact saved hash.',{requestId:id,reviewId:id,expectedReviewSha256:digest,formats:{type:'array',minItems:1,maxItems:SUPPLIER_EXPORT_FORMATS.length,uniqueItems:true,items:{type:'string',enum:[...SUPPLIER_EXPORT_FORMATS]}}},['requestId','reviewId','expectedReviewSha256','formats'],write),
    make('material_export_manifest','Inspect the retained completion-manifest identity for a material or supplier export. This reads the original export without rebuilding files.',{exportId:id},['exportId']),
    make('material_export_file','Read exact retained export or manifest bytes with their manifest and file hashes. Continue the returned readId and nextOffset; complete bytes are base64.',{exportId:id,file:text(512),expectedManifestSha256:digest,expectedSha256:digest,offset,limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES},readId},['exportId','file','expectedManifestSha256','expectedSha256','offset','limit']),
    make('material_export_file_release','Release one unfinished retained export read in this original workspace. Files and completed export identity remain saved.',{exportId:id,readId},['exportId','readId'],write)
  ];
}
