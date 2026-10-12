# GridFabric Plaid public contract sources

This projection describes the public Plaid v2 HTTP integration surface. It is an original functional reference, not a vendor JSON schema or evidence of a live Plaid, Canvas, device, utility or certification run.

## Captured source

The public Node reference is pinned to [16dc5efa](https://github.com/gridfabric/nodejs-sample-middleware/tree/16dc5efa5d49610109cd8c3a111bafb32fde0dce). Its exact index.js is 7,375 UTF-8 bytes, Git blob 2bc4ebfabe31a30dc5e25cb0d1ff8730d42e9bed and SHA256 12dc84d3699db86dc882bba51093069478c787611b94d09b52bb5ee98a4421a3. The complete [management example export](https://plaid-docs.gridfabric.io/files/boomerang_config.json) was read through all 1,007 numbered lines with matching overlaps and parsed as strict JSON. It is a historical export dated by its own timestamp, not a current provider receipt. The contract records hashes of the retained retrieval representations; web line-reconstruction hashes are not original HTTP-download byte hashes.

The primary [plugin reference](https://plaid-docs.gridfabric.io/reference/plugin-reference/), [management API](https://plaid-docs.gridfabric.io/reference/management-http-api/), [event implementation](https://plaid-docs.gridfabric.io/implementation-guide/implementing-events/), [report implementation](https://plaid-docs.gridfabric.io/implementation-guide/implementing-reporting/), [configuration](https://plaid-docs.gridfabric.io/reference/configuring-plaid/), [event reference](https://plaid-docs.gridfabric.io/reference/openadr-events/), [report reference](https://plaid-docs.gridfabric.io/reference/openadr-reporting/) and [changelog](https://plaid-docs.gridfabric.io/reference/change-log/) were read on 2026-10-12. The source registry is embedded in plaid-public-contract.json.

## Implementation boundaries

Preserve complete incoming bytes before projection. Bind the operator's stable instanceId and explicit resource/channel mapping; retain registration-assigned identities separately. Plaid owns protocol negotiation, callback scheduling, randomized effective times and report request windows. Return the synchronous callback before calling the same management listener. An HTTP 200/status OK may still contain an exception or a rejected VTN response.

Public wire examples confirm messageType, registration rid, query rIds, response rId and the Timet field spellings. Older prose uses different spellings. Keep original editions and record the deployed version; event modification numbers are documented from 2.5.0. A callback's single point at zero granularity does not replace the report subscription's on-change semantics.

## Schema and license custody

The complete callback JSON schemas and generated quicktype module are supplied in the vendor SDK, under /oadr/oadrapi/oadrapi/pluginmessages/schema/. They are absent from the public three-file sample. Unknown nested event members, opt-response shapes, status-object fields and complete enums are explicitly marked unverified. Retain them or validate against a separately received, version-bound vendor schema; do not infer members or substitute generated fixtures for vendor captures.

The [core license](https://plaid-docs.gridfabric.io/files/NOVA-LICENSE.txt) identifies the product as proprietary; the [quickstart](https://plaid-docs.gridfabric.io/quickstart/) describes vendor-granted software and Canvas access. This source projection vendors no Plaid implementation. management-examples.json contains published request interfaces and labeled historical response projections; its query example is explicitly authored for application development. No account, trial, provider invocation or outbound company message is part of this source capture.
