# Branch publication content and original-operation recovery

A named Git branch creation writes a reference and a Git object ID. Repository descriptions, branch identifiers, transport envelopes and provider identity are metadata. Presenting that whole metadata JSON as authored correspondence can produce an irrelevant prose classification and strand an otherwise valid operation.

This package integrates that field distinction with the existing publisher, recovers a retained metadata-only result under its original operation ID, and keeps that recovery usable after an interrupted evaluation. It also prevents a recovered, unattempted incident from becoming a future notice while retaining the incident and any previously frozen or attempted notice.

## Complete operation lifecycle

`branch_projection.mjs` recognizes only the validated `branch.create` shape returned by the existing named-operation resolver. It binds the authenticated owner, public repository identity, exact branch, object ID, transport body and original operation ID. REST and the existing GraphQL createRef form are supported. Extra prose, unfamiliar shapes and other operations follow the existing prose assessment.

`branch_projection_recovery.mjs` records the original incident and result in an additive durable journal, then atomically claims the observed original operation for fresh evaluation. Its conditional write binds the digest, state, result, update time, evaluation token, write generation and original incident content. The original request continues through the existing current-provider and dispatch checks.

`branch_projection_stale.mjs` consults that durable journal inside the module. Ordinary operations call the existing evaluation fence. A journaled recovery uses the same complete current fence with its incident predicate recognizing only the matching recovered metadata incident. It retains the original 15-minute stale interval, token and digest comparison, result/status conditions, write generation, and optional lock transaction. A changed incident or another incident still prevents a claim. This covers process death immediately after the recovery claim and after the Worker's normal started transition; the original operation can resume through its ordinary stale-evaluation path.

The receiver generates this module from the **whole current evaluation fence**, retaining its helpers, imports, constants and other declarations. Its bundled version reflects the maintained source used for development. Deployment composition always regenerates it from the supplied current input.

`branch_projection_notices.mjs` excludes only an incident matching the durable recovery journal's operation, incident ID, digest, content, destination, projection version and original reason. Legacy attempt timestamps must all be empty. New queue admission and backlog ingestion skip that precise obsolete notice. Existing collecting/prepared membership remains recorded but is excluded from a future payload. An atomic predicate on the first payload write closes recovery racing the payload assembly; the existing drain recomposes when recovery wins that race. Real incidents remain in the digest. If an excluded incident was the deduplication representative, remaining duplicate members are still rendered in the payload; their recorded duplicate relationships remain intact.

A saved payload or recorded digest attempt is the history boundary. Such payloads, provider receipts, sent statuses and original incident rows remain intact. The current outbox retains its terminal and uncertain-attempt behavior and delegates through the composed digest module. No new polling loop or delivery queue is introduced.

## Compose the current installation

Read the installed full source and its deployed module manifest. Supply all four actual current modules:

```sh
node receive_branch_projection.mjs \
  --worker /current/service/worker.mjs \
  --fence /current/service/evaluation_fence.mjs \
  --notices /current/service/owner_notice_digest.mjs \
  --outbox /current/service/email_outbox.mjs \
  --output /private/new-branch-content-source
```

The receiver writes eight complete modules and `source-manifest.json` into a separate empty directory. It composes the Worker and notice module, retains the fence and outbox byte for byte, regenerates the recovered fence from the whole current fence, and supplies the projection, recovery and notice helpers. Every input/output is bound by its full SHA-256 and byte length. Each complete output is read back and checked by the executing Node binary with `--check` before the final manifest is written. Standard Node libraries are the only receiver dependencies.

The composer requires exact, unique integration seams: eleven in the Worker, seven in the notice module and two in the fence. It rejects changed or repeated seams with the specific unmatched source. Resolve such a change against the actual current module and rerun composition. The supplied source must precede this composition; using its own output as input is rejected.

Update the existing deployment's module list with these complete eight outputs while preserving every other current module and binding. Keep concurrent current-source changes in the same composed source. Use the existing authenticated deployment operation and read back its complete resulting manifest. This command creates source and does not deploy.

The additive recovery table initializes lazily per database handle. Recovery journal insertion and operation claim share one D1 batch transaction. The relevant provider contract is [Cloudflare D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). The notice change uses the existing shared dispatch lease and payload write.

## Continue the original operation

Call the unchanged original request with its unchanged operation ID through the existing publisher. Eligibility requires the original stored branch envelope, request digest and actor, exactly one matching incident, and fresh resolved repository identity. The original pipeline then rechecks current provider facts and policies before its existing dispatch boundary. An already-created reference at the requested object is adopted by the existing resolver and receipt logic; another object remains a conflict.

If evaluation stops after the original claim or its started transition, submit that same request after the current fence's stale interval. Durable state selects the recovered fence; callers cannot request an exception or supply a policy predicate. The existing dispatch/lease fencing still decides whether any provider mutation may occur.

Keep account state, incident content, original private requests and provider records in their existing private custody. This generic package contains executable source and documentation.

## Verification

The maintained production resolver and complete baseline Worker composition were executed in V8. Exact REST branch projection qualified; extra authored text, a different actor, another operation and an actual prose incident did not. The complete current maintained notice and fence modules were composed, with unchanged fence/outbox bytes carried into the receiving manifest. The development Worker baseline predates the current installed service, so the receiver takes the installed source as its input.

The receiving environment should exercise recovery through its native database: death after claim and after started; retry before/after the stale interval; a changed token or live lock; a second real incident; recovery before queue/seal; recovery racing the first payload write; and an already frozen or attempted digest. This is one operation lifecycle under the existing source and delivery machinery.
