// SPDX-License-Identifier: MIT
// Installed interfaces forward the selected private original Operator and three web views.
import {MAX_RETAINED_CHUNK_BYTES} from '../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
export const NATIVE_DEFINITIONS=Object.freeze([
 {
  "suffix": "status",
  "description": "Read the original delivery counts, jobs, worker and accepted process activity.",
  "properties": {},
  "required": [],
  "read": true
 },
 {
  "suffix": "records",
  "description": "Page complete original collection membership; retain and follow its native cursor.",
  "properties": {
   "collection": {
    "enum": [
     "sources",
     "targets",
     "plans",
     "jobs",
     "feeds"
    ]
   },
   "limit": {
    "type": "integer",
    "minimum": 1,
    "maximum": 100
   },
   "cursor": {
    "type": "string",
    "minLength": 1,
    "maxLength": 8192
   }
  },
  "required": [
   "collection"
  ],
  "read": true
 },
 {
  "suffix": "inspect",
  "description": "Retain the complete original source, target, plan, job or feed and its native links.",
  "properties": {
   "collection": {
    "enum": [
     "sources",
     "targets",
     "plans",
     "jobs",
     "feeds"
    ]
   },
   "id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   }
  },
  "required": [
   "collection",
   "id"
  ],
  "read": true
 },
 {
  "suffix": "import_source",
  "description": "Retain exact host-declared full CSV and optional original candidate/dataset inputs, then call the original parser.",
  "properties": {
   "sourceInput": {
    "type": "string",
    "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
   },
   "expectedSourceSha256": {
    "type": "string",
    "pattern": "^[a-f0-9]{64}$"
   },
   "candidateInput": {
    "type": "string",
    "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
   },
   "datasetInput": {
    "type": "string",
    "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
   }
  },
  "required": [
   "sourceInput",
   "expectedSourceSha256"
  ],
  "read": false
 },
 {
  "suffix": "read_rows",
  "description": "Read complete CSV cells through the original reader; follow next_offset and use the full artifact for any oversized row.",
  "properties": {
   "source_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "offset": {
    "type": "integer",
    "minimum": 0,
    "maximum": 9007199254740991
   },
   "limit": {
    "type": "integer",
    "minimum": 1,
    "maximum": 500
   },
   "columns": {
    "type": "array",
    "minItems": 1,
    "maxItems": 10000,
    "uniqueItems": true,
    "items": {
     "type": "string",
     "minLength": 1,
     "maxLength": 1048576
    }
   }
  },
  "required": [
   "source_id"
  ],
  "read": true
 },
 {
  "suffix": "add_target",
  "description": "Inspect the host-declared existing CKAN package/resource using its declared environment token reference.",
  "properties": {
   "target": {
    "type": "string",
    "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
   }
  },
  "required": [
   "target"
  ],
  "read": false
 },
 {
  "suffix": "create_plan",
  "description": "Read actual destination bytes/metadata and retain the original reviewed baseline and explicit text fields.",
  "properties": {
   "source_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "target_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "fields": {
    "type": "object",
    "maxProperties": 100,
    "additionalProperties": {
     "type": "string",
     "maxLength": 1048576
    }
   }
  },
  "required": [
   "source_id",
   "target_id"
  ],
  "read": false
 },
 {
  "suffix": "queue_delivery",
  "description": "Approve the selected original plan; its ID is the durable native job ID.",
  "properties": {
   "plan_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   }
  },
  "required": [
   "plan_id"
  ],
  "read": false
 },
 {
  "suffix": "advance_delivery",
  "description": "Advance the original durable delivery and retain its accepted activity separately from its actual result.",
  "properties": {
   "job_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "wait": {
    "type": "boolean"
   }
  },
  "required": [
   "job_id"
  ],
  "read": false
 },
 {
  "suffix": "reconcile_delivery",
  "description": "Read actual destination bytes and metadata for the original job without sending a provider write.",
  "properties": {
   "job_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "wait": {
    "type": "boolean"
   }
  },
  "required": [
   "job_id"
  ],
  "read": false
 },
 {
  "suffix": "retry_delivery",
  "description": "Explicit same-job retry only after the operator has established the previous provider request ended; first reconcile uncertainty.",
  "properties": {
   "job_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "wait": {
    "type": "boolean"
   }
  },
  "required": [
   "job_id"
  ],
  "read": false
 },
 {
  "suffix": "pause_delivery",
  "description": "Pause between requests or resume the same original job; never imply cancellation of an in-flight provider request.",
  "properties": {
   "job_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "paused": {
    "type": "boolean"
   }
  },
  "required": [
   "job_id",
   "paused"
  ],
  "read": false
 },
 {
  "suffix": "accept_metadata",
  "description": "Accept reviewed unrelated metadata changes through the original full readback and package lease.",
  "properties": {
   "job_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   }
  },
  "required": [
   "job_id"
  ],
  "read": false
 },
 {
  "suffix": "confirm_request_finished",
  "description": "Record the operator's actual confirmation that the earlier provider request ended. This is not an automatic timeout recovery.",
  "properties": {
   "job_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   }
  },
  "required": [
   "job_id"
  ],
  "read": false
 },
 {
  "suffix": "configure_feed",
  "description": "Save the complete original recurring contract using declared producer paths; enabled=true authorizes this original feed.",
  "properties": {
   "producer": {
    "type": "string",
    "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
   },
   "config": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "target_id": {
      "type": "string",
      "pattern": "^[a-f0-9]{24}$"
     },
     "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
     },
     "fields": {
      "type": "object",
      "maxProperties": 100,
      "additionalProperties": {
       "type": "string",
       "maxLength": 1048576
      }
     },
     "columns": {
      "type": [
       "array",
       "null"
      ],
      "minItems": 1,
      "maxItems": 10000,
      "uniqueItems": true,
      "items": {
       "type": "string",
       "minLength": 1,
       "maxLength": 1048576
      }
     },
     "interval_seconds": {
      "type": "integer",
      "minimum": 30,
      "maximum": 2592000
     },
     "minimum_rows": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
     },
     "maximum_rows": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
     },
     "maximum_drop_percent": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100
     },
     "enabled": {
      "type": "boolean"
     }
    },
    "required": [
     "target_id"
    ]
   }
  },
  "required": [
   "producer",
   "config"
  ],
  "read": false
 },
 {
  "suffix": "replace_feed",
  "description": "Replace the original full feed contract, retaining its native replacement journal and applicable current job.",
  "properties": {
   "previous_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "producer": {
    "type": "string",
    "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
   },
   "config": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "target_id": {
      "type": "string",
      "pattern": "^[a-f0-9]{24}$"
     },
     "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
     },
     "fields": {
      "type": "object",
      "maxProperties": 100,
      "additionalProperties": {
       "type": "string",
       "maxLength": 1048576
      }
     },
     "columns": {
      "type": [
       "array",
       "null"
      ],
      "minItems": 1,
      "maxItems": 10000,
      "uniqueItems": true,
      "items": {
       "type": "string",
       "minLength": 1,
       "maxLength": 1048576
      }
     },
     "interval_seconds": {
      "type": "integer",
      "minimum": 30,
      "maximum": 2592000
     },
     "minimum_rows": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
     },
     "maximum_rows": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
     },
     "maximum_drop_percent": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100
     },
     "enabled": {
      "type": "boolean"
     }
    },
    "required": [
     "target_id"
    ]
   }
  },
  "required": [
   "previous_id",
   "producer",
   "config"
  ],
  "read": false
 },
 {
  "suffix": "set_feed_enabled",
  "description": "Enable or pause the exact saved original feed; preserve its original history.",
  "properties": {
   "feed_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "enabled": {
    "type": "boolean"
   }
  },
  "required": [
   "feed_id",
   "enabled"
  ],
  "read": false
 },
 {
  "suffix": "tick",
  "description": "Advance due original feeds and jobs once. An accepted activity is distinct from a finished provider result.",
  "properties": {
   "wait": {
    "type": "boolean"
   }
  },
  "required": [],
  "read": false
 },
 {
  "suffix": "export_delivery",
  "description": "Export the original full job, plan, CSV and producer manifests. Preserve the selected filename and earlier exports.",
  "properties": {
   "job_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "filename": {
    "type": "string",
    "pattern": "^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}\\.zip$"
   }
  },
  "required": [
   "job_id"
  ],
  "read": false
 },
 {
  "suffix": "artifact_info",
  "description": "Read the original artifact URI's full digest, byte count, media type and filename.",
  "properties": {
   "uri": {
    "type": "string",
    "minLength": 1,
    "maxLength": 1024
   }
  },
  "required": [
   "uri"
  ],
  "read": true
 },
 {
  "suffix": "download_chunk",
  "description": "Read a full native artifact range with original full-file/chunk hashes. Native maximum is262144 bytes.",
  "properties": {
   "uri": {
    "type": "string",
    "minLength": 1,
    "maxLength": 1024
   },
   "offset": {
    "type": "integer",
    "minimum": 0,
    "maximum": 9007199254740991
   },
   "length": {
    "type": "integer",
    "minimum": 1,
    "maximum": 262144
   },
   "expected_sha256": {
    "type": "string",
    "pattern": "^[a-f0-9]{64}$"
   }
  },
  "required": [
   "uri"
  ],
  "read": true
 },
 {
  "suffix": "approval_status",
  "description": "Read actual review counts and eligible completed original deliveries.",
  "properties": {},
  "required": [],
  "read": true
 },
 {
  "suffix": "approval_records",
  "description": "Page original profiles, reviews, provider operations or edition observations.",
  "properties": {
   "collection": {
    "enum": [
     "profiles",
     "records",
     "operations",
     "observations"
    ]
   },
   "limit": {
    "type": "integer",
    "minimum": 1,
    "maximum": 100
   },
   "cursor": {
    "type": "string",
    "minLength": 1,
    "maxLength": 8192
   }
  },
  "required": [
   "collection"
  ],
  "read": true
 },
 {
  "suffix": "approval_inspect",
  "description": "Retain the complete original review/operation and its source, native decision and history links.",
  "properties": {
   "id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "collection": {
    "enum": [
     "profiles",
     "records",
     "operations",
     "observations"
    ]
   }
  },
  "required": [
   "id"
  ],
  "read": true
 },
 {
  "suffix": "approval_add_profile",
  "description": "Bind the declared credential reference to the actual authenticated principal at the retained target.",
  "properties": {
   "target_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "name": {
    "type": "string",
    "minLength": 1,
    "maxLength": 160
   },
   "credential": {
    "type": "string",
    "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
   },
   "token_header": {
    "type": "string",
    "minLength": 1,
    "maxLength": 200
   }
  },
  "required": [
   "target_id",
   "name",
   "credential"
  ],
  "read": false
 },
 {
  "suffix": "approval_track",
  "description": "Track one completed delivery and independently reread the exact native edition before retaining its review.",
  "properties": {
   "job_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "profile_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   }
  },
  "required": [
   "job_id",
   "profile_id"
  ],
  "read": false
 },
 {
  "suffix": "approval_refresh",
  "description": "Refresh the same native review, source bytes and principal; retain the new local revision for a later decision.",
  "properties": {
   "record_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "profile_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   }
  },
  "required": [
   "record_id"
  ],
  "read": false
 },
 {
  "suffix": "approval_save_notes",
  "description": "Save notes with the currently inspected original local revision.",
  "properties": {
   "record_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "notes": {
    "type": "string",
    "maxLength": 16000
   },
   "expected_revision": {
    "type": "integer",
    "minimum": 0,
    "maximum": 9007199254740991
   }
  },
  "required": [
   "record_id",
   "notes",
   "expected_revision"
  ],
  "read": false
 },
 {
  "suffix": "approval_request",
  "description": "Request review through the original contributor principal. Keep native request_id and complete body unchanged on recovery.",
  "properties": {
   "record_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "profile_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "notes": {
    "type": "string",
    "maxLength": 16000
   },
   "expected_revision": {
    "type": "integer",
    "minimum": 0,
    "maximum": 9007199254740991
   },
   "request_id": {
    "type": "string",
    "pattern": "^[A-Za-z0-9][A-Za-z0-9_.:-]{7,95}$"
   }
  },
  "required": [
   "record_id",
   "profile_id",
   "expected_revision",
   "request_id"
  ],
  "read": false
 },
 {
  "suffix": "approval_decide",
  "description": "Approve or reject through actual native reviewer permissions and edition/revision checks. Approval can publish the dataset.",
  "properties": {
   "record_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "profile_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   },
   "action": {
    "enum": [
     "approve",
     "reject"
    ]
   },
   "notes": {
    "type": "string",
    "maxLength": 16000
   },
   "expected_revision": {
    "type": "integer",
    "minimum": 0,
    "maximum": 9007199254740991
   },
   "request_id": {
    "type": "string",
    "pattern": "^[A-Za-z0-9][A-Za-z0-9_.:-]{7,95}$"
   }
  },
  "required": [
   "record_id",
   "profile_id",
   "action",
   "expected_revision",
   "request_id"
  ],
  "read": false
 },
 {
  "suffix": "approval_reconcile",
  "description": "Read the original saved provider operation and current complete edition after an uncertain response.",
  "properties": {
   "operation_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   }
  },
  "required": [
   "operation_id"
  ],
  "read": false
 },
 {
  "suffix": "approval_retry",
  "description": "Explicitly replay the same original provider operation key after its saved outcome has been inspected.",
  "properties": {
   "operation_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   }
  },
  "required": [
   "operation_id"
  ],
  "read": false
 },
 {
  "suffix": "approval_export",
  "description": "Export the original complete review source, delivery, observations, native operations and notes. Each original export remains distinct.",
  "properties": {
   "record_id": {
    "type": "string",
    "pattern": "^[a-f0-9]{24}$"
   }
  },
  "required": [
   "record_id"
  ],
  "read": false
 },
 {
  "suffix": "approval_restore",
  "description": "Restore the exact declared complete approval ZIP into a fresh declared destination through the original receiver.",
  "properties": {
   "sourceInput": {
    "type": "string",
    "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
   },
   "expectedSourceSha256": {
    "type": "string",
    "pattern": "^[a-f0-9]{64}$"
   },
   "destination": {
    "type": "string",
    "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
   }
  },
  "required": [
   "sourceInput",
   "expectedSourceSha256",
   "destination"
  ],
  "read": false
 }
]);
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},text=(maxLength,minLength=1)=>({type:'string',minLength,maxLength});
const sha={type:'string',pattern:'^[a-f0-9]{64}$'},id={type:'string',pattern:'^[a-f0-9]{24}$'};
const int=(minimum=0,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum,maximum}),object={type:'object'},read={readOnly:true,idempotent:true},write={readOnly:false};
const request={requestId:text(200)},page={offset:int(),limit:int(1,100)},file={fileId:sha,expectedSha256:sha};
export function catalogueDeliveryTools(tool){
 const t=(suffix,description,p={},required=['workspace'],annotations=read)=>tool('merchant_catalogue_'+suffix,description,{workspace:alias,...p},required,annotations);
 const native=NATIVE_DEFINITIONS.map(d=>t(d.suffix,d.description+(d.read?'':' The host requestId selects this exact complete installed request; it is distinct from any original native request_id.'),
  {...d.properties,...(d.read?{}:request)},['workspace',...d.required,...(d.read?[]:['requestId'])],d.read?read:write));
 return [...native,
 t('connections','List only host-declared installations, complete immutable input descriptors, producer/target/credential/destination aliases and current attachment state.',{},[]),
 t('connect','Attach to the selected existing managed listener; validate the complete private source and original catalogue contract.',{expectedLaunchId:text(200)},['workspace'],write),
 t('disconnect','Close this client and retained read handles after its accepted requests settle. Preserve the original listener and native job ownership.',{launchId:text(200)},['workspace','launchId'],write),
 t('info','Read the authenticated original managed installation, source/worker identity and declared environment names. Never return tokens or the private session capability.'),
 t('catalogue','Read and retain all original tool definitions, native resource templates and limits from the selected private application.'),
 t('browser','Return the exact original delivery, implementation or approval page of the attached listener.',{view:{type:'string',enum:['catalogue','implementation','approval']}},['workspace','view']),
 t('artifact','Retain a complete original catalogue URI or returned HTTP download, using exact full bytes and optional selected digest/count.',{
  uri:text(1024),route:text(2048),query:object,expectedSha256:sha,expectedBytes:int(),filename:text(240)},['workspace']),
 t('files','List the exact complete files retained for this original workspace/source authority.',page),
 t('file','Read complete SHA-bound retained ranges. Continue the same readId through EOF and verify the complete file.',{
  ...file,readId:text(400),offset:int(),limit:int(1,MAX_RETAINED_CHUNK_BYTES)},['workspace','fileId','expectedSha256']),
 t('file_release','Release only this original retained byte reader.',{readId:text(400)},['workspace','readId'],write),
 t('file_inspect','Inspect an exact retained JSON snapshot by pointer and bounded complete entries; full bytes remain readable.',{
  ...file,pointer:text(4000,0),offset:int(),limit:int(1,50)},['workspace','fileId','expectedSha256']),
 t('requests','Read complete retained original requests, observed responses and uncertain dispatch records; do not infer a native outcome from an HTTP status.',page),
 t('implementation_read','Read the original customer implementation, deployment or source-complete profile inspection. A profile is a declared input, never an arbitrary host path.',{
  kind:{type:'string',enum:['template','list','get','deployment','inspect']},implementationId:id,profileInput:alias,expectedSourceSha256:sha},['workspace','kind']),
 t('implementation_action','Perform one exact original customer implementation action. Source preparation uses a declared full profile; every later mutation preserves its native revision.',{
  ...request,action:{type:'string',enum:['prepare','plan','queue','adopt-job','bind-target','advance','receiving','feeds','export']},
  implementationId:id,payload:object,profileInput:alias,expectedSourceSha256:sha},['workspace','requestId','action'],write),
 t('implementation_receive','Verify and receive a declared whole original implementation archive into a fresh declared directory through its native receiver.',{
  ...request,sourceInput:alias,expectedSourceSha256:sha,destination:alias},['workspace','requestId','sourceInput','expectedSourceSha256','destination'],write)
 ];
}
