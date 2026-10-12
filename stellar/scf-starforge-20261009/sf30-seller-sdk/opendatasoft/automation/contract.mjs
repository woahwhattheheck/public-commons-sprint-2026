// MIT. Original SDK contract plus the current official-reference corrections in current-reference.json.
function freeze(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
export const AUTOMATION_SOURCE = freeze({
  "schema": "stellar-forge.opendatasoft-automation-source.v1",
  "officialRepository": "opendatasoft/opendatasoft-automation-sdk",
  "commit": "d8111887796815a7a2cf0755033a809b0f3f757e",
  "specPath": "generators/python/openapi/openapi_3.1.0_original.json",
  "specBlob": "568f4b4b3b9414dc404ea8fac83f35bfabf6bfcd",
  "specBytes": 461135,
  "specSha256": "27065299b52ec6c8e71272981f912107ff6931d1276fab7bb15a5a0de1de7d3b",
  "liveDocumentation": "https://developer.huwise.com/apis/automation/v1.0/index.html",
  "reviewedAt": "2026-10-12",
  "apiVersion": "1.0",
  "apiPrefix": "/api/automation/v1.0",
  "operationCount": 92,
  "legacyDocumentation": "https://help.opendatasoft.com/apis/ods-automation-v1/",
  "currentReference": {
    "path": "current-reference.json",
    "bytes": 7598,
    "sha256": "d9f084bfdf358093776bca18df95186c2e9c8badd865ee80641387fd356821da"
  },
  "contractBasis": "retained-official-sdk-with-current-official-reference",
  "operationAliasCount": 1
});
export const AUTOMATION_API_PREFIX = '/api/automation/v1.0';
export const AUTOMATION_OPERATIONS = freeze({
  "list-datasets": {
    "method": "GET",
    "path": "/datasets/",
    "name": "listDatasets",
    "params": {},
    "query": {
      "limit": {
        "type": "integer",
        "maximum": 1000,
        "minimum": 0,
        "default": 20,
        "description": "The maximum number of results returned by the API when the response is paginated. Tip: You can make a request with the parameter \"limit\" set to 0 to get only the metadata (\"results\" property will contain an empty array)."
      },
      "offset": {
        "type": "integer",
        "description": "The number of results to skip before beginning the listing in case of a paginated response"
      },
      "dataset_id": {
        "type": "string",
        "description": "Find a dataset from its `dataset_id`"
      }
    },
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": true
  },
  "create-dataset": {
    "method": "POST",
    "path": "/datasets/",
    "name": "createDataset",
    "params": {},
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/Dataset"
    },
    "success": [
      201
    ],
    "response": "json",
    "effect": "write",
    "paginated": false,
    "responseSchema": {
      "$ref": "#/components/schemas/Dataset"
    }
  },
  "retrieve-dataset": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/",
    "name": "getDataset",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false,
    "responseSchema": {
      "$ref": "#/components/schemas/Dataset"
    }
  },
  "update-dataset": {
    "method": "PUT",
    "path": "/datasets/{dataset_uid}/",
    "name": "updateDataset",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/DatasetUpdate"
    },
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false,
    "forbiddenBodyFields": {
      "metadata": "Use update-all-dataset-metadata to replace the complete reviewed metadata dictionary."
    },
    "responseSchema": {
      "$ref": "#/components/schemas/Dataset"
    }
  },
  "delete-dataset": {
    "method": "DELETE",
    "path": "/datasets/{dataset_uid}/",
    "name": "deleteDataset",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      204
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "publish-dataset": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/publish/",
    "name": "publishDataset",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "action",
    "paginated": false
  },
  "publish-dataset-metadata": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/publish_metadata/",
    "name": "publishDatasetMetadata",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "action",
    "paginated": false
  },
  "abort-dataset": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/abort/",
    "name": "abortDataset",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "action",
    "paginated": false
  },
  "unpublish-dataset": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/unpublish/",
    "name": "unpublishDataset",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "action",
    "paginated": false
  },
  "copy-dataset": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/copy/",
    "name": "copyDataset",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      201
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "get-dataset-status": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/status/",
    "name": "getDatasetStatus",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "list-dataset-feedbacks": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/feedbacks/",
    "name": "listFeedbacks",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {
      "record_id": {
        "type": "string",
        "description": "Find feedbacks made on a record with this id"
      },
      "is_archived": {
        "type": "boolean",
        "default": 0,
        "description": "If true, list only archived feedbacks"
      },
      "sort": {
        "type": "string",
        "default": "-created_at",
        "example": [
          "created_at"
        ],
        "description": "Sort by date of submission"
      }
    },
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": true
  },
  "retrieve-dataset-feedback": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/feedbacks/{feedback_uid}/",
    "name": "getFeedback",
    "params": {
      "dataset_uid": "datasetUid",
      "feedback_uid": "feedbackUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "archive-dataset-feedback": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/feedbacks/{feedback_uid}/archive/",
    "name": "archiveFeedback",
    "params": {
      "dataset_uid": "datasetUid",
      "feedback_uid": "feedbackUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "list-dataset-field-configurations": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/fields/",
    "name": "listFields",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": true
  },
  "create-dataset-field-configurations": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/fields/",
    "name": "createField",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/DatasetFieldConfiguration"
    },
    "success": [
      201
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "retrieve-dataset-field-configuration": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/fields/{field_uid}/",
    "name": "getField",
    "params": {
      "dataset_uid": "datasetUid",
      "field_uid": "fieldUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "update-dataset-field": {
    "method": "PUT",
    "path": "/datasets/{dataset_uid}/fields/{field_uid}/",
    "name": "updateField",
    "params": {
      "dataset_uid": "datasetUid",
      "field_uid": "fieldUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/DatasetFieldConfiguration"
    },
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "destroy-dataset-field-configurations": {
    "method": "DELETE",
    "path": "/datasets/{dataset_uid}/fields/{field_uid}/",
    "name": "deleteField",
    "params": {
      "dataset_uid": "datasetUid",
      "field_uid": "fieldUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      204
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "list-dataset-processors": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/processors/",
    "name": "listProcessors",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": true
  },
  "create-dataset-processor": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/processors/",
    "name": "createProcessor",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/DatasetProcessor"
    },
    "success": [
      201
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "retrieve-dataset-processor": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/processors/{processor_uid}/",
    "name": "getProcessor",
    "params": {
      "dataset_uid": "datasetUid",
      "processor_uid": "processorUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "update-dataset-processor": {
    "method": "PUT",
    "path": "/datasets/{dataset_uid}/processors/{processor_uid}/",
    "name": "updateProcessor",
    "params": {
      "dataset_uid": "datasetUid",
      "processor_uid": "processorUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/DatasetProcessor"
    },
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "delete-dataset-processor": {
    "method": "DELETE",
    "path": "/datasets/{dataset_uid}/processors/{processor_uid}/",
    "name": "deleteProcessor",
    "params": {
      "dataset_uid": "datasetUid",
      "processor_uid": "processorUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      204
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "list-extractors": {
    "method": "GET",
    "path": "/extractors/",
    "name": "listExtractors",
    "params": {},
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "list-dataset-resources": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/resources/",
    "name": "listResources",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {
      "limit": {
        "type": "integer",
        "maximum": 1000,
        "minimum": 0,
        "default": 20,
        "description": "The maximum number of results returned by the API when the response is paginated. Tip: You can make a request with the parameter \"limit\" set to 0 to get only the metadata (\"results\" property will contain an empty array)."
      },
      "offset": {
        "type": "integer",
        "description": "The number of results to skip before beginning the listing in case of a paginated response"
      },
      "expand": {
        "type": "string",
        "enum": [
          "datasource.connection",
          "datasource.dataset"
        ],
        "description": "The list of fields to expand."
      }
    },
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": true
  },
  "create-dataset-resource": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/resources/",
    "name": "createResource",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/Resource"
    },
    "success": [
      201
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "guess-unsaved-resource-extractors": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/resources/guess_extractors/",
    "name": "guessExtractors",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "type": "object",
      "properties": {
        "datasource": {
          "$ref": "#/components/schemas/Datasource"
        }
      },
      "required": [
        "datasource"
      ]
    },
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "guess-unsaved-resource-extractor-params": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/resources/guess_extractor_params/",
    "name": "guessExtractorParams",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "type": "object",
      "properties": {
        "datasource": {
          "$ref": "#/components/schemas/Datasource"
        },
        "type": {
          "type": "string",
          "example": "csvfile"
        }
      },
      "required": [
        "type",
        "datasource"
      ]
    },
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "resource-unsaved-preview": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/resources/preview/",
    "name": "previewResourceInput",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "type": "object",
      "properties": {
        "datasource": {
          "$ref": "#/components/schemas/Datasource"
        },
        "type": {
          "type": "string",
          "example": "csvfile"
        },
        "params": {
          "type": "object",
          "additionalProperties": true,
          "example": {
            "doublequote": true,
            "encoding": "utf-8",
            "first_row_no": 1,
            "headers_first_row": true,
            "separator": ";"
          }
        }
      },
      "required": [
        "type",
        "datasource"
      ]
    },
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "retrieve-dataset-resource": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/resources/{resource_uid}/",
    "name": "getResource",
    "params": {
      "dataset_uid": "datasetUid",
      "resource_uid": "resourceUid"
    },
    "query": {
      "expand": {
        "type": "string",
        "enum": [
          "datasource.connection",
          "datasource.dataset"
        ],
        "description": "The list of fields to expand."
      }
    },
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "update-dataset-resource": {
    "method": "PUT",
    "path": "/datasets/{dataset_uid}/resources/{resource_uid}/",
    "name": "updateResource",
    "params": {
      "dataset_uid": "datasetUid",
      "resource_uid": "resourceUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/Resource"
    },
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "delete-dataset-resource": {
    "method": "DELETE",
    "path": "/datasets/{dataset_uid}/resources/{resource_uid}/",
    "name": "deleteResource",
    "params": {
      "dataset_uid": "datasetUid",
      "resource_uid": "resourceUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      204
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "resource-guess-extractors": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/resources/{resource_uid}/guess_extractors/",
    "name": "guessSavedResourceExtractors",
    "params": {
      "dataset_uid": "datasetUid",
      "resource_uid": "resourceUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "clean-resource-cache": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/resources/{resource_uid}/clean_cache/",
    "name": "clearResourceCache",
    "params": {
      "dataset_uid": "datasetUid",
      "resource_uid": "resourceUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      204
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "resource-guess-extractor-params": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/resources/{resource_uid}/guess_extractors_params/",
    "name": "guessSavedResourceExtractorParams",
    "params": {
      "dataset_uid": "datasetUid",
      "resource_uid": "resourceUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "resource-preview": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/resources/{resource_uid}/preview/",
    "name": "previewResource",
    "params": {
      "dataset_uid": "datasetUid",
      "resource_uid": "resourceUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "recover-resource": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/resources/{resource_uid}/recover/",
    "name": "recoverResource",
    "params": {
      "dataset_uid": "datasetUid",
      "resource_uid": "resourceUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "action",
    "paginated": false
  },
  "delete-recover-data-resource": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/resources/{resource_uid}/delete_recover_data/",
    "name": "deleteRecoveredResourceData",
    "params": {
      "dataset_uid": "datasetUid",
      "resource_uid": "resourceUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "action",
    "paginated": false
  },
  "enable-resource": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/resources/{resource_uid}/enable/",
    "name": "enableResource",
    "params": {
      "dataset_uid": "datasetUid",
      "resource_uid": "resourceUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "disable-resource": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/resources/{resource_uid}/disable/",
    "name": "disableResource",
    "params": {
      "dataset_uid": "datasetUid",
      "resource_uid": "resourceUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "resource-renew-api-key": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/resources/{resource_uid}/renew_api_key/",
    "name": "renewResourceApiKey",
    "params": {
      "dataset_uid": "datasetUid",
      "resource_uid": "resourceUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "upload-resource-file": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/resources/files/",
    "name": "uploadFile",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": "multipart",
    "bodySchema": {
      "type": "object",
      "properties": {
        "file": {
          "type": "string",
          "format": "binary"
        }
      },
      "required": [
        "file"
      ]
    },
    "success": [
      201,
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false,
    "successAuthority": {
      "200": "retained-official-sdk",
      "201": "current-official-documentation"
    },
    "responseSchema": {
      "$ref": "#/components/schemas/DatasetFile"
    }
  },
  "retrieve-dataset-resource-file": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/resources/files/{file_uid}/",
    "name": "getFile",
    "params": {
      "dataset_uid": "datasetUid",
      "file_uid": "fileUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "download-dataset-resource-file": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/resources/files/{file_uid}/download/",
    "name": "downloadFile",
    "params": {
      "dataset_uid": "datasetUid",
      "file_uid": "fileUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "binary",
    "effect": "read",
    "paginated": false
  },
  "list-dataset-attachments": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/attachments/",
    "name": "listAttachments",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {
      "limit": {
        "type": "integer",
        "maximum": 1000,
        "minimum": 0,
        "default": 20,
        "description": "The maximum number of results returned by the API when the response is paginated. Tip: You can make a request with the parameter \"limit\" set to 0 to get only the metadata (\"results\" property will contain an empty array)."
      },
      "offset": {
        "type": "integer",
        "description": "The number of results to skip before beginning the listing in case of a paginated response"
      }
    },
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": true
  },
  "create-dataset-attachment": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/attachments/",
    "name": "uploadAttachment",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": "multipart",
    "bodySchema": {
      "type": "object",
      "properties": {
        "file": {
          "type": "string",
          "format": "binary"
        }
      },
      "required": [
        "file"
      ]
    },
    "success": [
      201
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "retrieve-dataset-attachment": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/attachments/{attachment_uid}/",
    "name": "getAttachment",
    "params": {
      "dataset_uid": "datasetUid",
      "attachment_uid": "attachmentUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "delete-dataset-attachment": {
    "method": "DELETE",
    "path": "/datasets/{dataset_uid}/attachments/{attachment_uid}/",
    "name": "deleteAttachment",
    "params": {
      "dataset_uid": "datasetUid",
      "attachment_uid": "attachmentUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      204
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "download-dataset-attachment": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/attachments/{attachment_uid}/download/",
    "name": "downloadAttachment",
    "params": {
      "dataset_uid": "datasetUid",
      "attachment_uid": "attachmentUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "binary",
    "effect": "read",
    "paginated": false
  },
  "list-dataset-alternative-exports": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/alternative_exports/",
    "name": "listAlternativeExports",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {
      "limit": {
        "type": "integer",
        "maximum": 1000,
        "minimum": 0,
        "default": 20,
        "description": "The maximum number of results returned by the API when the response is paginated. Tip: You can make a request with the parameter \"limit\" set to 0 to get only the metadata (\"results\" property will contain an empty array)."
      },
      "offset": {
        "type": "integer",
        "description": "The number of results to skip before beginning the listing in case of a paginated response"
      }
    },
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": true
  },
  "create-dataset-alternative-export": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/alternative_exports/",
    "name": "createAlternativeExport",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": "multipart",
    "bodySchema": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string",
          "minLength": 1
        },
        "type": {
          "type": "string",
          "enum": [
            "uploaded_file"
          ]
        },
        "file": {
          "type": "string",
          "format": "binary"
        },
        "description": {
          "type": "string"
        }
      },
      "required": [
        "type",
        "title",
        "file"
      ]
    },
    "success": [
      201
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "retrieve-dataset-alternative-export": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/alternative_exports/{export_uid}/",
    "name": "getAlternativeExport",
    "params": {
      "dataset_uid": "datasetUid",
      "export_uid": "exportUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "update-dataset-alternative-export": {
    "method": "PUT",
    "path": "/datasets/{dataset_uid}/alternative_exports/{export_uid}/",
    "name": "updateAlternativeExport",
    "params": {
      "dataset_uid": "datasetUid",
      "export_uid": "exportUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string",
          "minLength": 1
        },
        "type": {
          "type": "string",
          "enum": [
            "uploaded_file"
          ]
        },
        "description": {
          "type": "string"
        }
      },
      "required": [
        "title",
        "type"
      ]
    },
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "delete-dataset-alternative-export": {
    "method": "DELETE",
    "path": "/datasets/{dataset_uid}/alternative_exports/{export_uid}/",
    "name": "deleteAlternativeExport",
    "params": {
      "dataset_uid": "datasetUid",
      "export_uid": "exportUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      204
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "download-dataset-alternative_exports": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/alternative_exports/{export_uid}/download/",
    "name": "downloadAlternativeExport",
    "params": {
      "dataset_uid": "datasetUid",
      "export_uid": "exportUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200,
      303
    ],
    "response": "binary",
    "effect": "read",
    "paginated": false
  },
  "list-dataset-user-security": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/security/users/",
    "name": "listUserSecurity",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {
      "limit": {
        "type": "integer",
        "maximum": 1000,
        "minimum": 0,
        "default": 20,
        "description": "The maximum number of results returned by the API when the response is paginated. Tip: You can make a request with the parameter \"limit\" set to 0 to get only the metadata (\"results\" property will contain an empty array)."
      },
      "offset": {
        "type": "integer",
        "description": "The number of results to skip before beginning the listing in case of a paginated response"
      }
    },
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": true
  },
  "create-dataset-user-security": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/security/users/",
    "name": "createUserSecurity",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/DatasetUserSecurity"
    },
    "success": [
      201
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "retrieve-dataset-user-security": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/security/users/{username}/",
    "name": "getUserSecurity",
    "params": {
      "dataset_uid": "datasetUid",
      "username": "username"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "update-dataset-user-security": {
    "method": "PUT",
    "path": "/datasets/{dataset_uid}/security/users/{username}/",
    "name": "updateUserSecurity",
    "params": {
      "dataset_uid": "datasetUid",
      "username": "username"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/DatasetUserSecurity"
    },
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "delete-dataset-user-security": {
    "method": "DELETE",
    "path": "/datasets/{dataset_uid}/security/users/{username}/",
    "name": "deleteUserSecurity",
    "params": {
      "dataset_uid": "datasetUid",
      "username": "username"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      204
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "list-dataset-group-security": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/security/groups/",
    "name": "listGroupSecurity",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {
      "limit": {
        "type": "integer",
        "maximum": 1000,
        "minimum": 0,
        "default": 20,
        "description": "The maximum number of results returned by the API when the response is paginated. Tip: You can make a request with the parameter \"limit\" set to 0 to get only the metadata (\"results\" property will contain an empty array)."
      },
      "offset": {
        "type": "integer",
        "description": "The number of results to skip before beginning the listing in case of a paginated response"
      }
    },
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": true
  },
  "create-dataset-group-security": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/security/groups/",
    "name": "createGroupSecurity",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/DatasetGroupSecurity"
    },
    "success": [
      201
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "retrieve-dataset-group-security": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/security/groups/{group_uid}/",
    "name": "getGroupSecurity",
    "params": {
      "dataset_uid": "datasetUid",
      "group_uid": "groupUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "update-dataset-group-security": {
    "method": "PUT",
    "path": "/datasets/{dataset_uid}/security/groups/{group_uid}/",
    "name": "updateGroupSecurity",
    "params": {
      "dataset_uid": "datasetUid",
      "group_uid": "groupUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/DatasetGroupSecurity"
    },
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "delete-dataset-group-security": {
    "method": "DELETE",
    "path": "/datasets/{dataset_uid}/security/groups/{group_uid}/",
    "name": "deleteGroupSecurity",
    "params": {
      "dataset_uid": "datasetUid",
      "group_uid": "groupUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      204
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "list-dataset-versions": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/versions/",
    "name": "listVersions",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {
      "limit": {
        "type": "integer",
        "maximum": 1000,
        "minimum": 0,
        "default": 20,
        "description": "The maximum number of results returned by the API when the response is paginated. Tip: You can make a request with the parameter \"limit\" set to 0 to get only the metadata (\"results\" property will contain an empty array)."
      },
      "offset": {
        "type": "integer",
        "description": "The number of results to skip before beginning the listing in case of a paginated response"
      }
    },
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": true
  },
  "retrieve-dataset-version": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/versions/{version_uid}/",
    "name": "getVersion",
    "params": {
      "version_uid": "versionUid",
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "restore-version": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/versions/{version_uid}/restore/",
    "name": "restoreVersion",
    "params": {
      "version_uid": "versionUid",
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "action",
    "paginated": false
  },
  "list-dataset-schedules": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/schedules/",
    "name": "listSchedules",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {
      "limit": {
        "type": "integer",
        "maximum": 1000,
        "minimum": 0,
        "default": 20,
        "description": "The maximum number of results returned by the API when the response is paginated. Tip: You can make a request with the parameter \"limit\" set to 0 to get only the metadata (\"results\" property will contain an empty array)."
      },
      "offset": {
        "type": "integer",
        "description": "The number of results to skip before beginning the listing in case of a paginated response"
      }
    },
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": true
  },
  "create-dataset-schedule": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/schedules/",
    "name": "createSchedule",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/DatasetSchedule"
    },
    "success": [
      201
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "retrieve-dataset-schedule": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/schedules/{schedule_uid}/",
    "name": "getSchedule",
    "params": {
      "dataset_uid": "datasetUid",
      "schedule_uid": "scheduleUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "update-dataset-schedule": {
    "method": "PUT",
    "path": "/datasets/{dataset_uid}/schedules/{schedule_uid}/",
    "name": "updateSchedule",
    "params": {
      "dataset_uid": "datasetUid",
      "schedule_uid": "scheduleUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/DatasetSchedule"
    },
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "delete-dataset-schedule": {
    "method": "DELETE",
    "path": "/datasets/{dataset_uid}/schedules/{schedule_uid}/",
    "name": "deleteSchedule",
    "params": {
      "dataset_uid": "datasetUid",
      "schedule_uid": "scheduleUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      204
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "list-all-dataset-metadata": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/metadata/",
    "name": "getMetadata",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false,
    "responseSchema": {
      "$ref": "#/components/schemas/DatasetMetadata"
    }
  },
  "update-all-dataset-metadata": {
    "method": "PUT",
    "path": "/datasets/{dataset_uid}/metadata/",
    "name": "updateMetadata",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "type": "object",
      "additionalProperties": true
    },
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false,
    "responseSchema": {
      "$ref": "#/components/schemas/DatasetMetadata"
    },
    "replacementScope": "all-metadata"
  },
  "list-template-dataset-metadata": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/metadata/{template_name}/",
    "name": "getMetadataTemplate",
    "params": {
      "dataset_uid": "datasetUid",
      "template_name": "templateName"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false,
    "responseSchema": {
      "$ref": "#/components/schemas/DatasetMetadataTemplate"
    }
  },
  "update-template-dataset-metadata": {
    "method": "PUT",
    "path": "/datasets/{dataset_uid}/metadata/{template_name}/",
    "name": "updateMetadataTemplate",
    "params": {
      "dataset_uid": "datasetUid",
      "template_name": "templateName"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "type": "object",
      "additionalProperties": true
    },
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false,
    "replacementScope": "one-metadata-template",
    "responseSchema": {
      "$ref": "#/components/schemas/DatasetMetadataTemplate"
    }
  },
  "retrieve-template-field-dataset-metadata": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/metadata/{template_name}/{template_field_name}/",
    "name": "getMetadataField",
    "params": {
      "dataset_uid": "datasetUid",
      "template_name": "templateName",
      "template_field_name": "templateFieldName"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false,
    "responseSchema": {
      "$ref": "#/components/schemas/DatasetMetadataValue"
    }
  },
  "update-template-field-dataset-metadata": {
    "method": "PUT",
    "path": "/datasets/{dataset_uid}/metadata/{template_name}/{template_field_name}/",
    "name": "updateMetadataField",
    "params": {
      "dataset_uid": "datasetUid",
      "template_name": "templateName",
      "template_field_name": "templateFieldName"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/DatasetMetadataValue"
    },
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false,
    "responseSchema": {
      "$ref": "#/components/schemas/DatasetMetadataValue"
    }
  },
  "delete-template-field-dataset-metadata": {
    "method": "DELETE",
    "path": "/datasets/{dataset_uid}/metadata/{template_name}/{template_field_name}/",
    "name": "deleteMetadataField",
    "params": {
      "dataset_uid": "datasetUid",
      "template_name": "templateName",
      "template_field_name": "templateFieldName"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      204
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "list-connections": {
    "method": "GET",
    "path": "/datasource_connections/",
    "name": "listConnections",
    "params": {},
    "query": {
      "limit": {
        "type": "integer",
        "maximum": 1000,
        "minimum": 0,
        "default": 20,
        "description": "The maximum number of results returned by the API when the response is paginated. Tip: You can make a request with the parameter \"limit\" set to 0 to get only the metadata (\"results\" property will contain an empty array)."
      },
      "offset": {
        "type": "integer",
        "description": "The number of results to skip before beginning the listing in case of a paginated response"
      },
      "sort": {
        "type": "string",
        "enum": [
          "created_at",
          "updated_at",
          "type",
          "dataset_count"
        ],
        "default": "created_at",
        "description": "Sort results with respect to the specified properties. You can prefix the property with the minus sign (`-`) for descending order, e.g. `-created_at`."
      }
    },
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": true
  },
  "create-connection": {
    "method": "POST",
    "path": "/datasource_connections/",
    "name": "createConnection",
    "params": {},
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/Connection"
    },
    "success": [
      201
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "retrieve-connection": {
    "method": "GET",
    "path": "/datasource_connections/{connection_uid}/",
    "name": "getConnection",
    "params": {
      "connection_uid": "connectionUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "update-connection": {
    "method": "PUT",
    "path": "/datasource_connections/{connection_uid}/",
    "name": "updateConnection",
    "params": {
      "connection_uid": "connectionUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/Connection"
    },
    "success": [
      200
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "delete-connection": {
    "method": "DELETE",
    "path": "/datasource_connections/{connection_uid}/",
    "name": "deleteConnection",
    "params": {
      "connection_uid": "connectionUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      204
    ],
    "response": "json",
    "effect": "write",
    "paginated": false
  },
  "list-metadata-templates": {
    "method": "GET",
    "path": "/metadata/templates/",
    "name": "listMetadataTemplates",
    "params": {},
    "query": {
      "limit": {
        "type": "integer",
        "maximum": 1000,
        "minimum": 0,
        "default": 20
      },
      "offset": {
        "type": "integer"
      },
      "is_active": {
        "type": "boolean"
      },
      "type": {
        "type": "string",
        "enum": [
          "interop",
          "admin",
          "basic",
          "extra"
        ],
        "description": "Filter by type of Metadata Template."
      }
    },
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": true
  },
  "retrieve-metadata-templates": {
    "method": "GET",
    "path": "/metadata/templates/{template_name}/",
    "name": "getDomainMetadataTemplate",
    "params": {
      "template_name": "templateName"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "get-metadata-fields-list": {
    "method": "GET",
    "path": "/metadata/templates/{template_name}/fields/",
    "name": "listMetadataTemplateFields",
    "params": {
      "template_name": "templateName"
    },
    "query": {
      "limit": {
        "type": "integer",
        "maximum": 1000,
        "minimum": 0,
        "default": 20
      },
      "offset": {
        "type": "integer"
      }
    },
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": true
  },
  "get-metadata-fields-retrieve": {
    "method": "GET",
    "path": "/metadata/templates/{template_name}/fields/{template_field_name}/",
    "name": "getMetadataTemplateField",
    "params": {
      "template_name": "templateName",
      "template_field_name": "templateFieldName"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "effect": "read",
    "paginated": false
  },
  "get-dataset-translations": {
    "method": "GET",
    "path": "/datasets/{dataset_uid}/i18n/translations/",
    "name": "getDatasetTranslations",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": null,
    "bodySchema": null,
    "success": [
      200
    ],
    "response": "json",
    "responseSchema": {
      "$ref": "#/components/schemas/DatasetTranslations"
    },
    "effect": "read",
    "paginated": false,
    "operationIdAuthority": "client-key-for-current-documented-route"
  },
  "update-dataset-translations": {
    "method": "POST",
    "path": "/datasets/{dataset_uid}/i18n/translations/",
    "name": "updateDatasetTranslations",
    "params": {
      "dataset_uid": "datasetUid"
    },
    "query": {},
    "body": "json",
    "bodySchema": {
      "$ref": "#/components/schemas/DatasetTranslations"
    },
    "success": [
      200
    ],
    "response": "json",
    "responseSchema": {
      "$ref": "#/components/schemas/DatasetTranslations"
    },
    "effect": "write",
    "paginated": false,
    "operationIdAuthority": "client-key-for-current-documented-route"
  }
});
export const AUTOMATION_SCHEMAS = freeze({
  "AWSIAMRoleAuth": {
    "title": "AWSIAMRoleAuth",
    "type": "object",
    "properties": {
      "ods_aws_account_id": {
        "type": "string",
        "description": "The AWS account number that will assume the role.",
        "readOnly": true,
        "example": 210987654321
      },
      "external_id": {
        "type": "string",
        "description": "The identifier for the connection that will assume the role.",
        "readOnly": true,
        "example": "ods-domain-2fa5c43c-35bf-4e1a-8da5-45f7cd8b4f6c"
      },
      "is_valid": {
        "type": "boolean",
        "description": "The capability of assuming the role for the connection. Is set to true if the role is successfully assumed when the \"role_arn\" is set.",
        "readOnly": true,
        "example": true
      },
      "role_arn": {
        "type": "string",
        "description": "The identifier of the role to be assumed should be set to an empty string when the connection is created. It is expected to be updated by the user.",
        "example": "arn:aws:iam::012345678901:role/ODSRoleAuthMyDomain"
      },
      "region": {
        "type": "string",
        "example": "eu-west-1"
      }
    },
    "required": [
      "region"
    ]
  },
  "AWSSignatureV4Auth": {
    "title": "AWSSignatureV4Auth",
    "type": "object",
    "properties": {
      "access_key_id": {
        "type": "string"
      },
      "secret_access_key": {
        "type": [
          "string",
          "null"
        ],
        "description": "The access key. The API returns null to hide this sensitive value."
      },
      "region": {
        "type": "string"
      }
    },
    "required": [
      "access_key_id",
      "secret_access_key",
      "region"
    ]
  },
  "AmazonS3AWSIAMRoleAuth": {
    "title": "AmazonS3AWSIAMRoleAuth",
    "allOf": [
      {
        "$ref": "#/components/schemas/AmazonS3Auth"
      },
      {
        "$ref": "#/components/schemas/AWSIAMRoleAuth"
      }
    ]
  },
  "AmazonS3AWSSignatureV4Auth": {
    "title": "AmazonS3AWSSignatureV4Auth",
    "allOf": [
      {
        "$ref": "#/components/schemas/AmazonS3Auth"
      },
      {
        "$ref": "#/components/schemas/AWSSignatureV4Auth"
      }
    ]
  },
  "AmazonS3Auth": {
    "title": "AmazonS3Auth",
    "type": "object",
    "discriminator": {
      "propertyName": "type",
      "mapping": {
        "aws_signature_v4": "#/components/schemas/AmazonS3AWSSignatureV4Auth",
        "iam_role": "#/components/schemas/AmazonS3AWSIAMRoleAuth"
      }
    },
    "properties": {
      "type": {
        "type": "string",
        "minLength": 1
      }
    },
    "required": [
      "type"
    ],
    "example": {
      "type": "aws_signature_v4",
      "region": "eu-west-1",
      "access_key_id": "access_key_id",
      "secret_access_key": "secret_access_key"
    }
  },
  "AmazonS3Connection": {
    "title": "AmazonS3Connection",
    "allOf": [
      {
        "$ref": "#/components/schemas/Connection"
      },
      {
        "type": "object",
        "properties": {
          "headers": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "name": {
                  "type": "string",
                  "example": "header-name"
                },
                "value": {
                  "type": "string",
                  "example": "header-value"
                }
              },
              "required": [
                "name",
                "value"
              ]
            }
          },
          "auth": {
            "$ref": "#/components/schemas/AmazonS3Auth"
          }
        },
        "required": [
          "url"
        ]
      }
    ]
  },
  "AmazonS3Datasource": {
    "allOf": [
      {
        "$ref": "#/components/schemas/Datasource"
      },
      {
        "type": "object",
        "x-tags": [
          "Dataset resources"
        ],
        "properties": {
          "url": {
            "type": "string",
            "example": "https://your-bucket.s3.amazonaws.com/file.csv"
          },
          "headers": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "name": {
                  "type": "string"
                },
                "value": {
                  "type": "string"
                }
              }
            }
          },
          "connection": {
            "oneOf": [
              {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "uid": {
                    "type": "string"
                  }
                },
                "required": [
                  "uid"
                ]
              },
              {
                "$ref": "#/components/schemas/AmazonS3Connection"
              }
            ]
          }
        },
        "required": [
          "connection"
        ]
      }
    ],
    "title": "AmazonS3Datasource"
  },
  "AnnotateDatasetFieldConfiguration": {
    "allOf": [
      {
        "$ref": "#/components/schemas/DatasetFieldConfiguration"
      },
      {
        "type": "object",
        "title": "AnnotateDatasetFieldConfiguration",
        "x-tags": [
          "Dataset fields"
        ],
        "properties": {
          "field": {
            "type": "string",
            "minLength": 1,
            "example": "field_id",
            "description": "The technical identifier of the field whose annotation you want to configure"
          },
          "annotation": {
            "type": "string",
            "enum": [
              "id",
              "timeserie_precision",
              "unit",
              "decimals",
              "sortable",
              "multivalued",
              "hierarchical"
            ],
            "description": "Annotations are a mean to configure special behavior for the fields. \nSome annotations are only available for certain field types.\n| Annotation name     | Field type                                   | Description                                                                                                                                                                                     |\n|---------------------|----------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|\n| id                  | all field types                              | Whether this field should constitute one of the keys of the records unique IDs. If no field has this annotation, all fields contribute to the creation of the records unique ID.                |\n| timeserie_precision | `date` and `datetime`                        | display precision of the field. Possible arguments are `year`, `month` and `day` for `date`, `hour` and `minute` for `datetime`                                                                 |\n| unit                | `int` and `decimal`                          | The unit of the field                                                                                                                                                                           |\n| decimals            | `decimal`                                    | The argument is the number of digits to appear after the decimal point                                                                                                                          |\n| sortable            | `text`                                       | whether the field should be sortable in table view                                                                                                                                              |\n| multivalued         | `text`                                       | whether the field contains multiple values separated by a character. The separator must be given as the argument                                                                                |\n| hierarchical        | `text`                                       | whether the field is hierarchical. The separator must be given as the argument                                                                                                                  |",
            "example": "unit"
          },
          "args": {
            "type": "array",
            "items": {
              "type": [
                "string",
                "integer"
              ]
            },
            "example": [
              "km2"
            ]
          }
        },
        "required": [
          "field",
          "annotation"
        ]
      }
    ],
    "title": "AnnotateDatasetFieldConfiguration"
  },
  "AzureBlobStorageAuth": {
    "title": "AzureBlobStorageAuth",
    "type": "object",
    "discriminator": {
      "propertyName": "type",
      "mapping": {
        "shared_key": "#/components/schemas/AzureBlobStorageSharedKeyAuth"
      }
    },
    "properties": {
      "type": {
        "type": "string",
        "minLength": 1
      }
    },
    "required": [
      "type"
    ],
    "example": {
      "type": "shared_key",
      "account_name": "storage-account-name",
      "access_key": "access_key"
    }
  },
  "AzureBlobStorageConnection": {
    "title": "AzureBlobStorageConnection",
    "allOf": [
      {
        "$ref": "#/components/schemas/Connection"
      },
      {
        "type": "object",
        "properties": {
          "headers": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "name": {
                  "type": "string",
                  "example": "header-name"
                },
                "value": {
                  "type": "string",
                  "example": "header-value"
                }
              },
              "required": [
                "name",
                "value"
              ]
            }
          },
          "auth": {
            "$ref": "#/components/schemas/AzureBlobStorageAuth"
          }
        },
        "required": [
          "url"
        ]
      }
    ]
  },
  "AzureBlobStorageDatasource": {
    "allOf": [
      {
        "$ref": "#/components/schemas/Datasource"
      },
      {
        "type": "object",
        "x-tags": [
          "Dataset resources"
        ],
        "properties": {
          "url": {
            "type": "string",
            "example": "https://storage-account-name.blob.core.windows.net/file.csv"
          },
          "headers": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "name": {
                  "type": "string"
                },
                "value": {
                  "type": "string"
                }
              }
            }
          },
          "connection": {
            "oneOf": [
              {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "uid": {
                    "type": "string"
                  }
                },
                "required": [
                  "uid"
                ]
              },
              {
                "$ref": "#/components/schemas/AzureBlobStorageConnection"
              }
            ]
          }
        },
        "required": [
          "connection"
        ]
      }
    ],
    "title": "AzureBlobStorageDatasource"
  },
  "AzureBlobStorageSharedKeyAuth": {
    "title": "AzureBlobStorageSharedKeyAuth",
    "allOf": [
      {
        "$ref": "#/components/schemas/AzureBlobStorageAuth"
      },
      {
        "type": "object",
        "properties": {
          "account_name": {
            "type": "string"
          },
          "shared_key": {
            "type": [
              "string",
              "null"
            ],
            "description": "The account shared key. The API returns null to hide this sensitive value."
          }
        },
        "required": [
          "account_name",
          "shared_key"
        ]
      }
    ]
  },
  "BasicAuth": {
    "title": "BasicAuth",
    "type": "object",
    "properties": {
      "username": {
        "type": "string"
      },
      "password": {
        "type": [
          "string",
          "null"
        ],
        "description": "The password for the user. The API returns null to hide this sensitive value."
      }
    },
    "required": [
      "username",
      "password"
    ]
  },
  "Connection": {
    "title": "Connection schema",
    "x-tags": [
      "Datasources connections"
    ],
    "type": "object",
    "discriminator": {
      "propertyName": "type",
      "mapping": {
        "http": "#/components/schemas/HTTPConnection",
        "ftp": "#/components/schemas/FTPConnection",
        "sharepoint": "#/components/schemas/SharepointConnection",
        "google_drive": "#/components/schemas/GoogleDriveConnection",
        "amazon_s3": "#/components/schemas/AmazonS3Connection",
        "azure_blob_storage": "#/components/schemas/AzureBlobStorageConnection"
      }
    },
    "properties": {
      "uid": {
        "type": "string",
        "minLength": 1,
        "readOnly": true,
        "example": "co_qf2hyt"
      },
      "type": {
        "type": "string",
        "minLength": 1
      },
      "is_reusable": {
        "type": "boolean",
        "description": "Defines if the connection can be reused across multiple datasets"
      },
      "can_reuse": {
        "type": "boolean",
        "description": "Defines if the current user has the permission to reuse this connection",
        "readOnly": true
      },
      "can_manage": {
        "type": "boolean",
        "description": "Defines if the current user has the permission to manage this connection",
        "readOnly": true
      },
      "dataset_count": {
        "type": "number",
        "readOnly": true,
        "description": "Number of datasets using this connection",
        "example": 59
      },
      "user_count": {
        "type": "number",
        "readOnly": true,
        "description": "Number of users with explicit access to this connection",
        "example": 7
      },
      "group_count": {
        "type": "number",
        "readOnly": true,
        "description": "Number of user groups with explicit access to this connection",
        "example": 4
      },
      "created_at": {
        "type": "string",
        "minLength": 1,
        "format": "date",
        "readOnly": true
      },
      "updated_at": {
        "type": "string",
        "minLength": 1,
        "format": "date",
        "readOnly": true
      }
    },
    "required": [
      "type"
    ]
  },
  "Dataset": {
    "title": "Dataset schema",
    "type": "object",
    "properties": {
      "uid": {
        "type": "string",
        "minLength": 1,
        "readOnly": true,
        "description": "Unique identifier of the dataset that will never change through the lifetime of the dataset",
        "example": "da_qf2hyt"
      },
      "dataset_id": {
        "type": "string",
        "minLength": 1,
        "description": "Human-readable identifier of the dataset that can be modified when the dataset is not published",
        "example": "counties-united-states-of-america"
      },
      "created_at": {
        "type": "string",
        "minLength": 1,
        "format": "date-time",
        "readOnly": true,
        "description": "Date when the dataset was created"
      },
      "updated_at": {
        "type": "string",
        "minLength": 1,
        "format": "date-time",
        "readOnly": true,
        "description": "Date when the dataset's configuration was last edited"
      },
      "is_published": {
        "type": "boolean",
        "default": false,
        "readOnly": true
      },
      "is_restricted": {
        "type": "boolean",
        "description": "Defines if the dataset is visible for anonymous visitors. \n- If it is `false`, anyone having access to the domain will be able to see the dataset in the catalog. Users who have at least a ruleset declared for them (whether directly, through a group or both) will be able to see everything their rulesets grant access to.\nUsers who do not have any ruleset declared for them (neither directly nor through a group) will be able to see what the default ruleset (`default_security` dataset property) grants access to.\n- If it is `true`, the dataset will only appear in the catalog for users who have a ruleset declared for them, either directly or through a group. Other users won't have any access to the dataset.\nThe `default_security` ruleset has no effect for restricted datasets."
      },
      "metadata": {
        "$ref": "#/components/schemas/DatasetMetadata"
      },
      "default_security": {
        "$ref": "#/components/schemas/DatasetSecurity",
        "description": "The dataset default security ruleset when the dataset is restricted. This ruleset applies to all users who do not  have any ruleset declared for them"
      },
      "created_by": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/RelatedUserReadOnly"
          },
          {
            "type": "null"
          }
        ],
        "readOnly": true
      },
      "updated_by": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/RelatedUserReadOnly"
          },
          {
            "type": "null"
          }
        ],
        "readOnly": true
      }
    },
    "required": [
      "metadata"
    ],
    "x-tags": [
      "Datasets"
    ]
  },
  "DatasetFieldConfiguration": {
    "title": "Field configuration schema",
    "description": "Field attached to a dataset",
    "type": "object",
    "x-tags": [
      "Dataset fields"
    ],
    "discriminator": {
      "propertyName": "type",
      "mapping": {
        "rename": "#/components/schemas/RenameDatasetFieldConfiguration",
        "type": "#/components/schemas/TypeDatasetFieldConfiguration",
        "annotate": "#/components/schemas/AnnotateDatasetFieldConfiguration",
        "description": "#/components/schemas/DescriptionDatasetFieldConfiguration",
        "order": "#/components/schemas/OrderDatasetFieldConfiguration",
        "delete": "#/components/schemas/DeleteDatasetFieldConfiguration"
      }
    },
    "properties": {
      "uid": {
        "type": "string",
        "readOnly": true,
        "description": "Unique identifier for the field configuration"
      },
      "type": {
        "type": "string",
        "minLength": 1
      },
      "label": {
        "type": "string",
        "description": "Friendly label of the field configuration",
        "example": "Field configuration friendly label"
      }
    },
    "required": [
      "type",
      "label"
    ],
    "example": {
      "uid": "pr_qf2hyt",
      "type": "annotate",
      "label": "Mark the field_id as multivalued, with a comma as the values separator",
      "field": "field_id",
      "annotation": "multivalued",
      "args": [
        ","
      ]
    }
  },
  "DatasetFile": {
    "type": "object",
    "properties": {
      "uid": {
        "type": "string",
        "readOnly": true,
        "description": "Unique identifier for the file",
        "example": "fromages.csv"
      },
      "filename": {
        "type": "string",
        "readOnly": true,
        "example": "fromages.csv"
      },
      "mimetype": {
        "type": [
          "string",
          "null"
        ],
        "readOnly": true,
        "example": "text/csv"
      },
      "created_at": {
        "type": "string",
        "readOnly": true,
        "format": "date-time"
      }
    }
  },
  "DatasetGroupSecurity": {
    "title": "Group ruleset schema",
    "type": "object",
    "properties": {
      "security": {
        "$ref": "#/components/schemas/DatasetSecurity"
      },
      "permissions": {
        "description": "List of special permissions granted to the target.",
        "type": "array",
        "uniqueItems": true,
        "items": {
          "type": "string",
          "enum": [
            "explore_restricted_dataset",
            "edit_dataset",
            "publish_dataset",
            "manage_dataset"
          ]
        }
      },
      "group": {
        "type": "object",
        "required": [
          "uid"
        ],
        "properties": {
          "uid": {
            "type": "string",
            "minLength": 1,
            "example": "content_designers"
          }
        },
        "description": "The group targeted by this ruleset."
      }
    },
    "required": [
      "group"
    ],
    "x-tags": [
      "Dataset security"
    ]
  },
  "DatasetMetadata": {
    "title": "Dataset metadata",
    "type": "object",
    "additionalProperties": {
      "$ref": "#/components/schemas/DatasetMetadataTemplate"
    }
  },
  "DatasetMetadataAssetContentConfiguration": {
    "title": "Asset Content Configuration",
    "description": "This template defines metadata for configuring how asset content are displayed in the portal.",
    "type": "object",
    "properties": {
      "facets": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "field_name": {
                  "type": "string",
                  "description": "The name of the field."
                },
                "facetsort": {
                  "type": "string",
                  "enum": [
                    "count",
                    "num",
                    "alphanum",
                    "-count",
                    "-num",
                    "-alphanum"
                  ],
                  "description": "Sorting criteria for the facet."
                },
                "disjunctive": {
                  "type": "boolean",
                  "description": "Whether the facet uses disjunctive filtering. When enabled, selecting multiple values within the facet applies OR logic, returning results that match any of the selected values."
                },
                "timerange_filter": {
                  "type": "boolean",
                  "description": "Whether the facet should use a time range filter on the date or datetime field."
                }
              },
              "required": [
                "field_name"
              ]
            }
          },
          "remote_value": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "field_name": {
                  "type": "string",
                  "description": "The name of the field."
                },
                "facetsort": {
                  "type": "string",
                  "enum": [
                    "count",
                    "num",
                    "alphanum",
                    "-count",
                    "-num",
                    "-alphanum"
                  ],
                  "description": "Sorting criteria for the facet."
                },
                "disjunctive": {
                  "type": "boolean",
                  "description": "Whether the facet is disjunctive."
                },
                "timerange_filter": {
                  "type": "boolean",
                  "description": "Whether the facet should use a time range filter on the date or datetime field."
                }
              },
              "required": [
                "field_name"
              ]
            }
          }
        },
        "description": "The set of facets for the asset."
      },
      "fields_displayed_in_specific_languages": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "object",
            "additionalProperties": {
              "type": "array",
              "items": {
                "type": "string",
                "enum": [
                  "en",
                  "fr",
                  "nl"
                ]
              },
              "minItems": 1
            },
            "description": "A dictionary where keys are field names and values are non-empty lists of valid languages."
          },
          "remote_value": {
            "type": "object",
            "additionalProperties": {
              "type": "array",
              "items": {
                "type": "string",
                "enum": [
                  "en",
                  "fr",
                  "nl"
                ]
              },
              "minItems": 1
            },
            "description": "A dictionary where each key is a field name, and each value is a list of languages in which the field should be displayed."
          }
        },
        "description": "The fields that should only be displayed in specific languages."
      },
      "records_search_boosts": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "object",
            "additionalProperties": {
              "type": "integer",
              "minimum": 0
            },
            "description": "A dictionary where keys are field names and values are positive integers representing the importance of the field in the full-text search. A value of 0 means the field is ignored by the search."
          },
          "remote_value": {
            "type": "object",
            "additionalProperties": {
              "type": "integer",
              "minimum": 0
            },
            "description": "A dictionary where each key is a field name, and each value is a positive integer indicating the importance of the field in the full-text search. A value of 0 means the field is ignored by the search."
          }
        },
        "description": "The importance of each fields in full-text search."
      }
    },
    "example": {
      "facets": {
        "value": [
          {
            "field_name": "title",
            "facetsort": "-count",
            "disjunctive": true
          },
          {
            "field_name": "release_date",
            "facetsort": "alphanum",
            "timerange_filter": true
          }
        ],
        "remote_value": [
          {
            "field_name": "title",
            "facetsort": "-count",
            "disjunctive": true
          },
          {
            "field_name": "release_date",
            "facetsort": "alphanum",
            "timerange_filter": true
          }
        ],
        "override_remote_value": false
      },
      "fields_displayed_in_specific_languages": {
        "value": {
          "title": [
            "en",
            "fr"
          ],
          "tags": [
            "en"
          ]
        },
        "remote_value": {
          "title": [
            "en",
            "fr"
          ],
          "tags": [
            "en"
          ]
        },
        "override_remote_value": false
      },
      "records_search_boosts": {
        "value": {
          "title": 10,
          "tags": 0,
          "description": 2
        },
        "remote_value": {
          "title": 10,
          "tags": 0,
          "description": 2
        },
        "override_remote_value": false
      }
    }
  },
  "DatasetMetadataCustom": {
    "title": "Custom template",
    "description": "Additional values for custom metadata templates you have configured on your portal.",
    "type": "object",
    "additionalProperties": {
      "$ref": "#/components/schemas/DatasetMetadataValue",
      "type": "object"
    },
    "example": {
      "field_name_1": {
        "value": "field_value_1"
      },
      "field_name_2": {
        "value": "field_value_2",
        "override_remote_value": true
      }
    },
    "x-additionalPropertiesName": "custom_template_name"
  },
  "DatasetMetadataDefault": {
    "title": "Default template",
    "description": "The standard set of metadata common to all Opendatasoft datasets.",
    "type": "object",
    "properties": {
      "title": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Title of the dataset."
      },
      "description": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Description of the dataset."
      },
      "keyword": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          },
          "remote_value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "description": "Keywords to define the dataset and better find it through searches.  Keywords are one of the catalog filters available in the front office of an Opendatasoft portal."
      },
      "modified": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1,
            "format": "date-time"
          },
          "remote_value": {
            "type": "string",
            "minLength": 1,
            "format": "date-time"
          }
        },
        "description": "Date indicating when the dataset was last modified."
      },
      "modified_updates_on_metadata_change": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "boolean"
          },
          "remote_value": {
            "type": "boolean"
          }
        },
        "description": "If the `modified` date should automatically be updated on metadata changes."
      },
      "modified_updates_on_data_change": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "boolean"
          },
          "remote_value": {
            "type": "boolean"
          }
        },
        "description": "If the `modified` date should automatically be updated on data changes."
      },
      "geographic_reference": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          },
          "remote_value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "description": "Geographic References."
      },
      "geographic_reference_auto": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "boolean"
          },
          "remote_value": {
            "type": "boolean"
          }
        },
        "description": "Geographic References automatic computation."
      },
      "language": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "enum": [
              "en",
              "fr",
              "nl",
              "pt",
              "it",
              "ar",
              "de",
              "es",
              "ca",
              "eu",
              "sv"
            ]
          },
          "remote_value": {
            "type": "string",
            "enum": [
              "en",
              "fr",
              "nl",
              "pt",
              "it",
              "ar",
              "de",
              "es",
              "ca",
              "eu",
              "sv"
            ]
          }
        },
        "description": "Language of the data in the dataset."
      },
      "timezone": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Forces the dataset visualizations to use the defined timezone for the date and datetime fields.  It avoids the dataset visualizations to depend on the timezone on which the user's computer is set."
      },
      "publisher": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Name of the person or organization who published the dataset."
      },
      "references": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Link to the source of the dataset."
      },
      "attributions": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          },
          "remote_value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "description": "Link to a source of the dataset that should be mentioned for legal reasons  (e.g. if the license demands the mention of a specific source or organization)."
      }
    },
    "required": [
      "title",
      "modified",
      "language"
    ],
    "example": {
      "title": {
        "value": "Counties -  United States of America",
        "remote_value": "Counties -  United States of America",
        "override_remote_value": false
      },
      "description": {
        "value": "This dataset is part of the Geographical repository maintained by Opendatasoft.  This dataset contains data for counties and equivalent entities in United States of America.",
        "remote_value": "This dataset is part of the Geographical repository maintained by Opendatasoft.  This dataset contains data for counties and equivalent entities in United States of America.",
        "override_remote_value": false
      },
      "keyword": {
        "value": [
          "territory",
          "geography",
          "boundary",
          "county",
          "usa"
        ],
        "remote_value": [
          "territory",
          "geography",
          "boundary",
          "county",
          "usa"
        ],
        "override_remote_value": false
      },
      "modified": {
        "value": "2023-01-01T00:00:00Z",
        "remote_value": "2023-01-01T00:00:00Z",
        "override_remote_value": false
      },
      "modified_updates_on_metadata_change": {
        "value": false,
        "remote_value": false,
        "override_remote_value": false
      },
      "modified_updates_on_data_change": {
        "value": false,
        "remote_value": false,
        "override_remote_value": false
      },
      "geographic_reference": {
        "value": [
          "world_us"
        ],
        "remote_value": [
          "world_us"
        ],
        "override_remote_value": false
      },
      "geographic_reference_auto": {
        "value": false,
        "remote_value": false,
        "override_remote_value": false
      },
      "language": {
        "value": "en",
        "remote_value": "en",
        "override_remote_value": false
      },
      "timezone": {
        "value": "US/Pacific",
        "remote_value": "US/Pacific",
        "override_remote_value": false
      },
      "publisher": {
        "value": "U.S. Department of Commerce, U.S. Census Bureau, Geography Division, Spatial Data Collection and Products Branch",
        "remote_value": "U.S. Department of Commerce, U.S. Census Bureau, Geography Division, Spatial Data Collection and Products Branch",
        "override_remote_value": false
      },
      "references": {
        "value": "https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html",
        "remote_value": "https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html",
        "override_remote_value": false
      },
      "attributions": {
        "value": [
          "U.S. Census Bureau"
        ],
        "remote_value": [
          "U.S. Census Bureau"
        ],
        "override_remote_value": false
      }
    }
  },
  "DatasetMetadataInternal": {
    "title": "Internal template",
    "description": "This set of metadata is used for dataset configuration and won't appear on your portal.",
    "type": "object",
    "properties": {
      "license_id": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "The license identifier. The identifier refers to the list of configured licenses in the domain."
      },
      "theme_id": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          },
          "remote_value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "description": "The list of theme identifiers. The identifiers refer to the list of configured theme in the domain."
      },
      "draft": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "boolean"
          },
          "remote_value": {
            "type": "boolean"
          }
        },
        "description": "If the dataset is a draft, it isn't visible in the dataset list and can't be published."
      }
    },
    "example": {
      "license_id": {
        "value": "38js5ao",
        "remote_value": "38js5ao",
        "override_remote_value": false
      },
      "theme_id": {
        "value": [
          "38js5ao"
        ],
        "remote_value": [
          "38js5ao"
        ],
        "override_remote_value": false
      },
      "draft": {
        "value": false,
        "remote_value": false,
        "override_remote_value": false
      }
    }
  },
  "DatasetMetadataTemplate": {
    "title": "Metadata template values",
    "type": "object",
    "additionalProperties": {
      "$ref": "#/components/schemas/DatasetMetadataValue"
    }
  },
  "DatasetMetadataValue": {
    "title": "Metadata value",
    "type": "object",
    "properties": {
      "value": {},
      "remote_value": {
        "readOnly": true
      },
      "override_remote_value": {
        "type": "boolean"
      }
    },
    "required": [
      "value"
    ]
  },
  "DatasetMetadataVisualization": {
    "title": "Visualization template",
    "description": "This set of metadata is used to configure the dataset visualizations on your portal.",
    "type": "object",
    "properties": {
      "analyze_disabled": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "boolean"
          },
          "remote_value": {
            "type": "boolean"
          }
        },
        "description": "Toggle for the analyze tab in explore."
      },
      "analyze_default": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Default analyze chart."
      },
      "table_fields": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          },
          "remote_value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "description": "Fields displayed in Table visualization."
      },
      "table_default_sort_field": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Default initial sort field in Table visualization."
      },
      "table_default_sort_direction": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Default initial sort direction in Table visualization."
      },
      "map_disabled": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "boolean"
          },
          "remote_value": {
            "type": "boolean"
          }
        },
        "description": "Toggle for the map tab in explore."
      },
      "map_marker_picto": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Picto used for markers on maps."
      },
      "map_marker_color": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Color used for markers on maps (#xxxxxx hex code)."
      },
      "map_marker_hidemarkershape": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "boolean"
          },
          "remote_value": {
            "type": "boolean"
          }
        },
        "description": "Hide the marker shape and only show the icon."
      },
      "map_tooltip_title": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Field used as title of the Map visualization tooltips."
      },
      "map_tooltip_fields": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          },
          "remote_value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "description": "Fields displayed in Map visualization tooltips."
      },
      "map_tooltip_disabled": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "boolean"
          },
          "remote_value": {
            "type": "boolean"
          }
        },
        "description": "Disable map tooltips."
      },
      "map_tooltip_html_enabled": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "boolean"
          },
          "remote_value": {
            "type": "boolean"
          }
        },
        "description": "Use the HTML template for the map tooltips."
      },
      "map_tooltip_html": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "HTML template of the tooltip."
      },
      "map_tooltip_sort_field": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Sort field in map tooltips."
      },
      "map_tooltip_sort_direction": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Sort direction in map tooltips."
      },
      "map_basemap": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Default basemap identifier."
      },
      "images_disabled": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "boolean"
          },
          "remote_value": {
            "type": "boolean"
          }
        },
        "description": "Toggle for the image tab in explore."
      },
      "media_gallery_fields": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          },
          "remote_value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "description": "Fields used to generate the media gallery."
      },
      "image_title": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Field used as title on the image thumbnail."
      },
      "image_fields": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          },
          "remote_value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "description": "Fields displayed when the image is clicked."
      },
      "image_tooltip_html_enabled": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "boolean"
          },
          "remote_value": {
            "type": "boolean"
          }
        },
        "description": "Use the HTML template for the image tooltips."
      },
      "image_tooltip_html": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          },
          "remote_value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "description": "HTML template of the image tooltip."
      },
      "calendar_enabled": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "boolean"
          },
          "remote_value": {
            "type": "boolean"
          }
        },
        "description": "Field used as title on the calendars."
      },
      "calendar_event_title": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Field used as title on the calendars."
      },
      "calendar_event_start": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Field used as start date on calendars."
      },
      "calendar_event_end": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Field used as end date on calendars."
      },
      "calendar_tooltip_html_enabled": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "boolean"
          },
          "remote_value": {
            "type": "boolean"
          }
        },
        "description": "Use the HTML template for the calendar tooltips."
      },
      "calendar_tooltip_html": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "HTML template of the tooltip."
      },
      "calendar_tooltip_fields": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          },
          "remote_value": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "description": "Fields displayed in Calendar visualization tooltips."
      },
      "calendar_event_color": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Color used for events on calendars."
      },
      "calendar_available_views": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Available views for the calendar."
      },
      "calendar_default_view": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Default view for the calendar."
      },
      "custom_view_enabled": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "boolean"
          },
          "remote_value": {
            "type": "boolean"
          }
        },
        "description": "Toggle for the custom view."
      },
      "custom_view_html": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "HTML content for the custom view."
      },
      "custom_view_css": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "CSS style for the custom view."
      },
      "custom_view_icon": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Name of the font-awesome icon used as title."
      },
      "custom_view_title": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Title of the custom tab."
      },
      "custom_view_slug": {
        "$ref": "#/components/schemas/DatasetMetadataValue",
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "remote_value": {
            "type": "string",
            "minLength": 1
          }
        },
        "description": "Slug of the custom tab."
      }
    },
    "example": {}
  },
  "DatasetProcessor": {
    "title": "Processor schema",
    "description": "Processor attached to a dataset",
    "type": "object",
    "x-tags": [
      "Dataset processors"
    ],
    "properties": {
      "uid": {
        "type": "string",
        "readOnly": true,
        "description": "Unique identifier for the processor"
      },
      "type": {
        "type": "string",
        "description": "Type of the processor"
      },
      "label": {
        "type": "string",
        "description": "Friendly label of the processor"
      }
    },
    "additionalProperties": {},
    "example": {
      "uid": "pr_qf2hyt",
      "type": "string_replace",
      "label": "replace old value with new value",
      "field": "my_field",
      "old": "old_value",
      "new": "new_value"
    },
    "required": [
      "type",
      "label"
    ]
  },
  "DatasetSchedule": {
    "title": "Schedule schema",
    "type": "object",
    "properties": {
      "uid": {
        "type": "string",
        "minLength": 1,
        "readOnly": true,
        "example": "sc_qf2hyt"
      },
      "cron_schedule": {
        "type": "string",
        "minLength": 1,
        "description": "The schedule using the unix-cron string format",
        "example": "0 * * * *"
      }
    },
    "required": [
      "cron_schedule"
    ],
    "x-tags": [
      "Dataset schedules"
    ]
  },
  "DatasetSecurity": {
    "type": "object",
    "properties": {
      "is_data_visible": {
        "type": "boolean",
        "example": true,
        "description": "Flag indicating whether the target will have access to the records of the dataset or not."
      },
      "visible_fields": {
        "type": [
          "array",
          "null"
        ],
        "description": "The target will only have access to the fields from this list.\n`null` means that the target has access to all fields.\nAn empty list means that the target won't see any field (empty dataset schema).",
        "uniqueItems": true,
        "items": {
          "type": "string",
          "minLength": 1
        },
        "example": [
          "year",
          "coty_code"
        ]
      },
      "filter_query": {
        "type": "string",
        "example": "year!=2022",
        "description": "The target will only have access to the records matching this query. An empty query means that all records are accessible."
      },
      "api_calls_quota": {
        "type": [
          "object",
          "null"
        ],
        "description": "Upper limit set on the number of API calls the target can make to this dataset in a given timeframe. Can be set to null for no specific quota.",
        "properties": {
          "unit": {
            "type": "string",
            "enum": [
              "second",
              "minute",
              "hour",
              "day",
              "month"
            ],
            "example": "month"
          },
          "limit": {
            "type": "number",
            "example": 12000
          }
        }
      }
    }
  },
  "DatasetUserSecurity": {
    "title": "User ruleset schema",
    "type": "object",
    "properties": {
      "security": {
        "$ref": "#/components/schemas/DatasetSecurity"
      },
      "permissions": {
        "description": "List of special permissions granted to the target.",
        "type": "array",
        "uniqueItems": true,
        "items": {
          "type": "string",
          "enum": [
            "explore_restricted_dataset",
            "edit_dataset",
            "publish_dataset",
            "manage_dataset"
          ]
        }
      },
      "user": {
        "$ref": "#/components/schemas/RelatedUser",
        "description": "The user targeted by this ruleset."
      }
    },
    "required": [
      "user"
    ],
    "x-tags": [
      "Dataset security"
    ]
  },
  "Datasource": {
    "type": "object",
    "title": "Datasource",
    "discriminator": {
      "propertyName": "type",
      "mapping": {
        "http": "#/components/schemas/HTTPDatasource",
        "ftp": "#/components/schemas/FTPDatasource",
        "sharepoint": "#/components/schemas/SharepointDatasource",
        "google_drive": "#/components/schemas/GoogleDriveDatasource",
        "federated": "#/components/schemas/FederatedDatasource",
        "uploaded_file": "#/components/schemas/UploadedFileDatasource",
        "amazon_s3": "#/components/schemas/AmazonS3Datasource",
        "azure_blob_storage": "#/components/schemas/AzureBlobStorageDatasource"
      }
    },
    "properties": {
      "type": {
        "type": "string",
        "minLength": 1
      }
    },
    "required": [
      "type"
    ],
    "example": {
      "type": "http",
      "connection": {
        "type": "http",
        "url": "https://my-server.com",
        "auth": null
      },
      "headers": [
        {
          "name": "header-name",
          "value": "header-value"
        }
      ],
      "relative_url": "/fromages.csv"
    }
  },
  "DeleteDatasetFieldConfiguration": {
    "allOf": [
      {
        "$ref": "#/components/schemas/DatasetFieldConfiguration"
      },
      {
        "type": "object",
        "title": "DeleteDatasetFieldConfiguration",
        "x-tags": [
          "Dataset fields"
        ],
        "properties": {
          "field": {
            "type": "string",
            "minLength": 1,
            "example": "field_id",
            "description": "The technical identifier of the field you want to delete"
          }
        },
        "required": [
          "field"
        ]
      }
    ],
    "title": "DeleteDatasetFieldConfiguration"
  },
  "DescriptionDatasetFieldConfiguration": {
    "allOf": [
      {
        "$ref": "#/components/schemas/DatasetFieldConfiguration"
      },
      {
        "type": "object",
        "title": "DescriptionDatasetFieldConfiguration",
        "x-tags": [
          "Dataset fields"
        ],
        "properties": {
          "field": {
            "type": "string",
            "minLength": 1,
            "example": "field_id",
            "description": "The technical identifier of the field you want to describe"
          },
          "description": {
            "type": "string",
            "minLength": 1,
            "example": "Elegant description",
            "description": "The user friendly description"
          }
        },
        "required": [
          "field",
          "description"
        ]
      }
    ],
    "title": "DescriptionDatasetFieldConfiguration"
  },
  "ExtractionInfos": {
    "title": "Extraction information",
    "type": "object",
    "description": "Information about the kind of extraction configured for this resource",
    "properties": {
      "label": {
        "type": "string",
        "description": "human readable label for the extraction type",
        "example": "CSV File",
        "readOnly": true
      },
      "type": {
        "type": "string",
        "minLength": 1,
        "description": "extractor type that should handle this resource",
        "example": "csvfile",
        "readOnly": true
      }
    }
  },
  "FTPAuth": {
    "title": "FTPAuth",
    "type": "object",
    "discriminator": {
      "propertyName": "type",
      "mapping": {
        "basic_auth": "#/components/schemas/FTPBasicAuth"
      }
    },
    "properties": {
      "type": {
        "type": "string",
        "minLength": 1
      }
    },
    "required": [
      "type"
    ]
  },
  "FTPBasicAuth": {
    "title": "FTPBasicAuth",
    "allOf": [
      {
        "$ref": "#/components/schemas/FTPAuth"
      },
      {
        "$ref": "#/components/schemas/BasicAuth"
      }
    ]
  },
  "FTPConnection": {
    "title": "FTPConnection",
    "allOf": [
      {
        "$ref": "#/components/schemas/Connection"
      },
      {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "minLength": 1,
            "example": "ftps://my-server.com"
          },
          "auth": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/FTPAuth"
              },
              {
                "type": "null"
              }
            ],
            "example": {
              "type": "basic_auth",
              "username": "my_username",
              "password": "my_password"
            }
          }
        },
        "required": [
          "url"
        ]
      }
    ]
  },
  "FTPDatasource": {
    "allOf": [
      {
        "$ref": "#/components/schemas/Datasource"
      },
      {
        "type": "object",
        "title": "FTPDatasource",
        "x-tags": [
          "Dataset resources"
        ],
        "properties": {
          "relative_url": {
            "type": "string"
          },
          "connection": {
            "oneOf": [
              {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "uid": {
                    "type": "string"
                  }
                },
                "required": [
                  "uid"
                ]
              },
              {
                "$ref": "#/components/schemas/FTPConnection"
              }
            ]
          }
        },
        "required": [
          "connection"
        ]
      }
    ],
    "title": "FTPDatasource"
  },
  "FederatedDataset": {
    "title": "Federated Dataset",
    "type": "object",
    "properties": {
      "dataset_id": {
        "type": "string"
      },
      "metas": {
        "type": "object"
      },
      "fields": {
        "type": "array",
        "items": {}
      }
    }
  },
  "FederatedDatasource": {
    "title": "Federated Datasource",
    "allOf": [
      {
        "$ref": "#/components/schemas/Datasource"
      },
      {
        "type": "object",
        "properties": {
          "domain": {
            "type": "object",
            "required": [
              "domain_id"
            ],
            "properties": {
              "domain_id": {
                "type": "string"
              }
            }
          },
          "dataset": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "dataset_id": {
                    "type": "string"
                  }
                },
                "required": [
                  "dataset_id"
                ]
              },
              {
                "$ref": "#/components/schemas/FederatedDataset"
              }
            ]
          },
          "permissions_user": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/RelatedUserReadOnly"
              },
              {
                "type": "null"
              }
            ],
            "readOnly": true
          },
          "impersonate_permissions": {
            "type": "boolean",
            "writeOnly": true
          },
          "parameters": {
            "type": "object"
          }
        },
        "required": [
          "domain",
          "dataset",
          "impersonate_permissions"
        ]
      }
    ]
  },
  "GoogleDriveAuth": {
    "title": "GoogleDriveAuth",
    "type": "object",
    "discriminator": {
      "propertyName": "type",
      "mapping": {
        "oidc": "#/components/schemas/GoogleDriveOIDCAuth"
      }
    },
    "properties": {
      "type": {
        "type": "string",
        "minLength": 1
      }
    },
    "required": [
      "type"
    ],
    "example": {
      "type": "oidc",
      "grant_type": "authorization_code",
      "claims": {}
    }
  },
  "GoogleDriveConnection": {
    "title": "GoogleDriveConnection",
    "allOf": [
      {
        "$ref": "#/components/schemas/Connection"
      },
      {
        "type": "object",
        "properties": {
          "auth": {
            "$ref": "#/components/schemas/GoogleDriveAuth"
          }
        }
      }
    ]
  },
  "GoogleDriveDatasource": {
    "allOf": [
      {
        "$ref": "#/components/schemas/Datasource"
      },
      {
        "type": "object",
        "x-tags": [
          "Dataset resources"
        ],
        "properties": {
          "file_id": {
            "type": "string"
          },
          "connection": {
            "oneOf": [
              {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "uid": {
                    "type": "string"
                  }
                },
                "required": [
                  "uid"
                ]
              },
              {
                "$ref": "#/components/schemas/GoogleDriveConnection"
              }
            ]
          }
        },
        "required": [
          "file_id",
          "connection"
        ]
      }
    ],
    "title": "GoogleDriveDatasource"
  },
  "GoogleDriveOIDCAuth": {
    "title": "GoogleDriveOIDCAuth",
    "allOf": [
      {
        "$ref": "#/components/schemas/GoogleDriveAuth"
      },
      {
        "$ref": "#/components/schemas/ODSOIDCAuth"
      },
      {
        "type": "object",
        "properties": {
          "application_id": {
            "type": "string",
            "readOnly": true
          }
        },
        "required": [
          "application_id"
        ]
      }
    ]
  },
  "HTTPAuth": {
    "title": "HTTPAuth",
    "type": "object",
    "discriminator": {
      "propertyName": "type",
      "mapping": {
        "basic_auth": "#/components/schemas/HTTPBasicAuth",
        "oauth2": "#/components/schemas/HTTPOAuth2Auth",
        "oidc": "#/components/schemas/HTTPOIDCAuth"
      }
    },
    "properties": {
      "type": {
        "type": "string",
        "minLength": 1
      }
    },
    "required": [
      "type"
    ]
  },
  "HTTPBasicAuth": {
    "title": "HTTPBasicAuth",
    "allOf": [
      {
        "$ref": "#/components/schemas/HTTPAuth"
      },
      {
        "$ref": "#/components/schemas/BasicAuth"
      }
    ]
  },
  "HTTPConnection": {
    "title": "HTTPConnection",
    "allOf": [
      {
        "$ref": "#/components/schemas/Connection"
      },
      {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "minLength": 1,
            "example": "https://my-server.com"
          },
          "headers": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "name": {
                  "type": "string",
                  "example": "header-name"
                },
                "value": {
                  "type": "string",
                  "example": "header-value"
                }
              },
              "required": [
                "name",
                "value"
              ]
            }
          },
          "auth": {
            "oneOf": [
              {
                "$ref": "#/components/schemas/HTTPAuth"
              },
              {
                "type": "null"
              }
            ],
            "example": {
              "type": "basic_auth",
              "username": "my_username",
              "password": "my_password"
            }
          }
        },
        "required": [
          "url"
        ]
      }
    ]
  },
  "HTTPDatasource": {
    "allOf": [
      {
        "$ref": "#/components/schemas/Datasource"
      },
      {
        "type": "object",
        "title": "HTTPDatasource",
        "x-tags": [
          "Dataset resources"
        ],
        "properties": {
          "relative_url": {
            "type": "string"
          },
          "headers": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "name": {
                  "type": "string"
                },
                "value": {
                  "type": "string"
                }
              }
            }
          },
          "connection": {
            "oneOf": [
              {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "uid": {
                    "type": "string"
                  }
                },
                "required": [
                  "uid"
                ]
              },
              {
                "$ref": "#/components/schemas/HTTPConnection"
              }
            ]
          }
        },
        "required": [
          "connection"
        ]
      }
    ],
    "title": "HTTPDatasource"
  },
  "HTTPOAuth2Auth": {
    "title": "HTTPOAuth2Auth",
    "allOf": [
      {
        "$ref": "#/components/schemas/HTTPAuth"
      },
      {
        "$ref": "#/components/schemas/OAuth2Auth"
      }
    ]
  },
  "HTTPOIDCAuth": {
    "title": "HTTPOIDCAuth",
    "allOf": [
      {
        "$ref": "#/components/schemas/HTTPAuth"
      },
      {
        "$ref": "#/components/schemas/OIDCAuth"
      }
    ]
  },
  "OAuth2Auth": {
    "title": "OAuth2Auth",
    "type": "object",
    "properties": {
      "client_id": {
        "type": "string"
      },
      "client_secret": {
        "type": "string",
        "writeOnly": true
      },
      "scope": {
        "type": "string"
      },
      "token_endpoint": {
        "type": "string"
      },
      "grant_type": {
        "type": "string",
        "enum": [
          "password",
          "authorization_code",
          "client_credentials"
        ]
      },
      "username": {
        "type": "string",
        "writeOnly": true
      },
      "password": {
        "type": "string",
        "writeOnly": true
      },
      "code": {
        "type": "string",
        "writeOnly": true
      }
    },
    "required": [
      "client_id",
      "client_secret",
      "scope",
      "token_endpoint",
      "grant_type"
    ]
  },
  "ODSOIDCAuth": {
    "title": "ODSOIDCAuth",
    "type": "object",
    "properties": {
      "nonce": {
        "type": "string",
        "writeOnly": true
      },
      "grant_type": {
        "type": "string",
        "enum": [
          "authorization_code"
        ]
      },
      "code": {
        "type": "string",
        "writeOnly": true
      },
      "claims": {
        "type": "object",
        "readOnly": true
      }
    },
    "required": [
      "nonce",
      "grant_type",
      "code",
      "claims"
    ]
  },
  "OIDCAuth": {
    "title": "OIDCAuth",
    "type": "object",
    "properties": {
      "client_id": {
        "type": "string"
      },
      "client_secret": {
        "type": "string",
        "writeOnly": true
      },
      "scope": {
        "type": "string"
      },
      "token_endpoint": {
        "type": "string"
      },
      "grant_type": {
        "type": "string",
        "enum": [
          "authorization_code"
        ]
      },
      "code": {
        "type": "string",
        "writeOnly": true
      },
      "claims": {
        "type": "object"
      }
    },
    "required": [
      "client_id",
      "client_secret",
      "scope",
      "token_endpoint",
      "grant_type"
    ]
  },
  "OrderDatasetFieldConfiguration": {
    "allOf": [
      {
        "$ref": "#/components/schemas/DatasetFieldConfiguration"
      },
      {
        "type": "object",
        "title": "OrderDatasetFieldConfiguration",
        "x-tags": [
          "Dataset fields"
        ],
        "properties": {
          "args": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "example": [
              "third_field",
              "second_field",
              "first_field"
            ],
            "description": "The ordered list of fields technical identifier"
          }
        },
        "required": [
          "args"
        ]
      }
    ],
    "title": "OrderDatasetFieldConfiguration"
  },
  "OriginInfos": {
    "title": "Origin information",
    "type": "object",
    "description": "Information about the origin of the resource (e.g. HTTP, FTP etc.)",
    "properties": {
      "label": {
        "type": "string",
        "description": "Human readable label for the resource origin",
        "example": "CSV File",
        "readOnly": true
      },
      "type": {
        "type": "string",
        "minLength": 1,
        "description": "Type of the resource origin. The most relevant information is returned between the datasource type and the extraction type. For example a resource using an HTTP Feed, has a \"feed\" origin, not HTTP.",
        "example": "csvfile",
        "readOnly": true
      }
    }
  },
  "RelatedUser": {
    "title": "Related user",
    "type": "object",
    "description": "Short representation of a User with only its username",
    "properties": {
      "username": {
        "type": "string",
        "example": "louise.data"
      }
    }
  },
  "RelatedUserReadOnly": {
    "title": "Related user",
    "type": "object",
    "description": "Short representation of a User with only its username",
    "properties": {
      "username": {
        "readOnly": true,
        "type": "string",
        "example": "louise.data"
      }
    },
    "readOnly": true
  },
  "RenameDatasetFieldConfiguration": {
    "allOf": [
      {
        "$ref": "#/components/schemas/DatasetFieldConfiguration"
      },
      {
        "type": "object",
        "title": "RenameDatasetFieldConfiguration",
        "x-tags": [
          "Dataset fields"
        ],
        "properties": {
          "from_name": {
            "type": "string",
            "minLength": 1,
            "example": "original_field_id",
            "description": "The original technical identifier"
          },
          "to_name": {
            "type": "string",
            "minLength": 1,
            "example": "new_field_id",
            "description": "The new technical identifier"
          },
          "field_label": {
            "type": "string",
            "minLength": 1,
            "example": "My user friendly label",
            "description": "A user friendly label for the field"
          }
        },
        "required": [
          "from_name",
          "to_name",
          "field_label"
        ]
      }
    ],
    "title": "RenameDatasetFieldConfiguration"
  },
  "Resource": {
    "title": "Resource schema",
    "type": "object",
    "x-tags": [
      "Dataset resources"
    ],
    "properties": {
      "uid": {
        "type": "string",
        "minLength": 1,
        "readOnly": true,
        "description": "Unique identifier for the resource"
      },
      "type": {
        "type": "string",
        "minLength": 1,
        "description": "Extractor type that should handle this resource"
      },
      "title": {
        "type": "string",
        "minLength": 1,
        "description": "User defined title for identifying the resource"
      },
      "display_name": {
        "type": "string",
        "minLength": 1,
        "description": "A name representing the resource. It is computed from the resource `title` and `datasource` depending on the type of resource",
        "readOnly": true
      },
      "extraction_infos": {
        "description": "Information about the kind of extraction configured for this resource, or null when it isn't relevant.",
        "oneOf": [
          {
            "$ref": "#/components/schemas/ExtractionInfos"
          },
          {
            "type": "null"
          }
        ],
        "readOnly": true
      },
      "origin": {
        "$ref": "#/components/schemas/OriginInfos",
        "readOnly": true
      },
      "updated_at": {
        "type": "string",
        "minLength": 1,
        "format": "date-time",
        "readOnly": true
      },
      "params": {
        "type": "object",
        "description": "Parameters passed to the extractor"
      },
      "datasource": {
        "$ref": "#/components/schemas/Datasource"
      },
      "url": {
        "type": "string",
        "minLength": 1
      }
    },
    "required": [
      "type",
      "title"
    ],
    "example": {
      "uid": "re_qf2hyt",
      "type": "csvfile",
      "title": "Fromages",
      "display_name": "https://my-server.com/fromages.csv",
      "extraction_infos": {
        "label": "CSV File",
        "type": "csvfile"
      },
      "origin": {
        "label": "HTTP",
        "type": "http"
      },
      "params": {
        "doublequote": true,
        "encoding": "utf-8",
        "first_row_no": 1,
        "headers_first_row": true,
        "separator": ";"
      },
      "datasource": {
        "type": "http",
        "connection": {
          "uid": "co_qf2hyt"
        },
        "headers": [
          {
            "name": "header-name",
            "value": "header-value"
          }
        ],
        "relative_url": "/fromages.csv"
      },
      "updated_at": "2022-01-01T00:00:00Z"
    }
  },
  "SharepointAuth": {
    "title": "SharepointAuth",
    "type": "object",
    "discriminator": {
      "propertyName": "type",
      "mapping": {
        "oidc": "#/components/schemas/SharepointOIDCAuth"
      }
    },
    "properties": {
      "type": {
        "type": "string",
        "minLength": 1
      }
    },
    "required": [
      "type"
    ],
    "example": {
      "type": "oidc",
      "grant_type": "authorization_code",
      "claims": {}
    }
  },
  "SharepointConnection": {
    "title": "SharepointConnection",
    "allOf": [
      {
        "$ref": "#/components/schemas/Connection"
      },
      {
        "type": "object",
        "properties": {
          "auth": {
            "$ref": "#/components/schemas/SharepointAuth"
          }
        }
      }
    ]
  },
  "SharepointDatasource": {
    "allOf": [
      {
        "$ref": "#/components/schemas/Datasource"
      },
      {
        "type": "object",
        "title": "SharepointDatasource",
        "x-tags": [
          "Dataset resources"
        ],
        "properties": {
          "file_id": {
            "type": "string"
          },
          "drive_id": {
            "type": "string"
          },
          "connection": {
            "oneOf": [
              {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "uid": {
                    "type": "string"
                  }
                },
                "required": [
                  "uid"
                ]
              },
              {
                "$ref": "#/components/schemas/SharepointConnection"
              }
            ]
          }
        },
        "required": [
          "file_id",
          "drive_id",
          "connection"
        ]
      }
    ],
    "title": "SharepointDatasource"
  },
  "SharepointOIDCAuth": {
    "title": "SharepointOIDCAuth",
    "allOf": [
      {
        "$ref": "#/components/schemas/SharepointAuth"
      },
      {
        "$ref": "#/components/schemas/ODSOIDCAuth"
      }
    ]
  },
  "TypeDatasetFieldConfiguration": {
    "allOf": [
      {
        "$ref": "#/components/schemas/DatasetFieldConfiguration"
      },
      {
        "type": "object",
        "title": "TypeDatasetFieldConfiguration",
        "x-tags": [
          "Dataset fields"
        ],
        "properties": {
          "field": {
            "type": "string",
            "minLength": 1,
            "example": "field_id",
            "description": "The technical identifier of the field you want to type"
          },
          "type_param": {
            "type": "string",
            "enum": [
              "text",
              "int",
              "double",
              "geo_point_2d",
              "geo_shape",
              "date",
              "datetime",
              "file"
            ],
            "description": "The type to apply",
            "example": "int"
          }
        },
        "required": [
          "field",
          "type_param"
        ]
      }
    ],
    "title": "TypeDatasetFieldConfiguration"
  },
  "UploadedFileDatasource": {
    "allOf": [
      {
        "$ref": "#/components/schemas/Datasource"
      },
      {
        "type": "object",
        "title": "UploadedFileDatasource",
        "x-tags": [
          "Dataset resources"
        ],
        "properties": {
          "file": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "uid": {
                    "type": "string"
                  }
                },
                "required": [
                  "uid"
                ]
              },
              {
                "$ref": "#/components/schemas/DatasetFile"
              }
            ]
          }
        },
        "required": [
          "file"
        ]
      }
    ],
    "title": "UploadedFileDatasource"
  },
  "MetadataValue": {
    "title": "Metadata value",
    "type": "object",
    "properties": {
      "value": {},
      "remote_value": {
        "readOnly": true
      },
      "override_remote_value": {
        "type": "boolean"
      }
    },
    "required": [
      "value"
    ]
  },
  "Metadata": {
    "title": "Dataset metadata",
    "type": "object",
    "additionalProperties": {
      "$ref": "#/components/schemas/DatasetMetadataTemplate"
    }
  },
  "DatasetUpdate": {
    "title": "Dataset configuration update",
    "type": "object",
    "properties": {
      "dataset_id": {
        "type": "string"
      },
      "is_restricted": {
        "type": "boolean"
      },
      "default_security": {
        "$ref": "#/components/schemas/DatasetSecurity"
      }
    }
  },
  "DatasetTranslations": {
    "title": "Dataset translation dictionary",
    "type": "object",
    "additionalProperties": {
      "type": "object",
      "additionalProperties": true
    }
  }
});
export const AUTOMATION_DATASET_STATUS_SCHEMA = freeze({
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "idle",
        "error",
        "limit_reached",
        "queued",
        "aborting_processing",
        "processing",
        "deleting",
        "saving_version"
      ]
    },
    "previous": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "type": "string",
          "enum": [
            "idle",
            "error",
            "limit_reached",
            "queued",
            "aborting_processing",
            "processing",
            "deleting",
            "saving_version"
          ]
        }
      ],
      "example": "processing"
    },
    "next": {
      "oneOf": [
        {
          "type": "null"
        },
        {
          "type": "string",
          "enum": [
            "idle",
            "error",
            "limit_reached",
            "queued",
            "aborting_processing",
            "processing",
            "deleting",
            "saving_version"
          ]
        }
      ],
      "example": null
    },
    "since": {
      "type": "string",
      "format": "date-time",
      "description": "Date when the dataset entered the current status"
    },
    "is_published": {
      "type": [
        null,
        "boolean"
      ],
      "example": true,
      "description": "will be `true` if the dataset is available in the explore API"
    },
    "message": {
      "type": [
        "string",
        "null"
      ],
      "example": null
    },
    "records_errors": {
      "description": "The record error describes errors which occurred during the processing. An error comes from:\n- a processor: when a value is invalid or an operation failed\n- a type conversion: when a value cannot be converted. For example the string \"s\" converted to an integer.",
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "record_id": {
            "type": "string",
            "description": "Identifier of the record after processing"
          },
          "field_uid": {
            "type": "string",
            "description": "Unique identifier of the field involved in the error"
          },
          "processor_uid": {
            "type": "string",
            "description": "Unique identifier of the processor which generates the error"
          },
          "message": {
            "type": "string",
            "description": "Human-readable error message"
          }
        }
      },
      "example": []
    },
    "params": {
      "type": "object",
      "description": "Status-dependent additional information. For example, if `status` is `limit reached`, this will contain an `error` object that contains a `limit_type`, a `limit` and a `value`.",
      "example": {}
    }
  }
});
export const AUTOMATION_DATASET_STATES = Object.freeze(["idle","error","limit_reached","queued","aborting_processing","processing","deleting","saving_version"]);
export const AUTOMATION_OPERATION_ALIASES = freeze({
  "list-metadata-template-fields": "get-metadata-fields-list"
});
export function automationOperation(operationId) {
  const requested = typeof operationId === 'string' ? operationId : '';
  const canonical = Object.hasOwn(AUTOMATION_OPERATION_ALIASES, requested) ? AUTOMATION_OPERATION_ALIASES[requested] : requested;
  const value = Object.hasOwn(AUTOMATION_OPERATIONS, canonical) ? AUTOMATION_OPERATIONS[canonical] : null;
  if (!value) { const error = new Error('Unknown native Automation API operation.'); error.code = 'ODS_AUTOMATION_OPERATION_INVALID'; throw error; }
  return value;
}
