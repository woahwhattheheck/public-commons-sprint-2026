/** MIT. Browser client for the original SF32 JSON-response MCP transport. */
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message = code) => { throw Object.assign(new Error(message), {code}); };

export class BuyerConsoleClient {
  #token = null; #id = 0; #version = null; #pending = new Set();
  tools = new Set();
  async #rpc(method, params, notification = false) {
    if (!this.#token) fail('NOT_CONNECTED', 'Connect to this workspace first.');
    const id = notification ? undefined : ++this.#id;
    const request = {jsonrpc:'2.0', ...(notification ? {} : {id}), method, ...(params ? {params} : {})};
    const controller = new AbortController(); this.#pending.add(controller);
    try {
      const response = await fetch('/', {
        method:'POST', cache:'no-store', credentials:'omit', redirect:'error', signal:controller.signal,
        headers:{authorization:'Bearer ' + this.#token, 'content-type':'application/json',
          accept:'application/json, text/event-stream', ...(this.#version ? {'mcp-protocol-version':this.#version} : {})},
        body:JSON.stringify(request),
      });
      if (notification && response.status === 202) return;
      let envelope;
      try { envelope = await response.json(); }
      catch { fail('MCP_RESPONSE_INVALID', 'The workspace did not return a JSON response.'); }
      if (!response.ok || envelope.error) fail(String(envelope.error?.code ?? 'HTTP_' + response.status),
        envelope.error?.message ?? 'The workspace request failed.');
      if (envelope.jsonrpc !== '2.0' || envelope.id !== id || !plain(envelope.result))
        fail('MCP_RESPONSE_INVALID', 'The workspace response did not match this request.');
      return envelope.result;
    } finally { this.#pending.delete(controller); }
  }
  async connect(token) {
    this.disconnect();
    if (typeof token !== 'string' || token.length < 24 || token.length > 4096)
      fail('TOKEN_REQUIRED', 'Enter this workspace’s operator access token.');
    this.#token = token;
    try {
      const init = await this.#rpc('initialize', {protocolVersion:'2025-11-25', capabilities:{},
        clientInfo:{name:'stellar-forge-buyer-console', version:'1.0.0'}});
      if (init.protocolVersion !== '2025-11-25') fail('MCP_VERSION_MISMATCH');
      this.#version = init.protocolVersion;
      await this.#rpc('notifications/initialized', undefined, true);
      const catalog = await this.#rpc('tools/list');
      if (!Array.isArray(catalog.tools)) fail('MCP_CATALOG_INVALID');
      this.tools = new Set(catalog.tools.map(tool => tool.name));
      return init;
    } catch (error) { this.disconnect(); throw error; }
  }
  disconnect() {
    for (const request of this.#pending) request.abort();
    this.#pending.clear(); this.#token = null; this.#version = null; this.tools.clear();
  }
  async call(name, args = {}) {
    if (!this.tools.has(name)) fail('MCP_TOOL_UNAVAILABLE', name + ' is unavailable in this running workspace.');
    const result = await this.#rpc('tools/call', {name, arguments:args});
    let data = result.structuredContent;
    if (!plain(data)) {
      const text = result.content?.find(item => item.type === 'text')?.text;
      try { data = JSON.parse(text); } catch { fail('MCP_TOOL_RESULT_INVALID'); }
    }
    if (result.isError) fail(data.code ?? 'TOOL_ERROR', data.reason ?? data.message ?? 'The operation failed.');
    return data;
  }
  async completeResult(quoteId, onProgress = () => {}) {
    const chunks = []; let offset = 0, identity;
    for (;;) {
      const page = await this.call('bazaar_read_result', {quoteId, byteOffset:offset, maxBytes:65536});
      if (page.quoteId !== quoteId || page.byteOffset !== offset || page.encoding !== 'base64' ||
          !Number.isSafeInteger(page.bytes) || page.bytes < 0 || page.bytes > 2 * 1024 * 1024 ||
          !/^[a-f0-9]{64}$/.test(page.sha256) || page.representation !== 'MCP_CALL_TOOL_RESULT_JSON')
        fail('MCP_RESULT_RANGE_INVALID', 'The saved result range does not match this quote.');
      const current = JSON.stringify([page.bytes, page.sha256, page.representation, page.contentType]);
      if (identity !== undefined && identity !== current) fail('MCP_RESULT_CHANGED', 'The saved result changed during this read.');
      identity = current;
      let chunk;
      try { chunk = Uint8Array.from(atob(page.data), character => character.charCodeAt(0)); }
      catch { fail('MCP_RESULT_ENCODING_INVALID'); }
      if (chunk.length !== page.returnedBytes || chunk.length > 65536 || offset + chunk.length > page.bytes)
        fail('MCP_RESULT_RANGE_INVALID');
      chunks.push(chunk); offset += chunk.length; onProgress(offset, page.bytes);
      if (page.nextByteOffset === null) {
        if (offset !== page.bytes) fail('MCP_RESULT_INCOMPLETE');
        const bytes = new Uint8Array(offset); let start = 0;
        for (const part of chunks) { bytes.set(part, start); start += part.length; }
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map(value => value.toString(16).padStart(2, '0')).join('');
        if (digest !== page.sha256) fail('MCP_RESULT_DIGEST_MISMATCH');
        let native;
        try { native = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
        catch { fail('MCP_RESULT_JSON_INVALID'); }
        if (!plain(native)) fail('MCP_RESULT_JSON_INVALID');
        return {native, bytes, metadata:page};
      }
      if (chunk.length === 0 || page.nextByteOffset !== offset) fail('MCP_RESULT_CURSOR_INVALID');
    }
  }
}
