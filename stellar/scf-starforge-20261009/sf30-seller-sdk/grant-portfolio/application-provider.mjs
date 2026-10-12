// MIT. Source-owned Applications registration over the original portfolio operator.
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {grantPortfolioApplication,prepareGrantPortfolioApplication,grantPortfolioStartup} from './application.mjs';
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'grant-portfolio',order:186,
  catalog({common}){return [grantPortfolioApplication(common)];},
  async prepare(type,settings,context){
    const original=await prepareGrantPortfolioApplication(settings,context);
    return {args:original.args,inputs:original.inputs,createDirectories:original.createDirectories};
  },
  matchRequest(request){return !request.pythonCommand&&request.command==='grant-portfolio';},
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"stellar-forge.grant-portfolio-workspace-launch.v1",'))return null;
      return ()=>grantPortfolioStartup(request,text);
    },{lineLimit:32768});
  },
};
