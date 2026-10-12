# Review and adopt a gRPC contract upgrade

Use **Contract upgrades** in the original gRPC merchant workspace when a service changes its protobuf contract. The workflow compares retained sources, explains the affected methods and fields, compiles your proposed merchant routes, and saves the exact reviewed choice into the existing revision history. It uses the same native protobuf loader, request serializer, merchant compiler, private workspace lease and SF82 release controls as normal authoring.

## Open the original operator

From a maintained installation, open **Applications → gRPC merchant authoring** and select the same private workspace. The existing `starforge grpc-workspace` command and source `grpc/workspace/server.mjs` entry remain available. Open the complete private URL printed by that server. The capability stays in that browser's session storage.

This is an operator feature inside that application. It does not start another merchant, open another upstream connection or create another payment intent.

## Retain the candidate source first

A candidate is either:

- A saved source/plan revision already in the original workspace.
- An exact retained reflection capture from the existing Reflection controls.

For a live reflected service, discover its current services, select the required services, capture the complete descriptor/import closure and inspect the retained result. The upgrade workflow uses those retained bytes. It does not query reflection again during comparison or adoption.

A local `.proto` candidate follows the original capture/save path. Save that candidate as a revision, then make the original merchant revision current before starting an upgrade review. If the earlier routes cannot compile against the new source yet, retain the candidate with an empty route list; the upgrade panel will start from the original merchant plan and let you correct it. Both revisions remain available. For an offline review, every selected revision/capture and its source identity must already be retained by this workspace.

## Start from the current saved merchant

Open **Contract upgrades** and choose **Use current saved revision**. The panel copies that saved merchant plan, including its public origin, routes, selected native methods, examples and complete payment declarations.

The upgrade base is the exact selected revision. Later inventory refreshes do not change it. If another window saves or checks out another revision, start a new review from that new current selection. Existing reviews remain readable.

Choose the saved candidate source. Selecting a candidate does not silently replace the merchant plan. Edit the **Proposed merchant plan JSON** and enter the title for the saved upgraded merchant.

Keep atomic payment amounts as quoted decimal strings. Each payment option retains its original scheme, network, asset, recipient, timeout and extra fields; the order of alternatives also remains meaningful. You may intentionally change terms in the proposed plan. The review displays both complete sets of options.

## Review the actual contract and routes

Choose **Review proposed upgrade**. The original native runtime compiles the captured candidate and processes the proposed plan without an application RPC or payment.

The retained review includes:

- Exact original and candidate protobuf/source identities.
- Field, message, enum and method changes from native reflection, including field numbers, field names, scalar/message types, repeated/map shapes, presence, oneofs and request/response reachability.
- Changed method input/output types and unary/server-streaming direction.
- Complete previous and proposed route identities, HTTP origins/paths and ordered payment options.
- Original saved request examples normalized and serialized against their candidate route method.
- Proposed request examples normalized and serialized against their selected method, with exact JSON/wire byte counts and SHA-256 values when accepted.
- Request and response public-schema identities, plus the candidate schemas through **Inspect candidate request and response schemas**.
- The native merchant compiler's precise error when the proposed route plan cannot yet compile.

Use the change filter and paged results to find a field or method without expanding every descriptor. A field name change can affect the workspace's exact-name JSON even when a protobuf tag remains the same. A type, oneof or default change can affect business meaning. The comparison reports those concrete differences; it does not infer that all future requests or clients behave identically from a passing example.

**Original saved example on candidate** checks the old route's example against the proposed method for that same route ID. **Selected upgrade example** checks the example currently written in the proposed route. Both checks are local native serialization. They do not call the service or validate the provider's business behavior.

An invalid proposed plan is retained as a useful review. Correct its method, fields, request example or complete terms, then review the revised input. Each changed review is a new retained record; an exact retry uses the same original review ID.

## Save the reviewed upgrade

Choose **Use reviewed upgrade** after reviewing the visible input. The button requires the same candidate, plan and title that produced the retained digest. Changed visible input must be reviewed again.

This invokes the original source/plan Save under its existing writer lease. It does not publish a running merchant. The save requires the reviewed revision and current-selection generation, so a later save/check-out from another window produces a conflict instead of overwriting it.

The saved adoption retains:

- Original review ID and review SHA-256.
- Original base revision.
- Exact saved upgraded revision and its selection generation.
- The original adoption intent and completion result.

The upgraded revision opens in the normal merchant editor. Its source configuration comes from the selected candidate, including target, TLS/authority, environment references and limits. Review any connection/limit differences shown in the report before saving.

