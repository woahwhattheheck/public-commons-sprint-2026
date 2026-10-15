/* MIT. Complete operator archives use the maintained lossless graph codec.
   Old operator carriers remain readable; every unfinished field and prior snapshot is retained. */
export function createOperatorArchive(S,createArchiveAPI,api,runtime){
 const engine="planning-operator-session-1.0.0",schema="commons.planning-session-frame.v1";
 const hash=text=>runtime.sha256(runtime.encode(text));
 function verify(frame){if(!frame||frame.schema!==schema||typeof frame.rootSha256!=="string")throw Error("Complete operator frame required");const session=S.validate(frame.session);if(hash(JSON.stringify(session))!==frame.rootSha256)throw Error("Operator frame content differs");return {...frame,session};}
 const adapter={engine,parseJSON:api.parseJSON,exportWorkspace:frame=>{verify(frame);const content=JSON.stringify(frame)+"\n";return {filename:"Planning_Working_Shared.json",content,sha256:hash(content)};},importWorkspace:raw=>verify(api.parseJSON(raw))};
 const shared=createArchiveAPI(adapter,runtime);
 function serialize(session){S.validate(session);const frame={schema,rootSha256:hash(JSON.stringify(session)),session};const out=shared.serialize(frame);return {...out,filename:"Planning_Working.json"};}
 function pack(session){return api.parseJSON(serialize(session).content);}
 function receive(raw){const e=api.parseJSON(raw);return e?.schema==="tjlabs.planning-shared-archive.v1"&&e.engine===engine?shared.open(raw).workspace.session:S.receive(raw);}
 return {engine,serialize,pack,receive};
}
