/* ES-FIELD12: exact offline field evidence and complete portable handover.
 * Original records remain in the implementation plan. IndexedDB stores bytes only.
 * ZIP format and native consumer: upstate.implementation-evidence/v1.
 */
export const EVIDENCE_SCHEMA = "upstate.implementation-evidence/v1";
export const EVIDENCE_LIMITS = Object.freeze({
  maxFiles: 128, maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024, maxPlanBytes: 16 * 1024 * 1024,
  maxManifestBytes: 1024 * 1024
});
const HEX = /^[a-f0-9]{64}$/;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function fail(message, details) {
  const error = new Error(message);
  error.name = "ImplementationEvidenceError";
  if (details !== undefined) error.details = details;
  throw error;
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label + " must be an object");
  return value;
}
function integer(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(label + " is outside its supported range");
  return value;
}
function limitsFrom(overrides = {}) {
  const result = { ...EVIDENCE_LIMITS };
  for (const key of Object.keys(result)) if (own(overrides, key)) {
    integer(overrides[key], key, result[key]);
    if (!overrides[key]) fail(key + " must be positive");
    result[key] = overrides[key];
  }
  return result;
}
export function evidenceSafeBasename(filename) {
  return String(filename).replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 120).replace(/^\.+/u, "") || "attachment";
}
function originalName(value) {
  if (typeof value !== "string" || !value || value.length > 1024 || value === "." || value === ".." || /[\\/\u0000]/u.test(value)) fail("Original filename must be an ordinary file name");
  return value;
}
function mediaType(value) {
  if (value === undefined || value === null || value === "") return "application/octet-stream";
  if (typeof value !== "string" || value.length > 255 || /[\r\n\u0000]/u.test(value)) fail("Invalid evidence media type");
  return value;
}
function planIdentifier(plan) {
  object(plan, "Implementation plan");
  if (typeof plan.id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/u.test(plan.id)) fail("Implementation plan needs its original safe ID");
  if (!Array.isArray(plan.source_links)) fail("Implementation plan needs its original source_links array");
  return plan.id;
}
function canonicalReference(planId, hash, filename) {
  return "implementation/plans/" + planId + "/attachments/" + hash + "-" + evidenceSafeBasename(filename);
}
function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  fail("Expected original binary bytes");
}
async function readBytes(value, maximum) {
  if (value && typeof value.arrayBuffer === "function") {
    if (typeof value.size === "number") integer(value.size, "File size", maximum);
    value = await value.arrayBuffer();
  }
  const bytes = asBytes(value);
  integer(bytes.byteLength, "Binary size", maximum);
  return bytes;
}
function utf8(value) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value);
  const out = [];
  for (const char of value) {
    let n = char.codePointAt(0);
    if (n >= 0xd800 && n <= 0xdfff) n = 0xfffd;
    if (n < 128) out.push(n);
    else if (n < 2048) out.push(192 | n >> 6, 128 | n & 63);
    else if (n < 65536) out.push(224 | n >> 12, 128 | n >> 6 & 63, 128 | n & 63);
    else out.push(240 | n >> 18, 128 | n >> 12 & 63, 128 | n >> 6 & 63, 128 | n & 63);
  }
  return new Uint8Array(out);
}
function decodeUtf8(bytes) {
  if (typeof TextDecoder !== "undefined") {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (_) { fail("Evidence JSON or path is not valid UTF-8"); }
  }
  const parts = [];
  let batch = [];
  for (let i = 0; i < bytes.length;) {
    let n = bytes[i++], need = 0, minimum = 0;
    if (n < 128) {}
    else if (n >= 194 && n <= 223) { n &= 31; need = 1; minimum = 128; }
    else if (n >= 224 && n <= 239) { n &= 15; need = 2; minimum = 2048; }
    else if (n >= 240 && n <= 244) { n &= 7; need = 3; minimum = 65536; }
    else fail("Evidence JSON or path is not valid UTF-8");
    if (i + need > bytes.length) fail("Truncated UTF-8 evidence data");
    for (let j = 0; j < need; j++) {
      const v = bytes[i++];
      if ((v & 192) !== 128) fail("Evidence JSON or path is not valid UTF-8");
      n = n * 64 + (v & 63);
    }
    if (n < minimum || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) fail("Invalid UTF-8 code point");
    batch.push(String.fromCodePoint(n));
    if (batch.length >= 4096) { parts.push(batch.join("")); batch = []; }
  }
  parts.push(batch.join(""));
  return parts.join("");
}
function jsonBytes(value) {
  let encoded;
  try { encoded = JSON.stringify(value, null, 2); }
  catch (_) { fail("Implementation plan must be ordinary JSON without cyclic references"); }
  if (encoded === undefined) fail("Missing JSON document");
  return utf8(encoded + "\n");
}
function parseJson(bytes, label) {
  try { return object(JSON.parse(decodeUtf8(bytes)), label); }
  catch (error) {
    if (error.name === "ImplementationEvidenceError") throw error;
    fail(label + " is not valid JSON");
  }
}
/* Original-byte SHA-256. The fallback is used by the pure V8 carrier check. */
function sha256Fallback(input) {
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const size = Math.ceil((input.length + 9) / 64) * 64;
  const data = new Uint8Array(size);
  data.set(input); data[input.length] = 128;
  const view = new DataView(data.buffer);
  const bits = input.length * 8;
  view.setUint32(size - 8, Math.floor(bits / 4294967296), false);
  view.setUint32(size - 4, bits >>> 0, false);
  const w = new Uint32Array(64), r = (x, n) => x >>> n | x << 32 - n;
  for (let offset = 0; offset < size; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = (w[i - 16] + (r(a,7) ^ r(a,18) ^ a >>> 3) + w[i - 7] + (r(b,17) ^ r(b,19) ^ b >>> 10)) >>> 0;
    }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (r(e,6) ^ r(e,11) ^ r(e,25)) + (e & f ^ ~e & g) + K[i] + w[i]) >>> 0;
      const t2 = ((r(a,2) ^ r(a,13) ^ r(a,22)) + (a & b ^ a & c ^ b & c)) >>> 0;
      hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    [a,b,c,d,e,f,g,hh].forEach((value,index) => { h[index] = (h[index] + value) >>> 0; });
  }
  return h.map(value => value.toString(16).padStart(8,"0")).join("");
}
export async function evidenceSha256(value) {
  const bytes = asBytes(value);
  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const result = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    return Array.from(result, value => value.toString(16).padStart(2, "0")).join("");
  }
  return sha256Fallback(bytes);
}
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n=0;n<256;n++) { let c=n; for(let k=0;k<8;k++) c=c&1?0xedb88320^(c>>>1):c>>>1; table[n]=c>>>0; }
  return table;
})();
export function evidenceCrc32(bytes) {
  let crc = 0xffffffff;
  for (const value of asBytes(bytes)) crc = CRC_TABLE[(crc ^ value) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
function safeArchivePath(name) {
  if (typeof name !== "string" || !name || name.length > 512 || !/^[A-Za-z0-9_.\/-]+$/u.test(name)
      || name.startsWith("/") || name.endsWith("/") || name.includes("\\")
      || name.split("/").some(part => !part || part === "." || part === "..")) fail("Unsafe evidence archive path");
  return name;
}
function requireDigest(value, label) {
  if (typeof value !== "string" || !HEX.test(value)) fail(label + " needs its complete lowercase SHA-256");
  return value;
}
function collectLocalLinks(plan, limits) {
  const id = planIdentifier(plan), seen = new Set(), result = [];
  for (const source of plan.source_links) {
    object(source, "Source link");
    if (typeof source.id !== "string" || !source.id || seen.has(source.id)) fail("Source link IDs must be unique");
    seen.add(source.id);
    if (source.kind !== "local_file") continue;
    requireDigest(source.sha256, "File source");
    integer(source.size_bytes, "Evidence file size", limits.maxFileBytes);
    originalName(source.original_filename);
    mediaType(source.media_type);
    const prefix="implementation/plans/"+id+"/attachments/", reference=source.reference;
    if(typeof reference!=="string"||!reference.startsWith(prefix))fail("Evidence reference leaves the original plan bank",{source_id:source.id});
    const name=reference.slice(prefix.length);
    if(!/^[A-Za-z0-9_.-]+$/u.test(name)||!name.startsWith(source.sha256+"-")||name.length<=65)fail("Evidence reference differs from its original content identity",{source_id:source.id});
    result.push(source);
  }
  if (result.length > limits.maxFiles) fail("Too many evidence files");
  const paths=new Map(result.map(source=>["evidence/"+source.sha256+"/"+evidenceSafeBasename(source.original_filename),source.size_bytes]));
  const total = [...paths.values()].reduce((sum, count) => sum + count, 0);
  integer(total, "Total evidence size", limits.maxTotalBytes);
  return result;
}
function assertVault(vault) {
  if (!vault || typeof vault.get !== "function" || typeof vault.putMany !== "function") fail("Open the evidence file store before using original files");
  return vault;
}
async function exactStoredFile(source, vault, limits) {
  const value = await vault.get(source.sha256);
  if (value === undefined || value === null) fail("Original evidence bytes are missing", {missing_source_ids:[source.id]});
  const bytes = asBytes(value.bytes ?? value);
  if (bytes.length !== source.size_bytes || bytes.length > limits.maxFileBytes || await evidenceSha256(bytes) !== source.sha256) fail("Stored evidence differs from its original file", {source_id:source.id});
  return bytes;
}
export async function openEvidenceVault(options = {}) {
  const idb = options.indexedDB ?? globalThis.indexedDB;
  if (!idb || typeof idb.open !== "function") fail("This browser does not provide persistent IndexedDB file storage");
  const name = options.databaseName || "upstate-implementation-evidence-v1";
  const database = await new Promise((resolve, reject) => {
    const request = idb.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files", {keyPath:"sha256"});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open evidence file storage"));
    request.onblocked = () => reject(new Error("Close another upgrading fieldwork tab and reopen evidence storage"));
  });
  database.onversionchange = () => database.close();
  const limits = limitsFrom(options.limits);
  return {
    async get(hash) {
      requireDigest(hash, "Stored evidence");
      return new Promise((resolve,reject) => {
        const tx = database.transaction("files","readonly"), req = tx.objectStore("files").get(hash);
        let result;
        req.onsuccess = () => { result = req.result; };
        tx.oncomplete = () => resolve(result ? new Uint8Array(result.bytes) : null);
        tx.onerror = () => reject(tx.error || new Error("Could not read evidence file"));
        tx.onabort = tx.onerror;
      });
    },
    async has(hash) { return (await this.get(hash)) !== null; },
    async putMany(records) {
      if (!Array.isArray(records) || records.length > limits.maxFiles) fail("Invalid evidence file batch");
      let total=0;
      const prepared = [], seen = new Set();
      for (const row of records) {
        object(row,"Evidence file"); requireDigest(row.sha256,"Evidence file");
        const bytes = asBytes(row.bytes);
        integer(bytes.length,"Evidence file size",limits.maxFileBytes);
        if (row.size_bytes !== bytes.length || await evidenceSha256(bytes) !== row.sha256) fail("File bytes do not match the evidence manifest");
        if (seen.has(row.sha256)) continue;
        seen.add(row.sha256); total += bytes.length;
        integer(total,"Evidence batch size",limits.maxTotalBytes);
        prepared.push({sha256:row.sha256,size_bytes:bytes.length,bytes:bytes.slice().buffer});
      }
      if (!prepared.length) return;
      await new Promise((resolve,reject) => {
        const tx=database.transaction("files","readwrite");
        tx.oncomplete=resolve;
        tx.onerror=()=>reject(tx.error || new Error("Could not retain original evidence; check browser storage capacity"));
        tx.onabort=tx.onerror;
        try { const store=tx.objectStore("files"); for(const row of prepared) store.put(row); }
        catch(error) { try { tx.abort(); } catch(_) {} reject(error); }
      });
    },
    close() { database.close(); }
  };
}
export async function captureEvidence(plan, file, options = {}) {
  const limits=limitsFrom(options.limits), vault=assertVault(options.vault);
  collectLocalLinks(plan,limits);
  const id=planIdentifier(plan);
  if (!file || typeof file.arrayBuffer !== "function") fail("Choose an original file from this device");
  const filename=originalName(file.name), bytes=await readBytes(file,limits.maxFileBytes);
  if (typeof file.size === "number" && bytes.length !== file.size) fail("Original file size changed during capture");
  const hash=await evidenceSha256(bytes), sourceId="file_"+hash.slice(0,24);
  const existing=plan.source_links.find(source=>source.id===sourceId);
  if (existing && (existing.kind!=="local_file" || existing.sha256!==hash || existing.size_bytes!==bytes.length)) fail("An existing source ID conflicts with these original bytes");
  const link=existing || {
    id:sourceId,kind:"local_file",label:options.label || filename,
    reference:canonicalReference(id,hash,filename),sha256:hash,size_bytes:bytes.length,
    original_filename:filename,media_type:mediaType(file.type)
  };
  // Apply the archive's unique-member accounting to the proposed source list.
  if (!existing) collectLocalLinks({...plan,source_links:[...plan.source_links,link]},limits);
  await vault.putMany([{sha256:hash,size_bytes:bytes.length,bytes}]);
  return {source_link:JSON.parse(JSON.stringify(link)),deduplicated:!!existing};
}
function previewMedia(bytes) {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)) return "image/png";
  if (bytes.length >= 3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return "image/jpeg";
  if (bytes.length >= 6 && ["GIF87a","GIF89a"].includes(String.fromCharCode(...bytes.subarray(0,6)))) return "image/gif";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0,4))==="RIFF" && String.fromCharCode(...bytes.subarray(8,12))==="WEBP") return "image/webp";
  return null;
}
export async function inspectEvidence(plan, options = {}) {
  const limits=limitsFrom(options.limits), vault=assertVault(options.vault);
  const result=[];
  for (const source of collectLocalLinks(plan,limits)) {
    const stored=await vault.get(source.sha256);
    if (stored===undefined || stored===null) result.push({source_link:source,available:false,previewable:false});
    else {
      const bytes=asBytes(stored.bytes ?? stored);
      const valid=bytes.length===source.size_bytes && await evidenceSha256(bytes)===source.sha256;
      result.push({source_link:source,available:valid,previewable:valid && !!previewMedia(bytes),...(valid?{}:{error:"Stored file differs from its source record"})});
    }
  }
  return result;
}
export async function getEvidenceFile(source, options = {}) {
  object(source,"Evidence source"); requireDigest(source.sha256,"Evidence source");
  integer(source.size_bytes,"Evidence file size",limitsFrom(options.limits).maxFileBytes);
  originalName(source.original_filename);
  const bytes=await exactStoredFile(source,assertVault(options.vault),limitsFrom(options.limits));
  const type=mediaType(source.media_type), preview=previewMedia(bytes);
  return {bytes,blob:typeof Blob!=="undefined"?new Blob([bytes],{type}):null,
    filename:source.original_filename,media_type:type,previewable:!!preview,preview_media_type:preview};
}
export async function createEvidencePreview(source, options = {}) {
  const file=await getEvidenceFile(source,options);
  if (!file.previewable) return null;
  if (typeof Blob==="undefined" || typeof globalThis.URL?.createObjectURL!=="function") fail("Image preview is unavailable in this browser");
  const url=globalThis.URL.createObjectURL(new Blob([file.bytes],{type:file.preview_media_type}));
  let active=true;
  return {url,media_type:file.preview_media_type,revoke(){if(active){active=false;globalThis.URL.revokeObjectURL(url);}}};
}
export function downloadEvidenceBlob(blob, filename) {
  if (!blob || typeof document==="undefined" || typeof globalThis.URL?.createObjectURL!=="function") fail("File download needs an ordinary browser document");
  const url=globalThis.URL.createObjectURL(blob), anchor=document.createElement("a");
  anchor.href=url;
  anchor.download=String(filename || "fieldwork-evidence.zip").replace(/[\u0000-\u001f/\\]/gu,"_").replace(/^\.+/u,"") || "attachment";
  anchor.style.display="none";
  document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); setTimeout(()=>globalThis.URL.revokeObjectURL(url),30000); }
}
/* Stored ZIP only: no compression, encryption, ZIP64, descriptors or hidden members. */
export function writeEvidenceZip(entries) {
  if (!Array.isArray(entries) || entries.length>130) fail("Invalid evidence ZIP member count");
  const seen=new Set(), rows=[];
  let localSize=0, centralSize=0;
  for(const entry of entries){
    const path=safeArchivePath(entry.path);
    if(seen.has(path)) fail("Duplicate evidence ZIP path");
    seen.add(path);
    const name=utf8(path), bytes=asBytes(entry.bytes);
    if(name.length>65535 || bytes.length>0xffffffff) fail("Evidence ZIP member is too large");
    const row={name,bytes,offset:localSize,crc:evidenceCrc32(bytes)};
    rows.push(row); localSize+=30+name.length+bytes.length; centralSize+=46+name.length;
  }
  if(localSize+centralSize+22>0xffffffff) fail("Evidence ZIP is too large");
  const out=new Uint8Array(localSize+centralSize+22), view=new DataView(out.buffer);
  let p=0;
  for(const row of rows){
    view.setUint32(p,0x04034b50,true);view.setUint16(p+4,20,true);view.setUint16(p+6,0x800,true);
    view.setUint16(p+8,0,true);view.setUint16(p+10,0,true);view.setUint16(p+12,33,true);
    view.setUint32(p+14,row.crc,true);view.setUint32(p+18,row.bytes.length,true);view.setUint32(p+22,row.bytes.length,true);
    view.setUint16(p+26,row.name.length,true);view.setUint16(p+28,0,true);
    out.set(row.name,p+30);out.set(row.bytes,p+30+row.name.length);p+=30+row.name.length+row.bytes.length;
  }
  for(const row of rows){
    view.setUint32(p,0x02014b50,true);view.setUint16(p+4,20,true);view.setUint16(p+6,20,true);
    view.setUint16(p+8,0x800,true);view.setUint16(p+10,0,true);view.setUint16(p+12,0,true);view.setUint16(p+14,33,true);
    view.setUint32(p+16,row.crc,true);view.setUint32(p+20,row.bytes.length,true);view.setUint32(p+24,row.bytes.length,true);
    view.setUint16(p+28,row.name.length,true);view.setUint16(p+30,0,true);view.setUint16(p+32,0,true);
    view.setUint16(p+34,0,true);view.setUint16(p+36,0,true);view.setUint32(p+38,0,true);view.setUint32(p+42,row.offset,true);
    out.set(row.name,p+46);p+=46+row.name.length;
  }
  view.setUint32(p,0x06054b50,true);view.setUint16(p+4,0,true);view.setUint16(p+6,0,true);
  view.setUint16(p+8,rows.length,true);view.setUint16(p+10,rows.length,true);
  view.setUint32(p+12,centralSize,true);view.setUint32(p+16,localSize,true);view.setUint16(p+20,0,true);
  return out;
}
export function readEvidenceZip(input, options = {}) {
  const bytes=asBytes(input), limits=limitsFrom(options.limits);
  const maxArchive=limits.maxTotalBytes+limits.maxPlanBytes+limits.maxManifestBytes+262144;
  integer(bytes.length,"Evidence ZIP size",maxArchive);
  if(bytes.length<22) fail("Truncated evidence ZIP");
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), end=bytes.length-22;
  const u16=p=>view.getUint16(p,true), u32=p=>view.getUint32(p,true);
  if(u32(end)!==0x06054b50 || u16(end+4)!==0 || u16(end+6)!==0 || u16(end+20)!==0) fail("Unsupported ZIP end record");
  const count=u16(end+10), centralSize=u32(end+12), centralOffset=u32(end+16);
  if(count!==u16(end+8) || count<2 || count>limits.maxFiles+2 || centralOffset+centralSize!==end) fail("Invalid evidence ZIP directory");
  const result=new Map();let p=centralOffset, nextLocal=0, total=0;
  for(let i=0;i<count;i++){
    if(p+46>end || u32(p)!==0x02014b50) fail("Truncated evidence ZIP directory");
    const flags=u16(p+8), method=u16(p+10), crc=u32(p+16), packed=u32(p+20), size=u32(p+24);
    const nameSize=u16(p+28), extraSize=u16(p+30), commentSize=u16(p+32), offset=u32(p+42);
    if((flags!==0 && flags!==0x800) || method!==0 || packed!==size || extraSize || commentSize || u16(p+34)!==0 || u16(p+6)>20) fail("Evidence ZIP must use plain stored files");
    if(!nameSize || p+46+nameSize>end) fail("Truncated evidence ZIP name");
    const path=safeArchivePath(decodeUtf8(bytes.subarray(p+46,p+46+nameSize)));
    if(result.has(path)) fail("Duplicate evidence ZIP member");
    const maximum=path==="manifest.json"?limits.maxManifestBytes:path==="plan.json"?limits.maxPlanBytes:limits.maxFileBytes;
    integer(size,"Evidence ZIP member size",maximum);
    if(path!=="manifest.json" && path!=="plan.json") {total+=size;integer(total,"Total evidence size",limits.maxTotalBytes);}
    if(offset!==nextLocal || offset+30>centralOffset || u32(offset)!==0x04034b50) fail("Evidence ZIP has hidden or overlapping data");
    const localName=u16(offset+26), localExtra=u16(offset+28), dataStart=offset+30+localName+localExtra;
    if(u16(offset+4)>20 || u16(offset+6)!==flags || u16(offset+8)!==method || u32(offset+14)!==crc
      || u32(offset+18)!==size || u32(offset+22)!==size || localExtra || localName!==nameSize
      || dataStart+size>centralOffset || decodeUtf8(bytes.subarray(offset+30,offset+30+localName))!==path) fail("Evidence ZIP local record differs from directory");
    const data=bytes.subarray(dataStart,dataStart+size);
    if(evidenceCrc32(data)!==crc) fail("Evidence ZIP CRC differs from its original bytes",{path});
    result.set(path,data);nextLocal=dataStart+size;p+=46+nameSize;
  }
  if(p!==end || nextLocal!==centralOffset || !result.has("manifest.json") || !result.has("plan.json")) fail("Evidence ZIP members do not form a complete handover");
  return result;
}
export async function exportEvidenceBundle(plan, options = {}) {
  const limits=limitsFrom(options.limits), vault=assertVault(options.vault), sources=collectLocalLinks(plan,limits);
  const planBytes=jsonBytes(plan);
  integer(planBytes.length,"Plan JSON size",limits.maxPlanBytes);
  const planHash=await evidenceSha256(planBytes), files=[], entries=[], missing=[], included=new Set();
  for(const source of sources){
    let bytes;
    try { bytes=await exactStoredFile(source,vault,limits); }
    catch(error) {
      if(error.details?.missing_source_ids) {missing.push(source.id);continue;}
      throw error;
    }
    const path="evidence/"+source.sha256+"/"+evidenceSafeBasename(source.original_filename);
    files.push({source_id:source.id,source_ref:source.reference,path,original_filename:source.original_filename,
      media_type:mediaType(source.media_type),size_bytes:source.size_bytes,sha256:source.sha256});
    if(!included.has(path)){entries.push({path,bytes});included.add(path);}
  }
  if(missing.length) fail("Receive the original files before exporting the complete fieldwork handover",{missing_source_ids:missing});
  const manifest={schema:EVIDENCE_SCHEMA,created_at:options.createdAt || new Date().toISOString(),
    plan:{id:plan.id,path:"plan.json",sha256:planHash,size_bytes:planBytes.length},files};
  if(typeof manifest.created_at!=="string" || !Number.isFinite(Date.parse(manifest.created_at))) fail("Invalid handover creation date");
  const manifestBytes=jsonBytes(manifest);
  integer(manifestBytes.length,"Manifest JSON size",limits.maxManifestBytes);
  const bytes=writeEvidenceZip([{path:"manifest.json",bytes:manifestBytes},{path:"plan.json",bytes:planBytes},...entries]);
  return {bytes,blob:typeof Blob!=="undefined"?new Blob([bytes],{type:"application/zip"}):null,
    filename:"fieldwork-"+plan.id+".zip",manifest,sha256:await evidenceSha256(bytes)};
}
export async function importEvidenceBundle(input, options = {}) {
  const limits=limitsFrom(options.limits), vault=assertVault(options.vault);
  const maximum=limits.maxTotalBytes+limits.maxPlanBytes+limits.maxManifestBytes+262144;
  const bytes=await readBytes(input,maximum), entries=readEvidenceZip(bytes,{limits});
  const manifest=parseJson(entries.get("manifest.json"),"Evidence manifest");
  if(manifest.schema!==EVIDENCE_SCHEMA) fail("Unsupported fieldwork evidence schema");
  const descriptor=object(manifest.plan,"Plan descriptor");
  requireDigest(descriptor.sha256,"Plan JSON");
  if(descriptor.path!=="plan.json" || descriptor.size_bytes!==entries.get("plan.json").length
    || await evidenceSha256(entries.get("plan.json"))!==descriptor.sha256) fail("Plan JSON differs from its manifest");
  const plan=parseJson(entries.get("plan.json"),"Implementation plan");
  if(planIdentifier(plan)!==descriptor.id) fail("Plan ID differs from its manifest");
  const links=collectLocalLinks(plan,limits);
  if(!Array.isArray(manifest.files) || manifest.files.length!==links.length) fail("Every local evidence source must have its original descriptor");
  const indexed=new Map(links.map(link=>[link.id,link])), seen=new Set(), paths=new Set(["manifest.json","plan.json"]), batch=[];
  for(const row of manifest.files){
    object(row,"Evidence member");
    const source=indexed.get(row.source_id);
    if(!source || seen.has(row.source_id)) fail("Evidence member has an unknown or duplicate source ID");
    seen.add(row.source_id);
    const path="evidence/"+source.sha256+"/"+evidenceSafeBasename(source.original_filename);
    if(row.path!==path || row.source_ref!==source.reference || row.original_filename!==source.original_filename
      || row.media_type!==mediaType(source.media_type) || row.sha256!==source.sha256 || row.size_bytes!==source.size_bytes) fail("Evidence member differs from its retained source link",{source_id:row.source_id});
    const original=entries.get(path);
    if(!original || original.length!==source.size_bytes || await evidenceSha256(original)!==source.sha256) fail("Evidence bytes differ from their original source",{source_id:row.source_id});
    paths.add(path);batch.push({sha256:row.sha256,size_bytes:row.size_bytes,bytes:original});
  }
  if(paths.size!==entries.size||[...entries.keys()].some(path=>!paths.has(path)))fail("The evidence ZIP contains unlisted members");
  await vault.putMany(batch);
  return {plan,manifest,files:manifest.files.map(row=>({...row})),sha256:await evidenceSha256(bytes)};
}
