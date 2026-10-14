#!/usr/bin/env node
// MIT. CLI and durable JSON-lines mode use the same native writer as the browser.
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { RecordMasteringClient } from './client.mjs';
import { serveWorkspace } from './server.mjs';
import { createFile } from './portable.mjs';
import { canonical } from './delivery-comparison.mjs';

// Always attempt every owned cleanup and preserve the original failure object.
async function finishOwnedCleanup(primary, actions) {
    const failures = [];
    for (const action of actions) { try { await action(); } catch (error) { failures.push(error); } }
    if (primary) {
        if (failures.length && (typeof primary === 'object' || typeof primary === 'function')) {
            try { Object.defineProperty(primary, 'cleanupErrors', { value: [...(primary.cleanupErrors ?? []), ...failures], configurable: true }); } catch {}
        }
        throw primary;
    }
    if (failures.length) { const first = failures.shift(); if (failures.length && first && (typeof first === 'object' || typeof first === 'function')) { try { Object.defineProperty(first, 'cleanupErrors', { value: [...(first.cleanupErrors ?? []), ...failures], configurable: true }); } catch {} } throw first; }
}

function args(argv) { const positional = [], options = {}; for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
        const key = argv[i].slice(2);
        if (Object.hasOwn(options, key) || !argv[i + 1] || argv[i + 1].startsWith('--'))
            throw Error('Missing or repeated option: ' + argv[i]);
        options[key] = argv[++i];
    }
    else
        positional.push(argv[i]);
} return { positional, options }; }
export async function main(argv = process.argv.slice(2)) {
    const { positional, options: o } = args(argv), command = positional[0] ?? 'help';
    const print = value => process.stdout.write(JSON.stringify(value) + '\n');
    if (command === 'help') {
        console.log('Record mastering — Node 22.16+\n\ncreate --workspace DIR --title TITLE\ninspect --workspace DIR --file source.csv\ninvoke ACTION --workspace DIR --input request.json\nimport --workspace DIR --file source.csv --input request.json\nserve --workspace DIR [--port 0]\nstdio --workspace DIR\nexport --workspace DIR --output workspace.mastering.gz\nreceive --file workspace.mastering.gz --workspace NEW_DIR [--sha256 HASH]\ndeliver --workspace DIR --edition ID --output master-delivery.gz\ncompare --workspace DIR --before ID --after ID --format json|html|csv --output FILE\ncompare --workspace DIR --input comparison.json --format json|html|csv --output FILE\nunpack-delivery --file master-delivery.gz --output NEW_DIR\n\nMutations carry expectedRevision and requestId. For invoke/import, --input - reads a JSON request from stdin.');
        return;
    }
    if (command === 'receive') {
        print(await RecordMasteringClient.receiveFile(o.file,o.workspace,{expectedSha256:o.sha256}));
        return;
    }
    if (command === 'unpack-delivery') {
        print(RecordMasteringClient.unpackDelivery(o.file, o.output, o.sha256));
        return;
    }
    if (!o.workspace)
        throw Error('--workspace is required');
    const client = new RecordMasteringClient({ directory: o.workspace, create: command === 'create', title: o.title });
    if (command === 'serve') {
        let service, closing = null, serviceClosed = false, clientClosed = false;
        const report = error => { process.exitCode = 1; try { process.stderr.write(JSON.stringify({ error: error.code ?? 'CLOSE_FAILED', message: error.message }) + '\n'); } catch {} };
        const onSignal = () => { void stop().catch(report); };
        const stop = () => {
            if (closing) return closing;
            closing = (async () => {
                await finishOwnedCleanup(null, [
                    async () => {
                        if (!service || serviceClosed) return;
                        try { await service.close(); serviceClosed = true; }
                        catch (error) { if (error.code === 'ERR_SERVER_NOT_RUNNING') serviceClosed = true; else throw error; }
                    },
                    () => { if (!clientClosed) { client.close(); clientClosed = true; } },
                ]);
                process.removeListener('SIGINT', onSignal);
                process.removeListener('SIGTERM', onSignal);
            })().finally(() => { closing = null; });
            return closing;
        };
        try {
            service = await serveWorkspace(client.workspace, { port: Number(o.port ?? 0), expectedBindingSha256: o['expected-binding-sha256'] });
            process.on('SIGINT', onSignal);
            process.on('SIGTERM', onSignal);
            // The session URL is private startup output, never part of a customer delivery.
            print(service.ready);
            return { ...service, close: stop };
        } catch (error) { await finishOwnedCleanup(error, [stop]); }
    }
    let primary;
    try {
        const input = () => JSON.parse(readFileSync(o.input === '-' ? 0 : o.input, 'utf8'));
        if (command === 'create')
            print(client.invoke('status'));
        else if (command === 'inspect')
            print(client.inspect(o.file));
        else if (command === 'invoke')
            print(client.invoke(positional[1], o.input ? input() : {}));
        else if (command === 'import')
            print(client.import(o.file, input()));
        else if (command === 'export')
            print(client.export(o.output));
        else if (command === 'deliver')
            print(client.deliver(o.edition, o.output));
        else if (command === 'compare') {
            const saved=o.input?input():null;
            if(saved&&saved.schema!=='stellar-forge.record-mastering.v1.delivery-comparison')throw Error('Choose a complete saved delivery comparison JSON.');
            const result=client.invoke('delivery.compare',saved?{workspaceId:saved.workspace?.id,beforeId:saved.before?.id,afterId:saved.after?.id,expectedSha256:saved.sha256}:{beforeId:o.before,afterId:o.after});
            if(saved&&canonical(saved)!==canonical(result.comparison))throw Error('The saved comparison differs from its complete original editions.');
            const format=o.format??'json';
            if(!['json','html','csv'].includes(format))throw Error('--format must be json, html or csv.');
            if(!o.output)throw Error('--output is required for the complete comparison file.');
            const content=format==='json'?JSON.stringify(result.comparison,null,2)+'\n':format==='html'?result.reportHtml:result.changesCSV;
            print({...createFile(o.output,Buffer.from(content,'utf8')),comparisonSha256:result.comparison.sha256,beforeId:result.comparison.before.id,afterId:result.comparison.after.id});
        }
        else if (command === 'stdio') {
            for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
                let request;
                try {
                    request = JSON.parse(line);
                    print({ id: request.id, result: client.invoke(request.action, request.input ?? {}) });
                }
                catch (error) {
                    print({ ...(request && Object.hasOwn(request, 'id') ? { id: request.id } : {}), error: { code: error.code ?? 'OPERATION_FAILED', message: error.message } });
                }
            }
        }
        else
            throw Error('Unknown command. Run help for available commands.');
    }
    catch (error) { primary = error; }
    finally {
        await finishOwnedCleanup(primary, [() => client.close()]);
    }
}
let entryUrl;
try {
    if (process.argv[1])
        entryUrl = pathToFileURL(realpathSync(process.argv[1])).href;
}
catch { }
if (import.meta.url === entryUrl)
    main().catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? 'COMMAND_FAILED', message: error.message }) + '\n'); process.exitCode = 1; });
