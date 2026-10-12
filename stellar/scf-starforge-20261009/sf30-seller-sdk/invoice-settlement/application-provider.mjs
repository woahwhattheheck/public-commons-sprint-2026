// MIT. Source-owned invoice settlement registration in the original Applications workspace.
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {invoiceSettlementApplication,prepareInvoiceSettlementApplication,invoiceSettlementStartup,INVOICE_SETTLEMENT_READY_SCHEMA} from './application.mjs';

export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'stellar-invoice-settlement',order:1120,
  catalog({common}){return [invoiceSettlementApplication(common)];},
  prepare(type,settings,context){return prepareInvoiceSettlementApplication(settings,context);},
  matchRequest(request){
    return !request.pythonCommand&&request.command==='stellar-invoice-settlement'&&request.args?.[0]==='serve';
  },
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{')||text.length>16384)return null;
      let value;try{value=JSON.parse(text);}catch{return null;}
      if(value?.schema!==INVOICE_SETTLEMENT_READY_SCHEMA)return null;
      return ()=>invoiceSettlementStartup(request,text);
    });
  }
};
