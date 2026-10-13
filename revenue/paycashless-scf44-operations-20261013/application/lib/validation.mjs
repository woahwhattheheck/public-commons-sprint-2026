// MIT. Provider policy remains in the issued API; local approval retains the exact request.
import {invariant,sha256,canonicalJSON} from './source-json.mjs';
import {PAYCASHLESS_SOURCE,actionContract} from './catalogue.mjs';
export function validateOperation({request,evidence={},now}){
 invariant(request&&typeof request==='object','PREPARED_REQUEST_REQUIRED');
 const {requestSha256,...identity}=request;
 invariant(sha256(Buffer.from(canonicalJSON(identity)))===requestSha256,'PREPARED_REQUEST_CHANGED');
 const entry=actionContract(request.action).entry;
 invariant(request.method===entry.method&&request.provider===entry.provider&&request.resourceKind===entry.resourceKind,'PREPARED_ORIGINAL_OPERATION_CHANGED');
 if(evidence.book)invariant(evidence.book.environment===request.environment,'BOOK_ENVIRONMENT_MISMATCH');
 if(request.provider==='paycashless'){
  invariant(request.source?.openapiSha256===PAYCASHLESS_SOURCE.openapiSha256&&request.source?.projectionsSha256===PAYCASHLESS_SOURCE.projectionsSha256,'PAYCASHLESS_ORIGINAL_API_BINDING_REQUIRED');
  if(entry.sandboxOnly)invariant(request.environment==='sandbox','SANDBOX_ONLY_ACTION');
 }else invariant(request.provider==='horizon'&&!request.mutation,'READ_ONLY_PROVIDER');
 return {valid:true,observedAt:now??null};
}
