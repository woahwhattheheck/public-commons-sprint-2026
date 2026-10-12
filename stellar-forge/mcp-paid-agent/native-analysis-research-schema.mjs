// SPDX-License-Identifier: MIT
// Pure additive schema over the original Analysis Research intake operations.
const alias={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'};
const job={type:'string',pattern:'^[a-f0-9]{32}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const workspace={type:'string',pattern:'^research_[a-f0-9]{64}$',
  description:'Copy the exact workspace_id returned by research-connections for this configured alias.'};
const dossier={type:'string',pattern:'^d_[a-f0-9-]{36}$',
  description:'Original Research dossier UUID, retaining its d_ prefix and hyphens.'};
const integer={type:'integer',minimum:0,maximum:9007199254740991};
const sequence={...integer,minimum:1};
const limit={type:'integer',minimum:1,maximum:100};
const family={enum:['documents','pipelines']};
const object=(required,properties)=>({type:'object',additionalProperties:false,required,properties});
const selection={oneOf:[
  object(['editionId'],{editionId:{type:'string',pattern:'^e_[a-f0-9]{64}$'}}),
  object(['purchaseId'],{purchaseId:{type:'string',pattern:'^u_[a-f0-9]{64}$'}}),
  object(['operationId','outputId'],{
    operationId:{type:'string',pattern:'^up_[a-f0-9]{64}$'},
    outputId:{type:'string',pattern:'^out_[a-f0-9]{64}$'}})
],description:'Select one exact saved source. Documents use purchaseId or editionId; Pipelines use operationId plus outputId, or editionId. IDs remain original and opaque.'};
const base={connection:{...alias,description:'Existing launcher-configured Research connection alias; the agent never supplies a connection path, token or API origin.'},
  expected_workspace_id:workspace};
const selected={...base,dossier_id:dossier,family,selection};
const common=['connection','expected_workspace_id'];
const source=[...common,'dossier_id','family'];
const picked=[...source,'selection'];
const reviewed=[...picked,'expected_edition_sha256'];
const text=maximum=>({type:'string',maxLength:maximum,pattern:'^[^\\u0000-\\u001f\\u007f]*$'});
const spec=(required,properties,description)=>({required,properties,description});
export const nativeResearchOperations=Object.freeze({
  'research-connections':spec([],{},
    'List original launcher-configured Research aliases and exact workspace IDs available inside this Analysis host. can_capture reports whether its original source runtime is available.'),
  'research-dossiers':spec(common,{...base,offset:integer,limit,snapshot:hash},
    'Page the original Research dossier inventory. Preserve result.next exactly, including its snapshot; offset greater than zero requires that same snapshot.'),
  'research-sources':spec(source,{...base,dossier_id:dossier,family,after:{type:'string'},limit},
    'List saved Documents purchases/editions or retained Pipelines jobs/outputs/editions. Use the exact returned native nextAfter cursor; this operation only reads saved source.'),
  'research-review':spec(picked,selected,
    'Review one exact saved Research selection. Copy its returned edition digest before reading elements or capturing the full original document into Analysis.'),
  'research-elements':spec(reviewed,{...selected,expected_edition_sha256:hash,offset:integer,limit,
    page:text(100),type:text(200),query:text(2000)},
    'Read a bounded original element page with its exact selected edition digest. Page/type/query filter only this review; the capture retains the full selected original source.'),
  'research-capture':spec([...reviewed,'id','name','expected_revision','title','captured_at'],{
    ...selected,expected_edition_sha256:hash,id:job,name:alias,expected_revision:integer,
    title:{...text(160),minLength:1},
    captured_at:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2})$',
      description:'Explicit full ISO timestamp with timezone, retained unchanged as the original capture provenance.'}},
    'Start or resume the same original Analysis research-capture job, using the reviewed full edition and source-alias revision. Keep id and every original request field. Reopen with job after an uncertain reply; repeating this same capture request resumes original retained work.'),
  'research-captures':spec([],{before:sequence,limit},
    'Page retained original research-capture jobs, exact requests, progress and compact completion identities. Use next_before unchanged; use job for the complete selected result.'),
  'research-cancel':spec(['id'],{id:job},
    'Request cancellation of one original local research-capture worker. Reopen job to observe its actual outcome; a completed source registration remains complete.')
});
