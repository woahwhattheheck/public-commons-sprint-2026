# Bounded S3 image input

The AWS runtime applies the vision pipeline's existing `MAX_IMAGE_BYTES` limit
(currently 24 MiB) while loading both the pinned reference and inspection object,
not only after the complete object has already been allocated.

`ContentLength` is checked before consuming the response body. Oversized declared
objects are closed without a body read. A missing length does not bypass the
limit: reads use at most 64 KiB per call and stop after a maximum of the byte cap
plus one look-ahead byte. That extra byte distinguishes an exactly-at-limit image
from an oversized object. No image is silently truncated into an accepted input.

Short reads are accumulated until EOF; a present length must match the actual
bytes. Empty input, invalid size metadata, non-byte reads and over-limit content
are rejected before inspection or ledger writes. The owned response stream is
closed on success and failure. A cleanup exception cannot mask an earlier read
failure. AWS transport exceptions still propagate rather than becoming a false
success or a synthesized image.

Bucket, key and `VersionId` requests are unchanged. This patch does not add a HEAD
request, retry a failed GET, change object permissions, deploy infrastructure,
alter the vision algorithm, or change duplicate replay/ledger identities.

## Offline verification

```sh
python -m unittest discover -s tests -p test_s3_input.py -v
```

Three focused tests execute the real dependency-free loader with fake S3 bodies:
exact-limit/partial reads and version selection; declared/undeclared oversized
objects; and truncation, empty/invalid metadata, read-error and cleanup behavior.
The existing runtime fake uses `BytesIO` so it implements the same bounded-read
and close interface as the SDK body. These checks do not establish a live AWS
round trip or competition entry acceptance.

Protocol references: [S3 GetObject response](https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/get_object.html)
and [StreamingBody read/close contract](https://docs.aws.amazon.com/botocore/latest/reference/response.html).
