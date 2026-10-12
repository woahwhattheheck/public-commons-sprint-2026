// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const alias = {type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};

const originalId = {type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$'};

const generation = {type:'integer',minimum:0};

const digest = {type:'string',pattern:'^[0-9a-f]{64}$'};

const offset = {type:'integer',minimum:0};

const readId = {type:'string',minLength:1,maxLength:160};

const chunks = {readId,expectedSha256:digest,offset,limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}};

function openSearchDeploymentTools(tool) {
  const read = {readOnly:true,idempotent:true}, write = {idempotent:true};
  const fields = properties => ({workspace:alias,...properties});
  const run = properties => ({requestId:originalId,...properties});
  return [
    tool('merchant_opensearch_deployment_status','Inspect the original OpenSearch deployment selection, retained releases, runtime owner and generation. This read does not open a seller console.',fields({}),['workspace'],read),
    tool('merchant_opensearch_deployment_compare','Compare two retained original releases, including source/query/customer terms and runtime differences. Omit from to use the current selection.',fields({from:alias,to:alias}),['workspace','to'],read),
    tool('merchant_opensearch_deployment_open','Open the original workspace deployment console and retain this request in the original journal. All lifecycle actions use that same controller.',fields(run({})),['workspace','requestId'],write),
    tool('merchant_opensearch_deployment_stage','Stage an original prepared merchant package after its saved file, source, plan and binding checks. Runtime options come from this alias’s host configuration.',fields(run({packageId:originalId,releaseId:alias,label:{type:'string',minLength:1,maxLength:160}})),['workspace','requestId','packageId','releaseId'],write),
    tool('merchant_opensearch_deployment_activate','Select a retained original release using the displayed selection generation. Starting or restarting its owned seller is a separate original action.',fields(run({releaseId:alias,expectedGeneration:generation,reason:{type:'string',minLength:1,maxLength:1000}})),['workspace','requestId','releaseId','expectedGeneration'],write),
    tool('merchant_opensearch_deployment_rollback','Select a previous retained release at the displayed generation. Omit to for the original previous release; restart the current owned instance to run the selection.',fields(run({to:alias,expectedGeneration:generation,reason:{type:'string',minLength:1,maxLength:1000}})),['workspace','requestId','expectedGeneration'],write),
    tool('merchant_opensearch_deployment_start','Start the selected original merchant through its maintained deployment owner. Preserve the displayed generation and returned seller instance ID.',fields(run({expectedGeneration:generation})),['workspace','requestId','expectedGeneration'],{...write,openWorld:true}),
    tool('merchant_opensearch_deployment_stop','Gracefully stop the seller instance currently owned by this original deployment console. Use its exact instance ID.',fields(run({instanceId:originalId})),['workspace','requestId','instanceId'],write),
    tool('merchant_opensearch_deployment_restart','Drain the current owned instance and run the selected release through the original controller. Both instance ID and selection generation must match.',fields(run({instanceId:originalId,expectedGeneration:generation})),['workspace','requestId','instanceId','expectedGeneration'],{...write,openWorld:true}),
    tool('merchant_opensearch_deployment_generate_client','Generate a retained customer export from the actual owned seller’s OpenAPI. exportId is a new customer export ID; instanceId identifies the running seller. Original request replay applies.',fields(run({exportId:alias,instanceId:originalId})),['workspace','requestId','exportId','instanceId'],write),
    tool('merchant_opensearch_deployment_clients','Page customer exports in the original deployment.clients directory. Reads saved completion records independently of a running seller.',fields({after:alias,limit:{type:'integer',minimum:1,maximum:50}}),['workspace'],read),
    tool('merchant_opensearch_deployment_client','Inspect the original customer export, offers, completion provenance and retained file reads.',fields({exportId:alias}),['workspace','exportId'],read),
    tool('merchant_opensearch_deployment_manifest','Read the exact retained customer manifest and its file digest before transferring original files or the complete archive.',fields({exportId:alias}),['workspace','exportId'],read),
    tool('merchant_opensearch_deployment_adopt_client','Recover the completion manifest for an intact original customer export using its inspected filesSha256. The original exporter validates all files and records ADOPTED_RETAINED; an already completed export is reused.',fields({exportId:alias,expectedFilesSha256:digest}),['workspace','exportId','expectedFilesSha256'],write),
    tool('merchant_opensearch_deployment_file','Transfer an original customer file through the maintained MerchantClientExports reader. Bind the export ID, inspected manifest digest, original file digest and original readId/offset.',fields({exportId:alias,file:{type:'string',minLength:1,maxLength:512},expectedManifestSha256:digest,...chunks}),['workspace','exportId','file','expectedManifestSha256','expectedSha256'],read),
    tool('merchant_opensearch_deployment_file_release','Release an unfinished original customer-file read owned by this export.',fields({exportId:alias,readId}),['workspace','exportId','readId'],write),
    tool('merchant_opensearch_deployment_archive','Transfer the original customer tar.gz archive through a SHA-256-pinned snapshot. The original archive encoder verifies every retained file against the inspected manifest. Continue with readId and expectedSha256; read_release releases unfinished archive reads.',fields({exportId:alias,expectedManifestSha256:digest,...chunks}),['workspace','exportId','expectedManifestSha256'],read),
    tool('merchant_opensearch_deployment_handover','Generate the original deployment handover for a retained release, including its current selection/runtime and customer commands. This is a current operator document with a generated timestamp.',fields({releaseId:alias}),['workspace','releaseId'],read),
  ];
}

export { openSearchDeploymentTools, alias, originalId, generation, digest, chunks, readId, offset };
