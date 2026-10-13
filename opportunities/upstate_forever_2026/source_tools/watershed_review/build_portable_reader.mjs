#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {buildPortableReader,tableNames} from "./portable.mjs";
const [delivery,output]=process.argv.slice(2);
if(!delivery||!output||process.argv.length!==4)throw Error("Usage: node build_portable_reader.mjs ORIGINAL_DELIVERY NEW_HTML_FILE");
const original=await fs.readFile(path.join(delivery,"OPEN_FIRST.html"),"utf8");
const tables={};for(const name of tableNames)tables[name]=await fs.readFile(path.join(delivery,name),"utf8");
const html=buildPortableReader(original,tables);
await fs.writeFile(output,html,{encoding:"utf8",flag:"wx"});
process.stdout.write(JSON.stringify({output,bytes:Buffer.byteLength(html),sha256:createHash("sha256").update(html).digest("hex")})+"\n");
