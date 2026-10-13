import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { enrichAnnualReferences, annualStationContextCsv, annualStationContextMarkdown } from "./annual_reference_enrichment_core.mjs";
export { enrichAnnualReferences, annualStationContextCsv, annualStationContextMarkdown } from "./annual_reference_enrichment_core.mjs";

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [regionalPath,inventoryPath,output,...other]=process.argv.slice(2);
  if(!regionalPath||!inventoryPath||!output||other.length)
    throw new Error("Usage: node annual_reference_enrichment.mjs REGIONAL_YIELDS.json USGS_INVENTORY.json NEW_OUTPUT_DIRECTORY");
  const identify=text=>({bytes:Buffer.byteLength(text,"utf8"),sha256:createHash("sha256").update(text,"utf8").digest("hex")});
  const regional=readFileSync(regionalPath,"utf8"), inventory=readFileSync(inventoryPath,"utf8");
  const context=enrichAnnualReferences(regional,inventory,identify);
  const directory=resolve(output);
  if(existsSync(directory)) throw new Error("Choose a new output directory; preserve prior source editions.");
  mkdirSync(directory,{recursive:true});
  const files={
    "original-regional-reference-yields.json":regional,
    "original-national-inventory.json":inventory,
    "annual-reference-station-context.json":JSON.stringify(context,null,2)+"\n",
    "annual-reference-station-context.csv":annualStationContextCsv(context),
    "annual-reference-station-context.md":annualStationContextMarkdown(context)
  };
  for(const [name,body] of Object.entries(files)) writeFileSync(join(directory,name),body,{encoding:"utf8",flag:"wx"});
  const manifest={schema:"upstate.annual-reference-station-context-files/v1",
    summary:context.summary,files:Object.fromEntries(Object.entries(files).map(([name,body])=>[name,identify(body)]))};
  writeFileSync(join(directory,"station-context-files.json"),JSON.stringify(manifest,null,2)+"\n",{encoding:"utf8",flag:"wx"});
  process.stdout.write(JSON.stringify({output:directory,...manifest},null,2)+"\n");
}
