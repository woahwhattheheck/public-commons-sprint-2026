# Complete native input in one process

These pinned, permissively licensed codecs prepare a complete UTF-8 operating input for a native process. The receiver checks the original byte count and SHA-256 after decompression, then retains source intake, execution, output creation and delivery within that same process when its working directory is ephemeral.

The input remains the complete selected programme and data. Compression changes its transport representation.

## Included upstream sources

| Codec | Original source | Git blob | License |
| --- | --- | --- | --- |
| pako 2.1.0 deflate UMD | nodeca/pako, tag 2.1.0, dist/pako_deflate.min.js | b560534f2527fc32fb86299680be6f361480ead6 | MIT and Zlib |
| LZMA-JS 2.3.2 worker | LZMA-JS/LZMA-JS, commit 8f98fe85a1ef78ab6e9d26ab85ce338f50095a23, src/lzma_worker.js | d8acf43a105af3eed975570048311e5dbbbf7ccb | MIT |

The vendored files are unchanged. Keep the accompanying LICENSE files and the original Zlib notice when redistributing them.

- [pako source](https://github.com/nodeca/pako/blob/2.1.0/dist/pako_deflate.min.js)
- [pako license](https://github.com/nodeca/pako/blob/2.1.0/LICENSE)
- [Zlib source notice](https://github.com/nodeca/pako/blob/2.1.0/lib/zlib/deflate.js)
- [LZMA-JS source](https://github.com/LZMA-JS/LZMA-JS/blob/8f98fe85a1ef78ab6e9d26ab85ce338f50095a23/src/lzma_worker.js)
- [LZMA-JS license](https://github.com/LZMA-JS/LZMA-JS/blob/8f98fe85a1ef78ab6e9d26ab85ce338f50095a23/LICENSE)

## Synchronous gzip from JavaScript

Load the entire pinned UMD source and provide its CommonJS export objects. This path needs typed arrays and ordinary JavaScript; it does not depend on Node modules or a worker.

~~~js
const module = {exports: {}};
const pako = new Function('exports', 'module', 'define',
  pakoSource + '\nreturn module.exports;'
)(module.exports, module, undefined);

const compressed = pako.gzip(originalUtf8Bytes, {level: 9});
~~~

Pass actual UTF-8 bytes, not UTF-16 character codes. Preserve the complete original byte count and SHA-256 with the encoded compressed output. The receiving Python process can decode these bytes using its standard gzip module.

## LZMA for a smaller complete command

Load the complete original worker without starting a browser worker. The callback is asynchronous; keep the JavaScript operation alive until it completes.

~~~js
const lzma = new Function(
  'setTimeout', 'setImmediate', 'onmessage', 'window',
  lzmaSource + '\nreturn LZMA;'
).call({}, setTimeout, undefined, undefined, undefined);

const compressed = await new Promise((resolve, reject) => {
  lzma.compress(Array.from(originalUtf8Bytes), 6, (result, error) => {
    if (error) reject(error);
    else resolve(Uint8Array.from(result, value => value & 255));
  });
});
~~~

The returned values can be signed byte integers; normalize them with value & 255 before transport encoding. The source emits the legacy .lzma container accepted by Python's standard lzma.decompress. Keep the complete original byte count and SHA-256 alongside it.

LZMA can use more temporary memory during compression than gzip. Finish the compression task before admitting a memory-sensitive native child. Choose the codec based on the complete resulting command size and the receiving host's supported decoder.

## Transport encodings and argument limits

Base64 works well for one complete stdin frame. Python's base64.b64decode and gzip.decompress or lzma.decompress restore the original bytes.

Base85 is useful when every byte must fit within one shell argument. Python's base64.b85decode expects its own Git-style Base85 alphabet:

~~~text
0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~
~~~

Encode unsigned groups of four bytes in big-endian order. A final partial group is padded with zeros for arithmetic and emits original remainder length plus one characters. Python's decoder reverses that final group.

Do not substitute ASCII85 or Z85: their alphabets and framing differ. After encoding, count the actual UTF-8 bytes of the complete Python argument, including its decoder and original programme. Linux commonly limits one argument to 131,072 bytes; leave room for the final null terminator. The complete command and environment also have a separate combined limit.

Construct shell arguments with actual shell quoting. For a POSIX shell, wrap the argument in single quotes and replace each contained single quote with the standard closed-quote, escaped-quote, reopened-quote sequence. JSON stringification is not shell quoting.

If the full argument does not fit, use one accepted process and one complete framed stdin input. Separate process invocations may have different working directories or mount lifetimes, so a written temporary file should not be assumed to exist in another invocation.

## Receiving original bytes

The native receiver performs the following before running the retained programme:

1. Decode the declared transport encoding and decompress the declared codec.
2. Compare the full decompressed byte count and SHA-256 with the input descriptor.
3. Parse JSON using strict UTF-8 and verify each source member's original byte count and hashes.
4. Materialize files in a new private directory with the intended relative paths.
5. Execute the selected programme using the same original process lifecycle.
6. Write and fsync the complete customer outputs, then finish their original private delivery before closing.

Use a complete current transfer descriptor supplied by the selected file service when source input or output requires one. Keep signed URLs and other transient transfer values in private runtime memory; source templates retain file identities and expected hashes.

The municipal operating receivers in this directory retain original file hashes and complete phase outputs. Their selected protocol determines whether a particular input is gzip/Base64 or a whole inline LZMA/Base85 command; retain that protocol when reusing an existing operation.

## Exact source identities

| File | UTF-8 bytes | SHA-256 |
| --- | ---: | --- |
| vendor/pako-2.1.0/pako_deflate.min.js | 27,876 | 9429785d1e7f805d46640c4155957fd0f286144dec05cea09f6f2eaa646adb21 |
| vendor/lzma-js-2.3.2/lzma_worker.js | 111,982 | b2704cc4536d113ba9d4badfb4b262ec878b16824e300596895c0a1080fbdc50 |
| vendor/lzma-js-2.3.2/LICENSE | 1,063 | 2a85a87a012b6f2099902bc20e94f4292c222a80f66072ecf5151d1377377385 |

The complete LZMA input path was used for the original native crew preparation and typed field continuation on Node 24.19.0 with Python's standard decoder. The receiving programmes checked original file identities before operating and saved complete editable outputs within their original process lifetime.
