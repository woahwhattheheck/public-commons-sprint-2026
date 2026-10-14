// SPDX-License-Identifier: MIT
// Server-side projection for an already resolved named Git branch operation.
// No caller flag can opt authored publication text out of classification.
export const BRANCH_PROJECTION_VERSION = 'branch-publication-content/v1';

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const keys = (v, wanted) => plain(v) && Object.keys(v).length === wanted.length
  && wanted.every(k => Object.prototype.hasOwnProperty.call(v,k));
const same = (a,b) => canonical(a) === canonical(b);
function canonical(v) {
  if(Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if(plain(v)) return '{' + Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function branchName(v) {
  return typeof v==='string' && v.length>0 && v.length<=1024
    && !/[\u0000-\u0020\u007f~^:?*\[\\]/u.test(v)
    && !v.startsWith('/') && !v.endsWith('/') && !v.startsWith('refs/')
    && !v.startsWith('-') && !v.endsWith('.') && v!=='@'
    && !v.includes('..') && !v.includes('@{')
    && v.split('/').every(x=>x && !x.startsWith('.') && !x.endsWith('.lock'));
}
function requestBinding(input,actor) {
  if(!keys(input,['operation_id','operation','args']) || input.operation!=='branch.create'
      || typeof input.operation_id!=='string' || !/^[a-zA-Z0-9._:-]{8,128}$/u.test(input.operation_id)
      || !keys(input.args,['owner','repo','branch','sha'])) return null;
  const a=input.args;
  if(typeof a.owner!=='string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(a.owner)
      || typeof a.repo!=='string' || !/^[A-Za-z0-9_.-]{1,100}$/u.test(a.repo) || ['.','..'].includes(a.repo)
      || !branchName(a.branch) || typeof a.sha!=='string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(a.sha)
      || !plain(actor) || !Number.isSafeInteger(actor.id) || actor.id<1
      || typeof actor.login!=='string' || actor.login.toLowerCase()!==a.owner.toLowerCase()) return null;
  return {full_name:a.owner+'/'+a.repo,owner_id:actor.id,ref:'refs/heads/'+a.branch,sha:a.sha};
}
function metadataRepository(r,b) {
  if(!plain(r) || Object.keys(r).some(k=>!['id','name','full_name','owner','private','fork','default_branch','description','homepage','topics'].includes(k))
      || !Number.isSafeInteger(r.id) || r.id<1 || !keys(r.owner,['id','login'])
      || r.owner.id!==b.owner_id || typeof r.owner.login!=='string'
      || typeof r.name!=='string' || typeof r.full_name!=='string'
      || r.full_name.toLowerCase()!==b.full_name.toLowerCase()
      || (r.owner.login+'/'+r.name).toLowerCase()!==b.full_name.toLowerCase()
      || r.private!==false || typeof r.fork!=='boolean' || !branchName(r.default_branch)
      || !(r.description===null || typeof r.description==='string')
      || ('homepage' in r && !(r.homepage===null || typeof r.homepage==='string'))
      || ('topics' in r && (!Array.isArray(r.topics) || r.topics.some(t=>typeof t!=='string')))) return false;
  return true;
}
function legacyEnvelope(content,b) {
  if(typeof content!=='string') return null;
  let v; try { v=JSON.parse(content); } catch { return null; }
  if(!keys(v,['method','path','body','repository','destination']) || v.method!=='POST'
      || v.path!=='/repos/'+b.full_name+'/git/refs' || !keys(v.body,['ref','sha'])
      || v.body.ref!==b.ref || v.body.sha!==b.sha
      || !metadataRepository(v.repository,b)
      || !same(v.destination,{owner_id:b.owner_id,full_name:v.repository.full_name,ref:b.ref,sha:b.sha})) return null;
  return v;
}

/** Call only with resolveOperation's complete result and authenticated actor. */
export function projectBranchPublication(input,operation,actor) {
  const binding=requestBinding(input,actor);
  if(!binding || !plain(operation) || operation.method!=='POST'
      || !keys(operation.metadata,['kind','repository','destination']) || operation.metadata.kind!=='branch'
      || !metadataRepository(operation.metadata.repository,binding)
      || !same(operation.metadata.destination,{...binding,full_name:operation.metadata.repository.full_name})
      || !Array.isArray(operation.prose) || operation.prose.length!==1) return null;
  const envelope=legacyEnvelope(operation.prose[0],binding);
  if(!envelope || !same(envelope.repository,operation.metadata.repository)
      || !same(envelope.destination,operation.metadata.destination)) return null;
  if(operation.path==='/graphql') {
    const body=operation.body, q="mutation AccountPublisherBranch($input:CreateRefInput!) {\n  createRef(input:$input) { ref { name prefix repository { nameWithOwner } target { __typename ... on Commit { oid } } } }\n}";
    if(operation.graphqlBranchCreate!==true || !keys(body,['query','variables']) || body.query!==q
        || !keys(body.variables,['input']) || !keys(body.variables.input,['repositoryId','name','oid','clientMutationId'])
        || typeof body.variables.input.repositoryId!=='string' || !body.variables.input.repositoryId
        || body.variables.input.name!==binding.ref || body.variables.input.oid!==binding.sha
        || body.variables.input.clientMutationId!==input.operation_id) return null;
  } else if(operation.path!==envelope.path || operation.graphqlBranchCreate
      || !same(operation.body,envelope.body)) return null;
  return Object.freeze({
    version:BRANCH_PROJECTION_VERSION,kind:'structured_branch_metadata',
    binding:Object.freeze({...binding,repository_id:operation.metadata.repository.id}),
    candidate:Object.freeze({body:''}),
    decision:Object.freeze({allow:true,incident:false,reason_code:'structured_branch_metadata'})
  });
}

/** Preliminary eligibility uses only the retained private row and exact request. */
export function legacyBranchRecoveryCandidate({input,actor,path,row,incident}) {
  const b=requestBinding(input,actor);
  if(!b || path!=='/v1/publish' || !plain(row) || row.op_id!==input.operation_id
      || row.state!=='BLOCKED_INCIDENT' || Number(row.response_status)!==403
      || typeof row.digest!=='string' || typeof row.result!=='string'
      || !plain(incident) || incident.op_id!==row.op_id || typeof incident.id!=='string'
      || incident.reason!=='self_fault_admission') return null;
  let previous,destination;
  try { previous=JSON.parse(row.result); destination=JSON.parse(incident.destination); } catch { return null; }
  if(previous.allow!==false || previous.incident!==true || previous.operation_id!==row.op_id
      || previous.incident_id!==incident.id || previous.reason_code!==incident.reason
      || !keys(destination,['operation','owner','repo','path']) || destination.operation!=='branch.create'
      || destination.owner!==input.args.owner || destination.repo!==input.args.repo
      || !['/repos/'+b.full_name+'/git/refs','/graphql'].includes(destination.path)) return null;
  const envelope=legacyEnvelope(incident.content,b);
  if(!envelope) return null;
  return {binding:{...b,repository_id:envelope.repository.id},previous};
}

/** Fresh resolved repository identity must still match the original request. */
export function proveLegacyBranchProjection({input,actor,path,row,incident,operation}) {
  const candidate=legacyBranchRecoveryCandidate({input,actor,path,row,incident});
  const projection=projectBranchPublication(input,operation,actor);
  if(!candidate || !projection || !same(candidate.binding,projection.binding)) return null;
  return Object.freeze({version:BRANCH_PROJECTION_VERSION,operation_id:row.op_id,
    original_digest:row.digest,original_result:row.result,incident_id:incident.id,
    incident_content:incident.content,incident_destination:incident.destination,
    binding:projection.binding});
}
