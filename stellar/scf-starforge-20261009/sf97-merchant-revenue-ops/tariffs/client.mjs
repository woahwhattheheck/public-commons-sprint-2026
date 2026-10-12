/**
 * Typed HTTP boundary for the existing merchant tariff workspace.
 * Each call preserves the caller's request payload and original operation IDs.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const TOKEN_PATTERN = /^[a-fA-F0-9]{64}$/;

function nonempty(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(name + ' must be a nonempty string');
  }
  return value;
}

function captureConnection(input, suppliedToken) {
  if (typeof input !== 'string' && !(input instanceof URL)) {
    throw new TypeError('url must be the tariff server launch URL or a URL object');
  }
  const parsed = new URL(String(input));
  if (!['http:', 'https:'].includes(parsed.protocol) || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new TypeError('The tariff client requires an HTTP(S) loopback URL');
  }
  if (parsed.username || parsed.password) {
    throw new TypeError('Use the launch URL token for authentication');
  }
  const fragment = new URLSearchParams(parsed.hash.slice(1));
  const fragmentTokens = fragment.getAll('token');
  if (fragmentTokens.length > 1) throw new TypeError('The launch URL contains multiple tokens');
  const fragmentToken = fragmentTokens[0];
  if (suppliedToken !== undefined && fragmentToken !== undefined && suppliedToken !== fragmentToken) {
    throw new TypeError('The supplied token differs from the launch URL token');
  }
  const token = suppliedToken === undefined ? fragmentToken : suppliedToken;
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    throw new TypeError('A 64-character hexadecimal tariff server token is required');
  }
  return Object.freeze({ origin: parsed.origin, token });
}

function headerRecord(headers) {
  const result = Object.create(null);
  headers.forEach(function (value, key) { result[key] = value; });
  return Object.freeze(result);
}

function errorMessage(status, body) {
  if (body && typeof body === 'object') {
    if (body.error && typeof body.error.message === 'string') return body.error.message;
    if (typeof body.error === 'string') return body.error;
    if (typeof body.message === 'string') return body.message;
  }
  return 'Tariff request failed with HTTP ' + status;
}

function parseBody(rawBody) {
  if (rawBody === '') return null;
  try { return JSON.parse(rawBody); } catch { return rawBody; }
}

/** An HTTP response was received. Full response text and parsed body are retained. */
export class TariffHttpError extends Error {
  constructor({ status, method, url, headers, rawBody, body }) {
    super(errorMessage(status, body));
    this.name = 'TariffHttpError';
    this.status = status;
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.rawBody = rawBody;
    this.body = body;
    this.code = body && typeof body === 'object' && body.error
      && typeof body.error.code === 'string' ? body.error.code : 'TARIFF_HTTP_ERROR';
    this.requestId = headers['x-request-id'] || null;
  }
}

/** No complete response was obtained. Reuse the original operation IDs for recovery. */
export class TariffTransportError extends Error {
  constructor({ method, url, cause, status = null }) {
    super('The tariff server response could not be completed', { cause });
    this.name = 'TariffTransportError';
    this.code = 'TARIFF_TRANSPORT_ERROR';
    this.method = method;
    this.url = url;
    this.status = status;
    this.outcome = method === 'GET' ? 'READ_FAILED' : 'UNKNOWN';
  }
}

/** The server returned a successful response whose body was not the declared JSON. */
export class TariffProtocolError extends Error {
  constructor({ method, url, status, headers, rawBody }) {
    super('The tariff server returned an invalid JSON response');
    this.name = 'TariffProtocolError';
    this.code = 'TARIFF_PROTOCOL_ERROR';
    this.method = method;
    this.url = url;
    this.status = status;
    this.headers = headers;
    this.rawBody = rawBody;
    this.outcome = method === 'GET' ? 'READ_FAILED' : 'UNKNOWN';
  }
}

function responseFilename(disposition, fallback) {
  if (disposition) {
    const encoded = /(?:^|;)\s*filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
    if (encoded) {
      try { return decodeURIComponent(encoded[1].trim()); } catch { /* Try the basic filename. */ }
    }
    const basic = /(?:^|;)\s*filename\s*=\s*(?:"((?:\\.|[^"])*)"|([^;]+))/i.exec(disposition);
    if (basic) return basic[1] !== undefined
      ? basic[1].replace(/\\(.)/g, '$1') : basic[2].trim();
  }
  return fallback;
}

/**
 * The connection URL and token are captured at construction. Mutating the caller's
 * URL object later does not move the client or its authentication to another origin.
 */
export class TariffClient {
  #origin;
  #token;
  #fetch;

