// MIT. Pure COOPS tool contracts; importing the catalog does not load a provider runtime.
import { MAX_RETAINED_CHUNK_BYTES } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';

const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPERATION = /^[A-Za-z0-9_-]{8,100}$/;
const SHORT_ID = /^[0-9a-f]{24}$/;
const PROFILE_ID = /^station-[0-9a-f]{24}$/;
const TABLES = ['observations','predictions','metadata','coverage'];
const PRODUCTS = ['water_level','hourly_height','predictions'];
const DATASET_ID = /^dataset-[0-9a-f]{24}$/;
const RELEASE_ID = /^coops-[0-9a-f]{24}$/;
const RECEIPT_FILES = ['dataset.csv','dataset.jsonl','review.html','delivery.json','manifest.json'];
const fail = (code, message) => Object.assign(new Error(message), { code });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function exact(value, fields, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !fields.includes(key)) || required.some(key => !Object.hasOwn(value, key)))
    throw fail('INVALID_PARAMS', 'Supply only the declared fields, including every required field.');
}
function checked(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw fail('INVALID_PARAMS', 'Supply a valid ' + label + '.');
  return value;
}
function integer(value, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw fail('INVALID_PARAMS', 'Integer is outside the declared range.');
  return value;
}

const string = (maximum = 200) => ({ type: 'string', maxLength: maximum });
const matching = pattern => ({ type: 'string', pattern: pattern.source });
const number = (minimum, maximum = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', minimum, maximum });
const choice = values => ({ type: 'string', enum: values });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const strings = maximum => ({ type: 'array', items: string(500), minItems: 1, maxItems: maximum });
const decimal = (minimum,maximum) => ({type:'number',minimum,maximum});
const boolean = {type:'boolean'};
const table = choice(TABLES);
const products = {type:'array',items:choice(PRODUCTS),minItems:1,maxItems:PRODUCTS.length,uniqueItems:true};
const payment = object({
  scheme: choice(['exact']), network: choice(['stellar:testnet','stellar:pubnet']), asset: string(100),
  amount: matching(/^[1-9][0-9]*$/), payTo: string(100), maxTimeoutSeconds: number(1,86400)
}, ['scheme','network','asset','amount','payTo','maxTimeoutSeconds']);
const nativeQuery = string(8192);
const id = matching(SHORT_ID), edition = matching(SHA), dataset = matching(DATASET_ID), release = matching(RELEASE_ID);
const actions = [
  [
    "station.save",
    "Save an original NOAA station profile and responsible team; retain prior profile values.",
    {
      "profileId": {
        "type": "string",
        "pattern": "^station-[0-9a-f]{24}$"
      },
      "stationId": {
        "type": "string",
        "pattern": "^[0-9]{7}$"
      },
      "label": {
        "type": "string",
        "maxLength": 160
      },
      "owner": {
        "type": "string",
        "maxLength": 200
      },
      "note": {
        "type": "string",
        "maxLength": 12000
      },
      "active": {
        "type": "boolean"
      }
    },
    [
      "stationId",
      "label"
    ]
  ],
  [
    "station.archive",
    "Archive a profile while preserving original sources, reviews and releases.",
    {
      "profileId": {
        "type": "string",
        "pattern": "^station-[0-9a-f]{24}$"
      }
    },
    [
      "profileId"
    ],
    {
      "destructive": true
    }
  ],
  [
    "capture.preview",
    "Retain and inspect the exact original NOAA source URLs and source basis before capture.",
    {
      "profileId": {
        "type": "string",
        "pattern": "^station-[0-9a-f]{24}$"
      },
      "label": {
        "type": "string",
        "maxLength": 200
      },
      "products": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "water_level",
            "hourly_height",
            "predictions"
          ]
        },
        "minItems": 1,
        "maxItems": 3,
        "uniqueItems": true
      },
      "beginDate": {
        "type": "string",
        "maxLength": 10
      },
      "endDate": {
        "type": "string",
        "maxLength": 10
      },
      "units": {
        "type": "string",
        "enum": [
          "metric",
          "english"
        ]
      },
      "timeZone": {
        "type": "string",
        "enum": [
          "gmt",
          "lst",
          "lst_ldt"
        ]
      },
      "datum": {
        "type": "string",
        "enum": [
          "MLLW",
          "MHHW",
          "MHW",
          "MTL",
          "MSL",
          "MLW",
          "NAVD",
          "STND",
          "IGLD",
          "LWD",
          "CRD"
        ]
      },
      "predictionInterval": {
        "type": "string",
        "enum": [
          "6",
          "h",
          "hilo"
        ]
      }
    },
    [
      "profileId",
      "products",
      "beginDate",
      "endDate",
      "units",
      "timeZone",
      "datum"
    ]
  ],
  [
    "capture.start",
    "Start one explicit source edition with original metadata and bounded source requests.",
    {
      "profileId": {
        "type": "string",
        "pattern": "^station-[0-9a-f]{24}$"
      },
      "label": {
        "type": "string",
        "maxLength": 200
      },
      "products": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "water_level",
            "hourly_height",
            "predictions"
          ]
        },
        "minItems": 1,
        "maxItems": 3,
        "uniqueItems": true
      },
      "beginDate": {
        "type": "string",
        "maxLength": 10
      },
      "endDate": {
        "type": "string",
        "maxLength": 10
      },
      "units": {
        "type": "string",
        "enum": [
          "metric",
          "english"
        ]
      },
      "timeZone": {
        "type": "string",
        "enum": [
          "gmt",
          "lst",
          "lst_ldt"
        ]
      },
      "datum": {
        "type": "string",
        "enum": [
          "MLLW",
          "MHHW",
          "MHW",
          "MTL",
          "MSL",
          "MLW",
          "NAVD",
          "STND",
          "IGLD",
          "LWD",
          "CRD"
        ]
      },
      "predictionInterval": {
        "type": "string",
        "enum": [
          "6",
          "h",
          "hilo"
        ]
      }
    },
    [
      "profileId",
      "products",
      "beginDate",
      "endDate",
      "units",
      "timeZone",
      "datum"
    ],
    {
      "openWorld": true
    }
  ],
  [
    "capture.resume",
    "Continue the original unfinished capture; reuse accepted response checkpoints.",
    {
      "captureId": {
        "type": "string",
        "pattern": "^[0-9a-f]{24}$"
      }
    },
    [
      "captureId"
    ],
    {
      "openWorld": true
    }
  ],
  [
    "capture.pause",
    "Pause the original capture while preserving its source response checkpoints.",
    {
      "captureId": {
        "type": "string",
        "pattern": "^[0-9a-f]{24}$"
      }
    },
    [
      "captureId"
    ]
  ],
  [
    "capture.import",
    "Import an exact host-declared coastal source package; preserve original response bytes and source identity.",
    {
      "profileId": {
        "type": "string",
        "pattern": "^station-[0-9a-f]{24}$"
      },
      "label": {
        "type": "string",
        "maxLength": 200
      },
      "sourcePackage": {
        "type": "string",
        "pattern": "^[a-z0-9][a-z0-9_-]{0,63}$"
      }
    },
    [
      "profileId",
      "sourcePackage"
    ]
  ],
  [
    "backfill.preview",
    "Review a source study of at most five years as original nonoverlapping annual source editions.",
    {
      "profileId": {
        "type": "string",
        "pattern": "^station-[0-9a-f]{24}$"
      },
      "label": {
        "type": "string",
        "maxLength": 200
      },
      "products": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "water_level",
            "hourly_height",
            "predictions"
          ]
        },
        "minItems": 1,
        "maxItems": 3,
        "uniqueItems": true
      },
      "beginDate": {
        "type": "string",
        "maxLength": 10
      },
      "endDate": {
        "type": "string",
        "maxLength": 10
      },
      "units": {
        "type": "string",
        "enum": [
          "metric",
          "english"
        ]
      },
      "timeZone": {
        "type": "string",
        "enum": [
          "gmt",
          "lst",
          "lst_ldt"
        ]
      },
      "datum": {
        "type": "string",
        "enum": [
          "MLLW",
          "MHHW",
          "MHW",
          "MTL",
          "MSL",
          "MLW",
          "NAVD",
          "STND",
          "IGLD",
          "LWD",
          "CRD"
        ]
      },
      "predictionInterval": {
        "type": "string",
        "enum": [
          "6",
          "h",
          "hilo"
        ]
      }
    },
    [
      "profileId",
      "products",
      "beginDate",
      "endDate",
      "units",
      "timeZone",
      "datum"
    ]
  ],
  [
    "backfill.start",
    "Start the reviewed historical study using sequential original annual capture editions.",
    {
      "profileId": {
        "type": "string",
        "pattern": "^station-[0-9a-f]{24}$"
      },
      "label": {
        "type": "string",
        "maxLength": 200
      },
      "products": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "water_level",
            "hourly_height",
            "predictions"
          ]
        },
        "minItems": 1,
        "maxItems": 3,
        "uniqueItems": true
      },
      "beginDate": {
        "type": "string",
        "maxLength": 10
      },
      "endDate": {
        "type": "string",
        "maxLength": 10
      },
      "units": {
        "type": "string",
        "enum": [
          "metric",
          "english"
        ]
      },
      "timeZone": {
        "type": "string",
        "enum": [
          "gmt",
          "lst",
          "lst_ldt"
        ]
      },
      "datum": {
        "type": "string",
        "enum": [
          "MLLW",
          "MHHW",
          "MHW",
          "MTL",
          "MSL",
          "MLW",
          "NAVD",
          "STND",
          "IGLD",
          "LWD",
          "CRD"
        ]
      },
      "predictionInterval": {
        "type": "string",
        "enum": [
          "6",
          "h",
          "hilo"
        ]
      }
    },
    [
      "profileId",
      "products",
      "beginDate",
      "endDate",
      "units",
      "timeZone",
      "datum"
    ],
    {
      "openWorld": true
    }
  ],
  [
    "backfill.resume",
    "Continue the same original historical study from its unfinished source partition.",
    {
      "backfillId": {
        "type": "string",
        "pattern": "^[0-9a-f]{24}$"
      }
    },
    [
      "backfillId"
    ],
    {
      "openWorld": true
    }
  ],
  [
    "backfill.pause",
    "Pause this original historical study and its current source request.",
    {
      "backfillId": {
        "type": "string",
        "pattern": "^[0-9a-f]{24}$"
      }
    },
    [
      "backfillId"
    ]
  ],
  [
    "backfill.export",
    "Retain a streamed combined CSV, JSON or JSONL with exact original child-edition and mapping pins.",
    {
      "backfillId": {
        "type": "string",
        "pattern": "^[0-9a-f]{24}$"
      },
      "table": {
        "type": "string",
        "enum": [
          "observations",
          "predictions",
          "metadata",
          "coverage"
        ]
      },
      "format": {
        "type": "string",
        "enum": [
          "csv",
          "json",
          "jsonl"
        ]
      },
      "mappingId": {
        "type": "string",
        "pattern": "^mapping-[0-9a-f]{24}$"
      }
    },
    [
      "backfillId",
      "table",
      "format"
    ]
  ],
  [
    "mapping.save",
    "Save an explicit original-field to model-input-heading mapping, retaining source row identities.",
    {
      "mappingId": {
        "type": "string",
        "pattern": "^mapping-[0-9a-f]{24}$"
      },
      "name": {
        "type": "string",
        "maxLength": 160
      },
      "table": {
        "type": "string",
        "enum": [
          "observations",
          "predictions"
        ]
      },
      "columns": {
        "type": "array",
        "minItems": 3,
        "maxItems": 64,
        "items": {
          "type": "object",
          "properties": {
            "source": {
              "type": "string",
              "maxLength": 100
            },
            "heading": {
              "type": "string",
              "maxLength": 100
            }
          },
          "required": [
            "source",
            "heading"
          ],
          "additionalProperties": false
        }
      },
      "note": {
        "type": "string",
        "maxLength": 12000
      }
    },
    [
      "name",
      "table",
      "columns",
      "note"
    ]
  ],
  [
    "edition.select",
    "Select a retained immutable source edition.",
    {
      "editionId": {
        "type": "string",
        "pattern": "^[0-9a-f]{64}$"
      }
    },
    [
      "editionId"
    ]
  ],
  [
    "edition.compare",
    "Retain source changes and scope differences between compatible original editions.",
    {
      "leftId": {
        "type": "string",
        "pattern": "^[0-9a-f]{64}$"
      },
      "rightId": {
        "type": "string",
        "pattern": "^[0-9a-f]{64}$"
      },
      "table": {
        "type": "string",
        "enum": [
          "observations",
          "predictions",
          "metadata",
          "coverage"
        ]
      }
    },
    [
      "leftId",
      "rightId",
      "table"
    ]
  ],
  [
    "annotation.save",
    "Save source-linked review and retain its earlier decisions.",
    {
      "editionId": {
        "type": "string",
        "pattern": "^[0-9a-f]{64}$"
      },
      "subject": {
        "type": "string",
        "maxLength": 300
      },
      "note": {
        "type": "string",
        "maxLength": 12000
      },
      "status": {
        "type": "string",
        "enum": [
          "open",
          "reviewed",
          "follow_up"
        ]
      }
    },
    [
      "editionId",
      "subject",
      "note",
      "status"
    ]
  ],
  [
    "dataset.prepare",
    "Prepare a selected original source table/window through native SF30.",
    {
      "editionId": {
        "type": "string",
        "pattern": "^[0-9a-f]{64}$"
      },
      "table": {
        "type": "string",
        "enum": [
          "observations",
          "predictions",
          "metadata",
          "coverage"
        ]
      },
      "name": {
        "type": "string",
        "maxLength": 128
      },
      "beginDate": {
        "type": "string",
        "maxLength": 10
      },
      "endDate": {
        "type": "string",
        "maxLength": 10
      },
      "products": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "water_level",
            "hourly_height",
            "predictions"
          ]
        },
        "minItems": 1,
        "maxItems": 3,
        "uniqueItems": true
      }
    },
    [
      "editionId",
      "table",
      "name"
    ]
  ],
  [
    "dataset.query",
    "Query the original SF30 dataset with its native URL-encoded query and cursor.",
    {
      "datasetId": {
        "type": "string",
        "pattern": "^dataset-[0-9a-f]{24}$"
      },
      "query": {
        "type": "string",
        "maxLength": 8192
      }
    },
    [
      "datasetId"
    ]
  ],
  [
    "release.prepare",
    "Prepare the original SF82 publisher with explicit reviewed payment terms.",
    {
      "datasetId": {
        "type": "string",
        "pattern": "^dataset-[0-9a-f]{24}$"
      },
      "origin": {
        "type": "string",
        "maxLength": 2048
      },
      "path": {
        "type": "string",
        "maxLength": 1024
      },
      "payment": {
        "type": "object",
        "properties": {
          "scheme": {
            "type": "string",
            "enum": [
              "exact"
            ]
          },
          "network": {
            "type": "string",
            "enum": [
              "stellar:testnet",
              "stellar:pubnet"
            ]
          },
          "asset": {
            "type": "string",
            "maxLength": 100
          },
          "amount": {
            "type": "string",
            "pattern": "^[1-9][0-9]*$"
          },
          "payTo": {
            "type": "string",
            "maxLength": 100
          },
          "maxTimeoutSeconds": {
            "type": "integer",
            "minimum": 1,
            "maximum": 86400
          }
        },
        "required": [
          "scheme",
          "network",
          "asset",
          "amount",
          "payTo",
          "maxTimeoutSeconds"
        ],
        "additionalProperties": false
      }
    },
    [
      "datasetId",
      "origin",
      "payment"
    ]
  ],
  [
    "release.inspect",
    "Inspect the original publisher and actual generation.",
    {
      "releaseId": {
        "type": "string",
        "pattern": "^coops-[0-9a-f]{24}$"
      }
    },
    [
      "releaseId"
    ]
  ],
  [
    "release.activate",
    "Activate the original selected publisher at its reviewed generation.",
    {
      "releaseId": {
        "type": "string",
        "pattern": "^coops-[0-9a-f]{24}$"
      },
      "expectedGeneration": {
        "type": "integer",
        "minimum": 0,
        "maximum": 9007199254740991
      }
    },
    [
      "releaseId",
      "expectedGeneration"
    ],
    {
      "destructive": true
    }
  ],
  [
    "release.start",
    "Start the original publisher under its actual configured payment runtime.",
    {
      "releaseId": {
        "type": "string",
        "pattern": "^coops-[0-9a-f]{24}$"
      },
      "expectedGeneration": {
        "type": "integer",
        "minimum": 0,
        "maximum": 9007199254740991
      }
    },
    [
      "releaseId",
      "expectedGeneration"
    ],
    {
      "openWorld": true
    }
  ],
  [
    "release.stop",
    "Stop the original workspace-owned publisher while preserving its source and receipts.",
    {
      "releaseId": {
        "type": "string",
        "pattern": "^coops-[0-9a-f]{24}$"
      }
    },
    [
      "releaseId"
    ],
    {
      "destructive": true
    }
  ],
  [
    "release.rollback",
    "Select the native previous release at its reviewed generation.",
    {
      "releaseId": {
        "type": "string",
        "pattern": "^coops-[0-9a-f]{24}$"
      },
      "expectedGeneration": {
        "type": "integer",
        "minimum": 0,
        "maximum": 9007199254740991
      }
    },
    [
      "releaseId",
      "expectedGeneration"
    ],
    {
      "destructive": true
    }
  ],
  [
    "buyer.inspect",
    "Inspect actual ordered SF88 page intents from the host-selected inbox.",
    {
      "intentIds": {
        "type": "array",
        "items": {
          "type": "string",
          "maxLength": 500
        },
        "minItems": 1,
        "maxItems": 1000
      }
    },
    [
      "intentIds"
    ]
  ],
  [
    "buyer.receive",
    "Receive original completed pages through SF100 and retain all original customer files.",
    {
      "intentIds": {
        "type": "array",
        "items": {
          "type": "string",
          "maxLength": 500
        },
        "minItems": 1,
        "maxItems": 1000
      }
    },
    [
      "intentIds"
    ]
  ],
  [
    "export.create",
    "Retain an original edition CSV, JSON, JSONL, report or complete source package, with source reviews.",
    {
      "editionId": {
        "type": "string",
        "pattern": "^[0-9a-f]{64}$"
      },
      "table": {
        "type": "string",
        "enum": [
          "observations",
          "predictions",
          "metadata",
          "coverage"
        ]
      },
      "format": {
        "type": "string",
        "enum": [
          "json",
          "jsonl",
          "csv",
          "report",
          "source-package"
        ]
      },
      "mappingId": {
        "type": "string",
        "pattern": "^mapping-[0-9a-f]{24}$"
      }
    },
    [
      "editionId",
      "format"
    ]
  ]
];
const actionNames = new Map(actions.map(value => ['merchant_coops_' + value[0].replaceAll('.','_'), value]));
const scope = {workspace:matching(ALIAS)};
const readOnly = {readOnly:true,idempotent:true};
const selectFile = {
  kind:choice(['source','capture-source','export','receipt']), id:string(100), page:number(0), file:choice(RECEIPT_FILES)
};
const chunks = {
  readId:matching(UUID), expectedSha256:matching(SHA), offset:number(0),
  limit:number(1,MAX_RETAINED_CHUNK_BYTES)
};
export function coopsWorkspaceTools(tool) {
  return [
    tool('merchant_coops_workspaces','List host-declared COOPS aliases and their original workspace UUIDs; report only this adapter’s retained download sessions.',{},[],readOnly),
    tool('merchant_coops_schema','Read the running original workspace schema, actual source contract, station/product/table declarations, payment fields and capabilities.',scope,['workspace'],readOnly),
    tool('merchant_coops_view','Read the same browser workspace and its current revision, captures, latest editions, all releases/receipts/exports and recent operation outcomes.',scope,['workspace'],readOnly),
    tool('merchant_coops_operation','Read one original operation by its retained operationId, including its recorded state and complete saved result. This does not redispatch it.',{...scope,operationId:matching(OPERATION)},['workspace','operationId'],readOnly),
    tool('merchant_coops_editions','Page the complete original edition archive. Retain the returned revision for every following page; a concurrent change returns REVISION_CHANGED.',{...scope,offset:number(0),limit:number(1,500),profileId:matching(PROFILE_ID),expectedRevision:number(0)},['workspace'],readOnly),
    tool('merchant_coops_edition','Read one complete immutable original edition, including every response receipt and exact source SHA256.',{...scope,editionId:edition},['workspace','editionId'],readOnly),
    tool('merchant_coops_rows','Page normalized original rows from one immutable edition. Original nulls, datum, units, quality flags and source times are retained; nextOffset continues the same edition and table.',{...scope,editionId:edition,table,offset:number(0),limit:number(1,500),beginDate:string(10),endDate:string(10),products},['workspace','editionId','table'],readOnly),
    tool('merchant_coops_files','Read exact file metadata and selectors for an original edition’s source responses, one retained export, or one complete five-file customer receipt.',{...scope,kind:selectFile.kind,id:selectFile.id},['workspace','kind','id'],readOnly),
    tool('merchant_coops_file_read','Read an original source/export/customer file as verified base64 byte chunks. Continue the same selector, readId, expectedSha256 and nextOffset. A retained read can finish after the console closes.',{...scope,...selectFile,...chunks},['workspace','kind','id'],readOnly),
    tool('merchant_coops_file_release','Release only the named temporary download snapshot; preserve original workspace source and customer files.',{...scope,readId:matching(UUID)},['workspace','readId'],{idempotent:true}),
    ...actions.map(([action, description, properties, required, annotations = {}]) =>
      tool('merchant_coops_' + action.replaceAll('.','_'),
        description + ' Supply the current revision and a stable operationId. Repeat the exact same request after an interrupted reply; the native journal reconciles it before checking the revision. Check ok and native state before continuing.',
        {...scope,operationId:matching(OPERATION),expectedRevision:number(0),...properties},
        ['workspace','operationId','expectedRevision',...required],{idempotent:true,...annotations}))
  ];
}
const definitions = new Map(coopsWorkspaceTools((name,description,properties,required) => ({name,properties,required})).map(item=>[item.name,item]));
function validate(value, schema, path) {
  if (schema.type === 'object') {
    if (!plain(value)) throw fail('INVALID_PARAMS', path + ' must be an object.');
    if (schema.additionalProperties === false) exact(value,Object.keys(schema.properties ?? {}),schema.required ?? []);
    for (const required of schema.required ?? []) if (!Object.hasOwn(value,required)) throw fail('INVALID_PARAMS',path+' requires '+required+'.');
    for (const [key, item] of Object.entries(value)) {
      const field = schema.properties?.[key] ?? (plain(schema.additionalProperties) ? schema.additionalProperties : null);
      if (field) validate(item,field,path+'.'+key);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity))
      throw fail('INVALID_PARAMS',path+' has an invalid item count.');
    if (schema.uniqueItems && new Set(value.map(item=>JSON.stringify(item))).size !== value.length)
      throw fail('INVALID_PARAMS',path+' requires distinct values.');
    for (const item of value) validate(item,schema.items,path+'[]');
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw fail('INVALID_PARAMS',path+' must be a boolean.');
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < schema.minimum || value > schema.maximum)
      throw fail('INVALID_PARAMS',path+' must be a number in the declared range.');
  } else if (schema.type === 'integer') integer(value,schema.minimum ?? 0,schema.maximum);
  else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length > (schema.maxLength ?? Infinity) || value.length < (schema.minLength ?? 0) ||
        schema.enum && !schema.enum.includes(value) || schema.pattern && !new RegExp(schema.pattern).test(value))
      throw fail('INVALID_PARAMS',path+' does not match the declared text field.');
  }
}

export { actionNames as coopsActionNames, definitions as coopsToolDefinitions, validate as validateCoopsToolField };
