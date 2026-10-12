// MIT. Borrow configured native owners; preserve the original saved Support case.
import {join} from 'node:path';
import {openCaseServiceAdjustments} from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/case-service-adjustments.mjs';
import {exact,failure,privateSupportDirectory} from './host-files.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function merchantServiceAdjustments({cases,casesDirectory,exportsDirectory,reads,accounting,buyer}){
  let model;
  const original=()=>model??=(async()=>openCaseServiceAdjustments({store:await cases(),accounting,buyer,
    directory:join(casesDirectory(),'service-adjustments')}))();
  const scope=args=>{if(!UUID.test(args.id??''))throw failure('INVALID_CASE_ID','Choose the original saved case UUID.');return 'service-adjustments:'+args.id;};
  return {
    handles:name=>name.startsWith('merchant_service_adjustment_')||name.startsWith('merchant_service_buyer_'),
    async call(name,args){
      if(name==='merchant_service_adjustment_file_reads'){exact(args,['id'],['id']);return {id:args.id,...reads.status(scope(args))};}
      if(name==='merchant_service_adjustment_file_release'){
        exact(args,['id','readId'],['id','readId']);if(!UUID.test(args.readId??''))throw failure('INVALID_PARAMS','Retain the original file-read UUID.');
        await reads.release(scope(args),args.readId);return {id:args.id,readId:args.readId,released:true};
      }
      if(name==='merchant_service_adjustment_file'||name==='merchant_service_buyer_file'){
        const buyerFile=name==='merchant_service_buyer_file',fields=buyerFile?['outcomeId','name']:['proposalId','proposalSha256','outcomeId','kind'];
        exact(args,['id','revision',...fields,'readId','offset','limit','expectedSha256'],['id','revision',...(buyerFile?['outcomeId','name']:['proposalId','proposalSha256','kind'])]);
        const {readId,offset,limit,expectedSha256,...choice}=args;
        return {...choice,...await reads.read({scope:scope(args),key:JSON.stringify({buyerFile,...choice}),kind:buyerFile?'service-buyer':'service-adjustment',
          directory:await privateSupportDirectory(exportsDirectory()),readId,offset,limit,expectedSha256,load:async()=>{
            const value=await (await original())[buyerFile?'downloadBuyer':'download'](choice);
            return {bytes:value.body,name:value.descriptor.filename,type:value.descriptor.mediaType};
          }})};
      }
      if(name==='merchant_service_adjustment_accounting'||name==='merchant_service_buyer_workspace'){
        const {action,...input}=args;
        return (await original())[name==='merchant_service_adjustment_accounting'?'accountingOperation':'buyerOperation'](action,input);
      }
      const method={
        merchant_service_adjustment_read:'read',merchant_service_adjustment_sources:'sources',
        merchant_service_adjustment_preview:'preview',merchant_service_adjustment_prepare:'prepareIntent',
        merchant_service_adjustment_retain:'retain',merchant_service_adjustment_execute:'execute',
        merchant_service_buyer_read:'buyerRead',merchant_service_buyer_sources:'buyerSources',
        merchant_service_buyer_inspect:'inspectBuyer',merchant_service_buyer_accountant_preview:'previewBuyerAccountantReturn',merchant_service_buyer_prepare:'prepareBuyerIntent',
        merchant_service_buyer_retain:'retainBuyer',merchant_service_buyer_execute:'executeBuyer'
      }[name];
      if(!method)throw failure('TOOL_NOT_FOUND','Choose an original Service adjustment operation.');
      if(method==='sources'||method==='buyerSources')exact(args,[],[]);
      return (await original())[method](args);
    },
    async close(){if(model)await (await model).close();}
  };
}
