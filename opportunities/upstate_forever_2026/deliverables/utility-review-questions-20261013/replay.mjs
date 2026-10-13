import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseCsv} from './sources/profiles_core.mjs';
import {DEFAULT,restoreProject,exportRows,csv} from './sources/review_core.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const out=process.argv[2];
if(!out) throw Error('Usage: node replay.mjs ACTUAL_NEW_OUTPUT_DIRECTORY');
const destination=path.resolve(out);
if(fs.existsSync(destination)) throw Error('Choose a fresh output directory.');
const inventory=JSON.parse(fs.readFileSync(path.join(root,'MANIFEST.json'),'utf8'));
for(const file of inventory.files){
 const body=fs.readFileSync(path.join(root,file.path));
 if(body.length!==file.bytes||createHash('sha256').update(body).digest('hex')!==file.sha256) throw Error('Source file differs: '+file.path);
}
const input=JSON.parse(fs.readFileSync(path.join(root,'sources/scopes.json'),'utf8'));
const rows=parseCsv(fs.readFileSync(path.join(root,'sources/watershed-profiles.csv'),'utf8')).rows.map(r=>
 Object.fromEntries(Object.entries(r).map(([k,v])=>[k,['huc12','name','states','group'].includes(k)?v:v.startsWith('[')?JSON.parse(v):Number(v)])));
const data={edition:input.edition,rows,scopes:input.scopes};
const project=JSON.parse(fs.readFileSync(path.join(root,'Upper_Savannah_Review_Project.json'),'utf8'));
restoreProject(project,data);
const output=[];
for(const {scope,topK} of input.comparisons)for(const basis of ['absolute','rate'])
 output.push(...exportRows(data,{...DEFAULT,scope,topK,basis},{}));
const body=csv(output);
if(body!==fs.readFileSync(path.join(root,'utility-preference-comparison.csv'),'utf8')) throw Error('Original utility comparison differs on replay.');
fs.mkdirSync(destination,{recursive:true});
fs.writeFileSync(path.join(destination,'utility-preference-comparison.csv'),body,{flag:'wx'});
fs.copyFileSync(path.join(root,'Upper_Savannah_Review_Project.json'),path.join(destination,'Upper_Savannah_Review_Project.json'),fs.constants.COPYFILE_EXCL);
console.log(JSON.stringify({source_edition:data.edition,original_profile_count:rows.length,comparison_rows:output.length,
 comparison_views:input.comparisons.length*2,weight_choices_per_view:66,queued_questions:Object.values(project.notes).filter(n=>n.queued).length,
 output:destination},null,2));
