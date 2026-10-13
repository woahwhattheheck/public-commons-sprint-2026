#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareProviderMigration} from './provider-input.mjs';
import {atomicBytes,atomicJson} from '../../workbench/vendor/dlt/vendor/sling/core/common.mjs';
export function prepareBubbleFiles({sourcePath,expectedPath,mappingPath,directory}){
 const read=path=>JSON.parse(fs.readFileSync(resolve(path),'utf8').replace(/^\uFEFF/,''));
 const source=read(sourcePath),expected=read(expectedPath),mapping=read(mappingPath);
 const capture={schema:'bubble.reconciliation-capture.v1',source,expected},prepared=prepareProviderMigration({capture,mapping});
 const root=resolve(directory);fs.mkdirSync(root,{recursive:true,mode:0o700});
 for(const f of prepared.files)atomicBytes(join(root,f.path),Buffer.from(f.content,'utf8'),{immutable:true});
 atomicJson(join(root,'PREPARED.json'),prepared.manifest,{immutable:true});
 return{directory:root,sourceOperationId:source.operationId,expectedOperationId:expected.operationId,tables:prepared.manifest.tables,files:prepared.manifest.files};
}
export function main(argv=process.argv.slice(2)){if(argv.length!==4)throw Error('Usage: node prepare-provider.mjs source-capture.json expected-capture.json mapping.json output-directory');return prepareBubbleFiles({sourcePath:argv[0],expectedPath:argv[1],mappingPath:argv[2],directory:argv[3]});}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(main(),null,2));}catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=1;}}
