// Optional, explicit-use Microsoft Foundry inference. Never runs during replay.
// Resource credentials remain server-side; no request occurs unless configured
// and the visitor presses the optional button. Output is unverified commentary.
export function foundryConfigured(env = process.env) {
  try {
    const base = new URL(env.AZURE_OPENAI_ENDPOINT || '');
    return base.protocol === 'https:' && /^[a-z0-9-]+\.openai\.azure\.com$/i.test(base.hostname) &&
      base.pathname === '/' && !!env.AZURE_OPENAI_API_KEY &&
      /^[A-Za-z0-9_.-]{1,100}$/.test(env.AZURE_OPENAI_DEPLOYMENT || '');
  } catch { return false; }
}

export async function suggestedNarrative(overlay, env = process.env) {
  if (!foundryConfigured(env)) return {used: false, reason: 'Foundry endpoint not configured'};
  if (!overlay || !Array.isArray(overlay.evidenceIds) || !overlay.evidenceIds.length) throw new TypeError('Evidence required');
  const base = new URL(env.AZURE_OPENAI_ENDPOINT);
  const endpoint = new URL('/openai/v1/chat/completions', base);
  const body = {
    model: env.AZURE_OPENAI_DEPLOYMENT,
    messages: [
      {role: 'system', content: 'You draft non-authoritative broadcast copy. Refer ONLY to the supplied synthetic football event evidence. Keep it below 135 characters, avoid real player names and any unobserved statistics. Do not present it as a genuine match.'},
      {role: 'user', content: JSON.stringify({canonicalText: overlay.text, evidenceIds: overlay.evidenceIds, metrics: overlay.metrics, provenance: overlay.provenance})},
    ],
    max_tokens: 90,
    temperature: 0,
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'api-key': env.AZURE_OPENAI_API_KEY},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Foundry request failed (status ' + response.status + ')');
  const length = Number(response.headers.get('content-length'));
  if (length > 16 * 1024) throw new Error('Foundry response size exceeded');
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > 16 * 1024) throw new Error('Foundry response size exceeded');
    chunks.push(chunk);
  }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const text = result?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.length === 0) throw new Error('No model commentary');
  return {used: true, text: text.replace(/[<>\r\n]/g, ' ').slice(0, 135),
    label: 'OPTIONAL FOUNDRY DRAFT · HUMAN VERIFICATION REQUIRED',
    canonicalEvidence: overlay.evidenceIds};
}
