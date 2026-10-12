// MIT. Source-owned registration in the maintained Applications lifecycle.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from '../../../distribution/runtime-workspace/application-provider.mjs';
import { mssqlApplication, prepareMssqlApplication, mssqlStartup } from './managed.mjs';

export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'mssql',order:355,
  catalog({common}){return [mssqlApplication(common)];},
  prepare(type,settings,context){return prepareMssqlApplication(settings,context);},
  matchRequest(request){return !request.pythonCommand&&request.command==='mssql-workspace';},
  createObserver(request,directory) {
    return observeApplicationStartup(request,directory,text=>
      text.startsWith('{"schema":"stellar-forge.mssql-workspace-startup.v1",')?()=>mssqlStartup(request,text):null,
      {lineLimit:32768});
  }
};
