#!/usr/bin/env node
// MIT. Customer application for the original SF30 Exa Answer merchant route.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Buyer } from '../index.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const usage = [
  'Original Exa Answer merchant customer',
  '',
  'node examples/exa-answer.mjs review --runtime SF88_DIR --state PRIVATE_DIR',
  '  --profile OPERATOR_PROFILE.json --client TRUSTED_SELLER_CLIENT.mjs',
  '  --query-file QUESTION.txt --intent STABLE_ID --max-atomic CAP --accept INDEX',
  '  [--operation exa-answer] [--request-timeout-ms 180000]',
  'node examples/exa-answer.mjs execute --runtime SF88_DIR --state PRIVATE_DIR',
  '  --intent STABLE_ID [--out NEW_REPORT.json]',
  'node examples/exa-answer.mjs recover --runtime SF88_DIR --state PRIVATE_DIR',
  '  --intent STABLE_ID [--partial] [--out NEW_REPORT.json]',
  '',
  'review creates an immutable operation using the original generated client.',
  'execute enters the existing native terminal approval and attempts it once.',
  'recover reads the same retained result; --partial selects its complete prefix.',
  'The merchant owns Exa credentials. The buyer supplies only the question.',
].join('\n');

/**
 * Consume the actual retained Answer representation. Citation objects retain
 * every original field; later chunks may add detail to the same source.
 * Primary contract: Exa Answer docs and exa-js 4430719181718117889247dc31bd5cd9e7ca459b.
 */
export async function readExaAnswer(result, { allowPartial = false, signal } = {}) {
  const fragments = [], citations = new Map();
  let providerDoneMarkerSeen = false, records = 0, lastEventIndex = null;
  for await (const event of result.events({ allowPartial, signal })) {
    records++; lastEventIndex = event.index;
    if (event.data.trim() === '') continue;
    // Continue consuming to the original EOF and final retained-file check.
    if (event.data.trim() === '[DONE]') { providerDoneMarkerSeen = true; continue; }
    let payload;
    try { payload = JSON.parse(event.data); }
    catch { throw Object.assign(new Error('EXA_EVENT_JSON_INVALID'), { code: 'EXA_EVENT_JSON_INVALID' }); }
    need(object(payload), 'EXA_EVENT_OBJECT_REQUIRED');
    need(payload.error === undefined || payload.error === null, 'EXA_ANSWER_PROVIDER_ERROR');
    const content = payload.choices?.[0]?.delta?.content;
    if (content !== undefined && content !== null) {
      need(typeof content === 'string', 'EXA_ANSWER_DELTA_INVALID');
      fragments.push(content);
    }
    // The native API places sources at the top level, outside choices[].delta.
    if (payload.citations !== undefined && payload.citations !== null && payload.citations !== 'null') {
      need(Array.isArray(payload.citations), 'EXA_ANSWER_CITATIONS_INVALID');
      for (const citation of payload.citations) {
        need(object(citation) && typeof citation.id === 'string' &&
          typeof citation.url === 'string', 'EXA_ANSWER_CITATION_INVALID');
        const key = JSON.stringify([citation.id, citation.url]);
        citations.set(key, { ...citations.get(key), ...citation });
      }
    }
  }
  return {
    answer: fragments.join(''), citations: [...citations.values()],
    providerDoneMarkerSeen, records, lastEventIndex,
    captureComplete: result.delivery.status === 'SAVED' && result.stream?.complete === true,
  };
}

