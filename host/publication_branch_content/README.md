# Branch publication content and original-operation recovery

A named Git branch creation writes a reference and a Git object ID. Repository descriptions, branch identifiers, transport envelopes and provider identity are metadata. Presenting that whole metadata JSON as authored correspondence can produce an irrelevant prose classification and strand an otherwise valid operation.

This package integrates that field distinction with the existing publisher and recovers a retained metadata-only result under its original operation ID. It supplies complete executable modules and a composer for the **current full Worker**, with no historical Worker replacement.

## Files and behavior

- `branch_projection.mjs` recognizes only the validated `branch.create` shape returned by the existing named-operation resolver. It binds the authenticated owner, public repository identity, exact branch, object ID, transport body and original operation ID. REST and the existing GraphQL createRef form are supported. It returns the structured metadata decision only when the complete existing projection matches. Extra prose, unfamiliar shapes and all other operations remain on the normal prose path.
- `branch_projection_recovery.mjs` retains the original incident and result in an additive recovery journal, then atomically claims exactly the observed original operation for fresh evaluation. The conditional write includes digest, state, result, update time, evaluation token, write generation and original incident content. A competing receiver cannot consume the same recovery claim. The existing retry path recognizes this precisely recorded metadata recovery while retaining other incident handling.
- `compose_branch_projection.mjs` applies ten exact, unique integration seams to the supplied full Worker and appends a version suffix. It preserves unrelated current source, classifiers, bindings, source assessment, compensation checks, attribution, leases, provider mutation fencing, metadata comparison and actual provider readback. Changed or repeated seams stop composition with the actual unmatched seam.
- `receive_branch_projection.mjs` runs the composer with Node standard libraries, writes the complete composed Worker plus both runtime modules to a separate empty directory, and reads every output back. Its manifest binds full input and output bytes with SHA-256.

## Use with the current installation

Read the actual installed source and its full deployed module manifest. Run:

```sh
node receive_branch_projection.mjs --worker /current/service/worker.mjs --output /private/branch-content-source
```

The output contains complete `worker.mjs`, both runtime modules and `source-manifest.json`. Compose any subsequent concurrent source changes into that current Worker before updating the existing service. Include both new modules in the current deployment module list; keep every other current module and binding. Use the existing authenticated deployment operation and its normal source readback. The composer does not deploy or invoke GitHub.

The publisher creates its small recovery table lazily and caches successful initialization per database handle. D1 executes the insert-and-claim pair as a transaction; its documented batch behavior is at [Cloudflare D1 Database](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). Existing operation and incident tables are preserved.

For a retained metadata result, call the **unchanged original request with its unchanged operation ID** through the same publisher. Eligibility requires the original stored branch envelope, exact request digest and actor, one matching retained incident with the observed reason, and fresh resolved repository identity. After the conditional recovery, the original pipeline rechecks current provider facts and policies before the existing dispatch boundary. If the branch already exists at the requested object, the existing resolver and receipt logic adopt that reference; a different object remains a conflict.

Keep full account state, incident content, original private requests and provider records in their existing private custody. This generic source package contains no customer records or incident payloads.

## Focused verification and deployment boundary

The production resolver's complete maintained source was executed in V8 with the actual public repository shape and a retained branch request. The projection recognized its exact REST result; additional authored text, a different actor, another operation and an actual prose incident did not qualify. The composer produced a complete Worker from the retained baseline with all ten exact seams. This establishes the integration contract; the retained baseline predates the current live service and is not a deployment input.

The current installation supplies its own full source to the composer. The deployment owner should exercise the original operation through the existing service, retain its fresh reference receipt, then continue the original product integration. No new queue, controller, approval token or renamed operation is introduced.
