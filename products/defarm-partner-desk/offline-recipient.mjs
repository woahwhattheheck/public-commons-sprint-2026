import {readFile,open,link,unlink} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {buildOffline,OFFLINE_FILES} from "./offline-build.mjs";
import {importCase,bytes} from "./core.mjs";
import {sha256} from "./sha256.mjs";
const here=dirname(fileURLToPath(import.meta.url));
export async function recipientHTML(packageText=null) {
  if(packageText!==null){
    if(bytes(packageText)>80*1024*1024)throw new Error("Original package exceeds 80 MiB");
    importCase(JSON.parse(packageText.replace(/^\uFEFF/,"")),sha256);
  }
  const bank=Object.fromEntries(await Promise.all(OFFLINE_FILES.map(async path=>[path,await readFile(join(here,path),"utf8")])));
  return buildOffline(bank,packageText);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(![3,4].includes(process.argv.length))throw new Error("Usage: node offline-recipient.mjs [COMPLETE-CASE.json] NEW-RECIPIENT.html");
    const input=process.argv.length===4?new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(await readFile(resolve(process.argv[2]))):null;
    const html=await recipientHTML(input),target=resolve(process.argv.at(-1)),temporary=target+"."+randomBytes(8).toString("hex")+".tmp",out=await open(temporary,"wx",0o600);
    try{await out.writeFile(html);await out.sync();}finally{await out.close();}
    try{await link(temporary,target);}catch(error){if(error.code!=="EEXIST")throw error;const previous=await readFile(target);if(previous.length!==bytes(html)||sha256(new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(previous))!==sha256(html))throw new Error("Existing recipient differs; choose a new output");}finally{await unlink(temporary);}
    console.log(JSON.stringify({bytes:bytes(html),sha256:sha256(html),output:target}));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
