// MIT. Provider authorization remains with its original configured service.
import {invariant,sha256,canonicalJSON} from './source-json.mjs';
import {PROVIDER_SOURCES,actionContract} from './catalogue.mjs';
export function validateOperation({request,evidence={},now}){
 invariant(request&&typeof request==='object','PREPARED_REQUEST_REQUIRED');
 const {requestSha256,...identity}=request;
 invariant(sha256(Buffer.from(canonicalJSON(identity)))===requestSha256,'PREPARED_REQUEST_CHANGED');
 const entry=actionContract(request.action).entry;
 invariant(request.method===entry.method&&request.provider===entry.provider&&request.resourceKind===entry.resourceKind,'PREPARED_ORIGINAL_OPERATION_CHANGED');
 invariant(entry.dispatchable!==false,'ORIGINAL_OPERATION_NOT_IMPLEMENTED');
 if(evidence.book)invariant(evidence.book.environment===request.environment,'BOOK_ENVIRONMENT_MISMATCH');
 const original=PROVIDER_SOURCES[request.provider];
 if(original)invariant(request.source?.openapiSha256===original.openapiSha256&&request.source?.projectionsSha256===original.projectionsSha256,'ORIGINAL_API_BINDING_REQUIRED');
 else invariant(request.provider==='horizon'&&!request.mutation,'READ_ONLY_PROVIDER');
 if(request.provider==='escala')invariant(request.environment==='sandbox'&&request.executionSemantics==='published-mock','ESCALA_MOCK_ONLY');
 return {valid:true,observedAt:now??null};
}
