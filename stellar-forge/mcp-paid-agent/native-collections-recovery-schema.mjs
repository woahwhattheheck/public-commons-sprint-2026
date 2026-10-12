// SPDX-License-Identifier: MIT
// Host-selected recovery profiles over the original SF88/SF101 operation journal.
const alias={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'};
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}};
const profile={profile:alias,expectedProfileSha256:hash};
const operation={...profile,requestId:uuid};
const archive={...operation,expectedRecordSha256:hash};
const spec=(required,properties,description)=>({required,properties,description});
const p=['profile','expectedProfileSha256'],o=[...p,'requestId'],a=[...o,'expectedRecordSha256'];
export const nativeCollectionRecoveryOperations=Object.freeze({
  workspaces:spec([],page,'Page host-registered original recovery listeners. No listener is started.'),
  profiles:spec([],page,'Page retained host-selected recovery profiles and their exact original file hashes.'),
  history:spec([],page,'Page the original listener journal; when offline, list only already retained terminal results.'),
  review:spec(p,{...profile,...page},'Read the original collection recovery source selection for a registered capture profile. Preserve its reviewSha256.'),
  inspect:spec(o,{...operation,...page},'Read the exact original operation, including retained terminal results after the listener stops. A missing live observation is not a completed or failed operation.'),
  start:spec([...o,'kind'],{...operation,kind:{enum:['SNAPSHOT','VERIFY','RESTORE']},
    expectedReviewSha256:hash,expectedRecordSha256:hash,verifiedRequestId:uuid,quiesced:{type:'boolean'}},
    'Start the original recovery operation using only a registered host profile. Keep requestId after a lost reply. Capture requires the original source review and quiesced:true; restore requires the original completed verification ID and record hash.'),
  cancel:spec(o,operation,'Cancel only the selected original recovery operation. Read its original terminal state afterward.'),
  resume:spec(o,operation,'Explicitly resume the same original unfinished operation; the original journal decides whether recovery is possible.'),
  open:spec(a,archive,'Open an original successfully restored collection, then register any host-selected afterRestore collection alias. Reopening a matching live collection does not repeat restoration or execute requests.'),
  files:spec(a,{...archive,...page},'Page exact encrypted original bundle member identities. No plaintext source, signing key or response is returned.'),
  file:spec([...a,'filename','expectedFileSha256'],{...archive,
    filename:{type:'string',pattern:'^(manifest\\.json|objects/[0-9]{6}\\.gcm)$'},
    expectedFileSha256:hash,byteOffset:{type:'integer',minimum:0},
    maxBytes:{type:'integer',minimum:1,maximum:65536}},
    'Read a verified range from one retained encrypted original member. Preserve the original record, manifest, filename and full-file hashes.')
});
export const nativeCollectionRecoveryActions=Object.freeze(['collection-recovery']);
export const nativeCollectionRecoverySchema=Object.freeze({
  properties:{
    recoveryWorkspace:{...alias,description:'Host-registered original recovery service alias.'},
    recoveryOperation:{type:'string',enum:Object.keys(nativeCollectionRecoveryOperations)},
    recoveryRequest:{type:'object',description:'Exact original profile, operation and encrypted-file selections. Paths and passphrase values cannot be supplied by an agent call.'}
  },
  anyOf:Object.entries(nativeCollectionRecoveryOperations).map(([name,{required,properties,description}])=>({
    required:['action','recoveryOperation',...(name==='workspaces'?[]:['recoveryWorkspace']),
      ...(required.length?['recoveryRequest']:[])],
    properties:{action:{const:'collection-recovery'},recoveryOperation:{const:name},
      recoveryRequest:{type:'object',additionalProperties:false,required,properties,description}}
  }))
});
