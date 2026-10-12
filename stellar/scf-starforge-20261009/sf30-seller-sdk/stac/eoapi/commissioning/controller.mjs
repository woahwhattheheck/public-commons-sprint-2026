// MIT. Mount within the original eoAPI operator host and its existing session.
import { need, object, safeCode } from '../../../../sf88-operator-buyer-cli/node/store.mjs';
import { identifier } from './model.mjs';

const exact=(value,keys)=>{need(object(value)&&Object.keys(value).every(key=>keys.includes(key)),'EOAPI_COMMISSIONING_ACTION_FIELDS_INVALID');return value;};
export function createCommissioningController({workspace,readPackage,savePackage}={}){
  need(workspace&&typeof workspace.getState==='function','EOAPI_COMMISSIONING_WORKSPACE_REQUIRED');
  return Object.freeze({
    // The enclosing host authenticates its operator, enforces its original CSRF
    // and body-size rules, and strips its configured route prefix.
    async dispatch({method,path,body={},signal}={}){
      try{
        need(typeof path==='string'&&path.length<=1000&&!path.includes('?'),'EOAPI_COMMISSIONING_ROUTE_INVALID');
        let result;
        if(method==='GET'&&path==='/state')result=await workspace.getState();
        else if(method==='GET'&&/^\/runs\/[a-z]+-[a-f0-9]+$/.test(path))result=await workspace.getReport({runId:path.slice(6)});
        else if(method==='GET'&&/^\/plans\/[a-z]+-[a-f0-9]+$/.test(path))result=await workspace.getPlan(path.slice(7));
        else if(method==='GET'&&/^\/imports\/[a-z]+-[a-f0-9]+$/.test(path))result=await workspace.getImported({importId:path.slice(9)});
        else if(method==='POST'&&path==='/plans'){exact(body,['input','operationId']);result=await workspace.savePlan(body);}
        else if(method==='POST'&&path==='/runs'){exact(body,['planId','operationId']);result=await workspace.createRun(body);}
        else if(method==='POST'&&path==='/execute'){exact(body,['runId']);result=await workspace.executeRun({...body,signal});}
        else if(method==='POST'&&path==='/adopt'){exact(body,['runId','caseId','captureRef','sourceWorkspaceId']);result=await workspace.adoptCapture(body);}
        else if(method==='POST'&&path==='/compare'){exact(body,['leftRunId','rightRunId']);result=await workspace.compareRuns(body);}
        else if(method==='POST'&&path==='/export'){
          exact(body,['runId']);need(typeof savePackage==='function','EOAPI_COMMISSIONING_SAVED_FILE_HOST_REQUIRED');
          const bundle=await workspace.exportRun(body);result=await savePackage(bundle);
        }else if(method==='POST'&&path==='/receive'){
          exact(body,['fileId','operationId']);identifier(body.fileId);identifier(body.operationId);
          need(typeof readPackage==='function','EOAPI_COMMISSIONING_SAVED_FILE_HOST_REQUIRED');
          result=await workspace.importPackage({package:await readPackage(body.fileId),operationId:body.operationId});
        }else return {status:404,body:{error:'EOAPI_COMMISSIONING_ROUTE_NOT_FOUND'}};
        return {status:200,body:result};
      }catch(error){
        const code=safeCode(error?.code,'EOAPI_COMMISSIONING_ACTION_FAILED');
        return {status:/BUSY|ACTIVE|CHANGED|CONFLICT/.test(code)?409:400,body:{error:code}};
      }
    }
  });
}
