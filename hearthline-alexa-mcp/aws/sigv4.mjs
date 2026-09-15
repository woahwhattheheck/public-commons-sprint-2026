import { createHash, createHmac } from 'node:crypto';

function sha256(value, encoding = 'hex') {
  return createHash('sha256').update(value).digest(encoding);
}

function hmac(key, value, encoding) {
  return createHmac('sha256', key).update(value).digest(encoding);
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUri(pathname) {
  if (!pathname) return '/';
  return pathname.split('/').map((part) => awsEncode(decodeURIComponent(part))).join('/') || '/';
}

function canonicalQuery(searchParams) {
  const pairs = [];
  for (const [key, value] of searchParams) pairs.push([awsEncode(key), awsEncode(value)]);
  pairs.sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
  return pairs.map(([key, value]) => `${key}=${value}`).join('&');
}

function normalizeHeaderValue(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}

function toAmzDate(value = new Date()) {
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  return iso.replace(/[:-]|\.\d{3}/g, '');
}

function assertCredentialPart(value, label) {
  if (!value || /[\r\n]/.test(String(value))) throw new Error(`${label} is required and must be single-line`);
}

export function signAwsRequest({
  method = 'POST',
  url,
  region,
  service,
  body = '',
  headers = {},
  credentials,
  now = new Date(),
}) {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error('AWS SigV4 endpoint must use https');
  if (!region || !/^[a-z0-9-]{3,32}$/.test(region)) throw new Error('invalid AWS region');
  if (!service || !/^[a-z0-9-]{1,64}$/.test(service)) throw new Error('invalid AWS service');
  assertCredentialPart(credentials?.accessKeyId, 'AWS access key id');
  assertCredentialPart(credentials?.secretAccessKey, 'AWS secret access key');

  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payload = typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array ? body : JSON.stringify(body);
  const payloadHash = sha256(payload);
  const normalized = new Map();
  for (const [name, value] of Object.entries(headers)) normalized.set(name.toLowerCase(), normalizeHeaderValue(value));
  normalized.set('host', target.host);
  normalized.set('x-amz-date', amzDate);
  normalized.set('x-amz-content-sha256', payloadHash);
  if (credentials.sessionToken) {
    assertCredentialPart(credentials.sessionToken, 'AWS session token');
    normalized.set('x-amz-security-token', normalizeHeaderValue(credentials.sessionToken));
  }
  const names = [...normalized.keys()].sort();
  const canonicalHeaders = names.map((name) => `${name}:${normalized.get(name)}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(target.pathname),
    canonicalQuery(target.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign, 'hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const outHeaders = Object.fromEntries([...normalized.entries()]);
  outHeaders.authorization = authorization;
  return {
    method: method.toUpperCase(),
    url: target.toString(),
    body: payload,
    headers: outHeaders,
    canonicalRequest,
    stringToSign,
    signature,
    signedHeaders,
    payloadHash,
    amzDate,
  };
}

export function redactAwsHeaders(headers) {
  const redacted = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = name.toLowerCase();
    redacted[key] = ['authorization', 'x-amz-security-token'].includes(key) ? '[REDACTED]' : String(value);
  }
  return redacted;
}
