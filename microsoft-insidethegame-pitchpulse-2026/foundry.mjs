/** Optional Microsoft Foundry / Azure OpenAI v1 chat adapter.
 *  Never invoked during replay; provider output remains an unverified draft.
 */
const MAX_BYTES=64*1024;
export function foundryConfigured(env=process.env){
  return Boolean(env.FOUNDRY_ENDPOINT && env.FOUNDRY_DEPLOYMENT && env.FOUNDRY_API_KEY);
}

async function boundedJson(response,deadline){
  const length=response.headers.get('content-length');
  if(length&&/^\d+$/.test(length)&&Number(length)>MAX_BYTES)throw new Error('Foundry response exceeds 64 KiB');
  if(!response.body)throw new Error('Foundry returned no response body');
  const reader=response.body.getReader();
  let bytes=0;
  const chunks=[];
  try{
    while(true){
      const {done,value}=await Promise.race([reader.read(),deadline]);
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_BYTES)throw new Error('Foundry response exceeds 64 KiB');
      chunks.push(value);
    }
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));}
    catch{throw new Error('Foundry returned invalid JSON');}
  }finally{
    // Do not let an uncooperative cancel promise defeat the request deadline.
    void reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}

export async function draftFoundryExplanation(snapshot,{env=process.env,fetchImpl=fetch,timeoutMs=6000}={}){
  if(!foundryConfigured(env))return {status:'not-configured',text:'Microsoft Foundry is not configured. Deterministic rule-linked overlays remain available offline.'};
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid Foundry timeout');
  let origin;
  try{origin=new URL(env.FOUNDRY_ENDPOINT);}catch{throw new Error('Invalid Foundry resource origin');}
  const hostname=origin.hostname.toLowerCase();
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.port||
     origin.pathname!=='/'||origin.search||origin.hash||
     !(hostname.endsWith('.openai.azure.com')||hostname.endsWith('.services.ai.azure.com')))
    throw new Error('FOUNDRY_ENDPOINT must be an official Azure Foundry HTTPS resource origin');
  const input={match:snapshot.fixture,clockSecond:snapshot.clockSecond,
    scoreboard:snapshot.scoreboard,control:snapshot.control,
    latestRuleLinkedOverlay:snapshot.overlays.at(-1)??null,
    explanation:snapshot.explanation};
  const body=JSON.stringify({model:env.FOUNDRY_DEPLOYMENT,temperature:0.2,max_completion_tokens:160,
    messages:[
      {role:'system',content:'Write a grounded, neutral football studio overlay, at most 45 words. Use ONLY numeric facts, synthetic teams, clock and sourced rule IDs provided. Do not invent goals, players, outcomes, probabilities or live broadcasts. State no facts beyond the evidence. Return plain text only.'},
      {role:'user',content:JSON.stringify(input)}
    ]});
  if(Buffer.byteLength(body,'utf8')>MAX_BYTES)throw new Error('Foundry request exceeds 64 KiB');
  const controller=new AbortController();
  let timer,response;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new Error('Foundry request timed out'));},timeoutMs);
  });
  try{
    response=await Promise.race([fetchImpl(`${origin.origin}/openai/v1/chat/completions`,{
      method:'POST',redirect:'manual',
      headers:{'content-type':'application/json','api-key':env.FOUNDRY_API_KEY},
      signal:controller.signal,body
    }),deadline]);
    if(response.status>=300&&response.status<400)throw new Error('Foundry redirect refused');
    if(!response.ok)throw new Error(`Foundry request failed: HTTP ${response.status}`);
    const json=await boundedJson(response,deadline);
    const text=json?.choices?.[0]?.message?.content;
    if(typeof text!=='string'||!text.trim())throw new Error('Foundry returned no usable text');
    return {status:'model-draft',text:text.trim().slice(0,800),model:env.FOUNDRY_DEPLOYMENT,
      warning:'Model-drafted commentary; confirm each statement against the accompanying ledger facts before broadcast.',
      provenance:{eventIds:input.latestRuleLinkedOverlay?.proof.eventIds??[],rule:input.latestRuleLinkedOverlay?.proof.rule??'none'}};
  }finally{
    clearTimeout(timer);
    if(response?.body&&!response.bodyUsed)void response.body.cancel().catch(()=>{});
  }
}
