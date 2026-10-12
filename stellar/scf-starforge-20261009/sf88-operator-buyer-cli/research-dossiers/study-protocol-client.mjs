// MIT. Registered protocol operations on an original Research attachment.
import {resolve,isAbsolute} from 'node:path';
import {digest,jsonBytes,need,object} from '../node/store.mjs';
import {readResearchHostFile} from './workspace-files.mjs';
import {SOURCE_BUNDLE_LIMIT} from './source-bundles.mjs';
import {captureStudyProtocol,inspectStudyProtocolCapture} from './study-protocol-source.mjs';
import {receiveStudyProtocol} from './study-protocol-receiving.mjs';
import {inspectStudyProtocolBundle} from './study-protocol-inspection.mjs';

export const STUDY_PROTOCOL_RECEIVE_REQUEST='sf88-study-protocol-receive-request/v1';
const id=(value,code)=>need(typeof value==='string'&&value.length>0&&value.length<=160&&
  !/[\u0000-\u001f\u007f/\\]/.test(value),code);
const utf8=bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
const requestIdentity=value=>({workspaceId:value.workspaceId,dossierId:value.dossierId,
  questionId:value.questionId,bundleSha256:value.bundleSha256,bundleBytes:value.bundleBytes,
  expectedRevision:value.expectedRevision});
export function inspectStudyProtocolReceiveRequest(request){
  need(object(request)&&request.schema===STUDY_PROTOCOL_RECEIVE_REQUEST&&
    Object.keys(request).every(key=>['schema','requestId','workspaceId','dossierId','questionId',
      'bundleSha256','bundleBytes','expectedRevision','rawText'].includes(key)),
    'PROTOCOL_RECEIVE_REQUEST_REQUIRED');
  need(typeof request.workspaceId==='string'&&/^research_[a-f0-9]{64}$/.test(request.workspaceId),
    'PROTOCOL_WORKSPACE_REQUIRED');
  id(request.dossierId,'PROTOCOL_DOSSIER_REQUIRED');id(request.questionId,'PROTOCOL_QUESTION_REQUIRED');
  need(Number.isSafeInteger(request.expectedRevision)&&request.expectedRevision>=1&&
    typeof request.rawText==='string','PROTOCOL_RECEIVE_REVISION_REQUIRED');
  const bytes=Buffer.from(request.rawText,'utf8');
  need(bytes.length<=SOURCE_BUNDLE_LIMIT,'SOURCE_BUNDLE_SIZE_INVALID');
  const inspection=inspectStudyProtocolBundle(bytes);
  need(request.bundleSha256===inspection.bundleSha256&&request.bundleBytes===inspection.bundleBytes&&
    request.requestId==='protocol_receive_'+digest(jsonBytes(requestIdentity(request))),
    'PROTOCOL_RECEIVE_REQUEST_CHANGED');
  return {request,bytes,inspection};
}

