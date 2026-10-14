// MIT. The installed BIM provider catalogue uses one original Workspace context.
import * as sdk from '@stellar/stellar-sdk';
import {createSoroswapAdapter} from '../lib/soroswap.mjs';
import {createDefindexAdapter} from '../lib/defindex.mjs';
import {createExchangeAdapter} from '../lib/exchange.mjs';
import {createRoutingAdapter} from '../lib/routing.mjs';
import {createMoneyGramAdapter,MONEYGRAM_ACTIONS} from '../lib/moneygram.mjs';
import {createSocketAdapter,SOCKET_ACTIONS} from '../lib/socket.mjs';
import {need,clone} from '../lib/value.mjs';

function selected(ctx,id){
 const configuration=ctx?.config?.providers?.[id];
 need(configuration&&typeof configuration==='object','PROVIDER_CONFIGURATION_REQUIRED',{provider:id});
 return configuration;
}
function moneygram(ctx){
 const c=selected(ctx,'moneygram');
 return createMoneyGramAdapter({environment:c.environment,secretAlias:c.credentialAlias,...(c.publicConfig?.registeredWebhookUrl?{registeredWebhookUrl:c.publicConfig.registeredWebhookUrl}:{})});
}
function socket(ctx){
 const c=selected(ctx,'socket'),p=c.publicConfig??{};
 return createSocketAdapter({access:p.access??c.environment,...(c.credentialAlias?{credentialAlias:c.credentialAlias}:{}),...(p.affiliate?{affiliate:p.affiliate}:{})});
}
function configured(id,actions,factory){
 return{id,actions:clone(actions),
  async prepare(actionId,input,ctx){const adapter=factory(ctx);need(typeof adapter.prepare==='function','PROVIDER_PREPARATION_UNAVAILABLE');return await adapter.prepare(actionId,input,ctx);},
  async execute(actionId,input,ctx){return await factory(ctx).execute(actionId,input,ctx);}
 };
}
export async function createProviders(){
 const soroswap=createSoroswapAdapter({sdk}),exchange=createExchangeAdapter({sdk}),defindex=createDefindexAdapter({sdk});
 return[soroswap,exchange,createRoutingAdapter({adapters:[soroswap,exchange]}),defindex,
  configured('moneygram',MONEYGRAM_ACTIONS,moneygram),configured('socket',SOCKET_ACTIONS,socket)];
}
