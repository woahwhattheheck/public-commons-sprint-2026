# Prescient SDK and S3 receiving bridge

This component connects the original Sparkgeo Prescient SDK to the maintained STAC product. The SDK performs identity acquisition and supplies temporary AWS sessions. The receiver transfers the exact asset already selected by the workspace and retains committed progress across capture attempts, worker cancellation, and process restart.

The public entry point is **sdk-runtime.mjs**. The operator's existing source-auth facade and asset-access provider own catalog admission, asset review, workspace history and customer export. This component supplies private native headers, original SDK sessions, reviewed S3 admission and the actual file transfer.

## Install the original SDK

Use Linux, Node with ES modules, Python 3.9 or newer, and the source-pinned original SDK. The native delivery runtime uses Python 3.12. The SDK requires boto3, google-auth, google-auth-oauthlib, msal, pydantic-settings and requests; its own pinned pyproject declares their compatible minimum versions.

Install from the reviewed source revision:

    python3 -m pip install -r requirements-prescient.txt

For the retained offline runtime, use its wheel directory with the same Python version/platform:

    python3 -m pip install --no-index --find-links ./wheels prescient-sdk==0.4.2

The complete native runtime bundle retains the original source distribution, dependency wheels, installed package inventory and file hashes. Use the actual bundled interpreter in pythonCommand. The worker verifies that the installed client.py and config.py match the reviewed original source before opening the connection. The original MIT notice is included in LICENSE.prescient-sdk.txt.

