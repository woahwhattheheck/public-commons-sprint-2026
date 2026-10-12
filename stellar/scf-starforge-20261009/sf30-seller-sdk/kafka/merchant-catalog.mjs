// MIT. Metadata only for the original Kafka workspace merchant family.
const str=(description,more={})=>({type:'string',description,...more});
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const alias=str('Host-declared workspace or input alias.',{pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'});
const id=str('Original lowercase SHA-256 identity.',{pattern:'^[a-f0-9]{64}$'});
const operation=str('Stable operation name; repeat it to recover the same original operation.',{pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'});
const offset=str('Exact nonnegative signed-64 Kafka offset as decimal text.',{pattern:'^(0|[1-9][0-9]{0,18})$'});
const revision={type:'integer',minimum:1,maximum:1000000000};
const page={offset:{type:'integer',minimum:0,maximum:1000000000},limit:{type:'integer',minimum:1,maximum:200}};
const read={readOnly:true,idempotent:true,openWorld:false};
const write={readOnly:false,idempotent:true,openWorld:false};
const source={...write,openWorld:true};
const names=['connection','inspection','capture','projection','source','plan'];
const env=str('Name of an existing server environment variable; keep its value in the original host.',{pattern:'^[A-Za-z_][A-Za-z0-9_]*$'});
const security=obj({
  protocol:{enum:['PLAINTEXT','SSL','SASL_PLAINTEXT','SASL_SSL']},
  mechanism:{enum:['PLAIN','SCRAM-SHA-256','SCRAM-SHA-512']},
  usernameEnv:env,passwordEnv:env,caFileEnv:env,certificateFileEnv:env,keyFileEnv:env,keyPasswordEnv:env
},['protocol']);
const connection=obj({
  schema:{const:'stellar-forge.kafka-connection.v1'},label:str('Saved source label.',{minLength:1,maxLength:160}),
  brokers:{type:'array',items:str('Broker host:port.',{minLength:1,maxLength:300}),minItems:1,maxItems:32,uniqueItems:true},
  topic:str('One exact topic name.',{minLength:1,maxLength:249}),security,
  requestTimeoutSeconds:{type:'integer',minimum:1,maximum:120},
  maxMessageBytes:{type:'integer',minimum:1,maximum:16777216},
  maxCaptureBytes:{type:'integer',minimum:1,maximum:268435456},
  maxCaptureRecords:{type:'integer',minimum:1,maximum:1000000}
});
export function kafkaWorkspaceTools(tool) {
  const t=(name,description,properties={},required=Object.keys(properties),hints=read)=>
    tool('merchant_kafka_'+name,description,properties,required,hints);
  const w={workspace:alias};
  return [
    t('workspaces','List the configured Kafka workspaces, host input aliases and active retained file reads.'),
    t('inspect','Inspect the existing authenticated Kafka Application and its original source binding.',w),
    t('state','Read complete native workspace state. Large results are retained as a complete resumable JSON file.',w),
    t('configured_topics','List saved exact-topic connection revisions in this workspace.',w),
    t('read','Read a retained connection, inspection, capture, projection, NDJSON source or mapping plan.',{...w,kind:{enum:names},id:str('Original record identity; connections use their saved name.')}),
    t('save_connection','Save one exact-topic connection using its original revision and stable operation. Credentials are environment references.',{
      ...w,connection:operation,expectedRevision:{type:'integer',minimum:0,maximum:1000000},operation,config:connection
    },undefined,write),
    t('inspect_connection','Inspect the configured broker and retain its exact cluster, topic UUID, partitions and committed bounds.',{
      ...w,connection:operation,revision:{type:'integer',minimum:1,maximum:1000001},operation
    },undefined,source),
    t('prepare_capture','Prepare explicit ranges from one retained source inspection; end offsets are exclusive.',{
      ...w,inspection:id,operation,ranges:{type:'array',minItems:1,maxItems:4096,
        items:obj({partition:{type:'integer',minimum:0,maximum:2147483647},start:offset,end:offset})}
    },undefined,write),
    t('run_capture','Run the same retained capture at its expected revision using the original read_committed consumer.',{...w,capture:id,expectedRevision:revision},undefined,source),
    t('resume_capture','Resume the original interrupted capture and retained per-partition progress at its current revision.',{...w,capture:id,expectedRevision:revision},undefined,source),
    t('cancel_capture','Cancel the selected original capture and retain the exact partial coverage already received.',{...w,capture:id},undefined,{...write,destructive:true}),
    t('wait_capture','Wait for the original capture to leave RUNNING/CANCELLING; return its actual terminal or prepared state.',{
      ...w,capture:id,pollMs:{type:'integer',minimum:100,maximum:10000},timeoutMs:{type:'integer',minimum:1,maximum:3600000}
    },['workspace','capture']),
    t('messages','Page compact retained message metadata with exact string offsets. Use message for complete raw bytes.',{...w,capture:id,...page},['workspace','capture']),
    t('message','Retain the complete original raw message JSON, including exact bytes and ordered headers, for resumable reads.',{
      ...w,id,operation
    },['workspace','id']),
    t('project','Freeze retained capture revisions into an original NDJSON source edition with explicit decode, view and deletion semantics.',{
      ...w,operation,captures:{type:'array',minItems:1,maxItems:64,items:obj({id,revision})},
      view:{enum:['events','latest-per-partition-key']},decode:{enum:['json','bytes']},
      deletePolicy:{enum:['retain','tombstone','tombstone-or-goldsky']},acceptIncomplete:{type:'boolean'},
      label:str('Source edition label.',{minLength:1,maxLength:128})
    },undefined,write),
    t('save_plan','Save a complete original NDJSON mapping plan. JSON text preserves exact numeric lexemes.',{
      ...w,planJson:str('Complete original NDJSON plan JSON.',{minLength:2,maxLength:131072})
    },undefined,write),
    t('build','Build the selected original NDJSON source and saved plan.',{...w,source:id,plan:id},undefined,write),
    t('query','Query a retained build using original scalar-string query parameters. Large results become a complete retained file.',{
      ...w,build:id,query:{type:'object',additionalProperties:{type:'string'}}
    }),
    t('compare','Compare two original retained dataset builds and save the complete native change set.',{...w,before:id,after:id},undefined,write),
    t('changes','Page one retained comparison without changing its original before/after build identities.',{
      ...w,id,offset:page.offset,limit:{type:'integer',minimum:1,maximum:250}
    },['workspace','id']),
    t('import','Import a complete host-declared Kafka project, native NDJSON project or source file with its original SHA-256.',{
      ...w,input:alias,name:str('NDJSON source name.',{minLength:1,maxLength:240}),
      label:str('NDJSON source label.',{minLength:1,maxLength:240})
    },['workspace','input'],write),
    t('export','Receive one complete native file into a stable export operation. Repeat the same operation and selection to reopen its completed file.',{
      ...w,operation,kind:{enum:['kafka-project','ndjson-project','dataset','changes','merchant','message','state','projection','record','query']},
      selection:{type:'object',description:'Exact native selection: project {build,projection?}; native/dataset {build}; changes/message/projection {id}; state {}; record {kind,id}; query {build,query}; merchant {build,payment,origin,path}.'}
    },undefined,write),
    t('exports','Page retained export selections, including an interrupted selection that can resume with its original operation.',{...w,...page},['workspace']),
    t('manifest','Read the original complete export manifest without reopening Kafka or regenerating the file.',{...w,artifact:id}),
    t('file_read','Read exact retained file bytes as base64. Continue or reopen with the same artifact, expectedSha256 and byte offset.',{
      ...w,artifact:id,expectedSha256:id,
      readId:str('Original retained read UUID.',{pattern:'^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$'}),
      offset:{type:'integer',minimum:0,maximum:2147483648},
      limit:{type:'integer',minimum:1,maximum:196608}
    },['workspace','artifact','expectedSha256']),
    t('file_release','Release one original file read descriptor. The completed export remains available for a later reopen.',{
      ...w,readId:str('Original retained read UUID.',{pattern:'^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$'})
    },undefined,write)
  ];
}
