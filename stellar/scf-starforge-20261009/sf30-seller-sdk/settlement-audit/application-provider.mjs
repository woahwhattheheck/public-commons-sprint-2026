// MIT. Source-owned settlement audit registration in the original Applications workspace.
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {settlementAuditApplication,prepareSettlementAuditApplication,settlementAuditStartup,SETTLEMENT_AUDIT_READY_SCHEMA} from './application.mjs';

export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'stellar-settlement-audit',order:1100,
  catalog({common}){return [settlementAuditApplication(common)];},
  prepare(type,settings,context){return prepareSettlementAuditApplication(settings,context);},
  matchRequest(request){
    return !request.pythonCommand&&request.command==='stellar-settlement-audit'&&request.args?.[0]==='serve';
  },
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{')||text.length>16384)return null;
      let value;try{value=JSON.parse(text);}catch{return null;}
      if(value?.schema!==SETTLEMENT_AUDIT_READY_SCHEMA)return null;
      return ()=>settlementAuditStartup(request,text);
    });
  }
};
