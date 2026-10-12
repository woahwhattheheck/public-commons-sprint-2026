// MIT. Private, explicit merchant registrations and environment references.
import {createHash} from 'node:crypto';
import {loopbackOrigin} from './bundle.mjs';
import {slackTeamId,slackChannelId} from './notifications-slack.mjs';

export const CONFIG_SCHEMA = 'stellar-forge.seller-watch-config.v1';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
export const kinds = ['ENDPOINT_UNAVAILABLE','OBSERVER_INCOMPLETE','HTTP_5XX',
  'DISCONNECTED','DELIVERY_UNAVAILABLE','DELIVERY_BACKLOG','DELIVERY_EXHAUSTED'];
export const activeIncident = item => ['OPEN','ACKNOWLEDGED'].includes(item.status);
const fail = field => {throw new TypeError('SF93_CONFIG_INVALID: '+field);};
function fields(value, names, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !names.includes(key))) fail(label);
  return value;
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(label);
  return value;
}
function text(value, max, label, pattern) {
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value)>max ||
      Buffer.from(value).toString('utf8')!==value ||
      /[\u0000-\u001f\u007f]/.test(value) || (pattern && !pattern.test(value))) fail(label);
  return value;
}
function threshold(value, defaults, label) {
  if (value === null) return null;
  const row = fields(value ?? defaults,['minimum','percent'],label);
  return {minimum:integer(row.minimum,1,1_000_000_000,label+'.minimum'),
    percent:integer(row.percent,0,100,label+'.percent')};
}
export function compileConfig(input) {
  const c = fields(input,['schema','pollMs','failurePolls','recoveryPolls','windowMinutes',
    'captureEveryMs','httpErrors','disconnects','retention','merchants','notification'],'config');
  if (c.schema !== CONFIG_SCHEMA) fail('schema');
  const retention = fields(c.retention ?? {},['closedDays','closedIncidents','notifications','captureBytes'],'retention');
  const result = {schema:CONFIG_SCHEMA,
    pollMs:integer(c.pollMs ?? 10_000,250,300_000,'pollMs'),
    failurePolls:integer(c.failurePolls ?? 2,1,100,'failurePolls'),
    recoveryPolls:integer(c.recoveryPolls ?? 2,1,100,'recoveryPolls'),
    windowMinutes:integer(c.windowMinutes ?? 5,1,60,'windowMinutes'),
    captureEveryMs:integer(c.captureEveryMs ?? 60_000,1000,86_400_000,'captureEveryMs'),
    httpErrors:threshold(c.httpErrors,{minimum:3,percent:10},'httpErrors'),
    disconnects:threshold(c.disconnects,{minimum:3,percent:10},'disconnects'),
    retention:{closedDays:integer(retention.closedDays ?? 30,1,3650,'retention.closedDays'),
      closedIncidents:integer(retention.closedIncidents ?? 200,1,2000,'retention.closedIncidents'),
      notifications:integer(retention.notifications ?? 400,1,2000,'retention.notifications'),
      captureBytes:integer(retention.captureBytes ?? 134_217_728,16_777_216,536_870_912,'retention.captureBytes')},
    merchants:[],notification:null};
  if (!Array.isArray(c.merchants) || c.merchants.length<1 || c.merchants.length>8) fail('1..8 merchants required');
  const ids = new Set();
  for (const value of c.merchants) {
    const m = fields(value,['id','label','seller','ops','delivery'],'merchant');
    const id = text(m.id,64,'merchant.id',idPattern);
    if (ids.has(id) || ['__proto__','constructor','prototype'].includes(id)) fail('duplicate or reserved merchant.id');
    ids.add(id);
    let delivery = null;
    if (m.delivery != null) {
      const d = fields(m.delivery,['required','oldestPendingSeconds','exhausted'],'merchant.delivery');
      if (typeof d.required !== 'boolean') fail('merchant.delivery.required');
      delivery = {required:d.required,
        oldestPendingSeconds:integer(d.oldestPendingSeconds ?? 300,1,31_536_000,'oldestPendingSeconds'),
        exhausted:integer(d.exhausted ?? 1,1,1_000_000_000,'exhausted')};
    }
    result.merchants.push({id,label:text(m.label ?? id,120,'merchant.label'),
      seller:loopbackOrigin(m.seller,'merchant.seller'),ops:loopbackOrigin(m.ops,'merchant.ops'),delivery});
  }
  if (c.notification != null) {
    if (c.notification.transport === 'slack') {
      const n = fields(c.notification,['id','transport','teamId','channelId','tokenEnv',
        'timeoutMs','maxAttempts','retryMs','maxRetryMs','minIntervalMs'],'notification');
      const retryMs = integer(n.retryMs ?? 1000,100,3_600_000,'notification.retryMs');
      result.notification = {id:text(n.id,64,'notification.id',idPattern),transport:'slack',
        teamId:text(n.teamId,32,'notification.teamId',slackTeamId),
        channelId:text(n.channelId,32,'notification.channelId',slackChannelId),
        tokenEnv:text(n.tokenEnv,128,'notification.tokenEnv',/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
        timeoutMs:integer(n.timeoutMs ?? 5000,100,30_000,'notification.timeoutMs'),
        maxAttempts:integer(n.maxAttempts ?? 8,1,100,'notification.maxAttempts'),retryMs,
        maxRetryMs:integer(n.maxRetryMs ?? 3_600_000,retryMs,86_400_000,'notification.maxRetryMs'),
        minIntervalMs:integer(n.minIntervalMs ?? 1100,1000,300_000,'notification.minIntervalMs')};
      return result;
    }
    const n = fields(c.notification,['id','urlEnv','secretEnv','allowLoopback','timeoutMs',
      'maxAttempts','retryMs','maxRetryMs'],'notification');
    const envName = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
    if (n.allowLoopback !== undefined && typeof n.allowLoopback !== 'boolean') fail('notification.allowLoopback');
    const retryMs = integer(n.retryMs ?? 1000,100,3_600_000,'notification.retryMs');
    result.notification = {id:text(n.id,64,'notification.id',idPattern),
      urlEnv:text(n.urlEnv,128,'notification.urlEnv',envName),
      secretEnv:text(n.secretEnv,128,'notification.secretEnv',envName),
      allowLoopback:n.allowLoopback ?? false,
      timeoutMs:integer(n.timeoutMs ?? 5000,100,30_000,'notification.timeoutMs'),
      maxAttempts:integer(n.maxAttempts ?? 8,1,100,'notification.maxAttempts'),retryMs,
      maxRetryMs:integer(n.maxRetryMs ?? 3_600_000,retryMs,86_400_000,'notification.maxRetryMs')};
  }
  return result;
}
export const configHash = config => hash(JSON.stringify(config));
export const merchantBinding = (config, merchant) => hash(JSON.stringify({id:merchant.id,
  seller:merchant.seller,ops:merchant.ops,delivery:merchant.delivery,
  failurePolls:config.failurePolls,recoveryPolls:config.recoveryPolls,
  windowMinutes:config.windowMinutes,httpErrors:config.httpErrors,disconnects:config.disconnects}));

