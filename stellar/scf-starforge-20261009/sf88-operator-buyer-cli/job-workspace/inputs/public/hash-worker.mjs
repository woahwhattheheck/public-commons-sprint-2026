// MIT. Hash selected browser files off the UI thread; retain no whole-file buffer.
import { Sha256 } from './sha256.mjs';
const CHUNK_BYTES = 262144;
const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
self.onmessage = async event => {
  try {
    const file = event.data?.file;
    if (!(file instanceof Blob) || file.size > 2147483648) throw new Error('JOB_INPUT_FILE_SIZE_INVALID');
    const whole = new Sha256(), chunks = [];
    let last = 0;
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
      whole.update(bytes);
      chunks.push(hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))));
      if (Date.now() - last >= 250 || offset + bytes.length === file.size) {
        self.postMessage({ type: 'progress', bytes: offset + bytes.length, totalBytes: file.size }); last = Date.now();
      }
    }
    self.postMessage({ type: 'complete', bytes: file.size, sha256: whole.digest(), chunks, chunkBytes: CHUNK_BYTES });
  } catch (error) { self.postMessage({ type: 'error', error: error?.message ?? 'JOB_INPUT_HASH_FAILED' }); }
};
