// MIT. The portfolio uses the original accounting command and shared Applications owner.
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../application-provider.mjs';
import {portfolioApplication,preparePortfolioApplication,portfolioStartup} from '../application-portfolio.mjs';
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'client-portfolio',order:257,
  catalog({common}){return [portfolioApplication(common)];},
  prepare(type,settings,context){return preparePortfolioApplication(settings,context.inputPath,context.runtimeDirectory);},
  matchRequest(request){
    return !request.pythonCommand&&request.command==='merchant-accounting-workspace'&&Array.isArray(request.args)&&
      request.args.includes('--portfolio-config')&&!request.args.includes('--managed-launch-sha256');
  },
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"stellar-forge.accounting-workspace-startup.v1",'))return null;
      return ()=>portfolioStartup(request,text);
    },{lineLimit:128*1024});
  },
};
