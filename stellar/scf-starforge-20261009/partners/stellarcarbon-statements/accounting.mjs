// MIT. Saved statements enter the original invoice controller and keep its request recovery.
import {copy,need} from './source.mjs';
import {digest} from './store.mjs';
import {statementVersion,invoiceDraftForStatement} from './engine.mjs';
import {accountingWorkspaceBinding} from '../../merchant-settlement-accounting/workspace/binding.mjs';
function requestIdFor(value){const hex=digest(value);return hex.slice(0,8)+'-'+hex.slice(8,12)+'-5'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32);}
export async function createStatementInvoice(workspace,accounting,{statementId,value,revision,requestId,actor}={}){
  need(accounting,'ACCOUNTING_CONNECTION_REQUIRED','Open the original accounting workspace.');
  return workspace.serial(async()=>{
    need(revision===workspace.state.revision,'STALE_WORKSPACE','Refresh the statements workspace before creating the invoice.',409);
    const draft=invoiceDraftForStatement(workspace.state,statementId,value);
    const report=statementVersion(workspace.state,statementId,value.statementVersion);
    const binding=accountingWorkspaceBinding(accounting.workspace.directory,accounting.workspace.state);
    const accountingWorkspaceId=binding.workspaceId;
    const linked=workspace.state.invoices.find(row=>row.statementId===statementId&&row.statementVersion===report.version&&row.accountingWorkspaceId===accountingWorkspaceId);
    if(linked)return {invoice:copy(linked),revision:workspace.state.revision,alreadyLinked:true};
    const originalRequestId=requestIdFor({workspaceId:workspace.state.workspaceId,statementId,version:report.version,accountingWorkspaceId});
    const prior=await accounting.workspace.serial(()=>copy(accounting.receivables.data().requests.find(row=>row.id===originalRequestId)||null));
    let invoiceId=prior?.result?.invoiceId;
    if(!invoiceId){
      const current=await accounting.receivables.state();
      const created=await accounting.receivables.saveDraft({...draft,revision:current.revision,requestId:originalRequestId,actor:actor||'Local operator'});
      invoiceId=created.invoice.id;
    }
    return workspace.applyUnlocked('invoice-link',{statementId,statementVersion:report.version,invoiceId,accountingWorkspaceId,originalRequestId},
      {revision:workspace.state.revision,requestId,actor});
  });
}
