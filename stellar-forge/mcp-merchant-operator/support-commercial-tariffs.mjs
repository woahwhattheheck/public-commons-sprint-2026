// MIT. Full tariff quotation receiving under the original configured Support owner.
import {openCommercialTariffController} from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/commercial/tariff-controller.mjs';
import {failure,exact,privateSupportDirectory} from './host-files.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const ACTIONS=Object.fromEntries(['status','catalog','selection','capture','inspect','attach','case','restore']
  .map(action=>['merchant_case_commercial_tariff_'+action,action]));
export function merchantCommercialTariffs({cases,casesDirectory,exportsDirectory,reads}={}){
  let opening,closing=false,closed;
  const original=()=>opening??=Promise.resolve(cases()).then(store=>openCommercialTariffController({store,casesDirectory:casesDirectory()}));
  return {
    handles:name=>Object.hasOwn(ACTIONS,name)||name==='merchant_case_commercial_tariff_file',
    async call(name,args){
      if(closing)throw failure('SUPPORT_CLOSING','The original Support owner is draining current tariff work.');
      if(name==='merchant_case_commercial_tariff_file'){
        exact(args,['id','revision','sourceId','kind','readId','expectedSha256','offset','limit'],['id','revision','sourceId','kind']);
        if(!UUID.test(args.id??'')||!HASH.test(args.revision??'')||!HASH.test(args.sourceId??'')||
            !['SOURCE','PORTFOLIO'].includes(args.kind)||args.readId!==undefined&&!UUID.test(args.readId))
          throw failure('INVALID_PARAMS','Select the exact original case revision, tariff source and complete file.');
        const choice={id:args.id,revision:args.revision,sourceId:args.sourceId,kind:args.kind};
        return {...choice,...await reads.read({scope:'commercial:'+args.id,key:JSON.stringify(choice),kind:'merchant-commercial-tariff',
          directory:await privateSupportDirectory(exportsDirectory()),readId:args.readId,expectedSha256:args.expectedSha256,
          offset:args.offset,limit:args.limit,load:async()=>{
            const received=await(await original()).call('download',choice),result=received.result;
            return {bytes:result.body,name:result.descriptor.filename,type:result.descriptor.mediaType};
          }})};
      }
      if(!Object.hasOwn(ACTIONS,name))throw failure('TOOL_NOT_FOUND','Unknown original tariff quotation operation.');
      return (await original()).call(ACTIONS[name],args);
    },
    close(){return closed??=(async()=>{closing=true;if(opening)await(await opening).close();})();},
  };
}
