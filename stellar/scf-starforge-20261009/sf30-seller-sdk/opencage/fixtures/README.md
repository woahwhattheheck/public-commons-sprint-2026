# Recorded OpenCage response

`native-reverse.json` is the exact 2,785-byte response returned by the original OpenCage HTTPS endpoint on 12 October 2026 at 01:36:08 UTC for `q=51.952659,7.632473&no_record=1`, using the provider's documented public test key. Its SHA256 is `94831ba4c34acf608585d242baa998c4ee58a190bf1e4ed3040897800f5797dd`.

The [official test-key contract](https://opencagedata.com/api#testing) returns a fixed success location. This capture contains one candidate, its geometry, provider confidence, response timestamp and returned attribution license. Preserve the complete bytes when using this source in the geocoding customer or original Buyer receiving workflow. The product's response import compares its recorded byte count and SHA256 before retaining a decision.

The native workshare used this response for browser import, explicit candidate selection, CSV and GeoJSON exports, and generated customer delivery. The related `NOWHERE-INTERESTING` query returned HTTP 200 with zero candidates. See [the provider's attribution guide](https://opencagedata.com/credits) and [OpenCage deployment](../DEPLOYMENT.md) for source and delivery operation.

An immutable raw GitHub URL for this file can be selected as the original Buyer's HTTPS response resource. Pin this response's exact byte count, SHA256 and the actual HTTP media type, then retain the original Buyer intent through execution and recovery.
