import { build } from 'esbuild';
import { join, resolve, relative } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { inspectRuntime, SOURCE_ROOT } from '../native/selection.mjs';
import { sha, atomicJson, requireValue } from '../core/common.mjs';

const runtime=await inspectRuntime();
await mkdir(join(SOURCE_ROOT,'dist'),{recursive:true});
const output=await build({absWorkingDir:SOURCE_ROOT,entryPoints:[join(SOURCE_ROOT,'web/app.mjs')],outfile:join(SOURCE_ROOT,'dist/app.js'),bundle:true,platform:'browser',format:'esm',
  target:['es2022'],sourcemap:true,metafile:true,legalComments:'eof',minify:false,logLevel:'warning',define:{'process.env.NODE_ENV':'"production"'}});
const inputs=[];
for(const path of Object.keys(output.metafile.inputs).sort()){
  const absolute=resolve(SOURCE_ROOT,path),rel=relative(SOURCE_ROOT,absolute);
  requireValue(rel&&!rel.startsWith('../')&&!rel.startsWith('/'),'BROWSER_SOURCE_CLOSURE','A browser input is outside the complete selected component.',409);
  const bytes=await readFile(absolute);inputs.push({path:rel,bytes:bytes.length,sha256:sha(bytes)});
}
const bytes=await readFile(join(SOURCE_ROOT,'dist/app.js')),manifest={schema:'tjlabs.tiptap-browser-build.v1',runtimeSelectionSha256:runtime.selectionSha256,lockfileSha256:runtime.lockfile.sha256,inputs,
  output:{path:'dist/app.js',bytes:bytes.length,sha256:sha(bytes)}};
atomicJson(join(SOURCE_ROOT,'dist/build-manifest.json'),manifest);
process.stdout.write(JSON.stringify({state:'built',...manifest.output,inputCount:inputs.length})+'\n');
