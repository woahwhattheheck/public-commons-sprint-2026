#!/usr/bin/env node
import fs from "node:fs";import path from "node:path";import {fileURLToPath} from "node:url";import {buildCustomerDocuments} from "./package-documents.mjs";
const here=path.dirname(fileURLToPath(import.meta.url)),out=path.resolve(process.argv[2]||path.join(here,"package-documents-output"));if(fs.existsSync(out))throw Error("Choose a new output directory.");
const result=buildCustomerDocuments("jsonsupport",JSON.parse(fs.readFileSync(path.join(here,"delivery","working-record.json"),"utf8")));fs.mkdirSync(out,{mode:0o700});for(const[name,body]of Object.entries(result.outputs))fs.writeFileSync(path.join(out,name),body,{flag:"wx",mode:0o600});console.log(JSON.stringify({output:out,...result.receipt},null,2));
