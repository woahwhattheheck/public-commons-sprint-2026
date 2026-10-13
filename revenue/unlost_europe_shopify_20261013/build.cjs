#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {composeCustomerPackages}=require('./customer-package.cjs');
const core=require('./runtime/tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs');
const sha=require('./runtime/host/connected_sha256.cjs');
const input=JSON.parse(fs.readFileSync(path.join(__dirname,'source/predecessor-working-record.json'),'utf8'));
const composition=JSON.parse(fs.readFileSync(path.join(__dirname,'source/customer-package-input.json'),'utf8'));
const customerFiles={};for(const name of composition.customer_paths)customerFiles[name]=fs.readFileSync(path.join(__dirname,name),'utf8');
const result=composeCustomerPackages(core,sha,input,customerFiles,composition.prepared_at);
const output=path.resolve(process.argv[2]||path.join(__dirname,'prepared-output'));
const files={...customerFiles,'working-record.json':JSON.stringify(result.working,null,2)+'\n','customer-package-receipt.json':JSON.stringify({schema:'unlost.customer-package-receiving.v1',prepared_at:composition.prepared_at,pack_id:input.pack.id,working_record_sha256:result.working.sha256,companies:result.working.leads.length,editions:result.working.editions.length,customer_files:result.working.customer_files.length,customer_packages:result.working.customer_packages.length,package_ids:result.packageIds,preserved_fields:result.preserved_fields,original_customer_files_unchanged:composition.customer_paths.filter(p=>p!=='customer/README.txt'),file_identities:result.file_identities,independent_receive_equal:result.receiving.equal,core_repository:composition.core_repository,core_commit:composition.core_commit},null,2)+'\n'};
for(const [name,content]of Object.entries(files)){const target=path.join(output,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content,'utf8');}
process.stdout.write(JSON.stringify({pack_id:input.pack.id,companies:result.working.leads.length,editions:result.working.editions.length,customer_files:result.working.customer_files.length,customer_packages:result.working.customer_packages.length,package_ids:result.packageIds,working_record_sha256:result.working.sha256,received_equal:result.receiving.equal,preserved_fields:result.preserved_fields,output},null,2)+'\n');
