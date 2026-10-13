// MIT. Original workspace operations, configured file aliases and complete receiving.
import { readFileSync, writeFileSync, mkdirSync, realpathSync, statSync, readdirSync, existsSync, renameSync, openSync, readSync, closeSync, linkSync, rmSync, fsyncSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RecordMasteringClient } from './client.mjs';
import { workspaceFile, hashFile, deliveryPacket, receiveWorkspaceFile, createFile } from './portable.mjs';
import { ensure, sha256, SCHEMA } from './core.mjs';
import { READ_ACTIONS, WRITE_ACTIONS, recordMasteringTools } from './mcp-tools.mjs';
export { recordMasteringTools };

// Always attempt every owned cleanup and preserve the original failure object.
function finishOwnedCleanup(primary, actions) {
    const failures = [];
    for (const action of actions) { try { action(); } catch (error) { failures.push(error); } }
    if (primary) {
        if (failures.length && (typeof primary === 'object' || typeof primary === 'function')) {
            try { Object.defineProperty(primary, 'cleanupErrors', { value: [...(primary.cleanupErrors ?? []), ...failures], configurable: true }); } catch {}
        }
        throw primary;
    }
    if (failures.length) { const first = failures.shift(); if (failures.length && first && (typeof first === 'object' || typeof first === 'function')) { try { Object.defineProperty(first, 'cleanupErrors', { value: [...(first.cleanupErrors ?? []), ...failures], configurable: true }); } catch {} } throw first; }
}

