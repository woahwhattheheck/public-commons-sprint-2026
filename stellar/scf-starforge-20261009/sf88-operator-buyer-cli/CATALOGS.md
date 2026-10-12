# Native catalog acquisition and buyer handoff

The existing `--discover` command now supports explicit HTTP CONNECT transport,
complete paginated acquisition, restart/resume, and a local catalog browser.
It uses the original SF31 `X402BuyerClient.discover` and public HTTPS/DNS policy,
composed with the original SF85 CONNECT agent. There is no second discovery
protocol, payment engine, signer, automatic purchase, or implicit proxy setting.
Node 22+; Linux also uses the standard util-linux `flock` command. No Node package
installation is needed. The source tree must include SF31 and SF85.

## Capture a whole catalog

Create a private parent directory. Save this as an absolute configuration path;
replace the capture path with a new local directory under that parent:

```json
{
  "catalog": {
    "origin": "https://vellar-facilitator-testnet-production.up.railway.app",
    "limit": 20,
    "captureDir": "/home/operator/catalogs/vellar-20261011",
    "allPages": true
  }
}
```

From this directory run:

```sh
node cli.mjs --discover --config /absolute/catalog-config.json
```

Use `https://periplo-testnet.fly.dev` in a separate configuration and capture
folder to acquire that provider. Existing deployment prefixes, queries, network
filters and original `resources` / `items` envelopes remain supported. A plain
configuration without `captureDir` returns the original one-page JSON result.

The capture directory contains `session.json`, `manifest.json`, `index.html`,
and one immutable `page-NNNNNN.json` plus an inert HTML view per observed page.
Open `index.html` in your local browser, follow **Browse offers**, and inspect
resource paths, methods, accept indexes, networks, atomic amounts and recipients.
Provider text is escaped and the pages have no script, active remote resources,
forms or automatic navigation. Public catalog offers still remain untrusted input.

Each page JSON is directly compatible with the existing offline preparation:

```sh
node cli.mjs --prepare \
  --discovery /absolute/capture/page-000000.json --row 0 --accept 0 \
  --intent-id YOUR-STABLE-ID --url https://SELECTED-SELLER/CONCRETE-PATH \
  --method GET --out /absolute/new-buyer-review.json
node cli.mjs --review --config /absolute/new-buyer-review.json
```

Substitute the selected page, indexes, concrete URL and method. Those flags do
not automatically select the first offer. The original preparer retains the
source listing and file hash, binds the requested path/method, and creates a
review config without loading a signer. Existing operator setup and execution
continue unchanged. The discovery proxy is never forwarded to paid execution.

## VM proxy transport

On a VM that requires an operator-configured HTTP CONNECT proxy, add `proxy` to
`catalog`, for example `"proxy": "http://127.0.0.1:YOUR_ACTUAL_PROXY_PORT"`.
Only an explicit HTTP proxy endpoint is accepted; no credentials, query string,
proxy authentication or implicit `HTTP_PROXY` / `HTTPS_PROXY` environment read.

Public DNS is validated first. Ordinary public DNS results connect through the
proxy to the selected, pinned public IP; TLS still authenticates the original
catalog hostname. On a managed VM whose actual DNS result is one `198.18.0.0/15`
overlay address, also set `sandboxGatewayIPv4` to that **exact current address**.
The original SF31 gate checks that single answer, then the existing SF85 agent
uses the original hostname as the CONNECT authority. It does not try TLS against
the overlay's plaintext proxy port. Mixed, stale, or unrelated private addresses
remain rejected. No broad private-network override is introduced.

Use the machine's actual resolver output and configured proxy endpoint; do not
copy an old run's overlay address. Reconfigure transport and rerun the same
capture to resume it. Proxy/pin/timeout are not part of the source query identity.

## Resume and operational behavior

Rerunning an identical source query in the same capture directory verifies saved
page hashes and resumes from the first unsaved offset. A completed acquisition
makes no new requests. A committed page whose manifest update was interrupted
is recovered from that same file; it is not fetched again. Files are written
privately through fsynced same-directory temporary files and atomic publication.
Use a private local filesystem for the capture directory.

On Linux, the shared [private-directory lock](./private-directory-lock.mjs) holds
an exclusive `flock` through the parent process's open descriptor. It uses the
same retained inode across processes and container namespaces that share the
capture directory. The kernel releases the lock on close or process exit,
including a crash. The private `.catalog-writer.lock` file remains in place for
the next invocation; keep that file with the directory. A live writer produces
`CATALOG_WRITER_ACTIVE_OR_STALE_SOCKET`, and missing or unusable `flock` produces
`CATALOG_LOCK_UNAVAILABLE`. Apply this update between capture invocations so
every writer for a directory uses the same locking mechanism.

Windows keeps the original named-pipe lifetime. On other Unix systems the private
socket can survive a forced termination: after confirming no capture process is
active, remove only `.catalog-writer.sock` in that capture directory and rerun.

`timeoutMs` defaults to 30000 and covers each entire page including DNS, TLS and
body consumption. `maxPages` defaults to 1000, accepts 1–10000, and produces an
explicit `PAGE_LIMIT_REACHED` result rather than a false completion. Increasing
it allows the same capture to continue. A failed page is not automatically
retried in the same invocation; a deliberate rerun resumes that unsigned GET.
Previously committed pages remain available in the browser even after failure.

Malformed/non-progressing pagination or changing totals/envelopes stop acquisition
with a concrete error. Start a new capture to observe a changed catalog; do not
edit old page files. Equal totals cannot establish that a provider held a stable
snapshot between requests. The manifest labels the result as **parsed pages, not
an atomic provider snapshot**. Its hashes refer to locally serialized original
SF31 parsed JSON, not raw HTTP bytes, proof of seller ownership, or payment.

Transport failures surface their original safe code, for example
`CATALOG_NETWORK_ENOTFOUND`, `CATALOG_NETWORK_EPROTO`, or
`CATALOG_NETWORK_NONPUBLIC_DNS_ANSWER`, without printing arbitrary error messages,
headers or proxy secrets. HTTP failures retain `DISCOVERY_HTTP_<status>`.

## Focused native local lifecycle

This single exercise runs actual Node HTTPS, a real local CONNECT tunnel and the
unchanged SF31/SF85 source. It interrupts page two, resumes without refetching
page one, recovers an interrupted checkpoint, runs the original offline buyer
review, and checks modified-file refusal and inert provider-text rendering.
The local offer is explicitly unfunded fixture data, not a public-provider run.
It does not run hosted CI or contact a merchant. Run from this directory:

```sh
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 1 \
  -subj '/CN=catalog.fixture.example' \
  -addext 'subjectAltName=DNS:catalog.fixture.example' \
  -keyout "$T/key.pem" -out "$T/cert.pem" >/dev/null 2>&1
chmod 600 "$T/key.pem"
CATALOG_TEST_ROOT="$T/run" CATALOG_TEST_CERT="$T/cert.pem" \
CATALOG_TEST_KEY="$T/key.pem" NODE_EXTRA_CA_CERTS="$T/cert.pem" \
  node catalog-acceptance.mjs
```

The extra CA belongs only to this isolated local exercise. Production TLS remains
verified with the runtime's normal trust roots. The implementation follows the
native Node [HTTPS Agent](https://nodejs.org/download/release/latest-jod/docs/api/https.html)
and [IPC lifetime](https://nodejs.org/download/release/v24.19.0/docs/api/net.html)
contracts. No browser or OpenSSL dependency is needed for ordinary acquisition.
