/** Original Measurements CLI entry for complete Chiques nutrient sources. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {MeasurementWorkspace} from './workspace.mjs';
import {prepareChiquesNutrients,verifyChiquesPreparation} from './chiques_nutrients.mjs';
import {chiquesOperation,readChiquesCollection} from './chiques_nutrient_workspace.mjs';
import {chiquesSourceHTML,chiquesSourceCSV} from './chiques_nutrient_reports.mjs';
import {publishCollection,editionBundle} from './collections.mjs';
import {publishExactFile} from './file_product.mjs';
const readText=async file=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await fs.readFile(file));
async function completeOutput(options,value){
 const data=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
 if(!options.output){if(Buffer.isBuffer(value))throw Error('Choose --output for the complete binary collection');process.stdout.write(data);return;}
 const target=path.resolve(options.output);await publishExactFile(target,data);
 const file=await fs.open(target,'r');try{await file.sync();}finally{await file.close();}
 const directory=await fs.open(path.dirname(target),'r');try{await directory.sync();}finally{await directory.close();}
}
export async function runChiquesCLI(operation,options,directory){
 if(operation==='prepare'){
  if(!options.source)throw Error('Choose --source ORIGINAL_TRANSFER.json');
  const sourcePacket=JSON.parse(await readText(options.source)),attachments=[];
  if(options.companions){
   const list=JSON.parse(await readText(options.companions));
   if(!Array.isArray(list)||list.some(x=>typeof x!=='string'))throw Error('Companions JSON must contain original file paths');
   for(const name of list){const file=path.resolve(path.dirname(path.resolve(options.companions)),name),bytes=await fs.readFile(file);attachments.push({name:path.basename(file),bytes:bytes.length,base64:bytes.toString('base64')});}
  }
  await completeOutput(options,prepareChiquesNutrients({sourcePacket,attachments}));return;
 }
 const workspace=new MeasurementWorkspace(directory);
 try{
  let input=options.file?JSON.parse(await readText(options.file)):{};
  if(operation==='preview'){
   if(input.schema==='upstate.chiques-nutrient-working/v1')input={preparation:input.preparation,...(!input.preparation?{sourcePacket:input.sourcePacket,attachments:input.attachments}: {})};
   else if(input.schema==='upstate.chiques-nutrient-preparation/v1')input={preparation:input};
   await completeOutput(options,chiquesOperation(workspace,'POST',['preview'],input));
  }else if(operation==='receive'){
   if(input.schema==='upstate.chiques-nutrient-working/v1'){if(!input.pending)throw Error('Keep a reviewed collection ID in the saved receiving request');input={preparation:input.preparation,expectedId:input.pending.expectedId};}
   if(!input.expectedId)throw Error('Use the exact reviewed request {preparation,expectedId}; preview does not authorize an inferred selection');
   await completeOutput(options,chiquesOperation(workspace,'POST',['receive'],input));
  }else if(operation==='catalogue')await completeOutput(options,chiquesOperation(workspace,'GET',['catalogue']));
  else if(['read','report','csv','bundle'].includes(operation)){
   const selected=readChiquesCollection(workspace,options.id);
   if(operation==='read')await completeOutput(options,selected);
   else if(operation==='report')await completeOutput(options,chiquesSourceHTML(selected.preparation.report));
   else if(operation==='csv')await completeOutput(options,chiquesSourceCSV(selected.preparation.report));
   else{
    if(!selected.complete)throw Error('Finish the original selected collection before publishing it');
    const edition=publishCollection(workspace,options.id),bundle=editionBundle(workspace,options.id,edition.id);
    await completeOutput(options,Buffer.from(bundle.base64,'base64'));
    process.stdout.write(JSON.stringify({collectionId:options.id,editionId:edition.id,name:bundle.name,bytes:bundle.bytes,sha256:bundle.sha256})+'\n');
   }
  }else throw Error('Unknown Chiques nutrient command: '+operation);
 }finally{workspace.close();}
}
