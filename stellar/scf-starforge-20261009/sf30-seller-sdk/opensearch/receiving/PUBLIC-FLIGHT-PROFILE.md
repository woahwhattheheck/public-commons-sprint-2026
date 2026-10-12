# Public flight receiving profile

This mode operates the maintained OpenSearch receiving workspace against the official OpenSearch Playground flight sample. It keeps the original anonymous service, native point-in-time searches, original source adapter, seller lifecycle and receiving workspace.

Enable it explicitly by adding `--public-flight-profile` to the maintained `run-deployment.py` invocation. The assembled source must contain the matching `playground-bridge.py` and `public_flight_profile.py`. The wrapper confirms the profile identifier in the bridge's readiness record before starting the application.

## Exact external requests

The only external application origin is **https://playground.opensearch.org**, using its existing anonymous session and console endpoint. The public profile fixes the index to **opensearch_dashboards_sample_data_flights**.

| Operation | Permitted native request |
|---|---|
| Engine metadata | GET / |
| Public index metadata | GET /_cat/indices/opensearch_dashboards_sample_data_flights with format=json, h=index,docs.count and bytes=b |
| Source mapping | GET /opensearch_dashboards_sample_data_flights/_mapping |
| Field capabilities | GET /opensearch_dashboards_sample_data_flights/_field_caps for the nine declared fields |
| Query preparation | A zero-row probe of the exact US/zero-minimum-fare query |
| Snapshot creation | The same public index, keep_alive=45s, complete index/PIT flags |
| Search pages | The exact query, fields and sort, with a provider-issued owned PIT and last-hit cursor |
| Snapshot release | One owned PIT ID at a time |

The query requires **OriginCountry = US** and **AvgTicketPrice >= 0**. The returned fields are FlightNum, Origin, Dest, OriginCountry, DestCountry, AvgTicketPrice, timestamp, FlightDelay and Cancelled. Ordering is timestamp ascending, FlightNum ascending, then the original adapter's _index and _shard_doc tiebreakers.

The maintained two editions retain seven or six hits, with three-row or two-row pages and one look-ahead row. The profile allows only those budgets. Search deadlines are at most 30 seconds. Snapshot state records only IDs and cursors returned by the corresponding upstream response. A failed search leaves its known snapshot available for release. The profile retires the old ID when the provider rotates it and releases state only after the provider confirms deletion.

Unknown routes, alternate indexes, changed query values, extra JSON/query fields, arbitrary cursors and foreign PIT IDs fail before an upstream request is constructed. Duplicate JSON keys and duplicate URL parameters also fail. Caller authorization, cookies, API keys and ambiguous transfer framing are rejected. The upstream headers are constructed by the bridge from fixed JSON/console headers and its own anonymous session.

The merchant server, generated client request inspection, workspace operations and browser traffic use the existing loopback application. The advertised `https://search.example.com/search/flights` value is inspected as generated client metadata.

## Source and operation records

The original source declaration is SHA256 **42c7b3542d83a89ac5a14b1f4a40f1fddc64a16a5d73e425f48e8c110df60368**. Its original seven-hit, three-page result is SHA256 **5cd0d983106d5691dc4680277590568beb3ec28de67004e8ba0ece0e53546825**, captured from native OpenSearch 3.9.0.

The source edition remains explicit. The receiving assembler preserves the earlier source archive and creates a separate immutable archive for the changed profile. The original workspace, drafts, source-result edition, prepared merchant package and native request identifiers remain available in the receiving copy.

Each profile run writes `public-egress-profile.json` with the fixed public contract. The existing native request journal records the profile, request kind, method/path, request-body hash and original response status/length. Rejected input is represented by hashes and its rejection code. The actual native deployment result continues to use the maintained lifecycle report and receiving artifacts.

The source guard was checked without network activity against all seven retained native sort rows, including paging, PIT rotation, release and rejection of unknown outbound inputs. The complete native receiving operation supplies the separate application outcome.

## Original public documentation

- [Analyze the Sample flight data](https://docs.opensearch.org/latest/getting-started/analyze-data/) identifies this exact index and its 13,059 source documents. IDs and timestamps are generated when the sample is loaded.
- [Prepare your data](https://docs.opensearch.org/latest/dashboards/getting-started/data-setup/) identifies the flight sample as preinstalled in OpenSearch Playground.
- [OpenSearch Playground](https://opensearch.org/blog/opensearch-playground/) describes the anonymous public environment.
