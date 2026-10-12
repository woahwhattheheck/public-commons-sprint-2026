// MIT. One original Gravity operator and the maintained source-owned connection.
import {fileURLToPath} from 'node:url';
import {EltssConnection,readEltssConfiguration} from '../../fhir_eltss/connected/connection.mjs';
import {CONNECTION_SCHEMA,OPERATOR_SCHEMA} from './contracts.mjs';
export const readGravityReferralConfiguration=filename=>
  readEltssConfiguration(filename,{schema:CONNECTION_SCHEMA});
export class GravityReferralConnection extends EltssConnection{
  constructor(binding){
    super(binding,{
      operatorSchema:OPERATOR_SCHEMA,connectionDirectory:'referral',
      cli:fileURLToPath(new URL('../cli.py',import.meta.url)),
      pythonEnvironment:'SF30_REFERRAL_PYTHON',nodeEnvironment:'SF30_REFERRAL_NODE',
      // Gravity's outer archive hash belongs to its own registry. The inherited
      // native receives array identifies the different inner workspace archive.
      receivingRecords:state=>state.referral?.receives
    });
  }
}
