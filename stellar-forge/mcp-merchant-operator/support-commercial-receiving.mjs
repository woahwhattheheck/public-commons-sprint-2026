// MIT. The original commercial receiving controller under the configured Support owner.
import {openCommercialReceivingController} from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/commercial/operator.mjs';
import {failure} from './config.mjs';
const ACTIONS={
  merchant_case_commercial_receiving_status:'status',
  merchant_case_commercial_receiving_capture:'capture',
  merchant_case_commercial_receiving_inspect:'inspect',
  merchant_case_commercial_receiving_attach:'attach',
  merchant_case_commercial_receiving_case:'inspect-case',
  merchant_case_commercial_receiving_restore:'restore',
};
export function merchantCommercialReceiving({cases,casesDirectory,environment=process.env}={}){
  let opening,closing=false,closed;
  const original=()=>opening??=Promise.resolve(cases()).then(store=>openCommercialReceivingController({
    store,casesDirectory:casesDirectory(),environment}));
  return {
    handles:name=>Object.hasOwn(ACTIONS,name),
    async call(name,args){
      if(closing)throw failure('SUPPORT_CLOSING','The original Support owner is draining its active operations.');
      if(!Object.hasOwn(ACTIONS,name))throw failure('TOOL_NOT_FOUND','Unknown original quotation receiving operation.');
      return (await original()).call(ACTIONS[name],args);
    },
    close(){
      return closed??=(async()=>{closing=true;if(opening)await(await opening).close();})();
    },
  };
}
