import { createHash } from 'node:crypto';
import {DEMO,plan} from './engine.mjs';
const hash=(value)=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,16);
/** Explicit proposal -> approval -> simulated execution. Zero external device calls. */
export function makeAgent(){
  let proposal=null, approvedId=null, receipt=null, revision=0;
  const history=[];
  function offer(input=DEMO){
    const result=plan(input);
    revision++;
    proposal={...result,id:hash({revision,result}),revision};
    approvedId=null;receipt=null;
    history.push({kind:'plan',revision,planId:proposal.id,avoidedCost:result.avoidedCost});
    return view();
  }
  function view(){return {proposal,approved:approvedId===proposal?.id,receipt,history:history.slice(-30),status:!proposal?'empty':receipt?'executed':approvedId?'approved':'proposed'};}
  function approve(id){
    if(!proposal||id!==proposal.id)throw Error('Stale or unknown plan: generate a new proposal');
    if(receipt)throw Error('Executed plan cannot be reapproved');
    if(approvedId!==id){approvedId=id;history.push({kind:'human-approval',planId:id});}
    return view();
  }
  function execute(id){
    if(!proposal||id!==proposal.id||approvedId!==id)throw Error('Exact plan must be approved before execution');
    if(receipt)return view(); // Idempotent replay: no duplicate simulated dispatch.
    receipt={id:hash({id,kind:'simulation'}),planId:id,simulated:true,liveDeviceCalls:0,
      commands:proposal.optimized.items.map(x=>({device:x.id,startHour:x.start,endHour:x.end,action:'SIMULATE_SCHEDULE'})),
      statement:'No electricity, appliance, smart-home service or API was changed.'};
    history.push({kind:'simulated-execution',planId:id,receiptId:receipt.id});
    return view();
  }
  function cancel(){proposal=null;approvedId=null;receipt=null;history.push({kind:'cancel'});return view();}
  function say(sentence){
    if(typeof sentence!=='string'||sentence.length>240)throw Error('Command must be text <=240 chars');
    const words=sentence.trim().toLowerCase();
    // Negative commands must NEVER turn into positive scheduling or reset actions.
    if(/\b(?:don't|do not|never|not)\s+(?:[\w-]+\s+){0,3}(?:plan|save|schedule|optimize|cancel|reset|discard)\b/.test(words))
      throw Error('Negated action not executed; use a direct explicit command');
    const cancelIntent=/\b(cancel|reset|discard)\b/.test(words);
    const readIntent=/\b(explain|status|why|show)\b/.test(words);
    const planIntent=/\b(plan|save|cheaper|schedule|optimize)\b/.test(words);
    if(cancelIntent&&readIntent)throw Error('Ambiguous command: ask for status or cancel separately');
    if(cancelIntent)return cancel(); // "cancel the plan" must cancel, never regenerate.
    if(readIntent)return view(); // "explain the plan" is read-only.
    if(planIntent)return offer();
    throw Error('Try "find a cheaper schedule", "explain the plan", or use explicit approval controls.');
  }
  return {offer,view,approve,execute,cancel,say};
}
