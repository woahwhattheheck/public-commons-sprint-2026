// MIT. Pollar partner adapter contract, bound to complete original sources.
const freeze = value => { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
export const POLLAR_NATIVE_ACTIONS = freeze([
  {
    "action": "server.wallet.fund",
    "title": "Fund a deferred wallet",
    "category": "wallet",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "publicKey": {
          "type": "string",
          "pattern": "^G[A-Z2-7]{55}$"
        }
      },
      "required": [
        "publicKey"
      ],
      "additionalProperties": false
    },
    "resultKind": "wallet-funding",
    "transport": "server",
    "method": "POST",
    "path": "/v1/wallets/fund",
    "authentication": "x-pollar-api-key",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/server-api.md",
    "readback": "mcp.get_wallet_balances",
    "idempotency": {
      "kind": "existing-state",
      "code": "WALLET_ALREADY_FUNDED",
      "description": "A wallet already funded is returned as HTTP 409."
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "server.signerRotation.grant",
    "title": "Grant one signer rotation",
    "category": "wallet",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "publicKey": {
          "type": "string",
          "pattern": "^G[A-Z2-7]{55}$"
        }
      },
      "required": [
        "publicKey"
      ],
      "additionalProperties": false
    },
    "resultKind": "signer-rotation",
    "transport": "server",
    "method": "POST",
    "path": "/v1/wallets/{publicKey}/signer-rotation",
    "authentication": "x-pollar-api-key",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/server-api.md",
    "readback": null,
    "idempotency": {
      "kind": "conditional",
      "description": "Returns an existing unspent grant; a grant spent by a rotation permits a new grant."
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "server.signerRotation.revoke",
    "title": "Revoke an unspent signer rotation",
    "category": "wallet",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "publicKey": {
          "type": "string",
          "pattern": "^G[A-Z2-7]{55}$"
        }
      },
      "required": [
        "publicKey"
      ],
      "additionalProperties": false
    },
    "resultKind": "signer-rotation",
    "transport": "server",
    "method": "DELETE",
    "path": "/v1/wallets/{publicKey}/signer-rotation",
    "authentication": "x-pollar-api-key",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/server-api.md",
    "readback": null,
    "idempotency": {
      "kind": "none-documented"
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "server.user.register",
    "title": "Register a partner user",
    "category": "onboarding",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "externalId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 255
        },
        "email": {
          "type": "string",
          "minLength": 1
        },
        "firstName": {
          "type": "string",
          "minLength": 1
        },
        "lastName": {
          "type": "string",
          "minLength": 1
        },
        "avatar": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "externalId"
      ],
      "additionalProperties": false
    },
    "resultKind": "participant",
    "transport": "server",
    "method": "POST",
    "path": "/v1/users",
    "authentication": "x-pollar-api-key",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/server-api.md",
    "readback": "mcp.get_application_users",
    "idempotency": {
      "kind": "none-documented"
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "server.user.registerWithWallet",
    "title": "Register a user with a wallet",
    "category": "onboarding",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "externalId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 255
        },
        "email": {
          "type": "string",
          "minLength": 1
        },
        "firstName": {
          "type": "string",
          "minLength": 1
        },
        "lastName": {
          "type": "string",
          "minLength": 1
        },
        "avatar": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "externalId"
      ],
      "additionalProperties": false
    },
    "resultKind": "participant",
    "transport": "server",
    "method": "POST",
    "path": "/v1/users/with-wallet",
    "authentication": "x-pollar-api-key",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/server-api.md",
    "readback": "mcp.get_application_users",
    "idempotency": {
      "kind": "none-documented"
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.list_applications",
    "title": "List accessible applications",
    "category": "application",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "resultKind": "collection",
    "transport": "mcp",
    "tool": "list_applications",
    "scope": "applications:read",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": null,
    "idempotency": {
      "kind": "read"
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.get_application",
    "title": "Read application configuration",
    "category": "application",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "resultKind": "application",
    "transport": "mcp",
    "tool": "get_application",
    "scope": "applications:read",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": null,
    "idempotency": {
      "kind": "read"
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.get_application_wallets",
    "title": "Read application and user wallets",
    "category": "wallet",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "resultKind": "collection",
    "transport": "mcp",
    "tool": "get_application_wallets",
    "scope": "wallets:read",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": null,
    "idempotency": {
      "kind": "read"
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.get_wallet_balances",
    "title": "Read on-chain wallet balances",
    "category": "wallet",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "publicKey": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "id",
        "publicKey"
      ],
      "additionalProperties": false
    },
    "resultKind": "balances",
    "transport": "mcp",
    "tool": "get_wallet_balances",
    "scope": "wallets:read",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": null,
    "idempotency": {
      "kind": "read"
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.get_application_transactions",
    "title": "Read application transactions",
    "category": "history",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "limit": {
          "type": "integer",
          "minimum": 1
        },
        "offset": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "resultKind": "history-page",
    "transport": "mcp",
    "tool": "get_application_transactions",
    "scope": "transactions:read",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": null,
    "idempotency": {
      "kind": "read"
    },
    "pagination": {
      "kind": "offset",
      "offsetField": "offset",
      "limitField": "limit"
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.get_application_users",
    "title": "Read application users",
    "category": "onboarding",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "limit": {
          "type": "integer",
          "minimum": 1
        },
        "offset": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "resultKind": "participants-page",
    "transport": "mcp",
    "tool": "get_application_users",
    "scope": "users:read",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": null,
    "idempotency": {
      "kind": "read"
    },
    "pagination": {
      "kind": "offset",
      "offsetField": "offset",
      "limitField": "limit"
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.create_application",
    "title": "Create a partner application",
    "category": "application",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "name"
      ],
      "additionalProperties": false
    },
    "resultKind": "application",
    "transport": "mcp",
    "tool": "create_application",
    "scope": "applications:write",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": "mcp.list_applications",
    "idempotency": {
      "kind": "none-documented"
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.create_api_key",
    "title": "Create an application API key",
    "category": "application",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "name": {
          "type": "string",
          "minLength": 1
        },
        "type": {
          "type": "string",
          "minLength": 1
        },
        "allow_native_clients": {
          "type": "boolean"
        },
        "expires_at": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "id",
        "name"
      ],
      "additionalProperties": false
    },
    "resultKind": "credential",
    "transport": "mcp",
    "tool": "create_api_key",
    "scope": "api_keys:write",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": null,
    "idempotency": {
      "kind": "none-documented"
    },
    "sensitiveResponse": true,
    "description": "The original provider returns the newly created key once; store it in the private connection configuration.",
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "redacted original bytes plus original body hash; original credential returned ephemerally",
      "ephemeral": true
    }
  },
  {
    "action": "mcp.enable_asset",
    "title": "Enable an application asset",
    "category": "treasury",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "code": {
          "type": "string",
          "minLength": 1
        },
        "issuer": {
          "type": "string",
          "minLength": 1
        },
        "name": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "id",
        "code",
        "issuer",
        "name"
      ],
      "additionalProperties": false
    },
    "resultKind": "asset",
    "transport": "mcp",
    "tool": "enable_asset",
    "scope": "assets:write",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": "mcp.get_application",
    "idempotency": {
      "kind": "none-documented"
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.create_distribution_rule",
    "title": "Create a token distribution rule",
    "category": "treasury",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "assetId": {
          "type": "string",
          "minLength": 1
        },
        "name": {
          "type": "string",
          "minLength": 1
        },
        "amountPerUser": {
          "type": [
            "string",
            "number"
          ]
        },
        "maxClaims": {
          "type": [
            "integer",
            "string"
          ]
        },
        "period": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "id",
        "assetId",
        "name",
        "amountPerUser",
        "maxClaims",
        "period"
      ],
      "additionalProperties": true
    },
    "resultKind": "distribution-rule",
    "transport": "mcp",
    "tool": "create_distribution_rule",
    "scope": "distribution:write",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": null,
    "idempotency": {
      "kind": "none-documented"
    },
    "description": "The observed gateway input schema validates all additional original provider fields before dispatch.",
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.fund_testnet_wallet",
    "title": "Fund a testnet wallet",
    "category": "treasury",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "publicKey": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "id",
        "publicKey"
      ],
      "additionalProperties": false
    },
    "resultKind": "wallet-funding",
    "transport": "mcp",
    "tool": "fund_testnet_wallet",
    "scope": "wallets:write",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": "mcp.get_wallet_balances",
    "idempotency": {
      "kind": "provider-idempotent",
      "description": "Documented testnet friendbot top-up."
    },
    "network": "testnet",
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.update_application_domains",
    "title": "Replace the complete allowed origin list",
    "category": "application",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "allowed_origins": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "required": [
        "id",
        "allowed_origins"
      ],
      "additionalProperties": false
    },
    "resultKind": "application",
    "transport": "mcp",
    "tool": "update_application_domains",
    "scope": "applications:write",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": "mcp.get_application",
    "idempotency": {
      "kind": "none-documented"
    },
    "replaces": [
      "allowed_origins"
    ],
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.update_application_redirect_uris",
    "title": "Replace the complete OAuth redirect list",
    "category": "application",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "allowed_redirect_uris": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "required": [
        "id",
        "allowed_redirect_uris"
      ],
      "additionalProperties": false
    },
    "resultKind": "application",
    "transport": "mcp",
    "tool": "update_application_redirect_uris",
    "scope": "applications:write",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": "mcp.get_application",
    "idempotency": {
      "kind": "none-documented"
    },
    "replaces": [
      "allowed_redirect_uris"
    ],
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.get_application_wallet_by_role",
    "title": "Resolve an application wallet role",
    "category": "treasury",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "role": {
          "type": "string",
          "enum": [
            "GLOBAL",
            "FUNDING",
            "GAS",
            "DISTRIBUTION"
          ]
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "resultKind": "wallet",
    "transport": "mcp",
    "tool": "get_application_wallet_by_role",
    "scope": "wallets:read",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": null,
    "idempotency": {
      "kind": "read"
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.ensure_wallet_funded",
    "title": "Fund an application testnet wallet if needed",
    "category": "treasury",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        },
        "role": {
          "type": "string",
          "enum": [
            "GLOBAL",
            "FUNDING",
            "GAS",
            "DISTRIBUTION"
          ]
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "resultKind": "wallet-funding",
    "transport": "mcp",
    "tool": "ensure_wallet_funded",
    "scope": "wallets:write",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": "mcp.get_application_wallet_by_role",
    "idempotency": {
      "kind": "provider-idempotent",
      "description": "The provider conditionally funds an unfunded testnet role wallet; mainnet is reported."
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.check_application_readiness",
    "title": "Read partner application readiness",
    "category": "application",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "resultKind": "application-readiness",
    "transport": "mcp",
    "tool": "check_application_readiness",
    "scope": "applications:read",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "readback": null,
    "idempotency": {
      "kind": "read"
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  },
  {
    "action": "mcp.tools.list",
    "title": "Read the complete live gateway tool catalogue",
    "category": "application",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "resultKind": "tool-catalogue",
    "transport": "mcp-discovery",
    "authentication": "personal-access-token",
    "source": "https://github.com/pollar-xyz/pollar-docs/blob/0a3b5384de21a5d1355df1cfeec4745e5f22496a/docs/sdk-reference/mcp-gateway.md",
    "pagination": {
      "kind": "cursor",
      "cursorField": "cursor",
      "nextField": "nextCursor"
    },
    "idempotency": {
      "kind": "read"
    },
    "recording": {
      "request": "exact public intent; credentials supplied at transport",
      "response": "complete original response bytes",
      "ephemeral": false
    }
  }
]);
export const POLLAR_BROWSER_ACTIONS = freeze([
  {
    "action": "sdk.auth.state",
    "title": "Read authentication state",
    "category": "onboarding",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getAuthState",
    "parameters": [],
    "resultKind": "auth-state",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.auth.login",
    "title": "Sign in with a supported provider",
    "category": "onboarding",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "options": {
          "type": "object",
          "properties": {
            "provider": {
              "type": "string",
              "minLength": 1
            },
            "email": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "provider"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "options"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "login",
    "parameters": [
      "options"
    ],
    "resultKind": "auth-state",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "completion": "auth-event",
    "authFlow": "start",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.auth.beginEmail",
    "title": "Begin email sign-in",
    "category": "onboarding",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "beginEmailLogin",
    "parameters": [],
    "resultKind": "auth-state",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "completion": "auth-event",
    "authFlow": "start",
    "completeSteps": [
      "entering_email"
    ],
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.auth.sendCode",
    "title": "Send the email code",
    "category": "onboarding",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "email": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "email"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "sendEmailCode",
    "parameters": [
      "email"
    ],
    "resultKind": "auth-state",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "completion": "auth-event",
    "authFlow": "continue",
    "completeSteps": [
      "entering_code"
    ],
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.auth.verifyCode",
    "title": "Verify the email code",
    "category": "onboarding",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "code": {
          "type": "string",
          "minLength": 1,
          "sensitive": true
        }
      },
      "required": [
        "code"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "verifyEmailCode",
    "parameters": [
      "code"
    ],
    "resultKind": "auth-state",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "completion": "auth-event",
    "authFlow": "continue",
    "sensitiveInputs": [
      "code"
    ],
    "recording": {
      "request": "sensitive fields omitted; original argument hash retained",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.auth.providerAction",
    "title": "Continue an original sign-in provider",
    "category": "onboarding",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "provider": {
          "type": "string",
          "minLength": 1
        },
        "providerAction": {
          "type": "string",
          "minLength": 1
        },
        "payload": {}
      },
      "required": [
        "provider",
        "providerAction"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "providerAction",
    "parameters": [
      "provider",
      "providerAction",
      "payload"
    ],
    "resultKind": "auth-state",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "completion": "auth-event",
    "authFlow": "continue",
    "sensitiveInputs": [
      "payload"
    ],
    "recording": {
      "request": "sensitive fields omitted; original argument hash retained",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.auth.passkeyLogin",
    "title": "Sign in with an existing passkey wallet",
    "category": "onboarding",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "loginSmartWallet",
    "parameters": [],
    "resultKind": "auth-state",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "completion": "auth-event",
    "authFlow": "start",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.auth.passkeyCreate",
    "title": "Create a passkey wallet",
    "category": "onboarding",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "createSmartWallet",
    "parameters": [],
    "resultKind": "auth-state",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "completion": "auth-event",
    "authFlow": "start",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.auth.cancel",
    "title": "Cancel the current sign-in flow",
    "category": "onboarding",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "cancelLogin",
    "parameters": [],
    "resultKind": "auth-state",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "resultGetter": "getAuthState",
    "authFlow": "cancel",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.auth.refresh",
    "title": "Revalidate the original session",
    "category": "sessions",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "refresh",
    "parameters": [],
    "resultKind": "auth-state",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "resultGetter": "getAuthState",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.auth.logout",
    "title": "Sign out this session",
    "category": "sessions",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "options": {
          "type": "object",
          "properties": {
            "everywhere": {
              "type": "boolean"
            }
          },
          "required": [],
          "additionalProperties": false
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "logout",
    "parameters": [
      "options"
    ],
    "resultKind": "auth-state",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "resultGetter": "getAuthState",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.auth.logoutEverywhere",
    "title": "Sign out every session",
    "category": "sessions",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "logoutEverywhere",
    "parameters": [],
    "resultKind": "auth-state",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "resultGetter": "getAuthState",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.session.list",
    "title": "Read active sessions",
    "category": "sessions",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "listSessions",
    "parameters": [],
    "resultKind": "sessions",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.session.revoke",
    "title": "Revoke a selected session",
    "category": "sessions",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "familyId": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "familyId"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "revokeSession",
    "parameters": [
      "familyId"
    ],
    "resultKind": "session-revocation",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "readback": "sdk.session.list",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.profile.read",
    "title": "Read the authenticated user profile",
    "category": "onboarding",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getUserProfile",
    "parameters": [],
    "resultKind": "profile",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.network.read",
    "title": "Read the selected network",
    "category": "application",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getNetwork",
    "parameters": [],
    "resultKind": "network",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.application.read",
    "title": "Read the original application configuration",
    "category": "application",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getAppConfig",
    "parameters": [],
    "resultKind": "application",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.wallet.read",
    "title": "Read the Stellar wallet",
    "category": "wallet",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getWallet",
    "parameters": [],
    "resultKind": "wallet",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.wallet.list",
    "title": "Read wallets on every configured chain",
    "category": "wallet",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getWallets",
    "parameters": [],
    "resultKind": "wallets",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.wallet.adapters",
    "title": "Read installed original wallet adapters",
    "category": "onboarding",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "listWalletAdapters",
    "parameters": [],
    "resultKind": "wallet-adapters",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.wallet.create",
    "title": "Provision the user’s on-demand wallet",
    "category": "wallet",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "createWallet",
    "parameters": [],
    "resultKind": "wallet",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "provider-idempotent",
      "description": "Original /wallet/provision returns the existing wallet for the signed-in user."
    },
    "readback": "sdk.wallet.provisioning",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.wallet.provisioning",
    "title": "Refresh wallet ledger readiness",
    "category": "wallet",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "refreshWalletState",
    "parameters": [],
    "resultKind": "wallet-provisioning",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.wallet.balance",
    "title": "Read the authenticated wallet balances",
    "category": "wallet",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "refreshBalance",
    "parameters": [],
    "resultKind": "balances",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "resultGetter": "getWalletBalanceState",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.wallet.balanceFor",
    "title": "Read a Stellar wallet’s actual balances",
    "category": "wallet",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "publicKey": {
          "type": "string",
          "pattern": "^G[A-Z2-7]{55}$"
        },
        "network": {
          "type": "string",
          "enum": [
            "testnet",
            "mainnet"
          ]
        }
      },
      "required": [
        "publicKey"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getWalletBalance",
    "parameters": [
      "publicKey",
      "network"
    ],
    "resultKind": "balances",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.wallet.assets",
    "title": "Read current asset and trustline state",
    "category": "wallet",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "refreshAssets",
    "parameters": [],
    "resultKind": "assets",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "resultGetter": "getEnabledAssetsState",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.wallet.trustline",
    "title": "Set or remove a trustline through the wallet",
    "category": "wallet",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "asset": {
          "type": "object",
          "properties": {
            "code": {
              "type": "string",
              "minLength": 1,
              "maxLength": 12
            },
            "issuer": {
              "type": "string",
              "pattern": "^G[A-Z2-7]{55}$"
            }
          },
          "required": [
            "code",
            "issuer"
          ],
          "additionalProperties": false
        },
        "options": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "asset"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "setTrustline",
    "parameters": [
      "asset",
      "options"
    ],
    "resultKind": "transaction",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "readback": "sdk.wallet.assets",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.wallet.createAccount",
    "title": "Create an external wallet account on-chain",
    "category": "wallet",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "createAccount",
    "parameters": [],
    "resultKind": "transaction",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "readback": "sdk.wallet.provisioning",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.payment.send",
    "title": "Send an original Stellar or Solana payment",
    "category": "payments",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "params": {
          "oneOf": [
            {
              "type": "object",
              "properties": {
                "chain": {
                  "const": "STELLAR"
                },
                "destination": {
                  "type": "string",
                  "minLength": 1
                },
                "amount": {
                  "type": "string",
                  "pattern": "^[0-9]+(?:\\.[0-9]+)?$"
                },
                "asset": {
                  "oneOf": [
                    {
                      "type": "object",
                      "properties": {
                        "type": {
                          "const": "native"
                        }
                      },
                      "required": [
                        "type"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "type": {
                          "enum": [
                            "credit_alphanum4",
                            "credit_alphanum12"
                          ]
                        },
                        "code": {
                          "type": "string",
                          "minLength": 1
                        },
                        "issuer": {
                          "type": "string",
                          "pattern": "^G[A-Z2-7]{55}$"
                        }
                      },
                      "required": [
                        "type",
                        "code",
                        "issuer"
                      ],
                      "additionalProperties": false
                    }
                  ]
                },
                "options": {
                  "type": "object",
                  "additionalProperties": true
                }
              },
              "required": [
                "destination",
                "amount",
                "asset"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "chain": {
                  "const": "SOLANA"
                },
                "destination": {
                  "type": "string",
                  "minLength": 1
                },
                "amount": {
                  "type": "string",
                  "pattern": "^[0-9]+$"
                },
                "mint": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "minLength": 1
                }
              },
              "required": [
                "chain",
                "destination",
                "amount"
              ],
              "additionalProperties": false
            }
          ]
        }
      },
      "required": [
        "params"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "sendPayment",
    "parameters": [
      "params"
    ],
    "resultKind": "transaction",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "readback": "sdk.transaction.status",
    "description": "Uses original native Stellar embedded/external/passkey flows or the original Solana base-unit send path. Polygon is a declared type but the retained implementation returns unsupported.",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.transaction.build",
    "title": "Build the original wallet transaction",
    "category": "payments",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "operation": {
          "type": "string",
          "minLength": 1
        },
        "params": {
          "type": "object",
          "additionalProperties": true
        },
        "options": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "operation",
        "params"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "buildTx",
    "parameters": [
      "operation",
      "params",
      "options"
    ],
    "resultKind": "transaction-build",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.transaction.sign",
    "title": "Sign the selected original transaction",
    "category": "payments",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "unsignedXdr": {
          "type": "string",
          "minLength": 1
        },
        "options": {
          "type": "object",
          "properties": {
            "skipSponsorship": {
              "type": "boolean"
            }
          },
          "required": [],
          "additionalProperties": false
        }
      },
      "required": [
        "unsignedXdr"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "signTx",
    "parameters": [
      "unsignedXdr",
      "options"
    ],
    "resultKind": "transaction-signature",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.transaction.submit",
    "title": "Submit the original signed transaction",
    "category": "payments",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "signedXdr": {
          "type": "string",
          "minLength": 1
        },
        "options": {
          "type": "object",
          "properties": {
            "submissionToken": {
              "type": "string",
              "minLength": 1,
              "sensitive": true
            }
          },
          "required": [],
          "additionalProperties": false
        }
      },
      "required": [
        "signedXdr"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "submitTx",
    "parameters": [
      "signedXdr",
      "options"
    ],
    "resultKind": "transaction",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "original-transaction",
      "description": "Retains the exact signed XDR and an original optional submissionToken."
    },
    "readback": "sdk.transaction.status",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    },
    "sensitiveInputs": [
      "signedXdr",
      "options.submissionToken"
    ]
  },
  {
    "action": "sdk.transaction.signAndSubmit",
    "title": "Sign and submit the selected transaction",
    "category": "payments",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "unsignedXdr": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "signAndSubmitTx",
    "parameters": [
      "unsignedXdr"
    ],
    "resultKind": "transaction",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "readback": "sdk.transaction.status",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.transaction.run",
    "title": "Build, sign and submit an original operation",
    "category": "payments",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "operation": {
          "type": "string",
          "minLength": 1
        },
        "params": {
          "type": "object",
          "additionalProperties": true
        },
        "options": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "operation",
        "params"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "runTx",
    "parameters": [
      "operation",
      "params",
      "options"
    ],
    "resultKind": "transaction",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "readback": "sdk.transaction.status",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.transaction.status",
    "title": "Read original transaction confirmation",
    "category": "payments",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "hash": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "hash"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getTxStatus",
    "parameters": [
      "hash"
    ],
    "resultKind": "transaction-status",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.transaction.state",
    "title": "Read original transaction state",
    "category": "payments",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getTransactionState",
    "parameters": [],
    "resultKind": "transaction-state",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.transaction.reset",
    "title": "Clear the local transaction view",
    "category": "payments",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "resetTransactionState",
    "parameters": [],
    "resultKind": "transaction-state",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "local"
    },
    "resultGetter": "getTransactionState",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.proof.message",
    "title": "Sign a Stellar ownership message",
    "category": "onboarding",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "message": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "message"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "stellar.sep53.signMessage",
    "parameters": [
      "message"
    ],
    "resultKind": "ownership-proof",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.proof.sep10",
    "title": "Sign an original SEP-10 challenge",
    "category": "onboarding",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "params": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "params"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "stellar.sep10.sign",
    "parameters": [
      "params"
    ],
    "resultKind": "ownership-proof",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.proof.authEntry",
    "title": "Sign a Soroban authorization entry",
    "category": "payments",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "entryXdr": {
          "type": "string",
          "minLength": 1
        },
        "options": {
          "type": "object",
          "properties": {
            "validUntilLedger": {
              "type": "integer",
              "minimum": 1
            }
          },
          "required": [
            "validUntilLedger"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "entryXdr",
        "options"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "signAuthEntry",
    "parameters": [
      "entryXdr",
      "options"
    ],
    "resultKind": "ownership-proof",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.history.page",
    "title": "Read one complete original history page",
    "category": "history",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "params": {
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer",
              "minimum": 1
            },
            "offset": {
              "type": "integer",
              "minimum": 0
            },
            "chain": {
              "enum": [
                "STELLAR",
                "POLYGON",
                "SOLANA"
              ]
            }
          },
          "required": [],
          "additionalProperties": false
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "fetchTxHistory",
    "parameters": [
      "params"
    ],
    "resultKind": "history-page",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "resultGetter": "getTxHistoryState",
    "pagination": {
      "kind": "offset",
      "request": {
        "offset": "params.offset",
        "limit": "params.limit",
        "chain": "params.chain"
      },
      "response": {
        "records": "data.records",
        "total": "data.total",
        "offset": "data.offset",
        "limit": "data.limit"
      },
      "snapshot": false,
      "sourceType": "TxHistoryParams/TxHistoryContent"
    },
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.history.collect",
    "title": "Collect the complete original transaction history",
    "category": "history",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "params": {
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer",
              "minimum": 1
            },
            "offset": {
              "type": "integer",
              "minimum": 0
            },
            "chain": {
              "enum": [
                "STELLAR",
                "POLYGON",
                "SOLANA"
              ]
            }
          },
          "required": [],
          "additionalProperties": false
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "fetchTxHistory",
    "parameters": [
      "params"
    ],
    "resultKind": "history",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "operation": "complete-history",
    "pagination": {
      "kind": "offset",
      "request": {
        "offset": "params.offset",
        "limit": "params.limit",
        "chain": "params.chain"
      },
      "response": {
        "records": "data.records",
        "total": "data.total",
        "offset": "data.offset",
        "limit": "data.limit"
      },
      "snapshot": false,
      "sourceType": "TxHistoryParams/TxHistoryContent"
    },
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.requirements.read",
    "title": "Read current app requirements",
    "category": "requirements",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getAppRequirements",
    "parameters": [],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.requirements.form",
    "title": "Read an original requirement form",
    "category": "requirements",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "formId": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "formId"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getRequirementForm",
    "parameters": [
      "formId"
    ],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.requirements.submit",
    "title": "Submit an original requirement form",
    "category": "requirements",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "formId": {
          "type": "string",
          "minLength": 1
        },
        "answers": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "formId",
        "answers"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "submitRequirementForm",
    "parameters": [
      "formId",
      "answers"
    ],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.requirements.registry",
    "title": "Read the original registry check",
    "category": "requirements",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "optionId": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "optionId"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getRegistryCheck",
    "parameters": [
      "optionId"
    ],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.requirements.registrySubmit",
    "title": "Submit the original registry correction",
    "category": "requirements",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "optionId": {
          "type": "string",
          "minLength": 1
        },
        "edit": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "optionId",
        "edit"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "submitRegistryCheck",
    "parameters": [
      "optionId",
      "edit"
    ],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.requirements.provider",
    "title": "Read provider registration",
    "category": "requirements",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "corridorId": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "corridorId"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getProviderRegistration",
    "parameters": [
      "corridorId"
    ],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.requirements.providerSubmit",
    "title": "Submit provider registration",
    "category": "requirements",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "corridorId": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "corridorId"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "submitProviderRegistration",
    "parameters": [
      "corridorId"
    ],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.kyc.status",
    "title": "Read current verification status",
    "category": "requirements",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "providerId": {
          "type": "string",
          "minLength": 1
        },
        "corridorId": {
          "type": "string",
          "minLength": 1
        },
        "cardProviderId": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getKycStatus",
    "parameters": [
      "providerId",
      "corridorId",
      "cardProviderId"
    ],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.kyc.providers",
    "title": "Read verification providers",
    "category": "requirements",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "country": {
          "type": "string",
          "minLength": 1
        },
        "corridorId": {
          "type": "string",
          "minLength": 1
        },
        "cardProviderId": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "country"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getKycProviders",
    "parameters": [
      "country",
      "corridorId",
      "cardProviderId"
    ],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.kyc.start",
    "title": "Start the original verification flow",
    "category": "requirements",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "body": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "body"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "startKyc",
    "parameters": [
      "body"
    ],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.distribution.rules",
    "title": "Read claimable distribution rules",
    "category": "treasury",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "listDistributionRules",
    "parameters": [],
    "resultKind": "distribution-rules",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.distribution.claim",
    "title": "Claim a selected distribution rule",
    "category": "treasury",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "body": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "body"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "claimDistributionRule",
    "parameters": [
      "body"
    ],
    "resultKind": "distribution-claim",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.ramp.routes",
    "title": "Read supported original ramp routes",
    "category": "ramps",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getRampRoutes",
    "parameters": [],
    "resultKind": "ramp-routes",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.ramp.countries",
    "title": "Read supported ramp countries",
    "category": "ramps",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getRampCountries",
    "parameters": [],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.ramp.quote",
    "title": "Read an original provider quote",
    "category": "ramps",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "query"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getRampsQuote",
    "parameters": [
      "query"
    ],
    "resultKind": "ramp-quote",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.ramp.on",
    "title": "Start the selected original on-ramp",
    "category": "ramps",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "body": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "body"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "createOnRamp",
    "parameters": [
      "body"
    ],
    "resultKind": "ramp",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "quote",
      "field": "body.quoteId"
    },
    "readback": "sdk.ramp.read",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.ramp.off",
    "title": "Start the selected original off-ramp",
    "category": "ramps",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "body": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "body"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "createOffRamp",
    "parameters": [
      "body"
    ],
    "resultKind": "ramp",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "quote",
      "field": "body.quoteId"
    },
    "readback": "sdk.ramp.read",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.ramp.read",
    "title": "Read the original ramp transaction",
    "category": "ramps",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "txId": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "txId"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getRampTransaction",
    "parameters": [
      "txId"
    ],
    "resultKind": "ramp",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.ramp.continue",
    "title": "Continue the selected original ramp action",
    "category": "ramps",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "txId": {
          "type": "string",
          "minLength": 1
        },
        "body": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "txId",
        "body"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "continueRamp",
    "parameters": [
      "txId",
      "body"
    ],
    "resultKind": "ramp",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "readback": "sdk.ramp.read",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    },
    "sensitiveInputs": [
      "body.signedPayload"
    ]
  },
  {
    "action": "sdk.ramp.sign",
    "title": "Sign the original ramp’s current action",
    "category": "ramps",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "txId": {
          "type": "string",
          "minLength": 1
        },
        "snapshot": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "txId",
        "snapshot"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "signRampAction",
    "parameters": [
      "txId",
      "snapshot"
    ],
    "resultKind": "ramp",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "readback": "sdk.ramp.read",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.ramp.complete",
    "title": "Complete the original withdrawal",
    "category": "ramps",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "txId": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "txId"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "completeWithdraw",
    "parameters": [
      "txId"
    ],
    "resultKind": "ramp",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "readback": "sdk.ramp.read",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.swap.configuration",
    "title": "Read enabled swap venues",
    "category": "swap",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getSwapConfig",
    "parameters": [],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.swap.tokens",
    "title": "Read original swap tokens",
    "category": "swap",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getSwapTokens",
    "parameters": [],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.swap.quote",
    "title": "Read ranked original swap quotes",
    "category": "swap",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "params": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "params"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getSwapQuote",
    "parameters": [
      "params"
    ],
    "resultKind": "swap-quotes",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.swap.execute",
    "title": "Execute the selected original swap quote",
    "category": "swap",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "quote": {
          "type": "object",
          "additionalProperties": true
        },
        "options": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "quote"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "swap",
    "parameters": [
      "quote",
      "options"
    ],
    "resultKind": "transaction",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "readback": "sdk.transaction.status",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.earn.providers",
    "title": "Read enabled original earn providers",
    "category": "earn",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getEarnProviders",
    "parameters": [],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.earn.opportunities",
    "title": "Read original earn opportunities",
    "category": "earn",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "provider": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "provider"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getEarnOpportunities",
    "parameters": [
      "provider"
    ],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.earn.position",
    "title": "Read the actual earn position",
    "category": "earn",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "params": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "params"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getEarnPosition",
    "parameters": [
      "params"
    ],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.earn.deposit",
    "title": "Deposit through the selected original earn provider",
    "category": "earn",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "params": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "params"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "earnDeposit",
    "parameters": [
      "params"
    ],
    "resultKind": "transaction",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "readback": "sdk.transaction.status",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.earn.withdraw",
    "title": "Withdraw through the selected original earn provider",
    "category": "earn",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "params": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "required": [
        "params"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "earnWithdraw",
    "parameters": [
      "params"
    ],
    "resultKind": "transaction",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "idempotency": {
      "kind": "none-documented"
    },
    "readback": "sdk.transaction.status",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    }
  },
  {
    "action": "sdk.ramp.signature",
    "title": "Submit the original external-wallet ramp signature",
    "category": "ramps",
    "mode": "write",
    "mutates": true,
    "inputSchema": {
      "type": "object",
      "properties": {
        "txId": {
          "type": "string",
          "minLength": 1
        },
        "body": {
          "type": "object",
          "properties": {
            "signedXdr": {
              "type": "string",
              "minLength": 1
            },
            "action": {
              "enum": [
                "sep10",
                "withdraw_payment"
              ]
            }
          },
          "required": [
            "signedXdr",
            "action"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "txId",
        "body"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "submitRampSignature",
    "parameters": [
      "txId",
      "body"
    ],
    "resultKind": "ramp",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    },
    "idempotency": {
      "kind": "none-documented"
    },
    "sensitiveInputs": [
      "body.signedXdr"
    ],
    "readback": "sdk.ramp.read",
    "description": "Calls the unchanged submitRampSignature method and retains its original outcome."
  },
  {
    "action": "sdk.ramp.liquidity",
    "title": "Read original payout-rail liquidity",
    "category": "ramps",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "rail": {
          "enum": [
            "PIX",
            "BREB"
          ]
        }
      },
      "required": [
        "rail"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getRampLiquidity",
    "parameters": [
      "rail"
    ],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    },
    "description": "Calls the unchanged getRampLiquidity method and retains its original outcome."
  },
  {
    "action": "sdk.ramp.kycStatus",
    "title": "Read original ramp-provider KYC state",
    "category": "ramps",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "getRampKycStatus",
    "parameters": [],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    },
    "description": "Calls the unchanged getRampKycStatus method and retains its original outcome."
  },
  {
    "action": "sdk.ramp.pixDecode",
    "title": "Decode the original Pix payment payload",
    "category": "ramps",
    "mode": "read",
    "mutates": false,
    "inputSchema": {
      "type": "object",
      "properties": {
        "qrCode": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "qrCode"
      ],
      "additionalProperties": false
    },
    "transport": "browser-sdk",
    "nativeMethod": "decodePixQr",
    "parameters": [
      "qrCode"
    ],
    "resultKind": "record",
    "source": "https://github.com/pollar-xyz/pollar/blob/b67e306439511df00f63374445e315b68fa36b92/packages/core/src/client/client.ts",
    "sourcePackage": "@pollar/core",
    "sourceVersion": "0.12.0-rc.1",
    "recording": {
      "request": "public original arguments",
      "response": "original public SDK result and provider IDs; authentication/signing custody remains in the original SDK"
    },
    "description": "Calls the unchanged decodePixQr method and retains its original outcome."
  }
]);

