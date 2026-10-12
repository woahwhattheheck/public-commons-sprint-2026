// MIT. Directory access shares the original native workspace and operator lifecycle.
import {fileURLToPath} from 'node:url';
import {EltssConnection,readEltssConfiguration} from '../../fhir_eltss/connected/connection.mjs';
import {CONNECTION_SCHEMA,OPERATOR_SCHEMA} from './contracts.mjs';
export const readHumanServicesDirectoryConfiguration=filename=>
  readEltssConfiguration(filename,{schema:CONNECTION_SCHEMA});
export class HumanServicesDirectoryConnection extends EltssConnection{
  constructor(binding){
    super(binding,{
      operatorSchema:OPERATOR_SCHEMA,connectionDirectory:'directory',
      cli:fileURLToPath(new URL('../cli.py',import.meta.url)),
      pythonEnvironment:'SF30_DIRECTORY_PYTHON',nodeEnvironment:'SF30_DIRECTORY_NODE',
      receivingRecords:state=>[
        ...(state.directory?.receives??[]),
        ...(state.referral?.receives??[]),
        ...(state.receives??[])
      ]
    });
  }
}
