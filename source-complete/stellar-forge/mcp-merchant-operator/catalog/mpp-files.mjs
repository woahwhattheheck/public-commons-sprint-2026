// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const MPP_EXPORT_MANIFEST='mpp-export.json';

const fileNames={response:'response.bin',contract:'mpp-contract.json',openapi:'mpp-openapi.json',package:'mpp-package.json'};

function mppFileTools(tool) {
  const id={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},digestSchema={type:'string',pattern:'^[a-f0-9]{64}$'};
  const read={readOnly:true,idempotent:true};
  return [
    tool('merchant_mpp_export_list','List retained native MPP response and customer handoff exports after operator restart.',
      {after:id,limit:{type:'integer',minimum:1,maximum:50}},[],read),
    tool('merchant_mpp_export_manifest','Inspect the saved original MPP file and its completion manifest before a native retained download.',
      {exportId:id},['exportId'],read),
    tool('merchant_mpp_export_file','Read the exact saved MPP payload or manifest through the existing retained-file transport. Preserve manifest SHA256, file SHA256, readId and byte offset.',
      {exportId:id,file:{type:'string',enum:[MPP_EXPORT_MANIFEST,...Object.values(fileNames)]},
        expectedManifestSha256:digestSchema,expectedSha256:digestSchema,readId:{type:'string'},
        offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},
      ['exportId','file','expectedManifestSha256'],read),
    tool('merchant_mpp_export_file_release','Release a temporary native MPP file-read snapshot while retaining its original completed export.',
      {exportId:id,readId:{type:'string'}},['exportId','readId'],read)
  ];
}

export { mppFileTools, MPP_EXPORT_MANIFEST, fileNames };
