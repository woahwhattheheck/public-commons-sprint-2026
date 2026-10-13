// MIT. Retain original callbacks without inventing an unsigned verification contract.
import {invariant,parseSourceJSON,sha256} from './source-json.mjs';
export function verifyWebhook({provider,rawBody,headers,receivedAt,configuration}){
 invariant(['escala','sdp'].includes(provider),'WEBHOOK_PROVIDER_UNSUPPORTED');
 const parsed=parseSourceJSON(rawBody);
 return {verified:false,projectable:false,verifiedData:false,eventTypeAuthenticated:false,
  reason:'No complete issued callback signature/canonicalization/replay contract is selected for this provider profile.',
  value:parsed.value,numberTokens:parsed.numberTokens,bodySha256:sha256(rawBody),eventId:null,receivedAt};
}
