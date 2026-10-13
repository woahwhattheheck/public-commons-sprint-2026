export const tools = [
  {
    "action": "workspace.get",
    "name": "audit_workspace_get",
    "description": "Read the complete original workspace state and current operating version.",
    "mutation": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "source.get",
    "name": "audit_source_get",
    "description": "Read one complete retained native source, revisions, model and validation. Use source.page for large original model lists.",
    "mutation": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "sourceId": {
          "type": "string"
        },
        "revisionId": {
          "type": "string"
        }
      },
      "required": [
        "sourceId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "source.page",
    "name": "audit_source_page",
    "description": "Read successive content-bound pages from one exact original XML model list.",
    "mutation": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "sourceId": {
          "type": "string"
        },
        "revisionId": {
          "type": "string"
        },
        "section": {
          "type": "string",
          "enum": [
            "entities",
            "fields",
            "references",
            "timeSeries",
            "diagnostics"
          ]
        },
        "offset": {
          "type": "integer",
          "minimum": 0
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 500
        }
      },
      "required": [
        "sourceId",
        "revisionId",
        "section"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "source.bytes",
    "name": "audit_source_bytes",
    "description": "Read all exact XML bytes in SHA-bound ranges, continuing until nextOffset is null.",
    "mutation": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "sourceId": {
          "type": "string"
        },
        "revisionId": {
          "type": "string"
        },
        "offset": {
          "type": "integer",
          "minimum": 0
        },
        "length": {
          "type": "integer",
          "minimum": 1,
          "maximum": 4194304
        }
      },
      "required": [
        "sourceId",
        "revisionId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "source.compare",
    "name": "audit_source_compare",
    "description": "Compare the complete original scalar and reference changes between retained revisions.",
    "mutation": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "sourceId": {
          "type": "string"
        },
        "fromRevisionId": {
          "type": "string"
        },
        "toRevisionId": {
          "type": "string"
        }
      },
      "required": [
        "sourceId",
        "fromRevisionId",
        "toRevisionId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "edition.get",
    "name": "audit_edition_get",
    "description": "Read a complete immutable source/review/link/analysis edition.",
    "mutation": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "editionId": {
          "type": "string"
        }
      },
      "required": [
        "editionId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "export.get",
    "name": "audit_export_get",
    "description": "Read complete retained metadata and its original download identity.",
    "mutation": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "exportId": {
          "type": "string"
        }
      },
      "required": [
        "exportId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "export.read",
    "name": "audit_export_read",
    "description": "Read a complete retained delivery in SHA-bound byte ranges.",
    "mutation": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "exportId": {
          "type": "string"
        },
        "offset": {
          "type": "integer",
          "minimum": 0
        },
        "length": {
          "type": "integer",
          "minimum": 1,
          "maximum": 4194304
        }
      },
      "required": [
        "exportId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "operation.get",
    "name": "audit_operation_get",
    "description": "Recover the saved result of an original mutation UUID without repeating its effect.",
    "mutation": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "requestId": {
          "type": "string"
        }
      },
      "required": [
        "requestId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "analysis.preview",
    "name": "audit_analysis_preview",
    "description": "Inspect the exact source, building, scenario, resource, reading type, units and native substream before analysis.",
    "mutation": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "sourceId": {
          "type": "string"
        },
        "revisionId": {
          "type": "string"
        },
        "buildingKey": {
          "type": "string"
        },
        "scenarioKey": {
          "type": "string"
        },
        "resourceKey": {
          "type": "string"
        },
        "readingType": {
          "type": "string"
        },
        "units": {
          "type": "string"
        },
        "streamKey": {
          "type": "string"
        }
      },
      "required": [
        "sourceId",
        "revisionId",
        "buildingKey",
        "scenarioKey",
        "resourceKey",
        "readingType",
        "units"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "projection.preview",
    "name": "audit_projection_preview",
    "description": "Preview the complete eight-table turnover projection from deliberately selected original entities.",
    "mutation": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "sourceId": {
          "type": "string"
        },
        "revisionId": {
          "type": "string"
        },
        "assetEntityKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "documentEntityKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requirementEntityKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "sourceId",
        "revisionId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "source.import",
    "name": "audit_source_import",
    "description": "Retain one complete original audit XML, native identifiers and selected official validation profiles.",
    "mutation": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "requestId": {
          "type": "string"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 0
        },
        "actor": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "contentBase64": {
          "type": "string"
        },
        "originUri": {
          "type": "string"
        },
        "selectedSchema": {
          "type": "string",
          "enum": [
            "2.7.0"
          ]
        },
        "profileIds": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "ashrae-l000",
              "ashrae-l100",
              "ashrae-l200",
              "bsyncr-input"
            ]
          }
        }
      },
      "required": [
        "requestId",
        "expectedVersion",
        "actor",
        "note",
        "name",
        "contentBase64",
        "selectedSchema",
        "profileIds"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "source.replace",
    "name": "audit_source_replace",
    "description": "Save a complete replacement XML revision against its reviewed original predecessor.",
    "mutation": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "requestId": {
          "type": "string"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 0
        },
        "actor": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "sourceId": {
          "type": "string"
        },
        "expectedRevisionId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "contentBase64": {
          "type": "string"
        },
        "selectedSchema": {
          "type": "string",
          "enum": [
            "2.7.0"
          ]
        },
        "profileIds": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "ashrae-l000",
              "ashrae-l100",
              "ashrae-l200",
              "bsyncr-input"
            ]
          }
        }
      },
      "required": [
        "requestId",
        "expectedVersion",
        "actor",
        "note",
        "sourceId",
        "expectedRevisionId",
        "contentBase64"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "source.patch",
    "name": "audit_source_patch",
    "description": "Save atomic exact-value scalar corrections against their full original expected values.",
    "mutation": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "requestId": {
          "type": "string"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 0
        },
        "actor": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "sourceId": {
          "type": "string"
        },
        "expectedRevisionId": {
          "type": "string"
        },
        "patches": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string"
              },
              "kind": {
                "type": "string",
                "enum": [
                  "text",
                  "attribute"
                ]
              },
              "attributeName": {
                "type": "string"
              },
              "expected": {
                "type": "string"
              },
              "value": {
                "type": "string"
              }
            },
            "required": [
              "path",
              "kind",
              "expected",
              "value"
            ],
            "additionalProperties": false
          }
        },
        "selectedSchema": {
          "type": "string",
          "enum": [
            "2.7.0"
          ]
        },
        "profileIds": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "ashrae-l000",
              "ashrae-l100",
              "ashrae-l200",
              "bsyncr-input"
            ]
          }
        }
      },
      "required": [
        "requestId",
        "expectedVersion",
        "actor",
        "note",
        "sourceId",
        "expectedRevisionId",
        "patches"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "source.validate",
    "name": "audit_source_validate",
    "description": "Save a new original revision with deliberately selected official schema and use-case validation.",
    "mutation": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "requestId": {
          "type": "string"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 0
        },
        "actor": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "sourceId": {
          "type": "string"
        },
        "expectedRevisionId": {
          "type": "string"
        },
        "selectedSchema": {
          "type": "string",
          "enum": [
            "2.7.0"
          ]
        },
        "profileIds": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "ashrae-l000",
              "ashrae-l100",
              "ashrae-l200",
              "bsyncr-input"
            ]
          }
        }
      },
      "required": [
        "requestId",
        "expectedVersion",
        "actor",
        "note",
        "sourceId",
        "expectedRevisionId",
        "selectedSchema",
        "profileIds"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "edition.save",
    "name": "audit_edition_save",
    "description": "Save the complete source selection and frozen operational review state as an immutable edition.",
    "mutation": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "requestId": {
          "type": "string"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 0
        },
        "actor": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "requestId",
        "expectedVersion",
        "actor",
        "note",
        "name"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "review.save",
    "name": "audit_review_save",
    "description": "Create or update a source/revision-bound operational finding with owner, date and evidence.",
    "mutation": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "requestId": {
          "type": "string"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 0
        },
        "actor": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "sourceId": {
          "type": "string"
        },
        "revisionId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "entityKey": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "open",
            "investigating",
            "resolved",
            "accepted"
          ]
        },
        "title": {
          "type": "string"
        },
        "assignee": {
          "type": "string"
        },
        "dueDate": {
          "type": "string"
        },
        "evidence": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "label": {
                "type": "string"
              },
              "url": {
                "type": "string"
              }
            },
            "required": [
              "label",
              "url"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "requestId",
        "expectedVersion",
        "actor",
        "note",
        "sourceId",
        "revisionId",
        "status",
        "title",
        "assignee",
        "dueDate"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "link.save",
    "name": "audit_link_save",
    "description": "Save an explicit sidecar relationship to an existing Haystack, LDA or turnover record.",
    "mutation": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "requestId": {
          "type": "string"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 0
        },
        "actor": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "sourceId": {
          "type": "string"
        },
        "revisionId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "entityKey": {
          "type": "string"
        },
        "targetKind": {
          "type": "string",
          "enum": [
            "haystack",
            "lda",
            "turnover"
          ]
        },
        "targetWorkspaceId": {
          "type": "string"
        },
        "targetRecordId": {
          "type": "string"
        }
      },
      "required": [
        "requestId",
        "expectedVersion",
        "actor",
        "note",
        "sourceId",
        "revisionId",
        "entityKey",
        "targetKind",
        "targetWorkspaceId",
        "targetRecordId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "projection.save",
    "name": "audit_projection_save",
    "description": "Save the complete previewed eight-table projection, original XML and native audit view.",
    "mutation": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "requestId": {
          "type": "string"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 0
        },
        "actor": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "sourceId": {
          "type": "string"
        },
        "revisionId": {
          "type": "string"
        },
        "assetEntityKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "documentEntityKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requirementEntityKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "expectedSelectionSha256": {
          "type": "string"
        }
      },
      "required": [
        "requestId",
        "expectedVersion",
        "actor",
        "note",
        "sourceId",
        "revisionId",
        "expectedSelectionSha256"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "analysis.run",
    "name": "audit_analysis_run",
    "description": "Queue a real nmecr run with complete original XML selection, supplied observed weather and explicit native model options.",
    "mutation": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "requestId": {
          "type": "string"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 0
        },
        "actor": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "sourceId": {
          "type": "string"
        },
        "revisionId": {
          "type": "string"
        },
        "buildingKey": {
          "type": "string"
        },
        "scenarioKey": {
          "type": "string"
        },
        "resourceKey": {
          "type": "string"
        },
        "readingType": {
          "type": "string"
        },
        "units": {
          "type": "string"
        },
        "streamKey": {
          "type": "string"
        },
        "weatherCsvBase64": {
          "type": "string"
        },
        "weatherName": {
          "type": "string"
        },
        "weatherSource": {
          "type": "string"
        },
        "modelOptions": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "requestId",
        "expectedVersion",
        "actor",
        "note",
        "sourceId",
        "revisionId",
        "buildingKey",
        "scenarioKey",
        "resourceKey",
        "readingType",
        "units",
        "weatherCsvBase64",
        "weatherName",
        "weatherSource",
        "modelOptions"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "analysis.resume",
    "name": "audit_analysis_resume",
    "description": "Continue the same recoverable native operation with its original immutable inputs and model checkpoints.",
    "mutation": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "requestId": {
          "type": "string"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 0
        },
        "actor": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "analysisId": {
          "type": "string"
        }
      },
      "required": [
        "requestId",
        "expectedVersion",
        "actor",
        "note",
        "analysisId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "export.create",
    "name": "audit_export_create",
    "description": "Save complete original XML, a current/saved-edition review, or an editable workspace/application handover.",
    "mutation": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "requestId": {
          "type": "string"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 0
        },
        "actor": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "kind": {
          "type": "string",
          "enum": [
            "xml",
            "review",
            "workspace",
            "application"
          ]
        },
        "sourceId": {
          "type": "string"
        },
        "revisionId": {
          "type": "string"
        },
        "editionId": {
          "type": "string"
        }
      },
      "required": [
        "requestId",
        "expectedVersion",
        "actor",
        "note",
        "kind"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "workspace.receive",
    "name": "audit_workspace_receive",
    "description": "Receive a complete editable workspace/application package, preserving all original sources and native history.",
    "mutation": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "requestId": {
          "type": "string"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 0
        },
        "actor": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "contentBase64": {
          "type": "string"
        }
      },
      "required": [
        "requestId",
        "expectedVersion",
        "actor",
        "note",
        "name",
        "contentBase64"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "return.preview",
    "name": "audit_return_preview",
    "description": "Read the complete colleague return, bind original source ancestry and compare baseline, current and returned native fields and reviews.",
    "mutation": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "contentBase64": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "baselines": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "sourceId": {
                "type": "string"
              },
              "returnedSourceId": {
                "type": "string"
              },
              "baselineRevisionId": {
                "type": "string"
              }
            },
            "required": [
              "sourceId",
              "returnedSourceId",
              "baselineRevisionId"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "contentBase64",
        "name"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "return.plan",
    "name": "audit_return_plan",
    "description": "Prepare the explicitly selected native corrections and returned reviews, retaining complete validation and an exact application plan.",
    "mutation": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "contentBase64": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "expectedPreviewSha256": {
          "type": "string"
        },
        "selections": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "sourceId": {
                "type": "string"
              },
              "returnedSourceId": {
                "type": "string"
              },
              "baselineRevisionId": {
                "type": "string"
              },
              "expectedCurrentRevisionId": {
                "type": "string"
              },
              "expectedCurrentSha256": {
                "type": "string"
              },
              "mode": {
                "type": "string",
                "enum": [
                  "fields",
                  "current",
                  "returned-document"
                ]
              },
              "decisions": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "fieldId": {
                      "type": "string"
                    },
                    "choice": {
                      "type": "string",
                      "enum": [
                        "current",
                        "returned",
                        "custom"
                      ]
                    },
                    "value": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "fieldId",
                    "choice"
                  ],
                  "additionalProperties": false
                }
              },
              "reviewIds": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "note": {
                "type": "string"
              }
            },
            "required": [
              "sourceId",
              "returnedSourceId",
              "baselineRevisionId",
              "expectedCurrentRevisionId",
              "expectedCurrentSha256",
              "mode",
              "decisions",
              "reviewIds",
              "note"
            ],
            "additionalProperties": false
          }
        },
        "baselines": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "sourceId": {
                "type": "string"
              },
              "returnedSourceId": {
                "type": "string"
              },
              "baselineRevisionId": {
                "type": "string"
              }
            },
            "required": [
              "sourceId",
              "returnedSourceId",
              "baselineRevisionId"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "contentBase64",
        "name",
        "expectedPreviewSha256",
        "selections"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  },
  {
    "action": "return.apply",
    "name": "audit_return_apply",
    "description": "Apply the reviewed complete correction plan in the original workspace transaction, retaining the whole returned project, native revision history and selected reviews.",
    "mutation": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "contentBase64": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "expectedPreviewSha256": {
          "type": "string"
        },
        "selections": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "sourceId": {
                "type": "string"
              },
              "returnedSourceId": {
                "type": "string"
              },
              "baselineRevisionId": {
                "type": "string"
              },
              "expectedCurrentRevisionId": {
                "type": "string"
              },
              "expectedCurrentSha256": {
                "type": "string"
              },
              "mode": {
                "type": "string",
                "enum": [
                  "fields",
                  "current",
                  "returned-document"
                ]
              },
              "decisions": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "fieldId": {
                      "type": "string"
                    },
                    "choice": {
                      "type": "string",
                      "enum": [
                        "current",
                        "returned",
                        "custom"
                      ]
                    },
                    "value": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "fieldId",
                    "choice"
                  ],
                  "additionalProperties": false
                }
              },
              "reviewIds": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "note": {
                "type": "string"
              }
            },
            "required": [
              "sourceId",
              "returnedSourceId",
              "baselineRevisionId",
              "expectedCurrentRevisionId",
              "expectedCurrentSha256",
              "mode",
              "decisions",
              "reviewIds",
              "note"
            ],
            "additionalProperties": false
          }
        },
        "expectedPlanSha256": {
          "type": "string"
        },
        "acceptDiagnostics": {
          "type": "boolean"
        },
        "actor": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "requestId": {
          "type": "string"
        },
        "expectedVersion": {
          "type": "integer",
          "minimum": 0
        },
        "baselines": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "sourceId": {
                "type": "string"
              },
              "returnedSourceId": {
                "type": "string"
              },
              "baselineRevisionId": {
                "type": "string"
              }
            },
            "required": [
              "sourceId",
              "returnedSourceId",
              "baselineRevisionId"
            ],
            "additionalProperties": false
          }
        },
        "editionName": {
          "type": "string"
        }
      },
      "required": [
        "contentBase64",
        "name",
        "expectedPreviewSha256",
        "selections",
        "expectedPlanSha256",
        "acceptDiagnostics",
        "actor",
        "requestId",
        "expectedVersion"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "idempotentHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    }
  }
];

