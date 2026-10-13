import {readFile,writeFile} from "node:fs/promises";
import {gzipSync} from "node:zlib";
import {fileURLToPath} from "node:url";
import path from "node:path";
const root=path.dirname(fileURLToPath(import.meta.url)),packet=JSON.parse(await readFile(path.join(root,"source-packet.json"),"utf8")),files={};
for(const name of Object.keys(packet.files)){if(name.includes("..")||path.isAbsolute(name))throw Error("Unsafe source filename");files[name]=await readFile(path.join(root,name),"utf8");}
const packed=gzipSync(Buffer.from(JSON.stringify(files)),{level:9,mtime:0}).toString("base64");
const html='<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Budibase commissioning | TJLabs</title></head><body><p id="message">Opening commissioning programme…</p><script id="source-packet" type="application/octet-stream">'+packed+'</script><script>'+files["bootstrap.js"]+'</script></body></html>';
await writeFile(path.join(root,"index.html"),html,{encoding:"utf8"});
process.stdout.write(JSON.stringify({output:"index.html",bytes:Buffer.byteLength(html),files:Object.keys(files).length})+"\n");