## Continue the existing merchant and customer lifecycle

With that saved revision current:

1. Use the original **Review channel and terms** to establish native readiness.
2. Make an intentional call only when the service action is appropriate. Keep its original operation ID for outcome inspection and recovery.
3. Choose **Prepare merchant** to retain the original merchant folder, schemas, methods and customer client.
4. Inspect the seven original customer files and deliver the matching client/contract to the customer.
5. Stage the retained package in the original SF82 release control, review its actual public/payment changes, and activate it.
6. Use the original drain, stop, rollback and reopen controls. Earlier source and release revisions remain the rollback basis.

For a server stream, the original complete/non-OK/cancelled capture and payment-flow rules still apply. Contract review does not alter stream completion or settlement semantics.

## Reopen and recover an interrupted review or save

**Retained upgrade reviews** lists saved reviews. Reopening one loads its exact old revision, candidate source, plan and report without contacting the upstream service.

If a review reply was lost, the browser keeps its original review ID in session storage. Reopening or repeating the unchanged review reads that same record. It does not create another application request.

If the original Save reply is unavailable, the panel reads **Read retained save outcome** for the same review ID. You can repeat that read after reconnecting; it sends no Save. A workspace refresh keeps this recovery choice visible instead of suggesting a new upgrade. A completed result becomes **Open saved upgrade**.

If the original Save was interrupted, the retained adoption intent binds the expected old and new selection generations. Use the same reviewed upgrade again:

- If Save had not advanced the current selection, the original pure Save completes from that same intent.
- If Save already advanced to its exact expected revision/generation, the result is reconciled without incrementing the generation again.
- If another operator has moved the current selection since then, the workspace reports a revision conflict. Open the current work and create the next review from that selection.
- A completed adoption can be reopened even after other work becomes current. Opening it does not automatically check it out or run a merchant.

A lost HTTP reply is not a reason to create another payment or call. This workflow never dispatches either one.

## Export the review

**Download retained review** saves the complete JSON report, proposed plan and exact identities. Treat it as merchant-side material: it includes private target/environment-reference configuration and request examples, in addition to public method/route information. It is separate from the seven public customer files produced by preparation.

Workspace files live in the existing private workspace's `upgrades/` directory. Review files are create-only; the existing atomic index contains their compact summaries. Adoption intent/result files use the same original review ID. No second workspace database, source compiler or payment engine is introduced.

## Continue with a merchant agent or CLI

The original [merchant upgrade guide](../../../../stellar-forge/mcp-merchant-operator/GRPC_UPGRADES.md) covers the six agent tools and the installed `grpc-upgrade` command. They use the same review UUID, digest, source records and original Save/CAS path shown in this panel.

Use the running console's private URL file with `--console-url-file`, or use `--state` after that original workspace closes. Complete receiving carries four records: the retained review/adoption, base revision, candidate revision or reflection capture, and proposed plan. Native inspection compiles those captured contracts and the selected merchant plan before the receiving operator continues. The seven prepared customer files remain a separate usable client delivery.

Open or receive the same review after interruption. Its immutable digest stays the reference; adopting, calling, preparing and publishing keep their own original operation identities.

## Original API integration

Authenticated requests use the same `x-workspace-token` and local-origin rules as the original operator.

| Original route | Request | Result |
| --- | --- | --- |
| `POST /api/upgrade-review` | `{id,baseRevision,candidate,plan,title}` | Exact retained comparison and plan validation. |
| `POST /api/upgrade-open` | `{id}` | Retained comparison and current adoption/selection state. |
| `POST /api/upgrade-method` | `{id,method}` | Native candidate request/response schemas. |
| `POST /api/upgrade-adopt` | `{id,expectedReviewSha256}` | Original saved revision and durable adoption result. |
| `GET /api/state` | Existing authenticated read | Existing workspace state plus compact `upgrades` summaries. |

A revision candidate is `{kind:"revision",id:"<revision SHA-256>"}`. A reflection candidate is `{kind:"reflection",id:"<capture UUID>",captureSha256:"<retained capture SHA-256>"}`.

The public module `./seller/grpc/contract-upgrade` compares two original compiled contracts. The workspace module `./seller/grpc/workspace/upgrade` is composed by the original native model; callers must preserve its existing writer/selection ownership.

## Source basis

Contract loading and exact values remain in the original `grpc/proto.mjs`, `descriptor.mjs` and `values.mjs`. Merchant routes remain compiled by `compileGrpcMerchantPlan`. The detailed comparator includes its primary protobuf references in its own source. Operational native readiness, payments and release lifecycle remain their original product's responsibilities.