/** The parent supplies its original #run so close() drains this complete work. */
export function createStudyProtocolClient({client,run}={}){
  need(client&&typeof client.status==='function'&&typeof client.previewSourceBundleBytes==='function'&&
    typeof client.receiveSourceBundleBytes==='function'&&typeof run==='function',
    'PROTOCOL_RESEARCH_CLIENT_REQUIRED');
  const identified=async expected=>{
    const status=await client.status();
    need(/^research_[a-f0-9]{64}$/.test(status.workspaceId)&&status.api?.sourceBundles===true,
      'PROTOCOL_SOURCE_BUNDLE_API_REQUIRED');
    if(expected)need(status.workspaceId===expected,'PROTOCOL_WORKSPACE_CHANGED');
    return status.workspaceId;
  };
  const prepare=async({dossierId,questionId,bytes})=>{
    need(bytes instanceof Uint8Array,'PROTOCOL_SOURCE_BYTES_REQUIRED');bytes=Buffer.from(bytes);
    id(dossierId,'PROTOCOL_DOSSIER_REQUIRED');id(questionId,'PROTOCOL_QUESTION_REQUIRED');
    const inspection=inspectStudyProtocolBundle(bytes),workspaceId=await identified();
    const preview=await client.previewSourceBundleBytes(dossierId,{questionId,bytes});
    need(preview.dossierId===dossierId&&preview.questionId===questionId&&
      preview.bundleSha256===inspection.bundleSha256&&preview.bundleBytes===inspection.bundleBytes&&
      Number.isSafeInteger(preview.expectedRevision)&&preview.expectedRevision>=1,
      'PROTOCOL_NATIVE_PREVIEW_CHANGED');
    const selected={workspaceId,dossierId,questionId,bundleSha256:inspection.bundleSha256,
      bundleBytes:inspection.bundleBytes,expectedRevision:preview.expectedRevision};
    const request={schema:STUDY_PROTOCOL_RECEIVE_REQUEST,
      requestId:'protocol_receive_'+digest(jsonBytes(selected)),...selected,rawText:utf8(bytes)};
    inspectStudyProtocolReceiveRequest(request);
    return {inspection,preview,request};
  };
  return Object.freeze({
    inspectBytes:bytes=>run(async()=>inspectStudyProtocolBundle(bytes)),
    inspectFile:({file,sha256})=>run(async()=>inspectStudyProtocolBundle(
      await readResearchHostFile(resolve(file),SOURCE_BUNDLE_LIMIT,{sha256}))),
    inspectCapture:directory=>run(async()=>{
      const capture=await inspectStudyProtocolCapture(resolve(directory));
      return {capture:capture.complete,inspection:inspectStudyProtocolBundle(capture.bundle)};
    }),
    capture:input=>run(async()=>{
      await identified();
      return captureStudyProtocol(input);
    }),
    prepare:input=>run(()=>prepare(input)),
    prepareFile:({file,sha256,...input})=>run(async()=>prepare({...input,
      bytes:await readResearchHostFile(resolve(file),SOURCE_BUNDLE_LIMIT,{sha256})})),
    receive:request=>run(async()=>{
      request=structuredClone(request);
      const selected=inspectStudyProtocolReceiveRequest(request);
      await identified(request.workspaceId);
      const result=await client.receiveSourceBundleBytes(request.dossierId,{
        questionId:request.questionId,bytes:selected.bytes,
        expectedBundleSha256:request.bundleSha256,expectedRevision:request.expectedRevision});
      need(result.id===request.dossierId&&Number.isSafeInteger(result.revision)&&
        result.revision>=request.expectedRevision&&result.questions.some(q=>q.id===request.questionId),
        'PROTOCOL_NATIVE_RECEIVING_CHANGED');
      return result;
    }),
    reconcile:request=>run(async()=>{
      request=structuredClone(request);
      const selected=inspectStudyProtocolReceiveRequest(request);
      await identified(request.workspaceId);
      const preview=await client.previewSourceBundleBytes(request.dossierId,{
        questionId:request.questionId,bytes:selected.bytes});
      need(preview.dossierId===request.dossierId&&preview.questionId===request.questionId&&
        preview.bundleSha256===request.bundleSha256&&preview.bundleBytes===request.bundleBytes,
        'PROTOCOL_NATIVE_PREVIEW_CHANGED');
      return {schema:STUDY_PROTOCOL_RECEIVE_REQUEST,requestId:request.requestId,
        workspaceId:request.workspaceId,dossierId:request.dossierId,questionId:request.questionId,
        state:preview.alreadyReceived?'ALREADY_RECEIVED':'NOT_RECEIVED',
        originalExpectedRevision:request.expectedRevision,currentRevision:preview.expectedRevision,preview};
    }),
    receiveCapture:input=>run(async()=>{
      input={...input};
      need(object(input)&&input.client===undefined&&input.connectionFile===undefined,
        'PROTOCOL_ORIGINAL_ATTACHMENT_REQUIRED');
      const workspaceId=await identified(input.expectedWorkspaceId);
      need(typeof input.directory==='string'&&isAbsolute(input.directory)&&resolve(input.directory)===input.directory,
        'PROTOCOL_ABSOLUTE_DIRECTORY_REQUIRED');
      return receiveStudyProtocol({...input,client,expectedWorkspaceId:workspaceId});
    }),
  });
}
