#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import message from '../source/value-message.cjs';
import publication from '../source/source-publication.cjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.argv.length!==5)throw Error('Usage: node native/compose-message.mjs ORIGINAL_CUSTOMER_JSON MESSAGE_RECIPE_JSON OUTPUT_DIRECTORY');
const editionPath=path.resolve(process.argv[2]),recipePath=path.resolve(process.argv[3]),output=path.resolve(process.argv[4]);
async function originalText(filename){
 const bytes=await fs.readFile(filename),text=bytes.toString('utf8');
 if(!Buffer.from(text,'utf8').equals(bytes))throw Error('Original text must be well-formed UTF-8: '+filename);
 return text;
}
const editionText=await originalText(editionPath),recipeText=await originalText(recipePath);
const recipe=JSON.parse(recipeText),prepared=message.compose({editionText,recipe});
message.receive(prepared);
const hash=body=>{const bytes=Buffer.from(body);return {bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};};
const files=Object.fromEntries(message.files(prepared).map(f=>['prepared/'+f.path,f.content]));
files['input/original-message-recipe.json']=recipeText;
for(const name of [
 'source/source-archive.cjs','source/SOURCE_ARCHIVES.md','native/pack-source.mjs','source/VALUE_FIRST_CUSTOMER_PRESENTATION.md','source/MARKDOWN_MIME_RECEIVING.md','source/PACK_SCOPED_LEAD_RECORDS.md',
 'runtime/host/connected_sha256.cjs',
 'runtime/tools/revenue_owner_console_20261010/lead_value_message_core.cjs',
 'source/value-message.cjs','source/source-publication.cjs','source/VALUE_IN_MESSAGE.md',
 'native/compose-message.mjs','native/materialize-source.py'
])files[name]=await originalText(path.join(root,name));
files['README.md']='# Complete unsent message preparation\n\nOpen prepared/message.html or prepared/message.txt. All selected original profiles and their complete proposed openings are in the body. prepared/prepared-message.json retains exact original edition bytes, complete reviewed recipe, source bindings and both bodies. The original customer pack and delivery history are unchanged. This is not a mailbox draft or a send receipt.\n\nReproduce this exact preparation into a separate directory:\n\n    node native/compose-message.mjs prepared/original-customer-edition.json input/original-message-recipe.json /absolute/message-reopened\n\nRead source/VALUE_IN_MESSAGE.md before editing the recipe or preparing a later edition. The original sender retains actual delivery and warm correspondence.\n';
files['message-source-manifest.json']=JSON.stringify({schema:'lead-value-message.source-members.v1',files:Object.entries(files).map(([path,body])=>({path,...hash(body)}))},null,2)+'\n';
const bank={schema:'lead-value-message.complete-source.v1',state:'PREPARED_UNSENT',prepared_at:recipe.prepared_at,edition:prepared.source,prepared_sha256:prepared.sha256,files};
const bankBody=JSON.stringify(bank,null,2)+'\n';
const sourceReal=await fs.realpath(root),outputReal=path.join(await fs.realpath(path.dirname(output)),path.basename(output));
if(outputReal===sourceReal||outputReal.startsWith(sourceReal+path.sep))throw Error('Use an independent output outside the maintained source.');
for(const selected of [editionPath,recipePath])if(selected===outputReal||selected.startsWith(outputReal+path.sep))throw Error('Keep original input files outside the new output.');
const publisher=publication.createPublication({fs,path,hash,encode:(value,encoding)=>Buffer.from(value,encoding),randomId:randomUUID,syncDirectories:process.platform!=='win32'});
const operation=await publisher.open({output,binding:{schema:'lead-value-message.publication.v1',edition:hash(editionText),recipe:hash(recipeText),complete_source:hash(bankBody)},recordedAt:recipe.prepared_at});
const receipt=await operation.publish([...Object.entries(files).map(([path,body])=>({path,body})),{path:'complete-source.json',body:bankBody}]);
console.log(JSON.stringify({state:'PREPARED_UNSENT',output,source:hash(bankBody),edition:prepared.source,prepared_sha256:prepared.sha256,outputs:prepared.outputs,publication:receipt},null,2));
