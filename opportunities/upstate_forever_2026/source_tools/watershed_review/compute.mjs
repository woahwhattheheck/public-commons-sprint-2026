import fs from 'node:fs';import path from 'node:path';
import {DEFAULT,view,exportRows,csv} from './review_core.mjs';
const [input,out]=process.argv.slice(2);if(!input||!out)throw Error('Usage: node compute.mjs dataset.json OUTPUT');
const d=JSON.parse(fs.readFileSync(input,'utf8'));fs.mkdirSync(out,{recursive:true});
const summary={schema:'upstate.review-preference-grid/v1',source_edition:d.edition,method:'Full 217-HUC reference midranks; 66 exhaustive 10-percentage-point weight combinations; ties share rank and top-K admission.',choices:[]};
for(const scope of Object.keys(d.scopes))for(const basis of ['absolute','rate']){
 const state={...DEFAULT,scope,basis},v=view(d,state,{}),rows=exportRows(d,state,{}),stem=scope+'-'+basis;
 fs.writeFileSync(path.join(out,stem+'.csv'),csv(rows));
 const result={scope,basis,population:v.population,weight_grid:v.scenarios,rankings:rows};
 fs.writeFileSync(path.join(out,stem+'.json'),JSON.stringify(result,null,2)+'\n');
 summary.choices.push({scope,basis,population:v.population,default_top10:rows.filter(r=>r.rank<=10).map(r=>({huc12:r.huc12,name:r.name,rank:r.rank,grid_best:r.best_grid_rank,grid_worst:r.worst_grid_rank,top_k_choices:r.top_k_weight_choices})),always_top10:rows.filter(r=>r.top_k_weight_choices===66).map(r=>r.huc12),never_top10:rows.filter(r=>r.top_k_weight_choices===0).length});
}
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary.choices.map(x=>({scope:x.scope,basis:x.basis,population:x.population,always_top10:x.always_top10})),null,2));