export function validateValue(value,schema,where="arguments") {
  const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:"AUDIT_TOOL_INPUT",status:400});};
  if(schema.type==="object"){
    need(value!==null&&typeof value==="object"&&!Array.isArray(value),where+" must be an object.");
    if(schema.additionalProperties===false)need(Object.keys(value).every(k=>Object.hasOwn(schema.properties??{},k)),where+" includes undeclared fields.");
    for(const k of schema.required??[])need(Object.hasOwn(value,k),where+" requires "+k+".");
    for(const [k,v] of Object.entries(value))if(schema.properties?.[k])validateValue(v,schema.properties[k],where+"."+k);
  }
  if(schema.type==="array"){need(Array.isArray(value),where+" must be a complete list.");value.forEach((v,k)=>validateValue(v,schema.items??{},where+"["+k+"]"));}
  if(schema.type==="boolean")need(typeof value==="boolean",where+" must be a boolean.");
  if(schema.type==="string")need(typeof value==="string",where+" must be a string.");
  if(schema.type==="integer")need(Number.isSafeInteger(value)&&value>=(schema.minimum??Number.MIN_SAFE_INTEGER)&&value<=(schema.maximum??Number.MAX_SAFE_INTEGER),where+" requires a supported integer.");
  if(schema.enum)need(schema.enum.includes(value),where+" requires a supported choice.");
}
export function nativeEnvelope(tool,args) {
  validateValue(args,tool.inputSchema);
  if(tool.mutation){const {requestId,expectedVersion,...inputs}=args;return {action:tool.action,inputs,requestId,expectedVersion};}
  return {action:tool.action,inputs:args};
}
