// MIT. Full private workspace receiving and exact create-only customer delivery.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, renameSync, linkSync, unlinkSync, chmodSync, openSync, readSync, writeSync, closeSync, fsyncSync, statSync, createReadStream } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync, gunzipSync, createGunzip } from 'node:zlib';
import { WorkspacePacketReader } from './packet-reader.mjs';
import { MasteringWorkspace, SCHEMA, sha256, ensure } from './core.mjs';

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

const json = v => JSON.stringify(v) + '\n';
const deliveryNames = new Set(['master.csv', 'dataset.json', 'delivery.json', 'field-provenance.jsonl', 'conflicts.csv', 'READING.md']);
export function createFile(path, bytes) {
    path = resolve(path);
    const temporary = join(dirname(path), '.mastering-' + randomUUID());
    let fd, owned = false, primary;
    try {
        fd = openSync(temporary, 'wx', 0o600); owned = true;
        writeAll(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
        linkSync(temporary, path);
        return { path, bytes: bytes.length, sha256: sha256(bytes) };
    } catch (error) { primary = error; }
    finally { finishOwnedCleanup(primary, [
        () => { if (fd !== undefined) closeSync(fd); },
        () => { if (owned) rmSync(temporary, { force: true }); },
    ]); }
}
export function workspacePacket(workspace, { expectedRevision } = {}) {
    const temp = join(workspace.directory, '.snapshot-' + randomUUID() + '.sqlite');
    let primary;
    try {
        workspace.db.prepare('VACUUM INTO ?').run(temp);
        if (expectedRevision !== undefined) {
            const captured = new DatabaseSync(temp, { readOnly: true });
            let captureError;
            try {
                ensure(captured.prepare('SELECT revision FROM workspace').get().revision === expectedRevision, 'REVISION_CHANGED', 'The workspace changed before its snapshot was captured.', 409);
            }
            catch (error) { captureError = error; }
            finally { finishOwnedCleanup(captureError, [() => captured.close()]); }
        }
        const bytes = readFileSync(temp);
        ensure(bytes.length < 380 * 1024 * 1024, 'TRANSFER_TOO_LARGE', 'This workspace exceeds the 380 MiB portable snapshot size.');
        return gzipSync(Buffer.from(json({ schema: SCHEMA + '.workspace-packet', databaseSha256: sha256(bytes), database: bytes.toString('base64') })));
    }
    catch (error) { primary = error; }
    finally { finishOwnedCleanup(primary, [() => rmSync(temp, { force: true })]); }
}
function decode(bytes, schema, expectedSha256) {
    if (expectedSha256)
        ensure(sha256(bytes) === expectedSha256, 'TRANSFER_CHANGED', 'The received file digest differs from the selected transfer.', 409);
    const packet = JSON.parse(gunzipSync(bytes, { maxOutputLength: 512 * 1024 * 1024 }).toString('utf8'));
    ensure(packet.schema === schema, 'TRANSFER_FORMAT', 'Unsupported transfer file.');
    return packet;
}
export function receiveWorkspace(bytes, destination, { expectedSha256, receipt } = {}) {
    const packet = decode(bytes, SCHEMA + '.workspace-packet', expectedSha256), db = Buffer.from(packet.database, 'base64');
    ensure(sha256(db) === packet.databaseSha256, 'DATABASE_CHANGED', 'The workspace database digest is invalid.');
    destination = resolve(destination);
    ensure(!existsSync(destination), 'DESTINATION_EXISTS', 'Receive into a new directory.', 409);
    const stage = join(dirname(destination), '.mastering-receive-' + randomUUID());
    mkdirSync(stage, { mode: 0o700 });
    let workspace, primary;
    try {
        writeFileSync(join(stage, 'mastering.sqlite'), db, { flag: 'wx', mode: 0o600 });
        workspace = new MasteringWorkspace(stage);
        ensure(workspace.db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 'DATABASE_INVALID', 'The received database is damaged.');
        ensure(workspace.db.prepare('PRAGMA foreign_key_check').all().length === 0, 'DATABASE_INVALID', 'The received database has broken references.');
        for (const row of workspace.db.prepare('SELECT original,sha256 FROM source_editions').all())
            ensure(sha256(row.original) === row.sha256, 'SOURCE_CHANGED', 'A retained original source is damaged.');
        if (receipt)
            workspace.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('receiver', JSON.stringify(receipt));
        const result = workspace.status();
        workspace.close();
        workspace = null;
        // Reserve the final destination before moving each known SQLite file. Never replace another workspace.
        mkdirSync(destination, { mode: 0o700 });
        try {
            renameSync(join(stage, 'mastering.sqlite'), join(destination, 'mastering.sqlite'));
        }
        catch (error) { finishOwnedCleanup(error, [() => rmSync(destination, { recursive: true, force: true })]); }
        return { directory: destination, workspaceId: result.id, revision: result.revision, counts: result.counts, sha256: sha256(bytes) };
    }
    catch (error) { primary = error; }
    finally { finishOwnedCleanup(primary, [() => workspace?.close(), () => rmSync(stage, { recursive: true, force: true })]); }
}
export function deliveryPacket(workspace, deliveryId) { const delivery = workspace.delivery(deliveryId); return gzipSync(Buffer.from(json({ schema: SCHEMA + '.delivery-packet', deliveryId, files: delivery.files, sha256: Object.fromEntries(Object.entries(delivery.files).map(([name, b64]) => [name, sha256(Buffer.from(b64, 'base64'))])) }))); }
export function receiveDelivery(bytes, destination, { expectedSha256 } = {}) {
    const packet = decode(bytes, SCHEMA + '.delivery-packet', expectedSha256);
    ensure(packet.files && Object.keys(packet.files).length === deliveryNames.size && Object.keys(packet.files).every(n => deliveryNames.has(n)), 'DELIVERY_FORMAT', 'The delivery file set is invalid.');
    const files = Object.entries(packet.files).map(([name, b64]) => { const data = Buffer.from(b64, 'base64'); ensure(sha256(data) === packet.sha256?.[name], 'DELIVERY_CHANGED', 'A delivered file digest is invalid.'); return { name, data }; });
    const info = JSON.parse(files.find(f => f.name === 'delivery.json').data.toString('utf8'));
    ensure(info.csvSha256 === sha256(files.find(f => f.name === 'master.csv').data), 'DELIVERY_CHANGED', 'The master CSV differs from its delivery description.');
    destination = resolve(destination);
    mkdirSync(destination, { mode: 0o700 });
    try {
        for (const file of files)
            writeFileSync(join(destination, file.name), file.data, { flag: 'wx', mode: 0o600 });
    }
    catch (error) { finishOwnedCleanup(error, [() => rmSync(destination, { recursive: true, force: true })]); }
    return { directory: destination, deliveryId: packet.deliveryId, files: files.map(f => ({ name: f.name, bytes: f.data.length, sha256: sha256(f.data) })), rowCount: info.rowCount };
}


// The file API writes ordinary concatenated gzip members. Every legacy receiver sees the
// same v1 JSON object after gunzip, without an intermediate whole-database base64 string.
export function hashFile(path) {
    const fd=openSync(path,'r'), hash=createHash('sha256'), buffer=Buffer.alloc(196608);
    let bytes=0, primary;
    try { for (;;) { const size=readSync(fd,buffer,0,buffer.length,null); if (!size) break;
        bytes+=size; hash.update(buffer.subarray(0,size)); } }
    catch (error) { primary = error; }
    finally { finishOwnedCleanup(primary, [() => closeSync(fd)]); }
    return {bytes,sha256:hash.digest('hex')};
}
function writeAll(fd,bytes) { let offset=0; while(offset<bytes.length) {
    const size=writeSync(fd,bytes,offset,bytes.length-offset); ensure(size>0,'WRITE_INTERRUPTED','The complete transfer could not be saved.'); offset+=size;
} }
export function workspaceFile(workspace,output,{expectedRevision}={}) {
    output=resolve(output);
    const snapshot=join(workspace.directory,'.snapshot-'+randomUUID()+'.sqlite');
    const temporary=join(dirname(output),'.mastering-'+randomUUID());
    let input, destination, primary;
    try {
        workspace.db.prepare('VACUUM INTO ?').run(snapshot); chmodSync(snapshot,0o600);
        ensure(statSync(snapshot).size<380*1024*1024,'TRANSFER_TOO_LARGE','This workspace exceeds the 380 MiB portable snapshot size.');
        if(expectedRevision!==undefined) { const captured=new DatabaseSync(snapshot,{readOnly:true}); let captureError;
            try { ensure(captured.prepare('SELECT revision FROM workspace').get().revision===expectedRevision,
                'REVISION_CHANGED','The workspace changed before its snapshot was captured.',409); }
            catch(error){captureError=error;} finally {finishOwnedCleanup(captureError,[()=>captured.close()]);}
        }
        const database=hashFile(snapshot), digest=createHash('sha256'); let size=0;
        destination=openSync(temporary,'wx',0o600);
        const member=text=>{const compressed=gzipSync(Buffer.from(text));writeAll(destination,compressed);digest.update(compressed);size+=compressed.length;};
        member('{"schema":'+JSON.stringify(SCHEMA+'.workspace-packet')+',"databaseSha256":'+JSON.stringify(database.sha256)+',"database":"');
        // A multiple of three prevents interior padding across base64 chunks.
        input=openSync(snapshot,'r');const chunk=Buffer.alloc(3*512*1024);let remaining=database.bytes;
        while(remaining) {
            let filled=0;const wanted=Math.min(chunk.length,remaining);
            while(filled<wanted){const n=readSync(input,chunk,filled,wanted-filled,null);ensure(n>0,'SNAPSHOT_TRUNCATED','The original snapshot changed.');filled+=n;}
            member(chunk.subarray(0,filled).toString('base64'));remaining-=filled;
        }
        member('"}\n');fsyncSync(destination);closeSync(destination);destination=undefined;
        linkSync(temporary,output);
        return {path:output,bytes:size,sha256:digest.digest('hex')};
    } catch(error){primary=error;} finally {
        finishOwnedCleanup(primary,[()=>{if(input!==undefined)closeSync(input);},()=>{if(destination!==undefined)closeSync(destination);},()=>rmSync(snapshot,{force:true}),()=>rmSync(temporary,{force:true})]);
    }
}

// A file receiver keeps only gzip/UTF-8/base64 chunks in memory. The authoritative database
// is admitted only after the entire original file, JSON envelope and source digests agree.
export async function receiveWorkspaceFile(file,destination,{expectedSha256,receipt,signal}={}) {
    destination=resolve(destination);ensure(!existsSync(destination),'DESTINATION_EXISTS','Receive into a new directory.',409);
    const stage=join(dirname(destination),'.mastering-receive-'+randomUUID());mkdirSync(stage,{mode:0o700});
    let fd, workspace, source, unzip, primary;
    try {
        fd=openSync(join(stage,'mastering.sqlite'),'wx',0o600);
        const reader=new WorkspacePacketReader(bytes=>writeAll(fd,bytes),SCHEMA+'.workspace-packet');
        const hash=createHash('sha256');source=createReadStream(file,{signal});unzip=createGunzip();
        const onError=error=>unzip.destroy(error);source.on('error',onError);source.on('data',chunk=>hash.update(chunk));source.pipe(unzip);
        const decoder=new TextDecoder('utf-8',{fatal:true});let decoded=0;
        for await(const chunk of unzip){decoded+=chunk.length;ensure(decoded<=512*1024*1024,'TRANSFER_TOO_LARGE','The expanded transfer exceeds 512 MiB.');reader.push(decoder.decode(chunk,{stream:true}));}
        reader.push(decoder.decode());reader.finish();const digest=hash.digest('hex');
        if(expectedSha256)ensure(digest===expectedSha256,'TRANSFER_CHANGED','The received file digest differs from the selected transfer.',409);
        fsyncSync(fd);closeSync(fd);fd=undefined;
        workspace=new MasteringWorkspace(stage);
        ensure(workspace.db.prepare('PRAGMA integrity_check').get().integrity_check==='ok','DATABASE_INVALID','The received database is damaged.');
        ensure(workspace.db.prepare('PRAGMA foreign_key_check').all().length===0,'DATABASE_INVALID','The received database has broken references.');
        for(const row of workspace.db.prepare('SELECT original,sha256 FROM source_editions').iterate())
            ensure(sha256(row.original)===row.sha256,'SOURCE_CHANGED','A retained original source is damaged.');
        if(receipt)workspace.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('receiver',JSON.stringify(receipt));
        const result=workspace.status();workspace.close();workspace=undefined;
        mkdirSync(destination,{mode:0o700});
        try {renameSync(join(stage,'mastering.sqlite'),join(destination,'mastering.sqlite'));}
        catch(error){finishOwnedCleanup(error,[()=>rmSync(destination,{recursive:true,force:true})]);}
        return {directory:destination,workspaceId:result.id,revision:result.revision,counts:result.counts,sha256:digest};
    } catch(error){primary=error;} finally {
        finishOwnedCleanup(primary,[()=>source?.destroy(),()=>unzip?.destroy(),()=>{if(fd!==undefined)closeSync(fd);},()=>workspace?.close(),()=>rmSync(stage,{recursive:true,force:true})]);
    }
}
