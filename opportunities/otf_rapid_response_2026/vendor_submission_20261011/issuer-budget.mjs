/* MIT. Node adapter for the shared original OTF workbook transformation. */
import {inflateRawSync} from "node:zlib";
import {createHash} from "node:crypto";
import {ISSUER_TEMPLATE,createIssuerBudget} from "./issuer-budget-core.mjs";
const runtime=createIssuerBudget({sha256:bytes=>createHash("sha256").update(bytes).digest("hex"),inflateRaw:(bytes,expectedBytes)=>inflateRawSync(bytes,{maxOutputLength:expectedBytes+1})});
export {ISSUER_TEMPLATE};
export function readWorkbookZip(input){return runtime.readWorkbookZip(input);}
export function writeWorkbookZip(archive,replacements){return runtime.writeWorkbookZip(archive,replacements);}
export function buildIssuerBudget(template,doc){return runtime.buildIssuerBudget(template,doc);}
