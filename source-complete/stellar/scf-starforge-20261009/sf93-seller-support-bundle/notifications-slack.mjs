// MIT. Slack delivery for the original SF93 incident queue.
import {request as httpsRequest} from 'node:https';
import {createHash} from 'node:crypto';

const API = 'https://slack.com/api/';
const identities = new Map();
const digest = value => createHash('sha256').update(value).digest('hex');
export const slackTeamId = /^T[A-Z0-9]{8,31}$/;
export const slackChannelId = /^[CGD][A-Z0-9]{8,31}$/;
export const slackTimestamp = /^[1-9][0-9]{8,15}\.[0-9]{1,6}$/;
const actorId = /^[UW][A-Z0-9]{8,31}$/;
const transient = new Set(['ratelimited','rate_limited','internal_error','fatal_error',
  'service_unavailable','request_timeout','org_login_required','team_added_to_org']);

/** Resolve the selected workspace/channel, keeping the token only in memory. */
export function resolveSlackDestination(config, environment) {
  const token = environment[config.tokenEnv];
  if (typeof token !== 'string' || token.length < 16 || token.length > 4096 || /[^\x21-\x7e]/.test(token))
    return {reason:'SLACK_TOKEN_UNAVAILABLE'};
  if (!slackTeamId.test(config.teamId) || !slackChannelId.test(config.channelId))
    return {reason:'SLACK_DESTINATION_INVALID'};
  const endpointHash = digest(JSON.stringify([API,config.teamId,config.channelId]));
  return {transport:'slack',token,teamId:config.teamId,channelId:config.channelId,
    binding:{id:config.id,transport:'slack',tokenEnv:config.tokenEnv,
      teamId:config.teamId,channelId:config.channelId,endpointHash}};
}

const labels = {ENDPOINT_UNAVAILABLE:'Merchant endpoint unavailable',OBSERVER_INCOMPLETE:'Merchant observations incomplete',
  HTTP_5XX:'Merchant server errors',DISCONNECTED:'Merchant connections interrupted',
  DELIVERY_UNAVAILABLE:'Delivery observations unavailable',DELIVERY_BACKLOG:'Merchant delivery backlog',
  DELIVERY_EXHAUSTED:'Merchant delivery attempts exhausted'};
const transitions = {OPENED:'Opened',ACKNOWLEDGED:'Acknowledged',RECOVERED:'Recovered',RETIRED:'Registration retired',REMINDER:'Operator reminder'};
const countLabels = {requests:'Requests',failures:'Failures',percent:'Failure percentage',minimum:'Minimum count',
  thresholdPercent:'Threshold percentage',pending:'Pending deliveries',exhausted:'Exhausted deliveries',
  oldestPendingSeconds:'Oldest pending delivery (seconds)',thresholdSeconds:'Age threshold (seconds)',
  observerErrors:'Observer errors',consecutivePolls:'Consecutive observations',windowMinutes:'Observation window (minutes)'};

/** Format only the original allowlisted notification fields. */
export function slackMessage(event, destination) {
  const p = JSON.parse(event.body);
  const lines = [
    `${transitions[p.transition]}: ${labels[p.kind]}`,
    `Merchant: ${p.merchantId}`,
    `Incident: ${p.incidentId}`,
    `State: ${p.status}`,
    `Observed: ${p.occurredAt}`,
    `Opened: ${p.openedAt}`,
  ];
  for (const [name,label] of Object.entries(countLabels))
    if (Object.hasOwn(p.counts,name)) lines.push(`${label}: ${p.counts[name]}`);
  if (p.sessionId) lines.push(`Source session: ${p.sessionId}`);
  lines.push('',p.status === 'OPEN'
    ? 'Acknowledge this incident in the merchant support controls and continue its original recovery.'
    : p.status === 'ACKNOWLEDGED'
      ? 'Operator acknowledgment is recorded. Recovery continues in the original merchant support controls.'
      : p.status === 'RECOVERED'
        ? 'The original watcher observed recovery. Its before and after captures are available in merchant support.'
        : 'Review the original registration change in merchant support.',
    `Event: ${p.eventId}`);
  const body = {channel:destination.channelId,text:lines.join('\n'),mrkdwn:false,
    parse:'none',unfurl_links:false,unfurl_media:false,reply_broadcast:false,
    client_msg_id:event.id};
  if (event.slackThreadTs != null) {
    if (!slackTimestamp.test(event.slackThreadTs)) throw new Error('SF93_SLACK_THREAD_INVALID');
    body.thread_ts = event.slackThreadTs;
  }
  return body;
}

