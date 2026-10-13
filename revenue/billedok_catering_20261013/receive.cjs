#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const core=require('./tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs');
function main(){
 const [input,output,...extra]=process.argv.slice(2);
 if(!input||!output||extra.length)throw Error('Usage: node receive.cjs CURRENT_LEDGER.json NEW_LEDGER.json');
 if(path.resolve(input)===path.resolve(output)||fs.existsSync(output))throw Error('Use a new destination; preserve the current workspace.');
 const ledger=JSON.parse(fs.readFileSync(input,'utf8'));
 const bundle=JSON.parse(fs.readFileSync(path.join(__dirname,'working-record.json'),'utf8'));
 const result=core.applyLeadFulfillment(ledger,{operation_id:bundle.pack.id+':receive:'+bundle.sha256.slice(0,16),kind:'working-record-receive',input:{bundle},expected_root_sha256:core.hash(core.validateRoot(ledger))});
 const reopened=core.leadFulfillmentExport(result.ledger,{packId:bundle.pack.id,format:'working-record'}).value;
 if(core.hash(reopened)!==core.hash(bundle))throw Error('The independently reopened original record differs.');
 fs.writeFileSync(output,JSON.stringify(result.ledger,null,2)+'\n',{flag:'wx',mode:0o600});
 process.stdout.write(JSON.stringify({pack_id:bundle.pack.id,companies:bundle.leads.length,editions:bundle.editions.length,customer_files:bundle.customer_files.length,customer_packages:bundle.customer_packages.length,received:true,output})+'\n');
}
try{main();}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
