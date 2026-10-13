#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {prepare}=require('./prepare.cjs');
const core=require('./tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs');
const renderers=require('./customer-renderers.cjs');
const source=JSON.parse(fs.readFileSync(path.join(__dirname,'source-records.json'),'utf8'));
const output=path.resolve(process.argv[2]||path.join(__dirname,'prepared-output'));
const result=prepare(core,renderers,source);
for(const [name,content]of Object.entries(result.files)){const target=path.join(output,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content,'utf8');}
process.stdout.write(JSON.stringify({pack_id:source.id,companies:result.working.leads.length,editions:result.editionIds,working_record_sha256:result.working.sha256,received_equal:result.receiving.equal,output},null,2)+'\n');
