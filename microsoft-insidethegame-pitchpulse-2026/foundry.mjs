/** Optional Microsoft Foundry / Azure OpenAI v1 chat adapter.
 *  Deliberately never invoked during demo replay; only on a specific user action.
 *  Provider output is a draft, not a verified match fact.
 */
export function foundryConfigured(env=process.env){
  return Boolean(env.FOUNDRY_ENDPOINT && env.FOUNDRY_DEPLOYMENT && env.FOUNDRY_API_KEY);
}

export async function draftFoundryExplanation(snapshot,{env=process.env,fetchImpl=fetch}={}){
  if(!foundryConfigured(env))return {status:'not-configured',text:'Microsoft Foundry is not configured. Deterministic rule-linked overlays remain available offline.'};
  const origin=new URL(env.FOUNDRY_ENDPOINT);
  const hostname=origin.hostname.toLowerCase();
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.port||
     !(hostname.endsWith('.openai.azure.com')||hostname.endsWith('.services.ai.azure.com')))
    throw new Error('FOUNDRY_ENDPOINT must be an official Azure Foundry HTTPS resource origin');
  const input={match:snapshot.fixture,clockSecond:snapshot.clockSecond,
    scoreboard:snapshot.scoreboard,control:snapshot.control,
    latestRuleLinkedOverlay:snapshot.overlays.at(-1)??null,
    explanation:snapshot.explanation};
  const response=await fetchImpl(`${origin.origin}/openai/v1/chat/completions`,{
    method:'POST',headers:{'content-type':'application/json','api-key':env.FOUNDRY_API_KEY},
    signal:AbortSignal.timeout(6000),
    body:JSON.stringify({model:env.FOUNDRY_DEPLOYMENT,temperature:0.2,max_completion_tokens:160,
      messages:[
        {role:'system',content:'Write a grounded, neutral football studio overlay, at most 45 words. Use ONLY numeric facts, synthetic teams, clock and sourced rule IDs provided. Do not invent goals, players, outcomes, probabilities or live broadcasts. State no facts beyond the evidence. Return plain text only.'},
        {role:'user',content:JSON.stringify(input)}
      ]})
  });
  if(!response.ok)throw new Error(`Foundry request failed: HTTP ${response.status}`);
  const json=await response.json();
  const text=json?.choices?.[0]?.message?.content;
  if(typeof text!=='string'||!text.trim())throw new Error('Foundry returned no usable text');
  return {status:'model-draft',text:text.trim().slice(0,800),model:env.FOUNDRY_DEPLOYMENT,
    warning:'Model-drafted commentary; confirm each statement against the accompanying ledger facts before broadcast.',
    provenance:{eventIds:input.latestRuleLinkedOverlay?.proof.eventIds??[],rule:input.latestRuleLinkedOverlay?.proof.rule??'none'}};
}