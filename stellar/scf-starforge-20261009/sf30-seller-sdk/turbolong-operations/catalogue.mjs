// MIT. Turbolong operating contracts, derived from selected original source.
const freeze = value => { if (value && typeof value === 'object') { for (const v of Object.values(value)) freeze(v); Object.freeze(value); } return value; };
export const TURBOLONG_ORIGINAL = freeze({repository:'Dgetsylver/TurboLong',commit:'f017de605bb020bf3d7f4285aae4c654508e8d86',tree:'e8a4b6fa5abe3cba1eea7bbebe26ab84e04ea053',fileCount:276,sourceBytes:4813567});
export const TURBOLONG_ACTIONS = freeze([
  {
    "action": "vault.inspect",
    "name": "vault.inspect",
    "title": "Read deployed vault state",
    "category": "vault",
    "inputSchema": {
      "type": "object",
      "properties": {
        "strategyId": {
          "type": "string",
          "pattern": "^C[A-Z2-7]{55}$"
        },
        "symbol": {
          "type": "string"
        },
        "network": {
          "enum": [
            "mainnet",
            "testnet"
          ]
        },
        "methods": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "strategyId"
      ],
      "additionalProperties": true
    },
    "resultKind": "vault.state",
    "mutates": false,
    "readOnly": true,
    "transport": "original-runtime",
    "original": {
      "source": "contracts/strategies/blend_leverage/src/lib.rs",
      "semantics": "Original Soroban read methods and original SDK simulation; preserve tuples, raw token amounts, and scale metadata. Shares price against equity less locked profit."
    }
  },
  {
    "action": "vault.shareInspect",
    "name": "vault.shareInspect",
    "title": "Read vault share token",
    "category": "vault",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tokenId": {
          "type": "string",
          "pattern": "^C[A-Z2-7]{55}$"
        },
        "holder": {
          "type": "string",
          "pattern": "^[GC][A-Z2-7]{55}$"
        },
        "spender": {
          "type": "string",
          "pattern": "^[GC][A-Z2-7]{55}$"
        },
        "methods": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "network": {
          "enum": [
            "mainnet",
            "testnet"
          ]
        }
      },
      "required": [
        "tokenId"
      ],
      "additionalProperties": true
    },
    "resultKind": "vault.share-state",
    "mutates": false,
    "readOnly": true,
    "transport": "original-runtime",
    "original": {
      "source": "contracts/tokens/vault_share/src/lib.rs",
      "semantics": "Resolve the selected token or original strategy share_token view; read original token supply, decimals, metadata and selected balance/allowance."
    }
  },
  {
    "action": "keeper.rebalance.probe",
    "name": "keeper.rebalance.probe",
    "title": "Probe one keeper pass",
    "category": "keeper",
    "inputSchema": {
      "type": "object",
      "properties": {
        "vaults": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "symbol": {
                "type": "string"
              },
              "strategyId": {
                "type": "string",
                "pattern": "^C[A-Z2-7]{55}$"
              }
            },
            "required": [
              "symbol",
              "strategyId"
            ],
            "additionalProperties": false
          },
          "minItems": 1
        },
        "network": {
          "enum": [
            "mainnet",
            "testnet"
          ]
        }
      },
      "required": [],
      "additionalProperties": true
    },
    "resultKind": "keeper.rebalance",
    "mutates": false,
    "readOnly": true,
    "transport": "original-runtime",
    "original": {
      "source": "scripts/rebalance_keeper.ts",
      "semantics": "Original dry-run single pass, using actual contract config, position and original transaction simulation. Preserve every original row; process exit alone does not establish vault success."
    }
  },
  {
    "action": "keeper.rebalance.execute",
    "name": "keeper.rebalance.execute",
    "title": "Execute one keeper pass",
    "category": "keeper",
    "inputSchema": {
      "type": "object",
      "properties": {
        "vaults": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "symbol": {
                "type": "string"
              },
              "strategyId": {
                "type": "string",
                "pattern": "^C[A-Z2-7]{55}$"
              }
            },
            "required": [
              "symbol",
              "strategyId"
            ],
            "additionalProperties": false
          },
          "minItems": 1
        },
        "network": {
          "enum": [
            "mainnet",
            "testnet"
          ]
        }
      },
      "required": [],
      "additionalProperties": true
    },
    "resultKind": "keeper.rebalance",
    "mutates": true,
    "readOnly": false,
    "transport": "original-runtime",
    "original": {
      "source": "scripts/rebalance_keeper.ts",
      "semantics": "Original --execute single pass; original contract owns target, cooldown and risk thresholds. Preserve every probe, skip, rejection, transaction and before/after state."
    }
  },
  {
    "action": "keeper.harvest.quote",
    "name": "keeper.harvest.quote",
    "title": "Quote original harvest router",
    "category": "keeper",
    "inputSchema": {
      "type": "object",
      "properties": {
        "vaults": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "symbol": {
                "type": "string",
                "minLength": 1
              },
              "strategyId": {
                "type": "string",
                "pattern": "^C[A-Z2-7]{55}$"
              },
              "underlyingClassic": {
                "anyOf": [
                  {
                    "type": "string",
                    "minLength": 1
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "underlyingSoroban": {
                "type": "string",
                "pattern": "^C[A-Z2-7]{55}$"
              },
              "swapVia": {
                "anyOf": [
                  {
                    "type": "string",
                    "pattern": "^C[A-Z2-7]{55}$"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "required": [
              "symbol",
              "strategyId",
              "underlyingClassic",
              "underlyingSoroban"
            ],
            "additionalProperties": true
          },
          "minItems": 1
        },
        "quoteAmountBlnd": {
          "type": "string",
          "pattern": "^-?[0-9]+$"
        },
        "slippage": {
          "type": "number",
          "minimum": 0,
          "exclusiveMaximum": 1
        },
        "telemetry": {
          "type": "boolean"
        },
        "network": {
          "enum": [
            "mainnet"
          ]
        }
      },
      "required": [],
      "additionalProperties": true
    },
    "resultKind": "keeper.harvest",
    "mutates": false,
    "readOnly": true,
    "transport": "original-runtime",
    "conditionalMutations": [
      {
        "argument": "telemetry",
        "equals": true,
        "description": "The original script POSTs route telemetry when selected ingest bindings are explicitly enabled."
      }
    ],
    "original": {
      "source": "scripts/harvest_router.ts",
      "semantics": "Original mainnet routing/claim/settlement logic. Preserve original quotes, chosen route, reason, integer amounts, partial fills, fallback rows, original slippage and transaction IDs. Each row is an outcome, not automatically a distinct harvest."
    }
  },
  {
    "action": "keeper.harvest.execute",
    "name": "keeper.harvest.execute",
    "title": "Execute original harvest router",
    "category": "keeper",
    "inputSchema": {
      "type": "object",
      "properties": {
        "vaults": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "symbol": {
                "type": "string",
                "minLength": 1
              },
              "strategyId": {
                "type": "string",
                "pattern": "^C[A-Z2-7]{55}$"
              },
              "underlyingClassic": {
                "anyOf": [
                  {
                    "type": "string",
                    "minLength": 1
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "underlyingSoroban": {
                "type": "string",
                "pattern": "^C[A-Z2-7]{55}$"
              },
              "swapVia": {
                "anyOf": [
                  {
                    "type": "string",
                    "pattern": "^C[A-Z2-7]{55}$"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "required": [
              "symbol",
              "strategyId",
              "underlyingClassic",
              "underlyingSoroban"
            ],
            "additionalProperties": true
          },
          "minItems": 1
        },
        "quoteAmountBlnd": {
          "type": "string",
          "pattern": "^-?[0-9]+$"
        },
        "slippage": {
          "type": "number",
          "minimum": 0,
          "exclusiveMaximum": 1
        },
        "telemetry": {
          "type": "boolean"
        },
        "network": {
          "enum": [
            "mainnet"
          ]
        }
      },
      "required": [
        "vaults"
      ],
      "additionalProperties": true
    },
    "resultKind": "keeper.harvest",
    "mutates": true,
    "readOnly": false,
    "transport": "original-runtime",
    "conditionalMutations": [
      {
        "argument": "telemetry",
        "equals": true,
        "description": "The original script POSTs route telemetry when selected ingest bindings are explicitly enabled."
      }
    ],
    "original": {
      "source": "scripts/harvest_router.ts",
      "semantics": "Original mainnet routing/claim/settlement logic. Preserve original quotes, chosen route, reason, integer amounts, partial fills, fallback rows, original slippage and transaction IDs. Each row is an outcome, not automatically a distinct harvest."
    }
  },
  {
    "action": "routing.report",
    "name": "routing.report",
    "title": "Run the original route report",
    "category": "routing",
    "inputSchema": {
      "type": "object",
      "properties": {
        "network": {
          "enum": [
            "mainnet",
            "testnet"
          ]
        },
        "url": {
          "type": "string"
        }
      },
      "required": [],
      "additionalProperties": true
    },
    "resultKind": "routing.original-report",
    "mutates": false,
    "readOnly": true,
    "transport": "original-runtime",
    "original": {
      "source": "scripts/swap_route_report.ts",
      "semantics": "Run original live-data report; its server aggregate is all-time and latest row statistics are a limited window. Retain source scope beside the output."
    }
  },
  {
    "action": "rates.project",
    "name": "rates.project",
    "title": "Project rates with the original Rust binary",
    "category": "rates",
    "inputSchema": {
      "type": "object",
      "properties": {
        "inputs": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string"
              },
              "rateConfig": {
                "type": "object",
                "properties": {
                  "rBase": {
                    "anyOf": [
                      {
                        "type": "integer"
                      },
                      {
                        "type": "string",
                        "pattern": "^(?:0|-?[1-9][0-9]*)$",
                        "maxLength": 20
                      }
                    ],
                    "x-original-integer": "i64",
                    "description": "Original Rust i64; use a canonical decimal string beyond JavaScript's safe integer range."
                  },
                  "rOne": {
                    "anyOf": [
                      {
                        "type": "integer"
                      },
                      {
                        "type": "string",
                        "pattern": "^(?:0|-?[1-9][0-9]*)$",
                        "maxLength": 20
                      }
                    ],
                    "x-original-integer": "i64",
                    "description": "Original Rust i64; use a canonical decimal string beyond JavaScript's safe integer range."
                  },
                  "rTwo": {
                    "anyOf": [
                      {
                        "type": "integer"
                      },
                      {
                        "type": "string",
                        "pattern": "^(?:0|-?[1-9][0-9]*)$",
                        "maxLength": 20
                      }
                    ],
                    "x-original-integer": "i64",
                    "description": "Original Rust i64; use a canonical decimal string beyond JavaScript's safe integer range."
                  },
                  "rThree": {
                    "anyOf": [
                      {
                        "type": "integer"
                      },
                      {
                        "type": "string",
                        "pattern": "^(?:0|-?[1-9][0-9]*)$",
                        "maxLength": 20
                      }
                    ],
                    "x-original-integer": "i64",
                    "description": "Original Rust i64; use a canonical decimal string beyond JavaScript's safe integer range."
                  },
                  "utilOpt": {
                    "anyOf": [
                      {
                        "type": "integer"
                      },
                      {
                        "type": "string",
                        "pattern": "^(?:0|-?[1-9][0-9]*)$",
                        "maxLength": 20
                      }
                    ],
                    "x-original-integer": "i64",
                    "description": "Original Rust i64; use a canonical decimal string beyond JavaScript's safe integer range."
                  },
                  "irMod": {
                    "anyOf": [
                      {
                        "type": "integer"
                      },
                      {
                        "type": "string",
                        "pattern": "^(?:0|-?[1-9][0-9]*)$",
                        "maxLength": 20
                      }
                    ],
                    "x-original-integer": "i64",
                    "description": "Original Rust i64; use a canonical decimal string beyond JavaScript's safe integer range."
                  },
                  "backstopFP": {
                    "anyOf": [
                      {
                        "type": "integer"
                      },
                      {
                        "type": "string",
                        "pattern": "^(?:0|-?[1-9][0-9]*)$",
                        "maxLength": 20
                      }
                    ],
                    "x-original-integer": "i64",
                    "description": "Original Rust i64; use a canonical decimal string beyond JavaScript's safe integer range."
                  }
                },
                "required": [
                  "rBase",
                  "rOne",
                  "rTwo",
                  "rThree",
                  "utilOpt",
                  "irMod",
                  "backstopFP"
                ],
                "additionalProperties": false
              },
              "totalSupply": {
                "type": "number"
              },
              "totalBorrow": {
                "type": "number"
              },
              "addSupply": {
                "type": "number"
              },
              "addBorrow": {
                "type": "number"
              },
              "priceUsd": {
                "type": "number"
              },
              "blndPrice": {
                "type": "number"
              },
              "supplyEps": {
                "anyOf": [
                  {
                    "type": "integer",
                    "minimum": 0
                  },
                  {
                    "type": "string",
                    "pattern": "^(?:0|[1-9][0-9]*)$",
                    "maxLength": 20
                  }
                ],
                "x-original-integer": "u64",
                "description": "Original Rust u64; use a canonical decimal string beyond JavaScript's safe integer range."
              },
              "borrowEps": {
                "anyOf": [
                  {
                    "type": "integer",
                    "minimum": 0
                  },
                  {
                    "type": "string",
                    "pattern": "^(?:0|[1-9][0-9]*)$",
                    "maxLength": 20
                  }
                ],
                "x-original-integer": "u64",
                "description": "Original Rust u64; use a canonical decimal string beyond JavaScript's safe integer range."
              }
            },
            "required": [
              "name",
              "rateConfig",
              "totalSupply",
              "totalBorrow",
              "addSupply",
              "addBorrow",
              "priceUsd",
              "supplyEps",
              "borrowEps",
              "blndPrice"
            ],
            "additionalProperties": false
          },
          "minItems": 1
        }
      },
      "required": [
        "inputs"
      ],
      "additionalProperties": true
    },
    "resultKind": "rates.original-projection",
    "mutates": false,
    "readOnly": true,
    "transport": "original-runtime",
    "original": {
      "source": "src/bin/rate_calc.rs",
      "semantics": "The entire selected fixture array goes to original rate_calc stdin. Preserve original binary/source/build identities, complete input and complete output."
    }
  },
  {
    "action": "rates.simulate",
    "name": "rates.simulate",
    "title": "Run the original mainnet loop analysis",
    "category": "rates",
    "inputSchema": {
      "type": "object",
      "properties": {
        "loops": {
          "type": "integer",
          "minimum": 1
        }
      },
      "required": [],
      "additionalProperties": true
    },
    "resultKind": "rates.original-simulation",
    "mutates": false,
    "readOnly": true,
    "transport": "original-runtime",
    "original": {
      "source": "src/bin/simulate.rs",
      "semantics": "Original Stellar CLI mainnet reads and Rust simulation at its original hardcoded pool/USDC addresses. --loops is the original loop count; all original inputs and output are retained."
    }
  },
  {
    "action": "deployment.plan",
    "name": "deployment.plan",
    "title": "Prepare the selected original deployment",
    "category": "deployment",
    "inputSchema": {
      "type": "object",
      "properties": {
        "network": {
          "enum": [
            "mainnet",
            "testnet"
          ]
        },
        "adminPublicKey": {
          "type": "string",
          "pattern": "^[GC][A-Z2-7]{55}$"
        },
        "keeperPublicKey": {
          "type": "string",
          "pattern": "^[GC][A-Z2-7]{55}$"
        },
        "minHarvestRates": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "pattern": "^-?[0-9]+$"
          }
        }
      },
      "required": [],
      "additionalProperties": true
    },
    "resultKind": "deployment.original-plan",
    "mutates": false,
    "readOnly": true,
    "transport": "original-runtime",
    "original": {
      "source": "docs/mainnet-go-live-runbook.md",
      "semantics": "Original deploy DRY_RUN=1 validates/prepares the first WASM install and then exits. Preserve that actual phase and output; subsequent deployment phases retain their source/runbook descriptors."
    }
  },
  {
    "action": "snapshots.list",
    "name": "snapshots.list",
    "title": "Acquire rate snapshot history",
    "category": "telemetry",
    "inputSchema": {
      "type": "object",
      "properties": {
        "pool_id": {
          "type": "string",
          "pattern": "^C[A-Z2-7]{55}$"
        },
        "asset": {
          "type": "string"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 500
        },
        "before": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1
            },
            {
              "type": "string",
              "pattern": "^[1-9][0-9]*$"
            }
          ]
        },
        "network": {
          "enum": [
            "mainnet",
            "testnet"
          ]
        },
        "startsAt": {
          "type": "string",
          "minLength": 10
        },
        "endsAt": {
          "type": "string",
          "minLength": 10
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "resultKind": "rates.snapshots",
    "mutates": false,
    "readOnly": true,
    "transport": "http",
    "pagination": {
      "style": "before",
      "cursorField": "nextCursor",
      "order": "id-descending",
      "maximumPageSize": 500,
      "continuation": "Follow nextArgs; keep immutable period bounds. A terminal cursor means the selected query's retained history was exhausted."
    },
    "original": {
      "source": "alerts/src/index.ts",
      "semantics": "GET /snapshots; preserve all original rows and response bytes. The original query uses before=id and returns nextCursor. Date filtering is performed locally after capture."
    }
  },
  {
    "action": "routes.list",
    "name": "routes.list",
    "title": "Acquire the latest route window",
    "category": "telemetry",
    "inputSchema": {
      "type": "object",
      "properties": {
        "strategy_id": {
          "type": "string",
          "pattern": "^C[A-Z2-7]{55}$"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 500
        },
        "network": {
          "enum": [
            "mainnet",
            "testnet"
          ]
        },
        "startsAt": {
          "type": "string",
          "minLength": 10
        },
        "endsAt": {
          "type": "string",
          "minLength": 10
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "resultKind": "routing.window",
    "mutates": false,
    "readOnly": true,
    "transport": "http",
    "pagination": {
      "style": "none",
      "maximumPageSize": 500,
      "continuation": "The original endpoint has no cursor. Import full original keeper history to extend the selected operating period."
    },
    "original": {
      "source": "alerts/src/index.ts",
      "semantics": "GET /swap-routes: report is an all-time server aggregate, rows are the latest window. Preserve both without treating the aggregate as period totals."
    }
  },
  {
    "action": "transaction.inspect",
    "name": "transaction.inspect",
    "title": "Resolve an original transaction",
    "category": "network",
    "inputSchema": {
      "type": "object",
      "properties": {
        "hash": {
          "type": "string",
          "pattern": "^[a-fA-F0-9]{64}$"
        },
        "xdrFormat": {
          "enum": [
            "base64",
            "json"
          ]
        },
        "network": {
          "enum": [
            "mainnet",
            "testnet"
          ]
        }
      },
      "required": [
        "hash"
      ],
      "additionalProperties": false
    },
    "resultKind": "transaction.record",
    "mutates": false,
    "readOnly": true,
    "transport": "http",
    "original": {
      "source": "https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction",
      "semantics": "Original RPC getTransaction; when no transaction is retained or RPC is unavailable, query the selected network's Horizon transaction resource. Preserve both receipts, network, hash, actual status and original XDR."
    }
  },
  {
    "action": "events.list",
    "name": "events.list",
    "title": "Acquire selected contract events",
    "category": "network",
    "inputSchema": {
      "type": "object",
      "properties": {
        "startLedger": {
          "type": "integer",
          "minimum": 1
        },
        "endLedger": {
          "type": "integer",
          "minimum": 2
        },
        "cursor": {
          "type": "string"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        },
        "filters": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "type": {
                "enum": [
                  "contract",
                  "system"
                ]
              },
              "contractIds": {
                "type": "array",
                "items": {
                  "type": "string",
                  "pattern": "^C[A-Z2-7]{55}$"
                },
                "maxItems": 5
              },
              "topics": {
                "type": "array",
                "items": {
                  "type": "array",
                  "items": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    ]
                  },
                  "minItems": 1,
                  "maxItems": 4
                },
                "maxItems": 5
              }
            },
            "required": [],
            "additionalProperties": false
          },
          "maxItems": 5
        },
        "xdrFormat": {
          "enum": [
            "base64",
            "json"
          ]
        },
        "network": {
          "enum": [
            "mainnet",
            "testnet"
          ]
        },
        "startsAt": {
          "type": "string",
          "minLength": 10
        },
        "endsAt": {
          "type": "string",
          "minLength": 10
        }
      },
      "required": [
        "startLedger"
      ],
      "additionalProperties": false
    },
    "resultKind": "network.events",
    "mutates": false,
    "readOnly": true,
    "transport": "http",
    "pagination": {
      "style": "rpc-cursor",
      "order": "event-id-ascending",
      "maximumPageSize": 10000,
      "continuation": "Preserve startLedger/endLedger in nextArgs as the selected window; omit both ledger fields from the actual RPC cursor request. Stop at the frozen exclusive end ledger."
    },
    "original": {
      "source": "https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents",
      "semantics": "Retain original XDR or provider JSON, all pages, cursor, actual retained ledger window and event IDs. Duplicate IDs retain their source occurrences."
    }
  },
  {
    "action": "keeper.history.import",
    "name": "keeper.history.import",
    "title": "Import complete original keeper history",
    "category": "history",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1
        },
        "format": {
          "enum": [
            "jsonl",
            "json"
          ]
        },
        "kind": {
          "enum": [
            "keeper.harvest",
            "keeper.rebalance",
            "surface.observations"
          ]
        },
        "network": {
          "enum": [
            "mainnet",
            "testnet"
          ]
        },
        "startsAt": {
          "type": "string",
          "minLength": 10
        },
        "endsAt": {
          "type": "string",
          "minLength": 10
        }
      },
      "required": [
        "path"
      ],
      "additionalProperties": false
    },
    "resultKind": "keeper.history",
    "mutates": false,
    "readOnly": true,
    "transport": "file",
    "original": {
      "source": "scripts/rebalance_keeper.ts; scripts/harvest_router.ts",
      "semantics": "Read one selected file below the configured history root, keep its exact bytes and every original line. Malformed or unfinished lines remain visible and produce PARTIAL acquisition."
    }
  },
  {
    "action": "surfaces.inspect",
    "name": "surfaces.inspect",
    "title": "Inspect configured operating surfaces",
    "category": "network",
    "inputSchema": {
      "type": "object",
      "properties": {
        "surfaces": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "minItems": 1
        },
        "network": {
          "enum": [
            "mainnet",
            "testnet"
          ]
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "resultKind": "surface.observations",
    "mutates": false,
    "readOnly": true,
    "transport": "http",
    "original": {
      "source": "docs/scf-t3-completion-report.md",
      "semantics": "Probe actual configured application, telemetry or RPC surfaces once, recording each response and observation time. Historical continuity is computed only from retained repeated observations and declared cadence."
    }
  }
]);
export const TURBOLONG_NATIVE_ACTIONS = freeze(TURBOLONG_ACTIONS.filter(a => a.transport === 'original-runtime'));
export const TURBOLONG_HTTP_ACTIONS = freeze(TURBOLONG_ACTIONS.filter(a => a.transport === 'http'));
export const TURBOLONG_PUBLIC_CONFIGURATION_SCHEMA = freeze({
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "network": {
      "enum": [
        "mainnet",
        "testnet"
      ]
    },
    "telemetryUrl": {
      "type": "string"
    },
    "rpcUrl": {
      "type": "string"
    },
    "horizonUrl": {
      "type": "string"
    },
    "timeoutMs": {
      "type": "integer",
      "minimum": 1000,
      "maximum": 300000
    },
    "surfaces": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "url": {
            "type": "string"
          },
          "kind": {
            "enum": [
              "http",
              "rpc-health"
            ]
          },
          "expectedStatus": {
            "type": "integer",
            "minimum": 100,
            "maximum": 599
          },
          "requiredText": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "url"
        ],
        "additionalProperties": false
      }
    },
    "runtime": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "required": [
    "network"
  ],
  "additionalProperties": true
});
export function getTurbolongAction(action) {
  const found = TURBOLONG_ACTIONS.find(a => a.action === action);
  if (!found) throw Object.assign(new Error('Unknown Turbolong action: ' + action),{code:'UNKNOWN_ACTION'});
  return found;
}
function failure(path,message) { throw Object.assign(new TypeError(path + ': ' + message),{code:'INVALID_ARGUMENT',path}); }
export function validateTurbolongValue(value,schema,path='value') {
  if (schema.anyOf || schema.oneOf) {
    const alternatives = schema.anyOf || schema.oneOf; let matches = 0;
    for (const alternative of alternatives) { try { validateTurbolongValue(value,alternative,path); matches++; } catch {} }
    if (!matches || (schema.oneOf && matches !== 1)) failure(path,'does not match the allowed value shapes');
  }
  if (schema.enum && !schema.enum.some(v => Object.is(v,value))) failure(path,'is not an allowed value');
  if (Object.prototype.hasOwnProperty.call(schema,'const') && !Object.is(schema.const,value)) failure(path,'does not match the fixed value');
  const type = schema.type;
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) failure(path,'must be an object');
    for (const required of schema.required || []) if (!Object.prototype.hasOwnProperty.call(value,required) || value[required] === undefined) failure(path+'.'+required,'is required');
    for (const [key,item] of Object.entries(value)) {
      if (['__proto__','prototype','constructor'].includes(key)) failure(path+'.'+key,'is not an accepted property');
      if (schema.properties?.[key]) validateTurbolongValue(item,schema.properties[key],path+'.'+key);
      else if (schema.additionalProperties === false) failure(path+'.'+key,'is not a supported property');
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validateTurbolongValue(item,schema.additionalProperties,path+'.'+key);
      else validateJSON(item,path+'.'+key);
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) failure(path,'must be an array');
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) failure(path,'has an invalid item count');
    for (let i=0;i<value.length;i++) validateTurbolongValue(value[i],schema.items || {},path+'['+i+']');
    if (schema.uniqueItems && new Set(value.map(v=>JSON.stringify(v))).size!==value.length) failure(path,'must contain unique values');
  } else if (type === 'string') {
    if (typeof value !== 'string') failure(path,'must be a string');
    if (schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength) failure(path,'has an invalid length');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) failure(path,'has an invalid format');
  } else if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || type === 'integer' && !Number.isSafeInteger(value)) failure(path,type === 'integer' ? 'must be a safe integer; retain larger original integers as strings' : 'must be a finite number');
    if (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum || schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum || schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) failure(path,'is outside the permitted range');
  } else if (type === 'boolean' && typeof value !== 'boolean') failure(path,'must be a boolean');
  else if (type === 'null' && value !== null) failure(path,'must be null');
  else if (!type) validateJSON(value,path);
  if (schema['x-original-integer']) {
    const kind=schema['x-original-integer'],n=BigInt(value),minimum=kind==='u64'?0n:-9223372036854775808n,maximum=kind==='u64'?18446744073709551615n:9223372036854775807n;
    if(n<minimum||n>maximum)failure(path,'is outside the original Rust '+kind+' range');
  }
  return value;
}
function validateJSON(value,path) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (let i=0;i<value.length;i++) validateJSON(value[i],path+'['+i+']'); return; }
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    for (const [k,v] of Object.entries(value)) { if (['__proto__','prototype','constructor'].includes(k)) failure(path+'.'+k,'is not an accepted property'); validateJSON(v,path+'.'+k); } return;
  }
  failure(path,'must be a finite JSON value');
}
export function validateTurbolongArguments(action,args={}) {
  const definition=getTurbolongAction(action); validateTurbolongValue(args,definition.inputSchema,'args');
  if (args.startsAt !== undefined || args.endsAt !== undefined) {
    for (const key of ['startsAt','endsAt']) if (args[key] !== undefined && (!/[zZ]|[+-]\d\d:\d\d$/.test(args[key]) || !Number.isFinite(Date.parse(args[key])))) failure('args.'+key,'must contain an explicit UTC offset');
    if (args.startsAt && args.endsAt && Date.parse(args.startsAt) >= Date.parse(args.endsAt)) failure('args.endsAt','must be later than startsAt');
  }
  if (action === 'events.list' && args.endLedger !== undefined && args.endLedger <= args.startLedger) failure('args.endLedger','must be greater than startLedger');
  if (action === 'keeper.history.import' && (args.path.includes('\0') || args.path.split(/[\\/]/).some(part=>part==='..'))) failure('args.path','must be a selected relative history path');
  return args;
}
export function describeTurbolongCatalogue() { return {schema:'stellar-forge.turbolong-operations-catalogue.v1',original:TURBOLONG_ORIGINAL,actions:TURBOLONG_ACTIONS}; }
