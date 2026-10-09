// Native Anthropic Messages transport, advisory text only. No payment authority.
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

export async function anthropicCompletionText({ apiKey, model, userContent, system, transport = fetch }) {
  if (!apiKey || !model || typeof system !== 'string' || typeof userContent !== 'string') {
    throw new TypeError('Anthropic advisory configuration is invalid');
  }
  const res = await transport(MESSAGES_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 768,
      temperature: 0.1,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
    signal: AbortSignal.timeout(18000),
  });
  if (!res.ok) throw new Error(`Anthropic advisory HTTP ${res.status}`);
  const data = await res.json();
  if (data?.type !== 'message' || data.stop_reason !== 'end_turn' ||
      !Array.isArray(data.content) || data.content.length !== 1 ||
      data.content[0]?.type !== 'text' ||
      typeof data.content[0].text !== 'string' || data.content[0].text.length > 6000) {
    throw new TypeError('Anthropic advisory response is malformed or incomplete');
  }
  return data.content[0].text;
}
