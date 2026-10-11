// MIT. Offline seller-signed removal from the existing SF60 catalog.
import {readFile, writeFile, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DurableCatalogTransaction} from '../sf60-durable-catalog-transaction/journal.mjs';
import {prepareWithdrawal, signWithdrawal, verifyWithdrawal, applyWithdrawal} from './withdrawal.mjs';

const USAGE = [
  'Seller-signed SF60 withdrawal (Node 22+, private operator directory):',
  '  node cli.mjs prepare --dir PATH --seller ID --catalog-key KEY --source-url HTTPS --reason TEXT --out REQUEST.json',
  '  node cli.mjs sign --request REQUEST.json --private-key LOCAL_ED25519_PEM --out ENVELOPE.json',
  '  node cli.mjs verify --envelope ENVELOPE.json --pin INDEPENDENT_PUBLIC_PEM',
  '  node cli.mjs apply --dir PATH --envelope ENVELOPE.json --pin INDEPENDENT_PUBLIC_PEM',
  'Sign and apply on respective trusted local machines. No network or wallet calls.'
].join('\n');
const commands = {
  prepare: ['--dir','--seller','--catalog-key','--source-url','--reason','--out'],
  sign: ['--request','--private-key','--out'],
  verify: ['--envelope','--pin'],
  apply: ['--dir','--envelope','--pin'],
};
function parse(argv) {
  const [command, ...args] = argv;
  const fields=commands[command];
  if (!fields || args.length !== fields.length*2) throw new Error(USAGE);
  const options={};
  for (let i=0;i<args.length;i+=2) {
    if (!fields.includes(args[i]) || Object.hasOwn(options,args[i]) ||
        typeof args[i+1] !== 'string' || !args[i+1]) throw new Error(USAGE);
    options[args[i]]=args[i+1];
  }
  if (fields.some(k=>!Object.hasOwn(options,k))) throw new Error(USAGE);
  return {command, options};
}
async function readSmall(filename) {
  const meta=await stat(filename);
  if (!meta.isFile() || meta.size < 1 || meta.size > 128*1024) throw new Error('PRIVATE_INPUT_SIZE_INVALID');
  return await readFile(filename,'utf8');
}
async function readJson(filename) {
  try { return JSON.parse(await readSmall(filename)); }
  catch(error) { if (error instanceof SyntaxError) throw new Error('INPUT_NOT_JSON'); throw error; }
}
async function persist(filename, value) {
  await writeFile(filename, JSON.stringify(value,null,2)+'\n', {flag:'wx',mode:0o600});
}
async function withJournal(directory, work) {
  const journal=await DurableCatalogTransaction.open(directory);
  try {return await work(journal);} finally {await journal.close();}
}
export async function run(argv=process.argv.slice(2)) {
  if (argv.length===1 && argv[0]==='--help') {console.log(USAGE);return;}
  const {command, options:o}=parse(argv);
  if (command==='prepare') {
    const request=await withJournal(o['--dir'], journal=>prepareWithdrawal({
      journal, sellerId:o['--seller'], catalogKey:o['--catalog-key'],
      sourceURL:o['--source-url'], reason:o['--reason']}));
    await persist(o['--out'],request);
    console.log(JSON.stringify({status:'REQUEST_PREPARED',requestFile:resolve(o['--out']),
      journalHead:request.previousHead,sequence:request.sequence,expiresAt:request.expiresAt}));
  } else if (command==='sign') {
    const envelope=signWithdrawal(await readJson(o['--request']), await readSmall(o['--private-key']));
    await persist(o['--out'],envelope);
    console.log(JSON.stringify({status:'SELLER_SIGNED',envelopeFile:resolve(o['--out']),
      sellerId:envelope.request.sellerId,expiresAt:envelope.request.expiresAt}));
  } else if (command==='verify') {
    const proof=verifyWithdrawal(await readJson(o['--envelope']),await readSmall(o['--pin']));
    console.log(JSON.stringify({status:'SIGNATURE_VALID',sellerId:proof.request.sellerId,
      catalogKey:proof.request.catalogKey,proofSha256:proof.proofSha256,
      currentCatalogNotChecked:true}));
  } else {
    const envelope=await readJson(o['--envelope']);
    const pinnedPublicKey=await readSmall(o['--pin']);
    const receipt=await withJournal(o['--dir'], journal=>applyWithdrawal({
      journal,envelope,pinnedPublicKey}));
    console.log(JSON.stringify(receipt));
  }
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  run().catch(error=>{console.error(error?.message??String(error));process.exitCode=1;});
}
