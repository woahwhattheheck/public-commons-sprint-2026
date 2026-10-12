// MIT. Reviewed RIS intake through the original attached Research workspace.
import {exact,failure} from './host-files.mjs';
import {equal,valueSha} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/ris-source/schema.mjs';
import {RESEARCH_RIS_EXPORTS} from './catalog/research-ris.mjs';

export const RESEARCH_RIS_PREFIX='merchant_research_ris_';
const removed=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
const need=(condition,message)=>{if(!condition)throw failure('RESEARCH_RIS_RECEIPT_CHANGED',message);};

export function verifyResearchRisReceipt(result,{dossierId,source,review,planSha256}){
  const receipt=result?.receipt;
  need(result?.dossier?.id===dossierId&&receipt?.schema==='sf88-research-ris-receipt-v1',
    'The original RIS receipt must name this attached dossier.');
  need(receipt.requestId===review.requestId&&receipt.questionId===review.questionId&&
    equal(receipt.source,source)&&receipt.planSha256===planSha256&&
    receipt.inputSha256===valueSha({source,review})&&
    /^e_[a-f0-9]{64}$/.test(receipt.editionId)&&Number.isSafeInteger(receipt.originalRevision)&&
    receipt.revision===receipt.originalRevision+1&&result.dossier.revision>=receipt.revision,
    'The saved RIS source, complete review, request, question, plan and atomic revision must match.');
  return result;
}

export async function callResearchRis(client,name,args,{source}={}){
  const ris=client.risSources(),id=args.dossierId;
  const input=removed(args,['workspace','dossierId']);
  if(name===RESEARCH_RIS_PREFIX+'prepare'){
    exact(args,['workspace','dossierId','source','review','offset','limit','recordId'],
      ['workspace','dossierId','source','review']);
    const selected=source(args.source,['ris-source']);
    return ris.prepareSourceFile(id,{file:selected.file,sha256:selected.sha256,
      ...removed(input,['source'])});
  }
  if(name===RESEARCH_RIS_PREFIX+'preview'){
    exact(args,['workspace','dossierId','input'],['workspace','dossierId','input']);
    return ris.preview(id,args.input);
  }
  if(name===RESEARCH_RIS_PREFIX+'receive'){
    exact(args,['workspace','dossierId','input'],['workspace','dossierId','input']);
    const selected=await ris.preview(id,{source:args.input.source,review:args.input.review});
    need(selected.complete===true&&selected.planSha256===args.input.expectedPlanSha256,
      'Complete the original field and duplicate review before receiving its selected plan.');
    const result=await ris.receive(id,args.input);
    return verifyResearchRisReceipt(result,{dossierId:id,source:selected.source,
      review:selected.review,planSha256:selected.planSha256});
  }
  if(name===RESEARCH_RIS_PREFIX+'list')return ris.sources(id,input);
  if(name===RESEARCH_RIS_PREFIX+'review')return ris.sources(id,input);
  if(name===RESEARCH_RIS_PREFIX+'request')return ris.sources(id,input);
  if(name===RESEARCH_RIS_PREFIX+'compare')return ris.compare(id,input);
  throw failure('TOOL_NOT_FOUND','Unknown original RIS operation.');
}

export async function exportResearchRis(client,args,{file,download}){
  const spec=RESEARCH_RIS_EXPORTS[args.kind],ris=client.risSources();
  if(!spec)throw failure('INVALID_PARAMS','Select an original RIS export kind.');
  if(spec.comparison){
    exact(args,['workspace','dossierId','kind','beforeRisEditionId','afterRisEditionId','revision','expectedSha256'],
      ['workspace','dossierId','kind','beforeRisEditionId','afterRisEditionId']);
    const before=args.beforeRisEditionId,after=args.afterRisEditionId;
    const view=await ris.compare(args.dossierId,{before,after,revision:args.revision,limit:1});
    need(view.dossier.id===args.dossierId&&view.before.editionId===before&&view.after.editionId===after,
      'Select the original two reviewed RIS editions in this dossier.');
    const revision=view.dossier.revision;
    const result=await download(()=>ris.exportComparison(args.dossierId,{file,before,after,revision,
      format:spec.risFormat,expectedSha256:args.expectedSha256}));
    need(result.revision===revision&&result.editionId===after,'The comparison export changed its selected original revision.');
    return {result,selection:{dossierId:args.dossierId,revision,beforeRisEditionId:before,afterRisEditionId:after,
      beforeReceipt:view.before,afterReceipt:view.after,representation:'derived-complete-source-comparison'}};
  }
  const keys=['workspace','dossierId','kind','editionId','revision','expectedSha256'];
  const required=['workspace','dossierId','kind','editionId'];
  if(spec.risFormat==='document'){keys.push('documentId');required.push('documentId');}
  if(spec.risFormat==='record'){keys.push('recordId');required.push('recordId');}
  exact(args,keys,required);
  const view=await ris.sources(args.dossierId,{editionId:args.editionId,revision:args.revision,
    ...(args.recordId?{recordId:args.recordId}:{limit:1})});
  need(view.dossier.id===args.dossierId&&view.receipt?.editionId===args.editionId,
    'Select an original received RIS edition in this dossier.');
  const revision=view.dossier.revision,receipt=view.receipt;
  let original;
  if(spec.risFormat==='edition')original=receipt.edition;
  else if(spec.risFormat==='source')original=receipt.source;
  else if(spec.risFormat==='document'){
    original=view.documents.find(row=>row.id===args.documentId);
    need(original,'The selected original RIS document is not in this edition.');
  }else if(spec.risFormat==='record'){
    original=view.record;
    need(original.recordId===args.recordId,'The original RIS record selector changed.');
  }
  const expectedSha256=args.expectedSha256??original?.sha256;
  const result=await download(()=>ris.export(args.dossierId,{file,editionId:args.editionId,revision,
    format:spec.risFormat,...(args.documentId?{documentId:args.documentId}:{}),
    ...(args.recordId?{recordId:args.recordId}:{}),expectedSha256}));
  need(result.revision===revision&&result.editionId===args.editionId,'The original RIS export changed its edition or revision.');
  if(original)need(result.bytes===original.bytes&&result.sha256===original.sha256,
    'The complete source or record export must retain its original byte identity.');
  return {result,selection:{dossierId:args.dossierId,revision,editionId:args.editionId,receipt,
    representation:spec.representation,...(args.documentId?{documentId:args.documentId}:{}),
    ...(args.recordId?{recordId:args.recordId}:{}),...(original?{original:{bytes:original.bytes,sha256:original.sha256}}:{})}};
}
