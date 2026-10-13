'use strict';
const fs=require('node:fs');
const path=require('node:path');
const core=require('../../lead_fulfillment_core.cjs');
function main(){
  const [input,output]=process.argv.slice(2);
  if(!input||!output)throw new Error('Usage: node receive.cjs CURRENT_LEDGER.json NEW_LEDGER.json');
  const ledger=JSON.parse(fs.readFileSync(input,'utf8'));
  const bundle=JSON.parse(fs.readFileSync(path.join(__dirname,'working-record.json'),'utf8'));
  const result=core.applyLeadFulfillment(ledger,{
    operation_id:bundle.pack.id+':receive:'+bundle.sha256.slice(0,16),
    kind:'working-record-receive',
    input:{bundle},
    expected_root_sha256:core.hash(core.validateRoot(ledger))
  });
  const reopened=core.leadFulfillmentExport(result.ledger,{packId:bundle.pack.id,format:'working-record'}).value;
  if(core.hash(reopened)!==core.hash(bundle))throw new Error('Received working record differs from the complete source.');
  fs.writeFileSync(output,JSON.stringify(result.ledger,null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify({pack_id:bundle.pack.id,received:true,changed:result.changed,companies:bundle.leads.length,editions:bundle.editions.length,deliveries:bundle.deliveries.length,output})+'\n');
}
try{main();}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
