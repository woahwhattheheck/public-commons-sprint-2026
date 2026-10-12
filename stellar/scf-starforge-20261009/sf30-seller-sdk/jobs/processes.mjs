// MIT. Native subprocess requests owned by the original merchant job host.
export function createNativeProcessesClient(port, signal) {
  let sequence = 0, closed = false;
  const pending = new Map();
  const failure = code => Object.assign(new Error(code), { code });
  const receive = message => {
    if (message?.type !== 'native-response') return;
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(failure(message.error)); else item.resolve(message.value);
  };
  const abort = () => {
    for (const item of pending.values()) item.reject(failure('JOB_EXECUTION_CANCELLED'));
    pending.clear();
  };
  port.on('message', receive);
  signal?.addEventListener('abort', abort, { once: true });
  function request(operation, args = {}) {
    if (closed || signal?.aborted) return Promise.reject(failure('JOB_EXECUTION_CANCELLED'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { port.postMessage({ type: 'native-request', id, operation, args }); }
      catch { pending.delete(id); reject(failure('JOB_NATIVE_CHANNEL_CLOSED')); }
    });
  }
  return Object.freeze({
    directory: () => request('directory'),
    run: args => request('run', args),
    close() {
      if (closed) return;
      closed = true; abort();
      port.off('message', receive);
      signal?.removeEventListener('abort', abort);
    },
  });
}
