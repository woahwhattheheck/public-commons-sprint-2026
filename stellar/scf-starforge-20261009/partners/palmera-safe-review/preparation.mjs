// MIT. Offline preparation through the original merchant offer and SF88 buyer.
import { readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { absolute, need, digest, jsonBytes, parseJson, privateDirectory, readBytes,
  readJson, exists, syncDirectory, intent, matchingWriteTemporaries
} from '../../sf88-operator-buyer-cli/node/store.mjs';
import { prepareBuyerDraft, readBuyerPreparation } from '../tenderly-stellar-pilot/customer.mjs';
import { createSelection } from '../tenderly-stellar-pilot/customer/selection.mjs';
import { openSelection, receiveSelection, exactWrite } from './transaction.mjs';

const SCHEMA='stellar-forge.safe-purchase-preparation.v1';
const NAMES=['preparation-intent.json','selection','merchant-plan.json','merchant-ticket.json',
  'merchant-selection.json','buyer.json','prepared.json'];
const TEMP=/^\.write-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Prepare one selected Safe request and original merchant ticket for native import. */
export async function prepareSafePurchase({selectionDirectory,planFile,ticketFile,intentId,directory}) {
  intent(intentId);
  const selected=await openSelection(selectionDirectory);
  const planBytes=await readBytes(absolute(planFile),65536);
  const ticketBytes=await readBytes(absolute(ticketFile),16384);
  const merchant=createSelection(parseJson(planBytes)),merchantBytes=jsonBytes(merchant);
  need(merchant.networkId===selected.expected.networkId,'SAFE_MERCHANT_NETWORK_MISMATCH');
  directory=await privateDirectory(absolute(directory));
  need(await realpath(directory)===directory,'SAFE_PREPARATION_DIRECTORY_SYMLINK');
  const input={schema:SCHEMA,directory,intentId,selectionId:selected.id,
    planSha256:digest(planBytes),ticketSha256:digest(ticketBytes),merchant};
  const inputBytes=jsonBytes(input),names=await readdir(directory);
  const markerTemporaries=await matchingWriteTemporaries(directory,[inputBytes]);
  const ordinary=names.filter(name=>!markerTemporaries.has(name));
  need(names.every(name=>NAMES.includes(name)||TEMP.test(name))&&
    (ordinary.length===0||ordinary.includes('preparation-intent.json')),
    'SAFE_PREPARATION_DESTINATION_CONFLICT');
  // A prior marker must match before completing any of its staged inputs.
  await exactWrite(join(directory,'preparation-intent.json'),inputBytes);
  await receiveSelection(selected.directory,join(directory,'selection'));
  await exactWrite(join(directory,'merchant-plan.json'),planBytes);
  await exactWrite(join(directory,'merchant-ticket.json'),ticketBytes);
  await exactWrite(join(directory,'merchant-selection.json'),merchantBytes);
  const selection=await openSelection(join(directory,'selection')),configFile=join(directory,'buyer.json');
  // The original draft owns offer compilation, body pin, expiry and ticket terms.
  // Existing complete configurations reopen their original ticket as retained metadata.
  const draft=await prepareBuyerDraft({plan:parseJson(planBytes),bodyFile:selection.bodyFile,
    ticketFile:join(directory,'merchant-ticket.json'),intentId,out:configFile,
    requireCurrent:!await exists(configFile)});
  const completion={schema:SCHEMA+'.complete',input,configSha256:draft.summary.configSha256};
  const completionBytes=jsonBytes(completion);
  const temporary=await matchingWriteTemporaries(directory,[
    inputBytes,planBytes,ticketBytes,merchantBytes,draft.bytes,completionBytes]);
  need((await readdir(directory)).every(name=>NAMES.includes(name)||temporary.has(name)),
    'SAFE_PREPARATION_DESTINATION_CONFLICT');
  // Use the original atomic writer for the exact original draft. The final marker
  // is published only after the native configuration reopens against its inputs.
  await exactWrite(configFile,draft.bytes);
  const reviewed=await readBuyerPreparation({configFile}),config=await readJson(configFile);
  need(reviewed.intentId===intentId&&reviewed.configSha256===completion.configSha256&&
    reviewed.bodySha256===selection.manifest.files['simulation.json'].sha256&&
    reviewed.sellerUrl===merchant.resource&&reviewed.method==='POST'&&
    config.operation.bodyFile===selection.bodyFile&&config.operation.ticketFile===join(directory,'merchant-ticket.json'),
    'SAFE_ORIGINAL_PREPARATION_MISMATCH');
  await exactWrite(join(directory,'prepared.json'),completionBytes);
  await syncDirectory(directory);
  return openPreparedPurchase(directory);
}
export async function openPreparedPurchase(directory) {
  directory=await privateDirectory(absolute(directory),{create:false});
  need(await realpath(directory)===directory,'SAFE_PREPARATION_DIRECTORY_SYMLINK');
  const savedBytes=await readBytes(join(directory,'prepared.json'));
  const inputBytes=await readBytes(join(directory,'preparation-intent.json'));
  const saved=parseJson(savedBytes),input=parseJson(inputBytes);
  need(saved.schema===SCHEMA+'.complete'&&input.schema===SCHEMA&&input.directory===directory&&
    jsonBytes(saved.input).equals(jsonBytes(input)),'SAFE_PREPARATION_MANIFEST_MISMATCH');
  const selection=await openSelection(join(directory,'selection'));
  const planBytes=await readBytes(join(directory,'merchant-plan.json'),65536);
  const ticketBytes=await readBytes(join(directory,'merchant-ticket.json'),16384);
  const merchant=createSelection(parseJson(planBytes));
  const merchantBytes=await readBytes(join(directory,'merchant-selection.json'),65536);
  const configFile=join(directory,'buyer.json'),configBytes=await readBytes(configFile);
  const config=parseJson(configBytes);
  need(selection.id===input.selectionId&&digest(planBytes)===input.planSha256&&
    digest(ticketBytes)===input.ticketSha256&&jsonBytes(merchant).equals(merchantBytes)&&
    jsonBytes(merchant).equals(jsonBytes(input.merchant))&&
    digest(configBytes)===saved.configSha256&&config.operation?.intentId===input.intentId&&
    config.operation.bodyFile===selection.bodyFile&&config.operation.ticketFile===join(directory,'merchant-ticket.json'),
    'SAFE_PREPARATION_INPUT_CHANGED');
  const temporary=await matchingWriteTemporaries(directory,[savedBytes,inputBytes,planBytes,ticketBytes,merchantBytes,configBytes]);
  need((await readdir(directory)).every(name=>NAMES.includes(name)||temporary.has(name)),
    'SAFE_PREPARATION_DESTINATION_CONFLICT');
  return {schema:SCHEMA+'.complete',directory,intentId:input.intentId,selectionId:selection.id,
    selectionDirectory:selection.directory,configFile,configSha256:saved.configSha256,
    bodySha256:selection.manifest.files['simulation.json'].sha256,
    merchantSelection:merchant,merchantSelectionFile:join(directory,'merchant-selection.json'),
    planFile:join(directory,'merchant-plan.json'),ticketFile:join(directory,'merchant-ticket.json')};
}
