import { readFileSync,lstatSync } from 'node:fs';
import { requireValue,constantEqual,text,id,array,object } from './common.mjs';
export function permissions(actor){return {read:!!actor?.roles?.some(r=>r==='operator'||r==='viewer'),operate:!!actor?.roles?.includes('operator')};}
export function requireOperator(actor){requireValue(permissions(actor).operate,'OPERATOR_REQUIRED','This installation actor cannot mutate the migration workspace.',403);}
function checked(value){
  object(value,'actor');id(value.id,'actor.id');text(value.name,'actor.name',{min:1,max:200});array(value.roles,'actor.roles',{max:2});
  requireValue(value.roles.every(r=>['operator','viewer'].includes(r)),'AUTH_CONTRACT','Unsupported installation role.',401);
  return{id:value.id,name:value.name,roles:[...new Set(value.roles)]};
}
export class Auth {
  constructor({authFile,contextForRequest}){this.authFile=authFile;this.contextForRequest=contextForRequest;requireValue(authFile||typeof contextForRequest==='function','AUTH_REQUIRED','Select the existing host authentication callback or an owned private auth file.');}
  config(){
    const s=lstatSync(this.authFile);requireValue(s.isFile()&&!s.isSymbolicLink()&&!(s.mode&0o077)&&(!process.getuid||s.uid===process.getuid()),'AUTH_FILE_PRIVATE','The installation authentication file must be owned and mode0600.',401);
    const v=JSON.parse(readFileSync(this.authFile,'utf8'));requireValue(v.schema==='tjlabs.sling-auth.v1','AUTH_CONTRACT','Unexpected installation authentication schema.',401);array(v.actors,'actors',{max:1000});
    const ids=new Set();for(const a of v.actors){checked(a);text(a.token,'token',{min:24,max:1024});requireValue(!ids.has(a.id),'AUTH_CONTRACT','Duplicate installation actor.',401);ids.add(a.id);}return v;
  }
  async actor(request){
    if(this.contextForRequest)return checked(await this.contextForRequest(request));
    const header=request.headers?.get?request.headers.get('authorization'):request.headers?.authorization;
    requireValue(typeof header==='string'&&header.startsWith('Bearer '),'UNAUTHENTICATED','Supply this installation bearer token.',401);
    const matches=this.config().actors.filter(a=>constantEqual(a.token,header.slice(7)));requireValue(matches.length===1,'UNAUTHENTICATED','The installation token is not recognized.',401);return checked(matches[0]);
  }
}
