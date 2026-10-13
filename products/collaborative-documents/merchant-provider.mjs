// SPDX-License-Identifier: MIT
// Additive source registration; native application ownership stays with Applications.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {collaborativeTools} from './tools.mjs';

export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,
  id:'collaborative-documents',family:'collaborativeDocuments',configKey:'collaborativeDocuments',
  title:'Collaborative Document Workbench',order:1190,catalogOrder:1190,summary:true,dependencies:[],
  configuration:{input:'collaborativeDocumentsConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./mcp.mjs')).readCollaborativeDocumentsConfiguration(hostPath(value))},
  tools:collaborativeTools,load:()=>import('./mcp.mjs'),
  create:(module,config)=>new module.MerchantCollaborativeWorkspaces(config),
  initialize:async options=>(await import('./setup.mjs')).initializeCollaborativeDocumentsMerchant(options),
  // Preserve a complete original 16 MiB action JSON plus MCP framing.
  maxRequestBytes:16*1024*1024+65536,
  instructions:[{prefix:'merchant_collaboration_',order:1190,text:
    'Collaborative Document tools attach to the original Applications-owned Hocuspocus/Tiptap/Yjs listener. Read status and connect a host-declared alias; do not supply a bearer token or an arbitrary file path. The same original actor, tenant scope and project document grants govern every access. Operator status permits administrative actions but does not bypass document grants for native editing or persistence. The browser owns ephemeral editor tokens; no agent tool issues or retains them. Read the original session, project, source/edition/mapping, native job and document epoch before acting. Every project creation and action retains its complete actor-bound request before dispatch. After an uncertain result, inspect requests, read the native request receipt, and replay the exact same ID, revision and payload. An HTTP error can follow a committed grant change or job launch; never assume it means the request did not commit. Use upload_input for a complete declared host file, or resume the same upload at its committed offset; uploads are at most512MiB and individual migrated documents at most32MiB. Native declared-file chunks are8MiB and inline MCP chunks at most196608 bytes. JSON/HTML/Yjs migration uses the original native schema and transformer, retaining all mapping errors and explicit row reviews. Existing documents are not overwritten by import. Runtime/configuration rollback preserves current Yjs state; explicit document.restore drains the deployment and creates a new physical epoch, preserving old history and rejecting stale offline edits. Storage confirmation requires both the complete original Y.encodeStateAsUpdate SHA/length and state vector; synchronization or vector equality alone is insufficient. Retain complete checkpoint, handoff, source and native job files with exact original bytes/SHA. The full bytes stay saved, but file and JSON reads recheck current actor and every retained document grant against the reopened original application; old caches cannot bypass revocation. Named handoffs contain original source, binary state and history, while auth/session secrets remain private to the installation. Receiving opens closed and needs its own original prepared runtime/build/ready plus explicit deployment start. Disconnect closes only this agent attachment; Applications Stop drains and closes the original application owner. This TJLabs authored workbench uses the pinned open-source engines and makes no vendor endorsement or Pro-feature claim.'
  }]
});
