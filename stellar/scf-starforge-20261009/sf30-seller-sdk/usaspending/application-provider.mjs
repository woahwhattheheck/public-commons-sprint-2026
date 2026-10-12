// MIT. Source-owned USAspending application registration.
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup }
  from '../../distribution/runtime-workspace/application-provider.mjs';
import { usaspendingApplication, prepareUSASpendingApplication, usaspendingStartup }
  from '../../distribution/runtime-workspace/application-usaspending.mjs';

export default {
  schema:APPLICATION_PROVIDER_SCHEMA,
  id:'usaspending',
  order:1000,
  catalog({common}) { return [usaspendingApplication(common)]; },
  prepare(type,settings,context) { return prepareUSASpendingApplication(settings,context); },
  matchRequest(request) {
    return !request.pythonCommand&&request.command==='usaspending-application'&&request.args?.[0]==='serve';
  },
  createObserver(request,directory,context) {
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"stellar-forge.usaspending-application-startup.v1",'))return null;
      return ()=>usaspendingStartup(request,text,context);
    },{lineLimit:32768});
  },
};
