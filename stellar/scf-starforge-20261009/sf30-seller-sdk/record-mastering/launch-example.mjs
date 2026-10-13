#!/usr/bin/env node
// MIT. Open a fresh worked project or receive an explicitly selected original archive.
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {RecordMasteringClient} from './client.mjs';
import {createExampleWorkspace} from './example-workspace.mjs';
import {serveWorkspace} from './server.mjs';
const args=process.argv.slice(2);
if(args.length>3 || (args.length>1 && (args[1]!=='--archive'||!args[2]))) {
    console.error('Usage: node launch-example.mjs [NEW_OR_EXISTING_DIRECTORY] [--archive ORIGINAL_WORKSPACE_FILE]');
    process.exitCode=1;
} else {
    const directory=resolve(args[0]??'./customer-review');let client,service;
    try {
        if(existsSync(directory)&&args[2])throw Error('Receive the selected archive into a new directory.');
        if(!existsSync(directory)) {
            if(args[2])await RecordMasteringClient.receiveFile(resolve(args[2]),directory);
            else createExampleWorkspace(directory);
        }
        client=new RecordMasteringClient({directory});service=await serveWorkspace(client.workspace);
        console.log('Record mastering — open this private URL on this machine:');console.log(service.url);
        console.log('Workspace: '+directory+'\nStop with Ctrl+C. Your saved edits remain in the workspace.');
        let closing=false;
        const stop=async()=>{if(closing)return;closing=true;await service.close();client.close();};
        process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
    } catch(error) {
        await service?.close();client?.close();console.error(error.message);process.exitCode=1;
    }
}
