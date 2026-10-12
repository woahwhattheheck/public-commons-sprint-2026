# Leap interval API source contract

TokenJunkieLabs prepared this functional interface projection from Leap's current public documentation on 12 October 2026. The adjacent JSON contains names, wire types, constraints, routes, pagination and selected behavioral rules needed by the device-interval product. It is not a replacement for Leap's documentation or an assertion that a provider call succeeded.

## Original sources

- [status](https://developer.leap.energy/reference/listintervaldatauploads.md): provider update 2026-08-12T15:01:16.000Z; complete UTF-8 source 13282 bytes, SHA-256 `6604552f95d42360eb3dca301b8c5198f37b12ddb72a89ce1299971f516e38a7`; embedded OpenAPI JSON 12973 bytes, SHA-256 `449181427fb92cdf5e358c77b41adfe7050ada3f886a4d5a23a6552ab76228ef`.
- [upload](https://developer.leap.energy/reference/uploadintervaldata.md): provider update 2026-07-30T19:19:03.000Z; complete UTF-8 source 5171 bytes, SHA-256 `e8fed743b276148bd5c265181f65f7d2fb8941e644e0c1718d07d29a90d374b4`; embedded OpenAPI JSON 4758 bytes, SHA-256 `d579334c772ff2ea00cd0760ae8babbe466fc52a15b87efe43e1de894f61e37a`.
- [errors](https://developer.leap.energy/reference/listintervaldatauploaderrors.md): provider update 2026-08-12T15:01:16.000Z; complete UTF-8 source 10773 bytes, SHA-256 `8a07aeef0462e895d8a9d73f00b9d154c538c4940642078716519dad92aa4c8c`; embedded OpenAPI JSON 10370 bytes, SHA-256 `3c1e1031aa1fcdb2cf208e4f08a9e2688b2651dc51bd810e1477b0e7dffbe4cf`.
- [missing](https://developer.leap.energy/reference/searchmissingintervaldata.md): provider update 2026-07-30T19:19:23.000Z; complete UTF-8 source 12393 bytes, SHA-256 `6328afa57e925b6829f6e667f8bf8d69ee6897a5d669c2b71c1490c41c3de490`; embedded OpenAPI JSON 11940 bytes, SHA-256 `a6c8d3742f743b2737bd79ae99c25be879038f9ed0b439120dedb5aadf7eb33b`.
- [meter](https://developer.leap.energy/reference/getmeterdetails.md): provider update 2026-05-28T00:03:05.000Z; complete UTF-8 source 51123 bytes, SHA-256 `593b6c5626fccb5af178625692515f5fe5b15e086d7196478b8a182d864fa427`; embedded OpenAPI JSON 50872 bytes, SHA-256 `c00f10385aec154945ac0425387e4b8cf2768280920864a07ef6024b53f52928`.
- [original_file](https://developer.leap.energy/reference/intervaldatapresignedurl.md): provider update 2026-07-27T17:19:56.000Z; complete UTF-8 source 4850 bytes, SHA-256 `1cb9c34480a1126077b824906b853f47c4abd62ded005dd925f226c9d91925c5`; embedded OpenAPI JSON 4371 bytes, SHA-256 `0f23ab672aa2d04537ffcb4457c4fee3ea993d448bfa9757a707a2b9a1c044a0`.
- [file_preview](https://developer.leap.energy/reference/intervaldatafilepreview.md): provider update 2026-07-27T17:19:56.000Z; complete UTF-8 source 6644 bytes, SHA-256 `1b9686056e50253eaf29a1667777739fce0f4e9d6b3253355ad8df28aeba68c9`; embedded OpenAPI JSON 6265 bytes, SHA-256 `f60a370d3b613f97b10347bb8a8a72c709ca1b31942d4cdfe935efd4c2d17bdc`.
- [csv](https://developer.leap.energy/docs/upload-interval-data-sftp.md): provider update 2026-08-03T23:34:49.000Z; complete UTF-8 source 13935 bytes, SHA-256 `4cfc56dc40d50a821b239b1b84a15d3f3c2ca1e2953794b0fca8585e9b0caafe`.
- [meter_types](https://developer.leap.energy/docs/utility-meters-vs-devices.md): provider update 2026-09-16T19:29:18.000Z; complete UTF-8 source 5989 bytes, SHA-256 `db710096fdd1c9589dc766863827538ec31d4da2284e68c8c7079f5e26fadc64`.

Each hash covers the complete retrieved UTF-8 Markdown response without newline conversion. Embedded JSON hashes cover the exact bytes between the original JSON code fences, excluding the fences and their adjacent delimiter newline. The original complete source responses and retrieval receipts are retained separately. The public projection omits provider prose, example payloads, images and optional annotations. None of the seven retrieved OpenAPI documents declares an `info.license`; this delivery does not assign a license to Leap's original material.

Authentication is documented separately at [API key authentication](https://developer.leap.energy/docs/api-key-authentication): the existing environment-specific API key is passed as a Bearer credential. The OpenAPI bearer format label is JWT; no API-key exchange is required by that guide. Leap provisions partner access, and production and staging keys differ.

## Interface and recovery decisions

The upload accepts raw `text/csv` with a required `schema=load` query parameter and returns a job UUID. It does not declare a filename, Content-Disposition or idempotency parameter. Upload acknowledgement, ingestion completion and subsequent program processing are distinct. Keep `last_job_id`, the original upload path and the current file path separately.

A candidate job can be investigated through the current paginated upload-status endpoint and its original-file endpoint. The latter returns HTTP 302 with a temporary S3 Location header. Download that original file without forwarding the API credential and compare its complete bytes with the retained upload. The preview endpoint has an `is_limited` flag and cannot establish whole-file equivalence when limited. The source declares no signed-host allowlist, URL lifetime or duplicate-submission policy. Unknown outcomes therefore require retained evidence and explicit reconciliation before a new submission.

Missing-data searches use inclusive start and exclusive end windows, and their submission deadline is exclusive. OPEN requests data; PENDING says the data is already submitted and being processed. Every original response page and opaque cursor belongs to the same retained search.

The CSV uses 15-minute UTC intervals, a Leap-created meter UUID and net kWh or both consumed/generated kWh; all three values must satisfy consumed minus generated equals net. The guide excludes utility-authorized meters and requires current and historical partner custody. This product narrows selection to DEVICE meters. The general meter guide also describes some partner-created utility-meter programs, so the device scope should not be generalized into a global provider restriction.

The meter response identifies DEVICE versus UTILITY_METER, creation metadata and partner references. It does not expose historical partner ownership. Creation time or API visibility is insufficient to establish that historical fact.

## Published inconsistencies kept visible

The validation-error schema's top-level required list names `summary`, whereas its properties define `error_summary`. The error-row required list names an undeclared `errors` field. The JSON projection preserves those source lists and records how the receiver should retain useful native responses without inventing those fields. The guide calls consumed/generated values positive while its own example includes zero; the error descriptions reject negative values. Current meter API enums are uppercase even though the narrative guide lowercases them.

No Leap account, meter, API upload, SFTP upload or provider validation result was created to derive this contract. Customer inputs, ownership evidence and live provider responses remain separate from the public documentation examples.
