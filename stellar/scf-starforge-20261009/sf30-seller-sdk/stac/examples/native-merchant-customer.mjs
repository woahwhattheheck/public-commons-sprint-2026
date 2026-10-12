// MIT. One existing STAC edition through the original merchant/customer engines.
// The host supplies the original Buyer/profile and native merchant integration.
import {readStacEdition,stageStacMerchant,startStacMerchant,STAC_CHUNK_BYTES}
  from '../merchant.mjs';
import {createStacCustomer,openStacCustomer,StacDelivery} from '../customer.mjs';
import {absolute,need} from '../../../sf88-operator-buyer-cli/node/store.mjs';

export async function runNativeMerchantCustomer({
  editionDirectory,merchantDirectory,customerDirectory,deliveryDirectory,copyDirectory,
  origin,payment,id,maxPages,maxTotalAtomic,query={},selectedAssets=[],
  buyer,createBuyer,nativeFactory,facilitator,allowLocalFacilitator=false,
  port=0,chunkBytes=STAC_CHUNK_BYTES,signal,progress
}={}) {
  need((buyer!==undefined)!==(createBuyer!==undefined),'STAC_ONE_ORIGINAL_BUYER_SOURCE_REQUIRED');
  need(createBuyer===undefined||typeof createBuyer==='function','STAC_BUYER_FACTORY_INVALID');
  const edition=await readStacEdition(absolute(editionDirectory));
  const assets=new Set(edition.manifest.assets.map(item=>item.path));
  need(Array.isArray(selectedAssets)&&new Set(selectedAssets).size===selectedAssets.length&&
    selectedAssets.every(path=>assets.has(path)),'STAC_SELECT_CAPTURED_ASSETS');
  const files=[...edition.manifest.files.filter(item=>!assets.has(item.path)).map(item=>item.path),
    ...selectedAssets];
  const staged=await stageStacMerchant({editionDirectory:edition.directory,
    directory:absolute(merchantDirectory),origin,payment});
  const session=await startStacMerchant({directory:staged.directory,port,nativeFactory,facilitator,
    allowLocalFacilitator});
  let customer,acquired,delivered;
  try {
    if(createBuyer)buyer=await createBuyer({session,staged});
    need(buyer&&typeof buyer.createDataset==='function'&&typeof buyer.fromConfig==='function',
      'STAC_ORIGINAL_BUYER_REQUIRED');
    customer=await createStacCustomer({buyer,directory:absolute(customerDirectory),
      merchantDirectory:staged.directory,id,maxPages,maxTotalAtomic,query,files,chunkBytes});
    acquired=await customer.run({signal,progress});
    need(acquired.dataset?.native.status==='COMPLETE'&&acquired.completedMembers===files.length,
      'STAC_ORIGINAL_CUSTOMER_ACQUISITION_INCOMPLETE');
    delivered=await customer.deliver(absolute(deliveryDirectory),{signal,progress});
  }finally{await session.close();}
  // Offline receiving follows shutdown of the one original listener.
  const offline=await StacDelivery.open(delivered.directory,{signal});
  let sceneCount=0;
  for await(const feature of offline.features({signal})) {
    need(feature.type==='Feature','STAC_ORIGINAL_FEATURE_REQUIRED');sceneCount++;
  }
  need(sceneCount===offline.datasetManifest.dataset.rows,'STAC_NATIVE_SCENE_COUNT_CHANGED');
  const copied=copyDirectory===undefined?null:await offline.copyTo(absolute(copyDirectory),{signal,progress});
  const reopened=await openStacCustomer({buyer,directory:absolute(customerDirectory)});
  return {schema:'stellar-forge.stac-native-customer-journey.v1',
    editionId:staged.editionId,snapshot:staged.snapshot,selection:reopened.selection,
    sceneCount,selectedAssets:offline.members().filter(item=>item.asset),
    receiving:{directory:offline.directory,manifest:offline.manifest},
    copied:copied?{directory:copied.directory,manifest:copied.manifest}:null,
    native:offline.native};
}
