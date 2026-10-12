// MIT. A selected merchant in this exact workspace uses the same native handler without an HTTP lock cycle.
import { requireValue as need } from '../mpp-charge/storage.mjs';
import { createPublicHttpsFetch } from '../sf31-buyer-client/public-transport.mjs';
const local=new WeakMap();
function key(origin,profileId,channel){return origin+'\n'+profileId+'\n'+channel;}
export function registerLocalMerchant(workspace,merchant){
  let routes=local.get(workspace);if(!routes){routes=new Map();local.set(workspace,routes);}
  const selected=key(merchant.config.publicOrigin,merchant.profileId,merchant.config.channel.address);
  need(!routes.has(selected),'MPP_CHANNEL_LOCAL_MERCHANT_ALREADY_ACTIVE',409);
  const entry={merchant};routes.set(selected,entry);
  return()=>{if(routes.get(selected)===entry)routes.delete(selected);};
}
export async function channelFetch(workspace,config,url,options){
  const selected=key(new URL(url).origin,config.merchantProfileSha256,config.channel.address);
  const receiver=local.get(workspace)?.get(selected);
  if(receiver)return receiver.merchant.handle(new Request(url,options));
  return createPublicHttpsFetch({timeoutMs:300000,paymentAuthorization:true,
    trustedProxy:config.transport ?? null})(url,options);
}
