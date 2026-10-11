// SPDX-License-Identifier: MIT
// The existing native buyer's saved-file reader, shared by requests and objects.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {need} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';

export function createSavedFileReader() {
  const verifiedFiles = new Map();
  return async function readSavedFile(file, {byteOffset = 0, maxBytes = 32768} = {}) {
    need(typeof file.destination === 'string' && /^[0-9a-f]{64}$/.test(file.sha256 ?? '') &&
      Number.isSafeInteger(file.bytes) && file.bytes >= 0, 'MCP_NATIVE_SAVED_RESULT_REQUIRED');
    need(Number.isSafeInteger(byteOffset) && byteOffset >= 0 && byteOffset <= file.bytes &&
      Number.isSafeInteger(maxBytes) && maxBytes >= 1 && maxBytes <= 65536, 'MCP_NATIVE_RESULT_RANGE_INVALID');
    const handle = await open(file.destination, constants.O_RDONLY | constants.O_NOFOLLOW |
      (constants.O_NONBLOCK ?? 0));
    try {
      const before = await handle.stat({bigint:true});
      need(before.isFile() && (before.mode & 0o077n) === 0n && before.size === BigInt(file.bytes) &&
        (typeof process.getuid !== 'function' || before.uid === BigInt(process.getuid())), 'MCP_NATIVE_RESULT_FILE_CHANGED');
      const fields = ['dev','ino','size','mtimeNs','ctimeNs'];
      const stamp = fields.map(key => String(before[key])).join(':') + ':' + file.sha256;
      if (verifiedFiles.get(file.destination) !== stamp) {
        const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
        let position = 0;
        for (;;) {
          const {bytesRead} = await handle.read(buffer, 0, buffer.length, position);
          if (!bytesRead) break;
          hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
          need(position <= file.bytes, 'MCP_NATIVE_RESULT_FILE_CHANGED');
        }
        const checked = await handle.stat({bigint:true});
        need(position === file.bytes && hash.digest('hex') === file.sha256 &&
          fields.every(key => before[key] === checked[key]), 'MCP_NATIVE_RESULT_FILE_CHANGED');
        verifiedFiles.set(file.destination, stamp);
        while (verifiedFiles.size > 512) verifiedFiles.delete(verifiedFiles.keys().next().value);
      }
      const bytes = Buffer.alloc(Math.min(maxBytes, file.bytes - byteOffset));
      let read = 0;
      while (read < bytes.length) {
        const {bytesRead} = await handle.read(bytes, read, bytes.length - read, byteOffset + read);
        need(bytesRead > 0, 'MCP_NATIVE_RESULT_FILE_CHANGED'); read += bytesRead;
      }
      const after = await handle.stat({bigint:true});
      need(fields.every(key => before[key] === after[key]), 'MCP_NATIVE_RESULT_FILE_CHANGED');
      let text;
      if (byteOffset === 0 && bytes.length === file.bytes)
        try { text = new TextDecoder('utf-8', {fatal:true}).decode(bytes); } catch {}
      return {contentType:file.contentType ?? null, bytes:file.bytes, sha256:file.sha256,
        byteOffset, returnedBytes:bytes.length, encoding:'base64', data:bytes.toString('base64'),
        ...(text === undefined ? {} : {text}),
        nextByteOffset:byteOffset + bytes.length < file.bytes ? byteOffset + bytes.length : null,
        verifiedSavedFile:true};
    } finally { await handle.close(); }
  };
}