Source: [sparkgeo/prescient-sdk at895b7720](https://github.com/sparkgeo/prescient-sdk/tree/895b7720b22c3047b76ecff512f6be13f1d62fc9). Runtime source hashes are listed in sdk-source.json.

## Private operator configuration

Keep the existing Prescient credentials in an absolute private envFile, or pass the approved private environment to the child process. A saved workspace profile contains the reference and the reviewed access scope. An env file should be readable only by its operator account.

For API-key access the original SDK reads PRESCIENT_ENDPOINT_URL and PRESCIENT_API_KEY. For identity access it reads its existing Microsoft or Google settings, including client ID, authorization URL and the provider-specific tenant or client secret. Use the original SDK's Settings contract for the customer's identity provider. For OAuth, the operator facade passes expectedIdentityProvider as microsoft or google. The worker compares it with the effective frozen Settings before any identity request and returns the actual non-secret identityProvider in metadata.

Run an OAuth worker in the same supported browser environment where the original SDK can complete Microsoft interactive acquisition or Google's loopback flow. Keep that worker running for session continuity: the original SDK retains refresh credentials in process memory.

The following is the non-secret runtime configuration shape. Replace the example endpoint, env-file path, bucket scope and private directories with the operator's reviewed values:

    {
      "envFile": "/private/customer/prescient.env",
      "expectedEndpoint": "https://customer.example.invalid/prescient/",
      "authMode": "api-key",
      "allowedOrigins": ["https://customer.example.invalid"],
      "allowedS3": [{
        "bucket": "customer-imagery",
        "prefix": "approved-project/",
        "region": "us-west-2",
        "expectedBucketOwner": "123456789012",
        "requesterPays": false
      }],
      "receivingRoot": "/private/customer/prescient-receiving",
      "captureRoot": "/private/customer/stac/captures",
      "refreshSkewSeconds": 120,
      "chunkBytes": 8388608,
      "connectTimeoutSeconds": 10,
      "readTimeoutSeconds": 60
    }

The worker reads the actual effective Settings and requires the endpoint, API-key/OAuth mode and any expectedIdentityProvider to match this profile. It uses the original client's stac_catalog_url property; the SDK's urljoin behavior determines the catalog path, including the effect of a trailing slash in the endpoint.

allowedOrigins is the explicit set of HTTPS origins that may receive the Prescient API key or ID-token header. The worker returns the original SDK's api-key header in API-key mode and its Authorization header in OAuth mode. The existing SF31 source-auth transport admits the corresponding reviewed header scheme for that exact origin: normalizeSourceAuthorization({origin, scheme: 'ApiKey'}) for the literal api-key header, or its existing Bearer scheme. The operator facade joins this runtime result to that existing transport capability.

allowedS3 is a list of literal bucket/key-prefix/region approvals. The longest matching prefix wins; equally specific conflicting entries are rejected. A prefix is an S3 string prefix, so use a trailing slash when the intention is a directory-like scope. expectedBucketOwner is optional. requesterPays must be explicitly true for a selected requester-pays asset. Existing STAC rights/license review and unresolved storage-scheme handling remain part of the original asset review.

Supported asset addresses are s3://bucket/key and the standard https://bucket.s3.region.amazonaws.com/key form. The receiver retains the original href and derives the same bucket, key and region. A single versionId query is supported. Object keys are percent-decoded once; literal plus signs and repeated slashes remain part of the key.

## Node API

    import { createPrescientSdkRuntime } from './prescient/sdk-runtime.mjs';

    const runtime = await createPrescientSdkRuntime({
      pythonCommand: ['/private/runtime/bin/python3'],
      config: reviewedRuntimeConfiguration,
      timeoutMs: 300000
    });

Construction starts one private Python worker, imports the unchanged SDK, checks the original source hashes and validates effective settings. The returned metadata contains the actual SDK source revision, installed version, endpoint, catalog URL, authentication mode and allowed origins.

| Method | Input and result |
| --- | --- |
| requestHeaders | {url, method, signal}; returns the original private authorization or api-key header for an approved HTTPS origin. GET, HEAD and POST are supported for source reads/search. |
| observeResponse | {url, status, signal}; records a401 response for the next supported identity renewal. |
| sessionStatus | {refresh, signal}; obtains or renews the original native S3 session and returns only its mode, generation and actual expiration. |
| reviewS3 | {descriptor, signal}; performs pure bucket/prefix/storage admission and returns eligible, eligibilityReason and resolved source coordinates. |
| downloadS3 | {descriptor, directory, maxBytes, selection, signal, onProgress}; continues the original selected object into the original capture directory. |
| close | Terminates and drains this runtime's worker and settles outstanding requests. Repeated close calls share the same completion. |

downloadS3 requires the original selection:

    {
      "workspaceId": "original-workspace-id",
      "reviewId": "original-asset-review-id",
      "itemDigest": "64-character-original-item-sha256",
      "operationId": "original-acquire-operation-id"
    }

Capture directory must already exist beneath captureRoot. It may change on a retry because the original workspace retains a new attempt directory. The stable receiving spool is keyed by the original workspace and operation. New receiving directories are synced in their parents before the first checkpoint. Its journal binds the review ID, item digest, original href, resolved bucket/key/version, approved request conditions, SDK revision and byte limit. Changing any bound selection under that same operation is a conflict.

maxBytes is the reviewed positive integer limit, up to2GiB. chunkBytes controls a committed range; it defaults to8MiB and may be set between16KiB and64MiB. onProgress receives the actual committed byte count, total size, receiving ID, attempt count and safe session metadata. An observer exception leaves the fsynced receiving operation intact.

All method inputs are captured when queued. Requests are serialized against one original SDK client. A deadline or AbortSignal terminates and drains only the owned worker; the next request starts a new source-checked worker against the same private receiving spool. timeoutMs covers each worker request, including SDK calls whose original implementation has no native timeout.

## Temporary session renewal

The receiver checks the actual temporary AWS Expiration returned by the original SDK. It renews before expiration using refreshSkewSeconds and renews once on an actual AWS ExpiredToken, ExpiredTokenException or TokenRefreshRequired response before retrying the same request.

For Microsoft/Google identity sessions it invokes the original refresh_credentials(force=True). For API-key mode it constructs a fresh original PrescientClient from the same frozen Settings, then reads the new original bucket credentials/session. Version0.4.2's API-key refresh method returns immediately, so client reconstruction is necessary to obtain a new fileproxy credential set. A catalog401 in API-key mode reports that the configured key needs an operator update; reopen the runtime with the corrected private configuration. The adapter never modifies the SDK's private credential dictionaries.

S3 clients from the previous generation are closed. The selected object, source validator, committed prefix and original operation remain unchanged. Receiving checkpoints and completion use a non-network session metadata snapshot, so finalizing already received bytes does not require another identity exchange.

The original SDK uses its ID token in the OAuth Authorization header. Its public Settings and native Microsoft/Google refresh behavior remain authoritative. SDK stdout/stderr and raw provider exception messages stay out of workspace journals; bridge errors carry a stable code and selected AWS status/request identifiers.

## Durable receiving and customer handoff

Before transfer, the receiver uses the approved real boto3 session to call HeadObject. It records the observed length, ETag, version, MIME type and any returned full-object SHA256 checksum. It enforces the reviewed byte limit before accepting an object body.

Each GetObject request has the exact byte Range and IfMatch validator. When the source supplies a version, subsequent requests pin that VersionId. The receiver requires the actual206 status, exact Content-Range and ContentLength, and matching ETag/version for each range. ETag is a source validator; the receiver computes a separate SHA256 over every received byte.

After each complete range, it fsyncs the partial file and atomically saves its committed prefix length and SHA256. On interruption, recovery hashes the committed prefix and truncates only an unfinished range tail. It then rechecks the same source object before continuing the next range. A changed object preserves the existing checkpoint and returns PRESCIENT_S3_OBJECT_CHANGED for the original workspace to resolve.

Once all bytes are committed, final rename, journal completion and capture publication can recover offline. A completed operation verifies its retained full SHA256 and replays the same original receiving record and completion time into a new capture attempt. Existing different asset bytes or a different receiving record in a capture are explicit conflicts. Recovery also syncs existing completion/capture entries before returning success, covering an earlier process death after rename but before its directory sync.

Successful downloadS3 writes:

- asset.bin — the actual complete selected object.
- prescient-receipt.json — original selection, resolved source identity, observed validators, received SHA256, byte count, attempts, committed range count, safe session metadata and original completion time.

It returns the provider-compatible status, headers, bytes, sha256, mime and completedAt fields, plus the complete prescient receiving record. The host provider owns its common request.json, response.json and workspace operation record. Embed the returned prescient record in response.json and include prescient-receipt.json in the existing export file inventory. Keep the original asset review, acquired asset, source edition and customer receiver IDs in that handoff.

The spool's lock is held for one original receiving operation. A second writer receives PRESCIENT_RECEIVING_ALREADY_ACTIVE. Partial bytes, checkpoints and completed objects live under the explicit private receivingRoot; export only the selected completed asset and its receiving metadata through the existing workspace handoff.

## Original public Austin receiving run

The existing Austin scene selection already points to a public Sentinel thumbnail:

    https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/14/R/PU/2026/9/S2B_14RPU_20260915_0_L2A/preview.jpg

Its original receiving context records29,731 bytes and SHA2563838006f6aa188a3e52eaa58bbb58de3d1f4c65fad201d50bea495e86f3905b7. The explicit standard S3 mapping is bucket sentinel-cogs, region us-west-2 and the unchanged key above.

The native S3Receiver accepts a session provider with s3_client(region), session_status(refresh=False) and session_metadata(). Production uses PrescientSession. The public-source receiving continuation supplies an explicitly anonymous real boto3 client for this already-public original asset, retaining the original descriptor and review context. Use the native run to record its actual public-s3 mode, source responses,16KiB checkpoint interruption, recovered full hash and offline receiving replay. Deliver that actual outcome alongside the complete source and original workspace handoff.

## Primary implementation references

- [Original Prescient client](https://github.com/sparkgeo/prescient-sdk/blob/895b7720b22c3047b76ecff512f6be13f1d62fc9/prescient_sdk/client.py)
- [Original Settings](https://github.com/sparkgeo/prescient-sdk/blob/895b7720b22c3047b76ecff512f6be13f1d62fc9/prescient_sdk/config.py)
- [Boto3 GetObject](https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/get_object.html)
- [Boto3 HeadObject](https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/head_object.html)
- [Amazon S3 virtual-hosted addresses](https://docs.aws.amazon.com/AmazonS3/latest/userguide/VirtualHosting.html)