function argumentsFor(mode, args) {
  const allowed = new Set(['runtime', 'state', 'intent', ...(mode === 'review'
    ? ['profile', 'client', 'query-file', 'max-atomic', 'accept', 'operation', 'request-timeout-ms']
    : ['out', ...(mode === 'recover' ? ['partial'] : [])])]);
  const flags = {};
  for (let index = 0; index < args.length; index++) {
    const token = args[index], key = token?.slice(2);
    need(token?.startsWith('--') && allowed.has(key) && !Object.hasOwn(flags, key), 'ARGUMENTS_INVALID');
    if (key === 'partial') flags[key] = true;
    else {
      const value = args[++index];
      need(typeof value === 'string' && value.length > 0 && !value.startsWith('--'), 'ARGUMENT_VALUE_REQUIRED');
      flags[key] = value;
    }
  }
  const required = name => { need(flags[name], 'REQUIRED_ARGUMENT_' + name.toUpperCase().replaceAll('-', '_')); return flags[name]; };
  const integer = (name, fallback, minimum, maximum) => {
    const value = flags[name] ?? String(fallback);
    need(/^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)) &&
      Number(value) >= minimum && Number(value) <= maximum, 'INTEGER_ARGUMENT_INVALID');
    return Number(value);
  };
  return { flags, required, integer };
}

export async function main([mode, ...args] = process.argv.slice(2)) {
  if (!mode || mode === '--help') { console.log(usage); return; }
  need(['review', 'execute', 'recover'].includes(mode), 'MODE_INVALID');
  const { flags, required, integer } = argumentsFor(mode, args);
  const buyer = new Buyer({
    runtimeDirectory: resolve(required('runtime')),
    stateDirectory: resolve(required('state')),
    ...(mode === 'review' ? { operatorProfile: resolve(required('profile')) } : {}),
  });
  const intentId = required('intent');
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (mode === 'review') {
      const raw = await readFile(resolve(required('query-file')));
      need(raw.length >= 1 && raw.length <= 8000, 'EXA_QUERY_BYTE_LIMIT');
      let query;
      try { query = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
      catch { throw Object.assign(new Error('EXA_QUERY_UTF8_INVALID'), { code: 'EXA_QUERY_UTF8_INVALID' }); }
      need(query.trim().length > 0, 'EXA_QUERY_REQUIRED');
      const module = await import(pathToFileURL(resolve(required('client'))).href);
      need(typeof module.createSellerClient === 'function', 'ORIGINAL_SELLER_CLIENT_REQUIRED');
      const api = module.createSellerClient({ buyer });
      const request = api.request(flags.operation ?? 'exa-answer', { body: { query } }, {
        intentId, maxAtomic: required('max-atomic'), acceptIndex: integer('accept', required('accept'), 0, 31),
        paymentFlow: 'upfront', signal: controller.signal,
      });
      need(request.method === 'POST' && new URL(request.url).pathname === '/research/answer',
        'EXA_MERCHANT_OPERATION_MISMATCH');
      const operation = await buyer.fromRequest(request, {
        requestTimeoutMs: integer('request-timeout-ms', 180000, 1, 300000),
        responseFile: { maxBytes: 32 * 1024 * 1024, timeoutMs: 120000,
          stream: { format: 'sse', maxRecordBytes: 1048576, maxRecords: 100000 } },
      });
      console.log(JSON.stringify(await operation.review(), null, 2));
      return;
    }
    const operation = buyer.operation(intentId);
    const result = mode === 'execute'
      ? await operation.execute({ review: await operation.review(), signal: controller.signal })
      : await operation.recover();
    need(result !== null, 'ORIGINAL_RESULT_NOT_AVAILABLE');
    const report = {
      intentId, native: result.native,
      process: { exitCode: result.record.exitCode, exitSignal: result.record.exitSignal,
        runtimeError: result.record.runtimeError, recovered: result.record.recovered },
    };
    if (result.delivery.status === 'SAVED' || flags.partial === true) {
      report.answer = await readExaAnswer(result, {
        allowPartial: flags.partial === true, signal: controller.signal,
      });
    }
    if (flags.out) await writeFile(resolve(flags.out), JSON.stringify(report, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
    if (!result.ok || result.delivery.status !== 'SAVED') process.exitCode = 2;
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(JSON.stringify({ error: error?.code ?? 'EXA_CUSTOMER_OPERATION_FAILED' }));
    process.exitCode = 1;
  });
}
