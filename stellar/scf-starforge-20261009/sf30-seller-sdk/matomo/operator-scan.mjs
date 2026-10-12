// MIT. Return the ORIGINAL SF100 scan of an existing private data room.
import {scan} from '../../sf100-buyer-dataset-delivery/deliver.mjs';
import {resolve} from 'node:path';
if(process.argv.length!==3)throw new Error('Use operator-scan.mjs PRIVATE_DATA_ROOM');
process.stdout.write(JSON.stringify(await scan(resolve(process.argv[2]),{retainPayload:false}))+'\n');
