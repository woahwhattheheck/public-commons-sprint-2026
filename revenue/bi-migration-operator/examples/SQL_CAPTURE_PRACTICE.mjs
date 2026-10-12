// An explicit local protocol carrier. It never opens a SQL Server connection.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {executeJob} from '../tools/sql-server/capture.mjs';
import {readMssqlSourceFile} from '../tools/sql-server/core/mssql/config.mjs';
import {compileMssqlQueries,bindMssqlParameters} from '../tools/sql-server/core/mssql/declaration.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const n=a.indexOf('=');return[a.slice(2,n),a.slice(n+1)];}));
const fixtureBytes=await fs.readFile(args.fixture);
const fixture=JSON.parse((args.fixture.endsWith('.gz')?gunzipSync(fixtureBytes):fixtureBytes).toString('utf8'));
if(fixture.schema!=='commons-bi-sql-protocol-example/1')throw Error('EXPLICIT_PRACTICE_INPUT_REQUIRED');
const root=path.resolve(args.operation);
await fs.mkdir(root,{recursive:true,mode:0o700});
const job=JSON.parse(await fs.readFile(args.job,'utf8'));
const raw=await readMssqlSourceFile(args.job.replace(/[^/\\]+$/,'')+job.source_file);
const compiled=compileMssqlQueries(raw.config.queries);
const metadata=fixture.column_types.filter(c=>raw.config.queries.selected.columns.includes(c.name));
const available=fixture.rows;
const log=path.join(root,'protocol-requests.jsonl');
async function record(value){await fs.appendFile(log,JSON.stringify({at:new Date().toISOString(),...value})+'\n',{mode:0o600});}
const adapter={
  async catalog(){
    await record({operation:'catalog',job_id:job.job_id,table:job.table??null,provider_call:false});
    return job.table?fixture.catalog:{schema:'stellar-forge.mssql-catalog.v1',serverVersion:'explicit-protocol-example',
      tables:[{name:fixture.catalog.table,schemaName:fixture.catalog.schemaName,tableName:fixture.catalog.tableName,type:'BASE TABLE'}],truncated:false};
  },
  async open(){
    return{config:raw.config,source:{
      preflight(){return{serverVersion:'explicit-protocol-example',queries:{selected:{columns:metadata,readSemantics:'single-statement-database-isolation'}}};},
      validate(name,input){return bindMssqlParameters(compiled[name],input);},
      async query(name,input,{signal}){
        bindMssqlParameters(compiled[name],input);
        if(signal.aborted)throw Object.assign(Error('QUERY_ABORTED'),{code:'QUERY_ABORTED'});
        const paging=job.pagination,keys=paging.keys??[];
        const selected=available.filter(row=>{
          if(!input[paging.start_parameter])return true;
          for(const key of keys){const a=row[key.column],b=input[key.parameter];if(a===b)continue;return a>b;}
          return false;
        });
        const limit=raw.config.queries[name].maxRows;
        const rows=selected.slice(0,limit).map(row=>Object.fromEntries(raw.config.queries[name].columns.map(c=>[c,row[c]])));
        const result={schema:'stellar-forge.mssql-result.v1',query:name,serverVersion:'explicit-protocol-example',
          columns:raw.config.queries[name].columns,columnTypes:metadata,rows,rowCount:rows.length,truncated:selected.length>rows.length,
          valueEncoding:'sqlserver-server-text',binaryEncoding:'base64-object',nullEncoding:'json-null',snapshot:'single-statement-database-isolation'};
        let used=Buffer.byteLength(JSON.stringify({...result,rows:[],rowCount:0,truncated:false}));
        for(const [index,row] of rows.entries()){used+=Buffer.byteLength(JSON.stringify(row))+(index?1:0);if(used+64>raw.config.queries[name].maxBytes)throw Object.assign(Error('QUERY_RESULT_TOO_LARGE'),{code:'QUERY_RESULT_TOO_LARGE'});}
        if(Buffer.byteLength(JSON.stringify(result))>raw.config.queries[name].maxBytes)throw Error('QUERY_RESULT_TOO_LARGE');
        const previous=(await fs.readFile(log,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)).filter(x=>x.operation==='query');
        const ordinal=previous.length+1;
        const body=Buffer.from(JSON.stringify(result));
        await record({operation:'query',ordinal,job_id:job.job_id,input,rows:rows.length,truncated:result.truncated,
          response_sha256:crypto.createHash('sha256').update(body).digest('hex'),provider_call:false});
        if(args.loss==='true'&&ordinal===3){
          await fs.writeFile(path.join(root,'protocol-deliberate-loss.json'),JSON.stringify({ordinal,response_sha256:crypto.createHash('sha256').update(body).digest('hex'),rows:rows.length,retained_by_capture:false}));
          throw Object.assign(Error('EXPLICIT_PROTOCOL_RESPONSE_LOSS'),{code:'EXPLICIT_PROTOCOL_RESPONSE_LOSS'});
        }
        return result;
      },
      async close(){await record({operation:'source_closed',job_id:job.job_id,provider_call:false});}
    }};
  }
};
const state=await executeJob({jobPath:args.job,operationRoot:root,mode:args.mode||'execute',adapter,origin:'protocol-example',
  afterCommit:async(state,page)=>{
    if(args.cancel&&page===Number(args.cancel)){
      await fs.writeFile(path.join(root,'cancel.json'),JSON.stringify({job_id:job.job_id,note:'Explicit Practice operator cancellation after committed page '+page}));
      await new Promise(resolve=>setTimeout(resolve,400));
    }
  }});
console.log(JSON.stringify({job_id:state.job_id,status:state.status,rows:state.rows,pages:state.pages.length,complete:state.complete,
  origin:'protocol-example',sql_server_connections:0}));
