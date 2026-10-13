#!/usr/bin/env node
// SPDX-License-Identifier: MIT
'use strict';
const fs=require('node:fs'),path=require('node:path'),core=require('./mooring-core.cjs');
const root=__dirname,read=name=>fs.readFileSync(path.join(root,name),'utf8');
const source=JSON.parse(read('source-catalogue.json'));
const escapeScript=s=>s.replace(/<\/script/gi,'<\\/script');
const parts={__CORE_JS__:escapeScript(read('mooring-core.cjs')),__EXAMPLES_JS__:escapeScript(read('mooring-examples.cjs')),__SOURCE_JSON__:JSON.stringify(source).replace(/</g,'\\u003c'),__UI_JS__:escapeScript(read('mooring-ui.js'))};
let html=read('mooring-template.html');
for(const [token,value]of Object.entries(parts)){if(html.split(token).length!==2)throw new Error('Expected one template token: '+token);html=html.replace(token,()=>value);}
if(/__(?:CORE_JS|EXAMPLES_JS|SOURCE_JSON|UI_JS)__/.test(html))throw new Error('Unresolved template input');
const output=path.join(root,'mooring-service-operations.html');fs.writeFileSync(output,html);process.stdout.write(JSON.stringify({path:output,bytes:core.bytes(html).length,sha256:core.hash(html)})+'\n');