export const POLLAR_PUBLIC_CONFIGURATION_SCHEMA = freeze({
  "type": "object",
  "properties": {
    "apiKey": {
      "type": "string",
      "minLength": 1,
      "description": "Original Pollar publishable SDK key."
    },
    "applicationId": {
      "type": "string",
      "minLength": 1
    },
    "stellarNetwork": {
      "type": "string",
      "enum": [
        "testnet",
        "mainnet"
      ]
    },
    "baseUrl": {
      "type": "string",
      "format": "uri",
      "default": "https://sdk.api.pollar.xyz"
    },
    "runtimeModuleUrl": {
      "type": "string",
      "default": "/pollar-runtime.mjs"
    },
    "runtimeId": {
      "type": "string"
    },
    "runtimeManifestSha256": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$"
    },
    "deviceLabel": {
      "type": "string"
    },
    "oauthRedirectUri": {
      "type": "string",
      "format": "uri"
    },
    "requestTimeoutMs": {
      "type": "integer",
      "minimum": 0
    },
    "submitTimeoutMs": {
      "type": "integer",
      "minimum": 0
    },
    "loginTimeoutMs": {
      "type": "integer",
      "minimum": 0
    },
    "logLevel": {
      "enum": [
        "silent",
        "error",
        "warn",
        "info",
        "debug"
      ]
    },
    "retry": {
      "type": "object",
      "properties": {
        "attempts": {
          "type": "integer",
          "minimum": 1
        },
        "baseDelayMs": {
          "type": "integer",
          "minimum": 0
        }
      },
      "additionalProperties": false
    }
  },
  "required": [
    "apiKey",
    "applicationId",
    "stellarNetwork"
  ],
  "additionalProperties": false
});

