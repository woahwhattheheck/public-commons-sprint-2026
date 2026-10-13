// MIT. Complete original companion paths and file identities, shared by browser and Runtime.
export const APPLICATION_INPUT_SET_SCHEMA='stellar-forge.runtime-application-input-set.v1';
export const APPLICATION_INPUT_SET_LIMITS=Object.freeze({files:1024,directories:4096,bytes:64*1024*1024,fileBytes:16*1024*1024,chunkBytes:1024*1024});
const HASH=/^[a-f0-9]{64}$/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const need=(value,code)=>{if(!value)throw Object.assign(new TypeError(code),{code,status:400});};
const fields=(v,keys)=>need(plain(v)&&Object.keys(v).every(k=>keys.includes(k)),'APPLICATION_INPUT_SET_FIELDS_INVALID');
export function applicationInputSetPath(value) {
  need(typeof value==='string'&&value.length>0&&value.length<=1024&&value===value.normalize('NFC')&&
    !/[\\:<>"|?*\u0000-\u001f\u007f]/.test(value),'APPLICATION_INPUT_SET_PATH_INVALID');
  const utf8Bytes=text=>{let bytes=0;for(const point of text){const n=point.codePointAt(0);need(n<0xd800||n>0xdfff,'APPLICATION_INPUT_SET_PATH_INVALID');bytes+=n<=0x7f?1:n<=0x7ff?2:n<=0xffff?3:4;}return bytes;};
  const parts=value.split('/');
  need(parts.every(p=>p&&p!=='.'&&p!=='..'&&p.length<=180&&utf8Bytes(p)<=255&&p===p.trim()&&!/[. ]$/.test(p)&&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)),'APPLICATION_INPUT_SET_PATH_INVALID');
  return value;
}
export function normalizeApplicationInputSet(value) {
  fields(value,['schema','name','directories','files']);
  need(value.schema===APPLICATION_INPUT_SET_SCHEMA&&typeof value.name==='string'&&value.name.trim()===value.name&&
    value.name.length>0&&value.name.length<=180&&!/[\u0000-\u001f\u007f]/.test(value.name),'APPLICATION_INPUT_SET_NAME_INVALID');
  need(Array.isArray(value.files)&&value.files.length>0&&value.files.length<=APPLICATION_INPUT_SET_LIMITS.files&&
    Array.isArray(value.directories??[])&&(value.directories??[]).length<=APPLICATION_INPUT_SET_LIMITS.directories,
    'APPLICATION_INPUT_SET_MEMBERS_INVALID');
  const directories=new Set(), kinds=new Map(), spellings=new Map();
  function register(path,type,explicit=false) {
    applicationInputSetPath(path);
    const parts=path.split('/');
    for(let i=1;i<=parts.length;i++) {
      const member=parts.slice(0,i).join('/'),last=i===parts.length;
      const memberType=last?type:'directory',memberExplicit=last&&explicit;
      const folded=member.toUpperCase().toLowerCase().normalize('NFC'),prior=spellings.get(folded);
      need(prior===undefined||prior===member,'APPLICATION_INPUT_SET_CASE_COLLISION');
      need(!kinds.has(member)||kinds.get(member)===memberType&&memberType==='directory'&&!memberExplicit,
        'APPLICATION_INPUT_SET_PATH_COLLISION');
      spellings.set(folded,member);kinds.set(member,memberType);
      if(memberType==='directory')directories.add(member);
    }
  }
  const explicitDirs=new Set();
  for(const path of value.directories??[]) {
    need(!explicitDirs.has(path),'APPLICATION_INPUT_SET_PATH_COLLISION');explicitDirs.add(path);
    register(path,'directory');
  }
  let bytes=0;
  const files=value.files.map(file=>{
    fields(file,['path','bytes','sha256','chunkSha256']);register(file.path,'file',true);
    need(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=APPLICATION_INPUT_SET_LIMITS.fileBytes&&HASH.test(file.sha256??'')&&
      Array.isArray(file.chunkSha256)&&file.chunkSha256.length===Math.ceil(file.bytes/APPLICATION_INPUT_SET_LIMITS.chunkBytes)&&
      file.chunkSha256.every(x=>typeof x==='string'&&HASH.test(x)),'APPLICATION_INPUT_SET_FILE_INVALID');
    bytes+=file.bytes;
    return {path:file.path,bytes:file.bytes,sha256:file.sha256,chunkSha256:[...file.chunkSha256]};
  });
  need(bytes<=APPLICATION_INPUT_SET_LIMITS.bytes&&directories.size<=APPLICATION_INPUT_SET_LIMITS.directories,
    'APPLICATION_INPUT_SET_SIZE_INVALID');
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {schema:APPLICATION_INPUT_SET_SCHEMA,name:value.name,directories:[...directories].sort(),files};
}
export function applicationInputSetJSON(value) {
  const normalized=normalizeApplicationInputSet(value);
  return JSON.stringify(normalized)+'\n';
}
export function applicationInputSetUploadManifest(file) {
  applicationInputSetPath(file.path);
  return {schema:'stellar-forge.sf88.collection-input-upload.v1',kind:'body',
    name:file.path.split('/').at(-1),bytes:file.bytes,chunkSha256:[...file.chunkSha256]};
}