/** Retain the complete request before admission; retries survive formatter updates. */
export function prepareSlackRequest(event, destination) {
  const slackRequestBody = JSON.stringify(slackMessage(event,destination));
  return {slackRequestBody,slackRequestHash:digest(slackRequestBody)};
}

export function validSlackRequest(event) {
  if (event.binding?.transport !== 'slack' || !Object.hasOwn(event,'slackThreadTs') ||
      event.slackThreadTs !== null && !slackTimestamp.test(event.slackThreadTs) ||
      typeof event.slackRequestBody !== 'string' || Buffer.byteLength(event.slackRequestBody) > 12_000 ||
      digest(event.slackRequestBody) !== event.slackRequestHash) return false;
  let body;
  try {body = JSON.parse(event.slackRequestBody);} catch {return false;}
  return body && !Array.isArray(body) && body.channel === event.binding.channelId &&
    body.client_msg_id === event.id && typeof body.text === 'string' && body.text.length > 0 && body.text.length <= 8_000 &&
    body.mrkdwn === false && body.parse === 'none' && body.unfurl_links === false &&
    body.unfurl_media === false && body.reply_broadcast === false &&
    Object.keys(body).every(key => ['channel','text','mrkdwn','parse','unfurl_links','unfurl_media',
      'reply_broadcast','client_msg_id','thread_ts'].includes(key)) &&
    (event.slackThreadTs === null ? !Object.hasOwn(body,'thread_ts') : body.thread_ts === event.slackThreadTs);
}

function retryAfter(value, now) {
  if (typeof value !== 'string' || value.length > 128) return null;
  const milliseconds = /^[0-9]+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  // Preserve the provider's complete wait; the ordinary backoff cap cannot shorten it.
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0 && milliseconds <= 8.64e15 - now
    ? milliseconds : null;
}

/** Fixed Slack origin, bounded response and one absolute request deadline. */
async function call(method, body, token, {signal,timeoutMs,request=httpsRequest}) {
  if (!['auth.test','chat.postMessage'].includes(method)) throw new TypeError('SF93_SLACK_METHOD_INVALID');
  const encoded = typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise(resolve => {
    let finished = false, timer, req, status = null, retryAfterMs = null;
    const finish = result => {if (!finished) {finished = true;clearTimeout(timer);resolve(result);}};
    try {
      req = request(new URL(API + method), {method:'POST',agent:false,signal,
        headers:{authorization:'Bearer ' + token,'content-type':'application/json; charset=utf-8',
          'content-length':Buffer.byteLength(encoded),'user-agent':'stellar-forge-sf93/1'}}, res => {
        let size = 0;const chunks = [];
        status = res.statusCode;
        retryAfterMs = retryAfter(res.headers['retry-after'],Date.now());
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 65_536) {
            finish({accepted:false,status,reason:'SLACK_RESPONSE_TOO_LARGE',retryable:true,retryAfterMs});req.destroy();
          } else chunks.push(chunk);
        });
        res.once('aborted', () => finish({accepted:false,status,reason:'SLACK_RESPONSE_ABORTED',retryable:true,retryAfterMs}));
        res.once('error', () => finish({accepted:false,status,reason:'SLACK_RESPONSE_ERROR',retryable:true,retryAfterMs}));
        res.once('end', () => {
          if (status < 200 || status >= 300) {
            finish({accepted:false,status,reason:'SLACK_HTTP_' + status,
              retryable:[408,425,429].includes(status) || status >= 500,retryAfterMs});return;
          }
          let value;
          try {value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
          catch {finish({accepted:false,status,reason:'SLACK_RESPONSE_INVALID',retryable:true,retryAfterMs});return;}
          if (value?.ok !== true) {
            const code = typeof value?.error === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(value.error)
              ? value.error : 'response_invalid';
            finish({accepted:false,status,reason:'SLACK_' + code.toUpperCase(),
              retryable:transient.has(code) || code === 'response_invalid',retryAfterMs});return;
          }
          finish({accepted:true,status,value,retryAfterMs});
        });
      });
      timer = setTimeout(() => {
        finish({accepted:false,status,reason:'SLACK_DEADLINE',retryable:true,retryAfterMs});req.destroy();
      },Math.max(1,timeoutMs));
      req.once('error', () => finish({accepted:false,status,
        reason:signal?.aborted ? 'CANCELLED' : 'SLACK_NETWORK_ERROR',retryable:true,retryAfterMs}));
      req.end(encoded);
    } catch {
      finish({accepted:false,status,reason:signal?.aborted ? 'CANCELLED' : 'SLACK_REQUEST_ERROR',retryable:true,retryAfterMs});
      req?.destroy();
    }
  });
}

