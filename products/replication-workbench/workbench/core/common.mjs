import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, lstatSync, realpathSync, openSync, closeSync, writeFileSync, readFileSync, fsyncSync, renameSync, unlinkSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';

export class DomainError extends Error {
  constructor(code, message, status = 400, details = {}) { super(message); this.name = 'DomainError'; this.code = code; this.status = status; this.details = details; }
}
export const fail = (code, message, status=400, details={}) => { throw new DomainError(code,message,status,details); };
export const requireValue = (condition,code,message,status=400,details={}) => { if (!condition) fail(code,message,status,details); };
export const now = () => new Date().toISOString();
export const clone = value => structuredClone(value);
export const uuid = prefix => prefix + '_' + randomUUID();
export const sha = data => createHash('sha256').update(data).digest('hex');
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(v=>canonical(v)).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
}
export const identity = value => sha(Buffer.from(canonical(value)));
export function text(value,name,{min=0,max=4096,fallback}={}) {
  if (value === undefined && fallback !== undefined) value=fallback;
  requireValue(typeof value==='string' && value.length>=min && value.length<=max,'INVALID_INPUT',name+' must be text of the permitted length.');
  requireValue(!value.includes('\0'),'INVALID_INPUT',name+' contains a null byte.');
  return value;
}
export function id(value,name='id') {
  text(value,name,{min:1,max:160});
  requireValue(/^[A-Za-z0-9_.:-]+$/.test(value),'INVALID_ID',name+' must contain only letters, digits, dots, underscores, colons or hyphens.');
  return value;
}
export function integer(value,name,{min=0,max=Number.MAX_SAFE_INTEGER,fallback}={}) {
  if(value===undefined && fallback!==undefined)value=fallback;
  requireValue(Number.isSafeInteger(value)&&value>=min&&value<=max,'INVALID_INPUT',name+' must be an integer in range.');
  return value;
}
export function oneOf(value,choices,name) { requireValue(choices.includes(value),'INVALID_INPUT',name+' is not supported.',400,{choices}); return value; }
export function object(value,name='value') { requireValue(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_INPUT',name+' must be an object.'); return value; }
export function array(value,name='value',{max=100000}={}) { requireValue(Array.isArray(value)&&value.length<=max,'INVALID_INPUT',name+' must be an array within the permitted length.');return value; }
export function digest(value,name='sha256'){requireValue(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'INVALID_DIGEST',name+' must be a lowercase SHA256.');return value;}
export function safeFilename(value){ const v=text(value,'filename',{min:1,max:240});requireValue(!/[\\/\x00-\x1f]/.test(v)&&v!=='.'&&v!=='..','INVALID_FILENAME','Use one filename without path components.');return v;}
export function safeRelative(value) { text(value,'relative path',{min:1,max:2000});requireValue(!value.startsWith('/')&&!value.includes('\\')&&!value.split('/').some(p=>!p||p==='.'||p==='..'),'INVALID_PATH','An operation-relative path is required.');return value; }
export function within(root,path){const a=resolve(root),b=resolve(path),r=relative(a,b);requireValue(r===''||(!r.startsWith('..'+sep)&&r!=='..'&&!r.startsWith(sep)),'PATH_OUTSIDE_ROOT','Path is outside the selected root.');return b;}
export function privateDirectory(path){
  mkdirSync(path,{recursive:true,mode:0o700});
  const info=lstatSync(path);
  requireValue(info.isDirectory()&&!info.isSymbolicLink(),'PRIVATE_DIRECTORY_REQUIRED','Workspace must be a real private directory.',409);
  requireValue((info.mode&0o077)===0,'PRIVATE_DIRECTORY_REQUIRED','Workspace directory permissions must be 0700.',409);
  if(process.getuid)requireValue(info.uid===process.getuid(),'PRIVATE_DIRECTORY_REQUIRED','Workspace must be owned by the current process user.',409);
  return realpathSync(path);
}
export function fsyncDirectory(path){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
export function atomicBytes(path,bytes,{immutable=false}={}){
  const body=Buffer.from(bytes);mkdirSync(dirname(path),{recursive:true,mode:0o700});
  if(immutable){try{const old=readFileSync(path);requireValue(old.equals(body),'IMMUTABLE_IDENTITY_CHANGED','Retained bytes differ from the original content.',409,{filename:path.split('/').at(-1)});return;}catch(e){if(e.code!=='ENOENT')throw e;}}
  const temp=path+'.pending-'+randomUUID();let fd;
  try{fd=openSync(temp,'wx',0o600);writeFileSync(fd,body);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temp,path);fsyncDirectory(dirname(path));}
  catch(e){if(fd!==undefined)closeSync(fd);try{unlinkSync(temp);}catch{}throw e;}
}
export const atomicJson=(path,value,options)=>atomicBytes(path,Buffer.from(JSON.stringify(value,null,2)+'\n'),options);
export function readJson(path){return JSON.parse(readFileSync(path,'utf8'));}
export function constantEqual(a,b){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
export function collectSourceFiles(root) {
  const out=[]; const allowed=new Set(['.mjs','.cjs','.js','.json','.md','.html','.css','.py','.toml','.yaml','.yml','.txt','.csv','.tsv','.sql','.go','.mod','.sum']);
  const visit=(dir,prefix='')=>{for(const ent of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    if(['node_modules','.git','.runtime','dist'].includes(ent.name))continue;
    const rel=prefix?prefix+'/'+ent.name:ent.name,path=join(dir,ent.name);
    requireValue(!ent.isSymbolicLink(),'SOURCE_SYMLINK','Editable source cannot contain symlinks.',409,{path:rel});
    if(ent.isDirectory())visit(path,rel);
    else if(ent.isFile()&&(allowed.has('.'+ent.name.split('.').at(-1))||/^(LICENSE|NOTICE)(\.|$)/.test(ent.name))){const body=readFileSync(path);out.push({path:rel,bytes:body.length,sha256:sha(body),body});}
  }};visit(root);return out;
}
export function publicError(e){return {code:e.code??'INTERNAL_ERROR',message:e instanceof DomainError?e.message:'The operation did not complete. Its original request remains available for reconciliation.',details:e instanceof DomainError?e.details:{}};}
