# Source and completed validation

## Source lineage

The product is an additive module below `sf30-seller-sdk/firecrawl/` in the existing Stellar Forge repository. It imports the original source instead of replacing the merchant, buyer, payment gate or encrypted recovery engine.

| Original component | Integration used |
| --- | --- |
| SF30 upstream adapter | `createUpstreamHandlers`, private backend environment references, original transport, response contract, availability counters and close |
| SF30 seller | `normalizeSellerPaymentOptions`, original service routes/admission, `startSellerService`, native factory and original operations launcher |
| SF30 developer client | `exportSellerClient` and the original standalone request contract |
| SF31 buyer/response writer | Actual native SDK challenge/response path and retained raw byte delivery |
| SF88 Buyer | `fromWorkspace(configuration)`, review, exact prepared intent, inspect, execute and recover |
| SF88 WorkspaceRecovery | Original selection, encrypted snapshot, verify and canonical restore |
| Original operator/Governor | Original workspace keys, current request cap, policy and ledger |

The matching configured-workspace components were read from provider commit `b9d838838cfc75bd3a920a1c304b13da4963f2e4`:

| File | Git blob |
| --- | --- |
| `sf88-operator-buyer-cli/python/bridge.mjs` | `faea8ad40851b416d73896d923dad6828cff3c85` |
| `sf88-operator-buyer-cli/queue.mjs` | `a7442e2a7f631a9605bdf2efe35bd093d8909a39` |
| `sf88-operator-buyer-cli/node/workspace.mjs` | `225fbef960996622bc5914a584febd30939174c9` |

The initial sparse runtime had the new Node workspace interface and an older bridge. Its option refusal was resolved by adopting these exact released originals into an isolated source copy. The same research query, capture IDs and prepared intent continued; no provider call was repeated for that interface correction.

## Primary provider contracts

Read on 2026-10-11:

- [Firecrawl v2 search reference](https://docs.firecrawl.dev/api-reference/endpoint/search)
- [Firecrawl search options and starter guide](https://docs.firecrawl.dev/features/search)
- [Firecrawl v2 scrape reference](https://docs.firecrawl.dev/api-reference/endpoint/scrape)
- [Firecrawl for platforms](https://docs.firecrawl.dev/firecrawl-for-platforms)
- [Coinbase's Firecrawl case study](https://www.coinbase.com/en-gb/developer-platform/discover/case-studies/firecrawl)

The implementation preserves the documented per-source search limit, distinct result groups, include/exclude domain semantics, page-content request and response metadata. Its selected subset is explicit in `contract.mjs`.

The Coinbase case concerns Firecrawl's existing Base endpoint. The source here composes the actual Firecrawl v2 API with the maintained Stellar provider/customer path.

## Completed native journey

Runtime: Node 24.19.0; original x402 core/Stellar packages 2.28.0; Stellar SDK 16.3.1.

Three real Firecrawl source requests completed through the original SF30 handler and original native buyer/response writer:

| Actual operation | Returned groups | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Search with content: “Stellar smart contracts documentation”, one web result, developers.stellar.org | 1 web | 10,789 | `79a273df6e2131e32206f2998e373bef68346540124bd857708ce27acb4f616d` |
| Search: “Stellar smart contracts”, limit one per web/news/images | 1 web, 1 news, 1 image | 1,284 | `469b2ca827074f55ba583107ea60c3b107025c3dc6e85d5c9c9b2ac2d9a9f323` |
| Read the actual selected https://developers.stellar.org/ page | 1 page | 10,259 | `31b8b707d0b7363cd2a512cf4695a730481388f5cf8202145c7abc8079db73d4` |

All were HTTP 200 with `success:true`. The search/content response reported three provider credits; grouped search reported two. The selected-page result did not provide a top-level credit count in the retained view. The original response bytes were unchanged through delivery.

The container's public DNS lookup initially returned `EAI_AGAIN`. The native exercise used the **existing SF31 explicit-CONNECT transport** through the already configured proxy, with exact Firecrawl origin/SNI/TLS, behind a private exercise-only source listener. That listener compared the exact source request bytes before forwarding. The production product remains fixed to `https://api.firecrawl.dev`; the exercise bridge is not a deployed merchant route or a replacement payment engine.

The software payment gate used the existing local native SDK outcome fixture. It verified ordering and exact delivery; it did not sign or submit a Stellar transaction. For every successful source operation, response generation finished before the local settlement callback.

The completed nine-stage flow also established:

1. Invalid requests were refused before source access, verification or settlement; a valid unsigned request produced the original payment challenge.
2. The original developer exporter produced all three operations and five standalone-client files from the actual seller OpenAPI.
3. The original operator initialized with zero reservations and no stored wallet key.
4. The three exact actual source responses entered the customer store with their source provenance.
5. The original Buyer prepared one 30,000-atomic-unit request under its original workspace, preserving the exact body/configuration and one intent.
6. Inspection and repeated collection of that unexecuted intent made no purchase; provider-observation intake could not overwrite preparation.
7. Source notes, selection and collection freeze enforced revision and selection checks. Later notes did not change the earlier edition.
8. HTML, CSV and complete JSON exports were created; comparison found one actual content change between the two retained page responses.
9. The original encrypted snapshot, verification and full canonical restore completed. Settings, client, profile, all three source hashes, the frozen edition and the same prepared intent reopened with zero new purchases.

Accepted native collection JSON: 33,587 bytes, SHA-256 `957857e91d66542ed17a34afcdbc0f985c9ed269a73ec26ae171f7a56832f6cf`.

Original recovery status: `BUYER_STATE_BACKUP_CREATED` → `BUYER_STATE_BACKUP_VERIFIED` → `BUYER_STATE_RESTORED`.

Recovery record SHA-256: `f9f3bb4b57c5e4996e2ad748f9af492694eb4c72709e12fb8a370e05bcf9f3f7`.

## Review corrections incorporated

Independent review identified and resolved three material integration seams: recovery now includes the actual settings/client/profile closure; observation intake rechecks preparation state inside its write transaction; and export publication stages/fsyncs before create-only publication while preserving a concrete post-publication outcome.

The frozen JSON retains original response bytes as Base64 with their hashes. Metadata paging does not decode every response; the complete frozen edition has an explicit encoded-size bound.

## Browser journey

The private operator browser walkthrough was selected on the same restored actual-source dataset. Its first execution request returned `environment_offline` before a browser process was created. The nine completed native stages above are the verified runtime result. The separate browser walkthrough remains attached to the original implementation work.
