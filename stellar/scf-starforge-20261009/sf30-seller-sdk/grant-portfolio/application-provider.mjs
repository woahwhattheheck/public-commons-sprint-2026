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
      let value;try{value=JSON.parse(text);}catch{return null;}
      if(value?.schema!=='stellar-forge.grant-portfolio-workspace-launch.v1'||
        value.status!=='GRANT_PORTFOLIO_WORKSPACE_READY')return null;
      return ()=>grantPortfolioStartup(request,text);
    },{lineLimit:32768});
  },
};
