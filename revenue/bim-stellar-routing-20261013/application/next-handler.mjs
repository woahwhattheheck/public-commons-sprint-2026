// MIT. Import this module only in a Next.js Node server route, never a client bundle.
import {openWorkspace} from './lib/workspace.mjs';
import {createRouteHandler} from './lib/routes.mjs';
export async function createBimNextHandler(options){
 const workspace=await openWorkspace(options);
 const handle=createRouteHandler({workspace,token:options.token,authorize:options.authorize,apiPrefix:options.apiPrefix??'/api/bim',allowedOrigins:options.allowedOrigins,settlementReaders:options.settlementReaders});
 return {workspace,GET:handle,POST:handle,close:()=>workspace.close()};
}
