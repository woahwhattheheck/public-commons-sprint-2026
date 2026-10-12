// MIT. Original saved merchant quotation through the configured support owner.
import {openCaseCommercial,commercialWorkspaceId} from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/case-commercial.mjs';
import {failure,exact,privateSupportDirectory} from './config.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
export function merchantCommercial({cases,casesDirectory,exportsDirectory,reads}) {
  let model;
  const original=async()=>model??=openCaseCommercial({store:await cases(),workspaceId:commercialWorkspaceId(casesDirectory())});
  const selected=args=>{if(!UUID.test(args.id??''))throw failure('INVALID_CASE_ID','Choose the original saved case UUID.');return 'commercial:'+args.id;};
  return {
    handles:name=>name.startsWith('merchant_case_commercial'),
    async call(name,args) {
      const scope=selected(args);
      if(name==='merchant_case_commercial_file_reads') {
        exact(args,['id'],['id']);return {id:args.id,...reads.status(scope)};
      }
      if(name==='merchant_case_commercial_file_release') {
        exact(args,['id','readId'],['id','readId']);
        if(!UUID.test(args.readId??''))throw failure('INVALID_PARAMS','Keep the original file read UUID.');
        await reads.release(scope,args.readId);return {id:args.id,readId:args.readId,released:true};
      }
      if(name==='merchant_case_commercial_file') {
        exact(args,['id','revision','quoteId','quoteSha256','kind','expectedSha256','readId','offset','limit'],
          ['id','revision','quoteId','quoteSha256','kind']);
        if(!HASH.test(args.revision??'')||!UUID.test(args.quoteId??'')||!HASH.test(args.quoteSha256??'')||
            !['QUOTE','QUOTE_JSON'].includes(args.kind)||args.readId!==undefined&&!UUID.test(args.readId))
          throw failure('INVALID_PARAMS','Choose the exact saved case revision, quote edition and document kind.');
        const choice={id:args.id,revision:args.revision,quoteId:args.quoteId,quoteSha256:args.quoteSha256,kind:args.kind};
        return {...choice,...await reads.read({scope,key:JSON.stringify(choice),kind:'merchant-commercial',
          directory:await privateSupportDirectory(exportsDirectory()),readId:args.readId,offset:args.offset,
          limit:args.limit,expectedSha256:args.expectedSha256,load:async()=>{
            const result=await (await original()).download(choice);
            return {bytes:result.body,name:result.descriptor.filename,type:result.descriptor.mediaType};
          }})};
      }
      const method={
        merchant_case_commercial:'read',merchant_case_commercial_preview:'preview',
        merchant_case_commercial_save_draft:'saveDraft',merchant_case_commercial_publish:'publish',
        merchant_case_commercial_receive_pricing:'receivePricing',merchant_case_commercial_receive:'receive',
        merchant_case_commercial_compare:'compare',
      }[name];
      if(!method)throw failure('TOOL_NOT_FOUND','Unknown original merchant quotation operation.');
      return (await original())[method](args);
    },
  };
}
