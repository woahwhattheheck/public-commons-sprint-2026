// MIT. One source-owned Applications registration for the native SensorThings Desk.
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../application-provider.mjs';
import {sensorThingsApplication,prepareSensorThingsApplication,sensorThingsStartup} from '../application-sensorthings.mjs';
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'sensorthings',order:1000,
  catalog({common}){return [sensorThingsApplication(common)];},
  prepare(type,settings,context){return prepareSensorThingsApplication(settings,context);},
  matchRequest(request){return !request.pythonCommand&&request.command==='sensorthings-desk';},
  createObserver(request,directory){return observeApplicationStartup(request,directory,text=>{
    if(!text.startsWith('{"schema":"stellar-forge.sensorthings-desk-startup.v1",'))return null;
    return ()=>sensorThingsStartup(request,text);
  },{lineLimit:65536});}
};
