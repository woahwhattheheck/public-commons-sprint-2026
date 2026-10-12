# Blockscout PRO token-information contract

Source review: 11 October 2026. This is the provider contract used by the retained Stellar merchant and operator in this directory. Keep the original provider response bytes, selected data chain, token address, request time, status and available accounting headers with each result.

## Token request and response

`GET https://api.blockscout.com/{chain_id}/api/v2/tokens/{address_hash_param}` uses `Authorization: Bearer <API key>`. Keep the key in the server-held credential selected for the provider session. The required chain ID is a string; the required address matches `^0x([A-Fa-f0-9]{40})$`.

The endpoint describes a JSON object with these required properties:

| Properties | Native type |
|---|---|
| `address_hash` | Non-null string matching the address pattern |
| `circulating_market_cap`, `circulating_supply`, `exchange_rate`, `volume_24h` | Nullable decimal strings: `^([1-9][0-9]*\|0)(\\.[0-9]+)?$` |
| `decimals`, `holders_count`, `total_supply` | Nullable integer strings: `^-?([1-9][0-9]*\|0)$` |
| `icon_url` | Nullable URI string |
| `name`, `symbol` | Nullable strings |
| `reputation` | Nullable enum: `ok`, `scam` |
| `type` | Nullable enum: `ERC-20`, `ERC-721`, `ERC-1155`, `ERC-404`, `ERC-7984` |

Optional nullable properties are `bridge_type` (`omni` or `amb`), `foreign_address` (address pattern) and `origin_chain_id` (integer-string pattern). Preserve nulls and numeric strings. The documented native 404 body has `message`; the 422 body has `errors[]` containing `detail`, `source.pointer` and `title`.

Source: [specific token endpoint and schema](https://docs.blockscout.com/api-reference/tokens/retrieve-detailed-information-about-a-specific-token), retrieved 2026-10-11.

## Data and payment identities

The selected EVM data chain and token address identify the requested data. They remain separate from the configured Stellar payment network, asset, seller and settlement transaction. A bridged token's origin chain/address is a further data attribute.

Blockscout's existing x402 example requests data on chain `8453` for `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; its existing payment is Base `eip155:8453` USDC. Its key-based and x402 routes expose the same underlying data. This implementation uses the existing Stellar payment components with a separately configured provider-operated route.

Source: [Blockscout x402 payments](https://docs.blockscout.com/devs/x402-payments), retrieved 2026-10-11.

## Credits and request capacity

PRO accepts an API key in a query parameter or authorization header; this implementation selects the header. Retain provider headers when present:

| Header | Meaning |
|---|---|
| `x-credits-remaining` | Credits remaining on the provider plan |
| `x-ratelimit-limit` | Requests per second |
| `x-ratelimit-remaining` | Remaining request-rate capacity |
| `x-ratelimit-reset` | Milliseconds until rate-limit reset |

The three rate-limit values can be `-1` when unavailable because of an internal error. The documented default for an unlisted endpoint is 20 credits; token detail uses that default. The distinct token-list `/tokens` route is listed at 30 credits. Free-plan requests are rejected after the daily credit allowance; paid plans have their own monthly overage treatment. Configure permitted chains, credit ceilings, tariff and concurrency explicitly, and retain observed headers with the original response.

Sources: [PRO responses and routes](https://docs.blockscout.com/devs/pro-api-responses-and-routes) and [PRO plan overview](https://docs.blockscout.com/devs/pro-api), retrieved 2026-10-11.

## Error preservation

PRO proxy errors use `{error, source}`, where source is `internal` or `upstream`. Documented statuses include 404 for an unsupported chain/route, 500 internal error, 501 not implemented, 502 bad gateway, 503 unavailable and 504 timeout. Upstream native 4xx responses can retain their original body format. Store status and bytes before presenting a readable operator explanation; distinguish exhausted capacity from a token not found. Payment recovery continues through the original transaction/attempt path.

Source: [PRO error responses](https://docs.blockscout.com/devs/error-responses), retrieved 2026-10-11.

## Provider agreement

Blockscout's terms distinguish the open-source components from the service licence (§3), place services under a separate Services Agreement (§4), and tie fees to that agreement and communicated pricing (§13). The proposed Stellar route is a provider-operated extension whose enabled chains, credentials, tariff, credit budget and operating responsibilities are configured for that engagement. Preserve the original proposal owner and service agreement context alongside the deployment handoff.

Source: [Blockscout terms and conditions](https://eaas.blockscout.com/terms-and-conditions), retrieved 2026-10-11.
