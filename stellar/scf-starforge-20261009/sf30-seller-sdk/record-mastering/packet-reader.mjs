// MIT. Incremental reader for the original v1 JSON string envelope, including escaped strings.
// It never evaluates input and never resolves filenames or writes outside its supplied sink.
import {createHash} from 'node:crypto';
export class WorkspacePacketReader {
    constructor(write,schema){this.write=write;this.schema=schema;this.state='start';this.buffer='';this.fields={};this.seen=new Set();this.current=null;this.carry='';this.bytes=0;this.digest=createHash('sha256');}
    fail(message){const e=Error(message);e.code='TRANSFER_FORMAT';throw e;}
    output(bytes){this.bytes+=bytes.length;if(this.bytes>=380*1024*1024)this.fail('The received database exceeds the 380 MiB snapshot size.');this.digest.update(bytes);this.write(bytes);}
    base64(text,final=false){
        const all=this.carry+text;if(!/^[A-Za-z0-9+/]*={0,2}$/.test(all))this.fail('Invalid base64 database contents.');
        const n=final?all.length:Math.max(0,Math.floor((all.length-1)/4)*4);
        const chunk=all.slice(0,n);this.carry=all.slice(n);
        if(!final&&chunk.includes('='))this.fail('Padding occurs before the end of the database.');
        if(final&&all.length%4!==0)this.fail('Truncated base64 database contents.');
        if(chunk){const bytes=Buffer.from(chunk,'base64');if(bytes.toString('base64')!==chunk)this.fail('Noncanonical database base64.');this.output(bytes);}
    }
    push(text){
        this.buffer+=text;let i=0;
        const ws=c=>c===' '||c==='\n'||c==='\r'||c==='\t';
        while(i<this.buffer.length){
            const c=this.buffer[i];
            if(['start','key','colon','value','comma','done'].includes(this.state)&&ws(c)){i++;continue;}
            if(this.state==='start'){if(c!=='{')this.fail('Expected a JSON object.');this.state='key';i++;continue;}
            if(this.state==='key'){
                if(c==='}'&&this.seen.size===0){this.state='done';i++;continue;}
                if(c!=='"')this.fail('Expected an envelope field name.');this.raw='"';this.state='key-string';this.escape=false;i++;continue;
            }
            if(this.state==='key-string'||this.state==='metadata'){
                this.raw+=c;i++;if(this.raw.length>1024)this.fail('Envelope metadata exceeds its format.');
                if(this.escape){this.escape=false;continue;}if(c==='\\'){this.escape=true;continue;}
                if(c!=='"')continue;
                let value;try{value=JSON.parse(this.raw);}catch{this.fail('Invalid JSON string.');}
                if(this.state==='key-string'){
                    if(!['schema','databaseSha256','database'].includes(value)||this.seen.has(value))this.fail('Unknown or repeated workspace envelope field.');
                    this.current=value;this.seen.add(value);this.state='colon';
                }else{this.fields[this.current]=value;this.state='comma';}
                continue;
            }
            if(this.state==='colon'){if(c!==':')this.fail('Expected a colon.');this.state='value';i++;continue;}
            if(this.state==='value'){
                if(c!=='"')this.fail('Workspace envelope values must be strings.');i++;
                if(this.current==='database')this.state='database';else{this.raw='"';this.escape=false;this.state='metadata';}
                continue;
            }
            if(this.state==='database'){
                const quote=this.buffer.indexOf('"',i), slash=this.buffer.indexOf('\\',i);
                const end=quote<0?slash<0?this.buffer.length:slash:slash<0?quote:Math.min(quote,slash);
                this.base64(this.buffer.slice(i,end));i=end;
                if(i===this.buffer.length)break;
                if(this.buffer[i]==='"'){this.base64('',true);this.fields.database=true;this.state='comma';i++;continue;}
                if(i+1>=this.buffer.length)break;
                const length=this.buffer[i+1]==='u'?6:2;if(i+length>this.buffer.length)break;
                let decoded;try{decoded=JSON.parse('"'+this.buffer.slice(i,i+length)+'"');}catch{this.fail('Invalid database string escape.');}
                this.base64(decoded);i+=length;continue;
            }
            if(this.state==='comma'){if(c===','){this.state='key-after-comma';i++;continue;}if(c==='}'){this.state='done';i++;continue;}this.fail('Expected a comma or closing brace.');}
            if(this.state==='key-after-comma'){if(ws(c)){i++;continue;}if(c!== '"')this.fail('Expected a field after the comma.');this.state='key';continue;}
            if(this.state==='done')this.fail('Unexpected data after the workspace envelope.');
        }
        this.buffer=this.buffer.slice(i);
        if(this.buffer.length>1024)this.fail('Invalid incomplete envelope token.');
    }
    finish(){
        if(this.state!=='done'||this.buffer.length||this.seen.size!==3||!this.fields.database||this.fields.schema!==this.schema)this.fail('Incomplete or unsupported workspace transfer.');
        if(!/^[a-f0-9]{64}$/.test(this.fields.databaseSha256)||this.digest.digest('hex')!==this.fields.databaseSha256)this.fail('The workspace database digest is invalid.');
    }
}
