/**
 * Streaming PostgreSQL wire worker for @electric-sql/pglite 0.5.8.
 *
 * PGlite's synchronous native read callback must be allowed to wait for later
 * CopyData packets. The parent process owns the responsive client socket; this
 * worker uses blocking pipes, so PostgreSQL receives the original client bytes.
 *
 * Based on the public PGlite Module and native loop APIs in pglite.ts:
 * https://github.com/electric-sql/pglite/blob/main/packages/pglite/src/pglite.ts
 * Inspected upstream source blob: f1016184996cfad357d3425b8b838d8ded4e0cf3.
 * Upstream PGlite is Apache-2.0. This adapter neither rewrites query results nor
 * changes the receiver's SQL/COPY implementation.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import { inspect } from "node:util";

const FRAME_LIMIT = 65536;
const require = createRequire(import.meta.url);
const [packageDirectory, dataDirectory] = process.argv.slice(2);
if (!packageDirectory || !dataDirectory) throw new Error("PGLITE_WORKER_ARGUMENTS");
for (const method of ["log", "info", "debug", "warn"]) {
  console[method] = (...args) => fs.writeSync(2, args.map(x => typeof x === "string" ? x : inspect(x)).join(" ") + "\n");
}
try { fs.writeFileSync("/proc/self/oom_score_adj", "1000"); } catch {}
const packageInfo = JSON.parse(fs.readFileSync(packageDirectory + "/package.json", "utf8"));
if (packageInfo.name !== "@electric-sql/pglite" || packageInfo.version !== "0.5.8") {
  throw new Error("PGLITE_WORKER_REQUIRES_EXACT_0_5_8");
}
const { PGlite } = require(packageDirectory);
const configuration = {
  initialMemory: 128 * 1024 * 1024,
  initDbStartParams: [
    "--set=shared_buffers=8MB",
    "--set=work_mem=1MB",
    "--set=maintenance_work_mem=8MB",
    "--set=max_connections=10",
    "--set=max_worker_processes=0",
    "--set=max_parallel_workers=0",
  ],
  startParams: [
    ...PGlite.defaultStartParams,
    "-c", "shared_buffers=8MB",
    "-c", "work_mem=1MB",
    "-c", "maintenance_work_mem=8MB",
    "-c", "max_connections=10",
    "-c", "statement_timeout=300000",
  ],
};
const stats = { connections: 0, resets: 0, clientBytes: 0, serverBytes: 0 };

function writeAll(fd, bytes) {
  for (let offset = 0; offset < bytes.length;) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!written) throw new Error("PGLITE_PIPE_WRITE_ZERO");
    offset += written;
  }
}
function sendFrame(kind, bytes = Buffer.alloc(0)) {
  if (bytes.length > FRAME_LIMIT) throw new Error("PGLITE_FRAME_TOO_LARGE");
  const header = Buffer.allocUnsafe(5);
  header[0] = kind.charCodeAt(0);
  header.writeUInt32BE(bytes.length, 1);
  writeAll(1, header);
  writeAll(1, bytes);
}
function sendJson(kind, value) {
  sendFrame(kind, Buffer.from(JSON.stringify(value)));
}
function readPipe(length, allowEof = false) {
  const bytes = Buffer.allocUnsafe(length);
  for (let offset = 0; offset < length;) {
    const received = fs.readSync(0, bytes, offset, length - offset, null);
    if (!received) {
      if (allowEof && offset === 0) return null;
      throw new Error("PGLITE_BROKER_PIPE_EOF");
    }
    offset += received;
  }
  return bytes;
}
function nextFrame() {
  const header = readPipe(5, true);
  if (header === null) return { kind: "S", bytes: Buffer.alloc(0) };
  const length = header.readUInt32BE(1);
  if (length > FRAME_LIMIT) throw new Error("PGLITE_BROKER_FRAME_TOO_LARGE");
  const kind = String.fromCharCode(header[0]);
  if (!["D", "E", "S"].includes(kind) || (kind !== "D" && length !== 0)) {
    throw new Error("PGLITE_BROKER_FRAME_INVALID");
  }
  return { kind, bytes: readPipe(length) };
}

let wire = Buffer.alloc(0);
let wireOffset = 0;
let ended = false;
let shutdown = false;
let prefix = Buffer.alloc(0);
let prefixOffset = 0;
let messageRemaining = 0;
let terminated = false;
let internal = false;
let outputMode = "client";
let captured = [];
let captureSize = 0;
let db;
let mod;
let nativeReadPointer;
let nativeWritePointer;
let closeRequested = false;
let closeReported = false;

function reportClosed(exitCode) {
  if (closeReported || !closeRequested || exitCode !== 0 || !db?.closed) return;
  closeReported = true;
  sendJson("Z", { status: "CLOSED", nativeClosed: db.closed, exitCode,
    stats, peakRssKiB: process.resourceUsage().maxRSS });
}
// The pinned engine may finish close() by exiting Node from Emscripten.
// Report only after its filesystem close and native closed flag have completed.
process.once("exit", code => {
  try { reportClosed(code); } catch {}
});

function refillWire() {
  if (wireOffset < wire.length) return true;
  wire = Buffer.alloc(0);
  wireOffset = 0;
  if (ended || shutdown) return false;
  for (;;) {
    const frame = nextFrame();
    if (frame.kind === "S") {
      shutdown = true;
      ended = true;
      return false;
    }
    if (frame.kind === "E") {
      ended = true;
      return false;
    }
    if (frame.bytes.length) {
      wire = frame.bytes;
      stats.clientBytes += wire.length;
      return true;
    }
  }
}
function readWire(length) {
  const bytes = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    if (!refillWire()) return null;
    const count = Math.min(length - offset, wire.length - wireOffset);
    wire.copy(bytes, offset, wireOffset, wireOffset + count);
    wireOffset += count;
    offset += count;
  }
  return bytes;
}
function setInputPrefix(bytes, startup = false) {
  prefix = bytes;
  prefixOffset = 0;
  const total = startup ? bytes.readUInt32BE(0) : bytes.readUInt32BE(1) + 1;
  messageRemaining = total - bytes.length;
  if (messageRemaining < 0) throw new Error("PGLITE_INPUT_PREFIX_LENGTH");
}
function validateFrontend(header) {
  const length = header.readUInt32BE(1);
  if (length < 4 || length > 0x3fffffff) throw new Error("PGLITE_FRONTEND_LENGTH");
  return header[0] === 88 && length === 4;
}
function terminateClient() {
  terminated = true;
  messageRemaining = 0;
  sendJson("C", { reason: "TERMINATE" });
}
function nativeRead(pointer, maximum) {
  if (prefixOffset < prefix.length) {
    const count = Math.min(maximum, prefix.length - prefixOffset);
    mod.HEAPU8.set(prefix.subarray(prefixOffset, prefixOffset + count), pointer);
    prefixOffset += count;
    return count;
  }
  if (internal || ended || shutdown || terminated) return 0;
  if (messageRemaining > 0) {
    if (!refillWire()) {
      messageRemaining = 0;
      return 0;
    }
    const count = Math.min(maximum, messageRemaining, wire.length - wireOffset);
    mod.HEAPU8.set(wire.subarray(wireOffset, wireOffset + count), pointer);
    wireOffset += count;
    messageRemaining -= count;
    return count;
  }
  // COPY may need the next frontend message before the native loop returns.
  // Bound each callback to one message so a coalesced Terminate can never be
  // prefetched into PostgreSQL's receive buffer behind CopyDone or another Q.
  const header = readWire(5);
  if (header === null) return 0;
  if (validateFrontend(header)) {
    terminateClient();
    return 0;
  }
  setInputPrefix(header);
  return nativeRead(pointer, maximum);
}
function nativeWrite(pointer, length) {
  const bytes = mod.HEAPU8.subarray(pointer, pointer + length);
  if (outputMode === "capture") {
    captureSize += length;
    if (captureSize > FRAME_LIMIT) throw new Error("PGLITE_SESSION_RESET_OUTPUT_LIMIT");
    captured.push(Buffer.from(bytes));
  } else if (outputMode === "client") {
    for (let offset = 0; offset < length; offset += FRAME_LIMIT) {
      sendFrame("D", bytes.subarray(offset, Math.min(offset + FRAME_LIMIT, length)));
    }
    stats.serverBytes += length;
  }
  return length;
}
function runNative(bytes, startup = false) {
  setInputPrefix(bytes, startup);
  if (startup) {
    const result = mod._ProcessStartupPacket(mod._pgl_getMyProcPort(), true, true);
    if (result !== 0) throw new Error("PGLITE_NATIVE_STARTUP_" + result);
    mod._pgl_sendConnData();
    mod._pgl_pq_flush();
    return;
  }
  try {
    while (prefixOffset < prefix.length || messageRemaining > 0 || mod._pq_buffer_remaining_data() > 0) {
      try {
        mod._PostgresMainLoopOnce();
      } catch (error) {
        // 100 is PGlite's documented extraction of PostgreSQL's main longjmp.
        if (mod._pgl_setPGliteExitStatus(-2) !== 100) throw error;
        mod._PostgresMainLongJmp();
      }
    }
  } finally {
    mod._PostgresSendReadyForQueryIfNecessary();
    mod._pgl_pq_flush();
  }
}
function queryPacket(sql) {
  const body = Buffer.from(sql + "\0", "utf8");
  const bytes = Buffer.allocUnsafe(body.length + 5);
  bytes[0] = 81;
  bytes.writeUInt32BE(body.length + 4, 1);
  body.copy(bytes, 5);
  return bytes;
}
function requireIdleResponse(bytes, command) {
  let offset = 0;
  let idle = false;
  let commandComplete = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 5) throw new Error("PGLITE_RESET_TRUNCATED_RESPONSE");
    const kind = String.fromCharCode(bytes[offset]);
    const length = bytes.readUInt32BE(offset + 1);
    if (length < 4 || offset + 1 + length > bytes.length) throw new Error("PGLITE_RESET_INVALID_RESPONSE");
    const body = bytes.subarray(offset + 5, offset + 1 + length);
    if (kind === "E") throw new Error("PGLITE_NATIVE_SESSION_RESET_ERROR: " + body.toString("utf8"));
    if (kind === "C" && body.toString("utf8").replace(/\0$/, "") === command) commandComplete = true;
    if (kind === "Z") idle = body.length === 1 && body[0] === 73;
    offset += length + 1;
  }
  if (!idle || !commandComplete) throw new Error("PGLITE_NATIVE_SESSION_RESET_NOT_IDLE");
}
function resetCommand(sql) {
  captured = [];
  captureSize = 0;
  internal = true;
  outputMode = "capture";
  try {
    runNative(queryPacket(sql));
    requireIdleResponse(Buffer.concat(captured), sql);
  } finally {
    internal = false;
    outputMode = "client";
    captured = [];
    captureSize = 0;
  }
}
async function finishClient(started) {
  // Consume only this client's queued bytes. The broker cannot send a new client
  // until A confirms native rollback and session reset have completed.
  wireOffset = wire.length;
  while (!ended && !shutdown) {
    const frame = nextFrame();
    if (frame.kind === "S") { shutdown = true; ended = true; }
    if (frame.kind === "E") ended = true;
  }
  wire = Buffer.alloc(0);
  wireOffset = 0;
  if (started) {
    resetCommand("ROLLBACK");
    resetCommand("DISCARD ALL");
    await db.syncToFs();
    stats.resets += 1;
  }
  sendJson("A", { reset: started, stats });
}
async function serve() {
  for (;;) {
    ended = false;
    terminated = false;
    let startup = readWire(8);
    if (shutdown) return;
    let started = false;
    while (startup !== null) {
      const length = startup.readUInt32BE(0);
      const protocol = startup.readUInt32BE(4);
      if (length < 8 || length > 10000) throw new Error("PGLITE_STARTUP_LENGTH");
      if ((protocol === 80877103 || protocol === 80877104) && length === 8) {
        // This local development transport has no TLS/GSS layer.
        sendFrame("D", Buffer.from("N"));
        startup = readWire(8);
        continue;
      }
      if (protocol === 80877102) {
        sendJson("C", { reason: "CANCEL_CONNECTION_UNSUPPORTED" });
        // A separate cancel connection cannot target this serialized in-process
        // backend. Close it without manufacturing a PostgreSQL response.
        break;
      }
      runNative(startup, true);
      started = true;
      stats.connections += 1;
      for (;;) {
        const header = readWire(5);
        if (header === null) break;
        if (validateFrontend(header)) {
          terminateClient();
          break;
        }
        runNative(header);
        await db.syncToFs();
        if (ended || shutdown || terminated) break;
      }
      break;
    }
    await finishClient(started);
    if (shutdown) return;
  }
}

try {
  db = new PGlite({ dataDir: dataDirectory, ...configuration });
  await db.waitReady;
  const actual = await db.query("SELECT version() AS version, current_setting('shared_buffers') AS shared_buffers, current_setting('work_mem') AS work_mem, current_setting('maintenance_work_mem') AS maintenance_work_mem, current_setting('max_connections') AS max_connections");
  mod = db.Module;
  for (const name of ["addFunction", "_pgl_set_rw_cbs", "_PostgresMainLoopOnce",
    "_pq_buffer_remaining_data", "_pgl_setPGliteExitStatus", "_PostgresMainLongJmp",
    "_PostgresSendReadyForQueryIfNecessary", "_pgl_pq_flush", "_pgl_getMyProcPort",
    "_ProcessStartupPacket", "_pgl_sendConnData"]) {
    if (typeof mod?.[name] !== "function") throw new Error("PGLITE_NATIVE_API_MISSING_" + name);
  }
  nativeReadPointer = mod.addFunction(nativeRead, "iii");
  nativeWritePointer = mod.addFunction(nativeWrite, "iii");
  mod._pgl_set_rw_cbs(nativeReadPointer, nativeWritePointer);
  sendJson("R", { version: actual.rows[0].version, package: packageInfo.version,
    settings: actual.rows[0], configuration, pid: process.pid, node: process.version,
    nodeFlags: process.execArgv, linearMemoryBytes: mod.HEAPU8.byteLength,
    memory: process.memoryUsage(), peakRssKiB: process.resourceUsage().maxRSS });
  await serve();
  outputMode = "discard";
  internal = true;
  await db.syncToFs();
  closeRequested = true;
  await db.close();
  if (!db.closed) throw new Error("PGLITE_NATIVE_CLOSE_NOT_COMPLETE");
  reportClosed(0);
} catch (error) {
  outputMode = "discard";
  internal = true;
  try { sendJson("F", { error: String(error), stack: error?.stack?.slice(0, 6000), stats }); } catch {}
  process.exitCode = 1;
} finally {
  outputMode = "discard";
  internal = true;
  if (db && !db.closed) {
    try { await db.close(); } catch {}
  }
  if (mod) {
    for (const pointer of [nativeReadPointer, nativeWritePointer]) {
      if (pointer !== undefined) try { mod.removeFunction(pointer); } catch {}
    }
  }
}