async function identity(destination, options) {
  const key = digest(destination.token + '\0' + destination.teamId);
  const previous = identities.get(key);
  if (!options.fresh && previous && previous.until > Date.now())
    return {accepted:true,status:200,identity:previous.identity};
  const result = await call('auth.test',{},destination.token,options);
  if (!result.accepted) return result;
  if (result.value.team_id !== destination.teamId)
    return {accepted:false,status:result.status,reason:'SLACK_WORKSPACE_MISMATCH',retryable:false};
  if (!actorId.test(result.value.user_id ?? ''))
    return {accepted:false,status:result.status,reason:'SLACK_IDENTITY_INVALID',retryable:false};
  const identity = {teamId:result.value.team_id,actorId:result.value.user_id};
  if (/^B[A-Z0-9]{8,31}$/.test(result.value.bot_id ?? '')) identity.botId = result.value.bot_id;
  // Entries contain identity metadata, never token values. Keep the cache small.
  for (const [id,entry] of identities) if (entry.until <= Date.now()) identities.delete(id);
  if (identities.size >= 16) identities.delete(identities.keys().next().value);
  identities.set(key,{identity,until:Date.now() + 300_000});
  return {accepted:true,status:result.status,identity};
}

/** Read-only actor/workspace verification for the configured destination. */
export async function inspectSlackDestination(destination, options, {signal,request} = {}) {
  const result = await identity(destination,{signal,request,timeoutMs:options.timeoutMs,fresh:true});
  if (!result.accepted) return result;
  return {accepted:true,status:result.status,reason:'SLACK_IDENTITY_VERIFIED',
    ...result.identity,channelId:destination.channelId,destinationId:destination.binding.id};
}

export function validSlackReceipt(receipt, event) {
  return receipt?.transport === 'slack' && slackTeamId.test(receipt.teamId ?? '') &&
    slackChannelId.test(receipt.channelId ?? '') && actorId.test(receipt.actorId ?? '') &&
    slackTimestamp.test(receipt.messageTs ?? '') && slackTimestamp.test(receipt.threadTs ?? '') &&
    (receipt.botId === undefined || /^B[A-Z0-9]{8,31}$/.test(receipt.botId)) &&
    Object.keys(receipt).every(key => ['transport','teamId','channelId','actorId','botId','messageTs','threadTs'].includes(key)) &&
    (!event || event.binding?.transport === 'slack' && receipt.teamId === event.binding.teamId &&
      receipt.channelId === event.binding.channelId &&
      receipt.threadTs === (event.slackThreadTs ?? receipt.messageTs));
}

/** Authentication and delivery share the original queue attempt's deadline. */
export async function deliverSlackNotification(event, destination, options, {signal,request} = {}) {
  if (!validSlackRequest(event) || event.binding.channelId !== destination.channelId ||
      event.binding.teamId !== destination.teamId)
    return {accepted:false,status:null,reason:'SLACK_REQUEST_NOT_PINNED',retryable:false};
  const deadline = Date.now() + options.timeoutMs;
  const verified = await identity(destination,{signal,request,timeoutMs:options.timeoutMs});
  if (!verified.accepted) return verified;
  const remaining = deadline - Date.now();
  if (remaining <= 0 || signal?.aborted)
    return {accepted:false,status:null,reason:signal?.aborted ? 'CANCELLED' : 'SLACK_DEADLINE',retryable:true};
  const result = await call('chat.postMessage',event.slackRequestBody,destination.token,
    {signal,request,timeoutMs:remaining});
  if (!result.accepted) return result;
  const message = result.value;
  const receipt = {transport:'slack',...verified.identity,channelId:message.channel,
    messageTs:message.ts,threadTs:event.slackThreadTs ?? message.ts};
  if (!validSlackReceipt(receipt,event) || (event.slackThreadTs !== null
      ? message.message?.thread_ts !== event.slackThreadTs
      : message.message?.thread_ts != null && message.message.thread_ts !== message.ts))
    return {accepted:false,status:result.status,reason:'SLACK_RECEIPT_MISMATCH',retryable:false};
  return {accepted:true,status:result.status,reason:'SLACK_MESSAGE_ACCEPTED',retryable:false,providerReceipt:receipt};
}
