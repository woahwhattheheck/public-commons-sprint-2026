#!/usr/bin/env node
// MIT. Transform retained customer response files without network or a buyer retry.
import { open, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildFacilityReport, renderFacilityCsv, renderFacilityHtml } from './report-core.mjs';

const HELP = 'node report.mjs --events RETAINED_GEOJSON [--events ANOTHER_GEOJSON] --facilities FACILITIES_JSON --out NEW_REPORT_DIRECTORY [--as-of UTC_ISO_TIME]';
async function read(path, maximum) {
  const selected = resolve(path);
  const handle = await open(selected, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({bigint:true});
    if (!before.isFile() || before.size > BigInt(maximum))
      throw new TypeError('Use a regular input within the size limit: ' + selected);
    const bytes = Buffer.alloc(Number(before.size));
    let offset=0;
    while (offset < bytes.length) {
      const {bytesRead} = await handle.read(bytes, offset, bytes.length-offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat({bigint:true});
    if (offset !== bytes.length || ['dev','ino','size','mtimeNs','ctimeNs'].some(key => before[key] !== after[key]))
      throw new Error('The input changed while being read: ' + selected);
    return {name:basename(selected),sha256:createHash('sha256').update(bytes).digest('hex'),
      document:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
  } finally { await handle.close(); }
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) { console.log(HELP); return; }
  const options = {events:[]};
  for (let i=0; i<args.length; i+=2) {
    const name=args[i], value=args[i+1];
    if (!['--events','--facilities','--out','--as-of'].includes(name) || !value || value.startsWith('--'))
      throw new TypeError(HELP);
    if (name === '--events') options.events.push(value);
    else {
      if (Object.hasOwn(options,name)) throw new TypeError('Repeated option: ' + name);
      options[name]=value;
    }
  }
  if (!options.events.length || options.events.length > 16 || !options['--facilities'] || !options['--out'])
    throw new TypeError(HELP);
  if (options['--as-of'] && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(options['--as-of']))
    throw new TypeError('--as-of needs an explicit UTC ISO timestamp.');
  const facilities=await read(options['--facilities'],1048576), inputs=[];
  for (const path of options.events) inputs.push(await read(path,67108864));
  const report=buildFacilityReport(inputs,facilities.document,{generatedAt:options['--as-of']});
  report.facilitySource={name:facilities.name,sha256:facilities.sha256};
  const output=resolve(options['--out']);
  // Reserve the final path exclusively; retain a private INCOMPLETE marker if a disk write fails.
  await mkdir(output,{mode:0o700});
  const marker=join(output,'INCOMPLETE');
  await writeFile(marker,'Report creation is incomplete. Use the retained input files to create a new output directory.\n',
    {flag:'wx',mode:0o600});
  const contents = {'report.json':JSON.stringify(report,null,2)+'\n',
    'facility-events.csv':renderFacilityCsv(report),'report.html':renderFacilityHtml(report)};
  for (const [name,content] of Object.entries(contents)) {
    const temporary=join(output,'.'+name+'.'+randomUUID());
    await writeFile(temporary,content,{flag:'wx',mode:0o600});
    await rename(temporary,join(output,name));
  }
  await rm(marker);
  console.log(JSON.stringify({directory:output,files:Object.keys(contents),counts:report.counts},null,2));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode=1; });