export function pollarArgumentError(message,details={}) {
  const error = new TypeError(message);
  error.code = 'POLLAR_ARGUMENT_INVALID'; error.details = details; return error;
}
function sameValue(a,b) {
  if (a===b) return true;
  if (!a || !b || typeof a!=='object' || typeof b!=='object') return false;
  if (Array.isArray(a)!==Array.isArray(b)) return false;
  const left=Object.keys(a).sort(),right=Object.keys(b).sort();
  return left.length===right.length && left.every((k,i)=>k===right[i]&&sameValue(a[k],b[k]));
}
export function validatePollarValue(value,schema,{path='$',root=schema}={}) {
  if (schema===true || schema===undefined) return value;
  if (schema===false) throw pollarArgumentError('This value is not permitted.',{path});
  if (!schema || typeof schema!=='object') throw pollarArgumentError('Invalid original schema.',{path});
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/')) throw pollarArgumentError('An external schema reference needs its original definition.',{path,ref:schema.$ref});
    let selected=root;
    for(const part of schema.$ref.slice(2).split('/')) selected=selected?.[part.replace(/~1/g,'/').replace(/~0/g,'~')];
    if(selected===undefined)throw pollarArgumentError('The original schema reference is absent.',{path,ref:schema.$ref});
    return validatePollarValue(value,selected,{path,root});
  }
  if (schema.const!==undefined && !sameValue(value,schema.const)) throw pollarArgumentError('Use the selected original value.',{path,expected:schema.const});
  if (Array.isArray(schema.enum) && !schema.enum.some(v=>sameValue(v,value))) throw pollarArgumentError('Choose an original supported value.',{path,values:schema.enum});
  for (const branch of schema.allOf??[]) validatePollarValue(value,branch,{path,root});
  if(schema.anyOf || schema.oneOf) {
    let matches=0;
    for(const branch of schema.anyOf??schema.oneOf)try{validatePollarValue(value,branch,{path,root});matches++;}catch(error){if(error.code!=='POLLAR_ARGUMENT_INVALID')throw error;}
    if(matches===0 || (schema.oneOf && matches!==1))throw pollarArgumentError('The input does not match its original value schema.',{path});
  }
  if(schema.not){let matches=true;try{validatePollarValue(value,schema.not,{path,root});}catch(error){if(error.code!=='POLLAR_ARGUMENT_INVALID')throw error;matches=false;}if(matches)throw pollarArgumentError('The original schema excludes this value.',{path});}
  const kind=value===null?'null':Array.isArray(value)?'array':typeof value==='number'&&Number.isInteger(value)?'integer':typeof value;
  const accepts=t=>t===kind || (t==='number'&&kind==='integer');
  if(schema.type && !(Array.isArray(schema.type)?schema.type:[schema.type]).some(accepts))throw pollarArgumentError('Use the declared input type.',{path,expected:schema.type,actual:kind});
  if(typeof value==='number'){
    if(!Number.isFinite(value) || (kind==='integer'&&!Number.isSafeInteger(value)))throw pollarArgumentError('Preserve this native number as an exact supported value.',{path});
    if(schema.minimum!==undefined&&value<schema.minimum || schema.maximum!==undefined&&value>schema.maximum ||
       schema.exclusiveMinimum!==undefined&&value<=schema.exclusiveMinimum || schema.exclusiveMaximum!==undefined&&value>=schema.exclusiveMaximum)
      throw pollarArgumentError('The number is outside the original supported range.',{path});
  }
  if(typeof value==='string'){
    if(schema.minLength!==undefined&&[...value].length<schema.minLength || schema.maxLength!==undefined&&[...value].length>schema.maxLength)
      throw pollarArgumentError('The text length differs from the required input.',{path});
    if(schema.pattern && !new RegExp(schema.pattern,'u').test(value))throw pollarArgumentError('The text differs from the declared input format.',{path});
  }
  if(Array.isArray(value)){
    if(schema.minItems!==undefined&&value.length<schema.minItems || schema.maxItems!==undefined&&value.length>schema.maxItems)
      throw pollarArgumentError('The list length differs from the original input schema.',{path});
    if(schema.uniqueItems)for(let i=0;i<value.length;i++)for(let j=0;j<i;j++)if(sameValue(value[i],value[j]))throw pollarArgumentError('The original list requires unique entries.',{path,index:i});
    value.forEach((v,i)=>validatePollarValue(v,schema.prefixItems?.[i]??schema.items??true,{path:path+'['+i+']',root}));
  } else if(value!==null&&typeof value==='object'){
    if(Object.getPrototypeOf(value)!==Object.prototype && Object.getPrototypeOf(value)!==null)throw pollarArgumentError('Use a plain JSON input object.',{path});
    for(const key of schema.required??[])if(!Object.hasOwn(value,key))throw pollarArgumentError('A required original input is missing.',{path,field:key});
    for(const [key,v] of Object.entries(value)){
      if(['__proto__','prototype','constructor'].includes(key))throw pollarArgumentError('Unsupported input field.',{path,field:key});
      if(Object.hasOwn(schema.properties??{},key))validatePollarValue(v,schema.properties[key],{path:path+'.'+key,root});
      else {
        const patterns=Object.entries(schema.patternProperties??{}).filter(([p])=>new RegExp(p,'u').test(key));
        if(patterns.length)for(const [,s] of patterns)validatePollarValue(v,s,{path:path+'.'+key,root});
        else if(schema.additionalProperties===false)throw pollarArgumentError('Use a declared original input field.',{path,field:key});
        else if(typeof schema.additionalProperties==='object')validatePollarValue(v,schema.additionalProperties,{path:path+'.'+key,root});
      }
    }
  }
  return value;
}
export function getPollarAction(action,{surface}={}) {
  const selected=surface==='browser'?POLLAR_BROWSER_ACTIONS:surface==='native'?POLLAR_NATIVE_ACTIONS:[...POLLAR_NATIVE_ACTIONS,...POLLAR_BROWSER_ACTIONS];
  const entry=selected.find(item=>item.action===action);
  if(!entry)throw pollarArgumentError('Choose a declared Pollar action.',{action,surface});
  return entry;
}
export function validatePollarArguments(action,args={},options={}) {
  const entry=getPollarAction(action,options);
  validatePollarValue(args,entry.inputSchema);
  if(options.observedSchema)validatePollarValue(args,options.observedSchema);
  return args;
}
export function publicPollarArguments(action,args={}) {
  const entry=getPollarAction(action);
  const out=structuredClone(args),redacted=[];
  for(const field of entry.sensitiveInputs??[]){
    const parts=field.split('.');let parent=out;
    for(const part of parts.slice(0,-1))parent=parent?.[part];
    const key=parts.at(-1);
    if(parent&&Object.hasOwn(parent,key)){delete parent[key];redacted.push(field);}
  }
  return {args:out,redacted};
}