const CONFIG = SCHEMA + '.connection', alias = /^[a-z0-9][a-z0-9_-]{0,63}$/, hash = /^[a-f0-9]{64}$/;
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x), json = x => JSON.stringify(x) + '\n';
const stable = x => Array.isArray(x) ? '[' + x.map(stable).join(',') + ']' : plain(x) ? '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}' : JSON.stringify(x);
const existingPath = (base, value, kind) => { ensure(typeof value === 'string' && value, 'CONFIG_PATH_REQUIRED', 'A configured path is required.'); const p = realpathSync(resolve(base, value)); ensure(kind === 'file' ? statSync(p).isFile() : statSync(p).isDirectory(), 'CONFIG_PATH_INVALID', 'A configured path has the wrong kind.'); return p; };
export function readMasteringConfiguration(file) {
    const path = realpathSync(file), raw = JSON.parse(readFileSync(path, 'utf8')), base = dirname(path);
    ensure(raw.schema === CONFIG && plain(raw.workspaces), 'CONFIGURATION_INVALID', 'Expected a record-mastering connection with named workspaces.');
    const workspaces = {};
    for (const [name, value] of Object.entries(raw.workspaces)) {
        ensure(alias.test(name) && plain(value) && plain(value.inputs ?? {}), 'CONFIGURATION_INVALID', 'Use simple source/workspace aliases.');
        const directory = existingPath(base, value.directory, 'directory'), inputs = {};
        for (const [name, input] of Object.entries(value.inputs ?? {})) {
            ensure(alias.test(name) && plain(input) && (!input.sha256 || hash.test(input.sha256)), 'CONFIGURATION_INVALID', 'Each input needs a named file and optional SHA-256.');
            inputs[name] = { path: existingPath(base, input.path, 'file'), sha256: input.sha256 ?? null };
        }
        // Export and receiving destinations are deliberately configured by the host, not tool arguments.
        for (const field of ['exportsDirectory', 'receiveRoot'])
            ensure(typeof value[field] === 'string' && value[field], 'CONFIGURATION_INVALID', 'Configure private export and receiving directories.');
        workspaces[name] = { directory, label: value.label ?? name, inputs, exportsDirectory: resolve(base, value.exportsDirectory), receiveRoot: resolve(base, value.receiveRoot) };
    }
    return { schema: CONFIG, workspaces };
}
function saveRecord(path, value) {
    const temporary = path + '.' + randomUUID(); let fd, owned = false, primary;
    try {
        fd = openSync(temporary, 'wx', 0o600); owned = true;
        writeFileSync(fd, json(value)); fsyncSync(fd); closeSync(fd); fd = undefined;
        renameSync(temporary, path); owned = false;
    } catch(error) { primary = error; }
    finally { finishOwnedCleanup(primary, [()=>{if(fd!==undefined)closeSync(fd);},()=>{if(owned)rmSync(temporary,{force:true});}]); }
}
function configuredInput(entry, name, expected, readBytes=true) { ensure(Object.hasOwn(entry.inputs, name), 'INPUT_UNKNOWN', 'Choose an input alias from the original connection.'); const input = entry.inputs[name], bytes = readBytes?readFileSync(input.path):null, file=bytes?{bytes:bytes.length,sha256:sha256(bytes)}:hashFile(input.path), digest=file.sha256; ensure((!input.sha256 || input.sha256 === digest) && (!expected || expected === digest), 'INPUT_CHANGED', 'The configured file differs from the inspected source.', 409); return { path:input.path, bytes, sha256: digest, size: file.bytes }; }
const definitions = new Map(recordMasteringTools((name, description, properties, required) => ({ name, properties, required })).map(d => [d.name, d]));
export class MerchantRecordMastering {
    #config;
    #clients = new Map();
    #closed = false;
    #tasks = new Set();
    constructor(config) { this.#config = config.recordMastering; }
    get summary() { return { configured: Boolean(this.#config), workspaces: Object.keys(this.#config?.workspaces ?? {}), attachedClients: this.#clients.size }; }
    #entries() {
        const entries = { ...this.#config?.workspaces };
        for (const [parent, entry] of Object.entries(this.#config?.workspaces ?? {})) {
            if (!existsSync(entry.receiveRoot))
                continue;
            for (const item of readdirSync(entry.receiveRoot, { withFileTypes: true })) {
                if (!item.isDirectory() || !alias.test(item.name))
                    continue;
                const directory = join(entry.receiveRoot, item.name), marker = join(directory, 'mastering-receive.json');
                if (!existsSync(marker)) {
                    if (!existsSync(join(directory, 'mastering.sqlite')))
                        continue;
                    const received = new RecordMasteringClient({ directory });
                    let retained;
                    try {
                        retained = received.workspace.db.prepare('SELECT value FROM settings WHERE key=?').get('receiver');
                    }
                    finally {
                        received.close();
                    }
                    if (!retained)
                        continue;
                    createFile(marker, Buffer.from(retained.value));
                }
                const saved = JSON.parse(readFileSync(marker, 'utf8'));
                if (saved.schema !== SCHEMA + '.received' || saved.parent !== parent)
                    continue;
                const name = parent + '__' + item.name;
                ensure(!Object.hasOwn(entries, name), 'RECEIVED_ALIAS_COLLISION', 'A received workspace alias conflicts with configured workspace.');
                entries[name] = { ...entry, directory, label: entry.label + ' / ' + item.name, inputs: {}, exportsDirectory: join(directory, 'exports'), receiveRoot: join(directory, 'received') };
            }
        }
        return entries;
    }
    #entry(name) { const entries = this.#entries(); ensure(Object.hasOwn(entries, name), 'WORKSPACE_UNKNOWN', 'Choose a configured or received workspace alias.'); return entries[name]; }
    #client(name) { const entry = this.#entry(name); if (!this.#clients.has(name))
        this.#clients.set(name, new RecordMasteringClient({ directory: entry.directory })); return this.#clients.get(name); }
    #export(entry, client, args) {
        ensure(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(args.requestId), 'REQUEST_ID_INVALID', 'Use a stable, simple export request ID.');
        const wanted = { workspace: client.workspace.meta().id, kind: args.kind, deliveryId: args.deliveryId ?? null, expectedRevision: args.expectedRevision, requestId: args.requestId }, inputSha256 = sha256(stable(wanted));
        mkdirSync(entry.exportsDirectory, { recursive: true, mode: 0o700 });
        const requestFile = join(entry.exportsDirectory, 'request-' + sha256(args.requestId) + '.json');
        let request = existsSync(requestFile) ? JSON.parse(readFileSync(requestFile, 'utf8')) : null;
        const validateFile = file => {
            ensure(file?.schema === SCHEMA + '.export' && file.kind === wanted.kind && file.workspaceId === wanted.workspace &&
                file.revision === wanted.expectedRevision && (file.deliveryId ?? null) === (wanted.kind === 'delivery' ? wanted.deliveryId : null) &&
                hash.test(file.sha256) && Number.isSafeInteger(file.bytes) && file.bytes > 0,
                'EXPORT_CHANGED', 'The retained export description differs from its original request.');
            return file;
        };
        const validateBytes = (path, file) => {
            const saved = hashFile(path);
            ensure(saved.sha256 === file.sha256 && saved.bytes === file.bytes, 'EXPORT_CHANGED', 'The original exported bytes changed.');
        };
        const completePrepared = () => {
            const prepared = request.prepared, result = validateFile(prepared?.file);
            ensure(typeof prepared.temporary === 'string' && /^\.export-[a-f0-9-]{36}\.gz$/.test(prepared.temporary),
                'EXPORT_CHANGED', 'The retained export staging name changed.');
            const temporary = join(entry.exportsDirectory, prepared.temporary), path = join(entry.exportsDirectory, result.sha256 + '.bin');
            if (existsSync(path)) validateBytes(path, result);
            else {
                validateBytes(temporary, result);
                try { linkSync(temporary, path); }
                catch(error) { if (error.code !== 'EEXIST') throw error; validateBytes(path, result); }
            }
            // The exact prepared bytes are recoverable before this publication and receipt save.
            saveRecord(requestFile, { ...request, prepared: undefined, file: result });
            rmSync(temporary, { force: true });
            return result;
        };
        if (request) {
            ensure(request.schema === SCHEMA + '.export-request' && request.inputSha256 === inputSha256 &&
                stable(request.input) === stable(wanted), 'REQUEST_ID_REUSED', 'The export request ID was used with different input.', 409);
            if (request.file) {
                const result = validateFile(request.file);
                validateBytes(join(entry.exportsDirectory, result.sha256 + '.bin'), result);
                return { ...result, replayed: true };
            }
            // Recovery belongs to the frozen original snapshot, even after later workspace edits.
            if (request.prepared) return { ...completePrepared(), replayed: true };
        }
        ensure(client.workspace.meta().revision === args.expectedRevision, 'REVISION_CHANGED', 'Refresh the workspace before exporting.', 409);
        if (!request) {
            request = { schema: SCHEMA + '.export-request', inputSha256, input: wanted };
            createFile(requestFile, Buffer.from(json(request)));
        }
        const temporaryName = '.export-' + randomUUID() + '.gz', temporary = join(entry.exportsDirectory, temporaryName);
        let retained = false, created = false, primary;
        try {
            let saved;
            if (args.kind === 'workspace')
                saved = workspaceFile(client.workspace, temporary, { expectedRevision: args.expectedRevision });
            else
                saved = createFile(temporary, deliveryPacket(client.workspace, args.deliveryId));
            created = true;
            const result = { schema: SCHEMA + '.export', kind: args.kind, sha256: saved.sha256, bytes: saved.bytes, workspaceId: wanted.workspace,
                revision: args.expectedRevision, ...(args.kind === 'delivery' ? { deliveryId: args.deliveryId } : {}) };
            request = { ...request, prepared: { temporary: temporaryName, file: result } };
            saveRecord(requestFile, request); retained = true;
            return completePrepared();
        } catch(error) { primary = error; }
        finally {
            // A prepared file remains available for the same request until its final receipt is durable.
            finishOwnedCleanup(primary, [() => { if (created && !retained) rmSync(temporary, { force: true }); }]);
        }
    }
    async #call(name, args) {
        if (name === 'merchant_mastering_workspaces')
            return { workspaces: Object.entries(this.#entries()).map(([workspace, e]) => ({ workspace, label: e.label, inputs: Object.entries(e.inputs).map(([input, v]) => ({ input, sha256: v.sha256 })) })) };
        const entry = this.#entry(args.workspace), client = this.#client(args.workspace);
        if (name === 'merchant_mastering_query') {
            ensure(READ_ACTIONS.includes(args.action), 'ACTION_INVALID', 'Choose an original read action.');
            const result = client.invoke(args.action, args.input ?? {}), bytes = Buffer.from(json(result));
            if (bytes.length <= 65536)
                return result;
            mkdirSync(entry.exportsDirectory, { recursive: true, mode: 0o700 });
            const digest = sha256(bytes), path = join(entry.exportsDirectory, digest + '.bin');
            if (!existsSync(path))
                createFile(path, bytes);
            return { schema: SCHEMA + '.result-file', workspace: args.workspace, action: args.action, format: 'application/json', sha256: digest, bytes: bytes.length, readTool: 'merchant_mastering_file_read' };
        }
        if (name === 'merchant_mastering_apply') {
            ensure(WRITE_ACTIONS.includes(args.action), 'ACTION_INVALID', 'Choose an original change action.');
            return client.invoke(args.action, args.input);
        }
        if (name === 'merchant_mastering_input' || name === 'merchant_mastering_import') {
            const input = configuredInput(entry, args.input, args.expectedSha256);
            if (name === 'merchant_mastering_input')
                return { input: args.input, bytes: input.size, sha256: input.sha256, ...(args.csv ? client.workspace.inspectCSV(input.bytes) : {}) };
            return client.invoke('source.import', { feedId: args.feedId, label: args.label, expectedRevision: args.expectedRevision, requestId: args.requestId, base64: input.bytes.toString('base64'), sha256: input.sha256 });
        }
        if (name === 'merchant_mastering_export')
            return this.#export(entry, client, args);
        if (name === 'merchant_mastering_file_read') {
            const path = join(entry.exportsDirectory, args.sha256 + '.bin'), offset = args.offset ?? 0, limit = args.limit ?? 65536, bytes = statSync(path).size;
            ensure(offset <= bytes, 'OFFSET_INVALID', 'Offset exceeds the retained file.');
            const data = Buffer.alloc(Math.min(limit, bytes - offset)), fd = openSync(path, 'r');
            let count = 0;
            try {
                while (count < data.length) {
                    const n = readSync(fd, data, count, data.length - count, offset + count);
                    ensure(n > 0, 'EXPORT_TRUNCATED', 'The retained export is incomplete.');
                    count += n;
                }
            }
            finally {
                closeSync(fd);
            }
            return { sha256: args.sha256, totalBytes: bytes, offset, bytes: data.length, base64: data.toString('base64'), chunkSha256: sha256(data), nextOffset: offset + data.length < bytes ? offset + data.length : null };
        }
        if (name === 'merchant_mastering_receive') {
            const input = configuredInput(entry, args.input, args.expectedSha256,false);
            ensure(args.workspace.length + args.name.length + 2 <= 64, 'RECEIVED_ALIAS_TOO_LONG', 'Choose a shorter receiving name.');
            const receivedAlias = args.workspace + '__' + args.name;
            ensure(!Object.hasOwn(this.#config?.workspaces ?? {}, receivedAlias), 'RECEIVED_ALIAS_COLLISION', 'This name is already configured.');
            mkdirSync(entry.receiveRoot, { recursive: true, mode: 0o700 });
            const destination = join(entry.receiveRoot, args.name), marker = join(destination, 'mastering-receive.json');
            if (existsSync(marker)) {
                const saved = JSON.parse(readFileSync(marker, 'utf8'));
                ensure(saved.schema === SCHEMA + '.received' && saved.parent === args.workspace && saved.inputSha256 === input.sha256, 'RECEIVE_NAME_REUSED', 'This receiving name belongs to another original file.', 409);
                const reopened = new RecordMasteringClient({ directory: destination });
                try {
                    return { workspace: receivedAlias, ...reopened.invoke('status'), replayed: true };
                }
                finally {
                    reopened.close();
                }
            }
            const receipt = { schema: SCHEMA + '.received', parent: args.workspace, inputSha256: input.sha256 };
            const result = await receiveWorkspaceFile(input.path, destination, { expectedSha256: input.sha256, receipt });
            createFile(marker, Buffer.from(json(receipt)));
            return { ...result, directory: undefined, workspace: receivedAlias };
        }
        throw Error('Unknown mastering tool.');
    }
    call(name, args = {}) {
        const d = definitions.get(name);
        ensure(!this.#closed && d && plain(args) && Object.keys(args).every(k => Object.hasOwn(d.properties, k)) && d.required.every(k => Object.hasOwn(args, k)), 'TOOL_INPUT_INVALID', 'Provide the declared tool arguments.');
        for (const [key, value] of Object.entries(args)) {
            const s = d.properties[key];
            ensure((s.type !== 'string' || typeof value === 'string' && value.length >= (s.minLength ?? 0) && value.length <= (s.maxLength ?? 1000000) && (!s.pattern || new RegExp(s.pattern).test(value))) && (s.type !== 'integer' || Number.isSafeInteger(value) && value >= (s.minimum ?? 0) && value <= (s.maximum ?? Number.MAX_SAFE_INTEGER)) && (s.type !== 'object' || plain(value)) && (s.type !== 'boolean' || typeof value === 'boolean') && (!s.enum || s.enum.includes(value)), 'TOOL_INPUT_INVALID', 'A tool argument has an invalid value.');
        }
        const task = Promise.resolve().then(() => this.#call(name, args));
        this.#tasks.add(task);
        task.finally(() => this.#tasks.delete(task)).catch(() => { });
        return task;
    }
    async close() {
        this.#closed = true;
        await Promise.allSettled([...this.#tasks]);
        finishOwnedCleanup(null, [...this.#clients].map(([name, client]) => () => {
            client.close();
            this.#clients.delete(name);
        }));
    }
}