  constructor({ url, token, fetch: fetchImplementation } = {}) {
    const connection = captureConnection(url, token);
    const selectedFetch = fetchImplementation === undefined ? globalThis.fetch : fetchImplementation;
    if (typeof selectedFetch !== 'function') throw new TypeError('A fetch implementation is required');
    this.#origin = connection.origin;
    this.#token = connection.token;
    this.#fetch = selectedFetch.bind(globalThis);
  }

  get origin() { return this.#origin; }

  async #request(method, path, input, options = {}, binaryName = null) {
    const url = new URL(path, this.#origin);
    if (url.origin !== this.#origin || !url.pathname.startsWith('/api/')) {
      throw new TypeError('A tariff request must stay within the captured API origin');
    }
    const headers = { Authorization: 'Bearer ' + this.#token, Accept: binaryName === null ? 'application/json' : '*/*' };
    const init = {
      method, headers, signal: options.signal,
      credentials: 'omit', cache: 'no-store', redirect: 'error'
    };
    if (input !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(input);
      if (init.body === undefined) throw new TypeError('The request body must be JSON');
    }
    let response;
    try {
      response = await this.#fetch(url.href, init);
    } catch (cause) {
      throw new TariffTransportError({ method, url: url.href, cause });
    }
    const capturedHeaders = headerRecord(response.headers);
    if (binaryName !== null && response.ok) {
      let bytes;
      try { bytes = new Uint8Array(await response.arrayBuffer()); }
      catch (cause) { throw new TariffTransportError({ method, url: url.href, status: response.status, cause }); }
      return Object.freeze({
        filename: responseFilename(response.headers.get('content-disposition'), binaryName),
        contentType: response.headers.get('content-type') || 'application/octet-stream',
        bytes, headers: capturedHeaders
      });
    }
    let rawBody;
    try { rawBody = await response.text(); }
    catch (cause) { throw new TariffTransportError({ method, url: url.href, status: response.status, cause }); }
    const body = parseBody(rawBody);
    if (!response.ok) {
      throw new TariffHttpError({
        status: response.status, method, url: url.href, headers: capturedHeaders, rawBody, body
      });
    }
    if (rawBody === '' || typeof body === 'string') {
      // JSON string values are legal; distinguish them from undecodable plain text.
      try { return JSON.parse(rawBody); }
      catch {
        throw new TariffProtocolError({
          method, url: url.href, status: response.status, headers: capturedHeaders, rawBody
        });
      }
    }
    return body;
  }

  state(options) { return this.#request('GET', '/api/state', undefined, options); }

  source(version, options) {
    const query = new URLSearchParams({ version: nonempty(version, 'version') });
    return this.#request('GET', '/api/source?' + query.toString(), undefined, options);
  }

  preview(input, options) { return this.#request('POST', '/api/preview', input, options); }

  save(input, options) { return this.#request('POST', '/api/plans', input, options); }

  list(options) { return this.#request('GET', '/api/plans', undefined, options); }

  load(planId, options) {
    return this.#request('GET', '/api/plans/' + encodeURIComponent(nonempty(planId, 'planId')), undefined, options);
  }

  selection(input, options) { return this.#request('POST', '/api/selection', input, options); }

  commitSelection(input, options) { return this.#request('POST', '/api/selection/commit', input, options); }

  download(planId, name, options) {
    const path = '/api/plans/' + encodeURIComponent(nonempty(planId, 'planId'))
      + '/files/' + encodeURIComponent(nonempty(name, 'name'));
    return this.#request('GET', path, undefined, options, name);
  }

  bundle(options) { return this.#request('GET', '/api/bundle', undefined, options); }

  receive(bundle, options) { return this.#request('POST', '/api/receive', bundle, options); }

  previewRepricing(input, options) { return this.#request('POST', '/api/repricing/preview', input, options); }

  saveRepricing(input, options) { return this.#request('POST', '/api/repricing/save', input, options); }

  stageRepricing(input, options) { return this.#request('POST', '/api/repricing/stage', input, options); }

  repricingSource(version, options) {
    const query = new URLSearchParams({ version: nonempty(version, 'version') });
    return this.#request('GET', '/api/repricing/source?' + query.toString(), undefined, options);
  }

  downloadRepricing(decision, name, options) {
    const path = '/api/repricing/' + encodeURIComponent(nonempty(decision, 'decision'))
      + '/files/' + encodeURIComponent(nonempty(name, 'name'));
    return this.#request('GET', path, undefined, options, name);
  }

  downloadPricing(version, name, options) {
    const path = '/api/pricing/' + encodeURIComponent(nonempty(version, 'version'))
      + '/files/' + encodeURIComponent(nonempty(name, 'name'));
    return this.#request('GET', path, undefined, options, name);
  }
}

export function createTariffClient(options) {
  return new TariffClient(options);
}
