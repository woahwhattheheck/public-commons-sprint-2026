# Certificate-authenticated supplier APIs

Connect an existing API that requires a client certificate or a private certificate
authority to the maintained SF30 seller. Buffered JSON/file responses, SSE and
NDJSON use the original upstream dispatcher and native payment lifecycle. The
same declaration is retained by the original seller release store.

The installed command is `starforge upstream-tls`. Application imports are
`@tokenjunkielabs/starforge-merchant/seller/upstream-tls` and its `/config` export.
Node 22+ supplies the certificate implementation; this feature adds no package.

## Configure your existing supplier binding

Keep the existing route, request mappings, supplier account, response limits and
payment terms. Add `tls` to the original `seller-upstreams.v1` binding:

```json
{
  "schema": "stellar-forge.seller-upstreams.v1",
  "bindings": {
    "inventory": {
      "origin": "https://api.supplier.example",
      "path": "/v1/inventory",
      "method": "GET",
      "query": ["sku"],
      "tls": {
        "caFileEnv": "SUPPLIER_CA_FILE",
        "certFileEnv": "SUPPLIER_CERT_FILE",
        "keyFileEnv": "SUPPLIER_KEY_FILE"
      }
    }
  }
}
```

Set the variables in the operator's normal service environment to the absolute
paths of the supplier-issued files. Keep those files outside the software package,
merchant export and release store. The declaration contains references; it does
not contain PEM text, private key bytes, passwords or machine-specific file paths.

| Field | Value supplied by the operator environment |
| --- | --- |
| `caFileEnv` | Optional PEM bundle of authorities trusted for this supplier. |
| `certFileEnv` | PEM client certificate, followed by its intermediate certificates. |
| `keyFileEnv` | Matching PEM private key. Supply this with `certFileEnv`. |
| `pfxFileEnv` | PKCS12/PFX bundle as an alternative to the PEM certificate/key pair. |
| `passphraseEnv` | Optional password for an encrypted key or PKCS12 bundle. |
| `minVersion` | Optional literal `TLSv1.2` or `TLSv1.3`; otherwise Node's minimum applies. |

A supplier using a publicly trusted server certificate usually needs only the
client certificate/key pair. A private-CA server without client authentication can
use `caFileEnv` alone. When `caFileEnv` is set, its bundle is the trust set for that
profile. Node's default authorities are used when it is absent.

For a PKCS12 supplier, replace the PEM fields with:

```json
{
  "tls": {
    "pfxFileEnv": "SUPPLIER_IDENTITY_FILE",
    "passphraseEnv": "SUPPLIER_IDENTITY_PASSWORD",
    "caFileEnv": "SUPPLIER_CA_FILE"
  }
}
```

The files must be regular files at canonical absolute paths. Key and PKCS12 files
use owner-only permissions on POSIX hosts, such as mode `0600`. Symlinked final
files are rejected. Rotate by replacing a complete file or changing the operator
environment, rather than editing a key while a launch is reading it. Certificate
and PKCS12 bundles may be up to 1 MiB; PEM private keys may be up to 256 KiB.

## Inspect, launch and operate

Review the saved declaration on any receiving machine:

```sh
starforge upstream-tls check --upstreams /private/merchant/upstreams.json
```

This command validates the TLS shape and lists environment references. It does
not read their values or open certificate files. To inspect the actual selected
material in the operator environment:

```sh
starforge upstream-tls inspect --upstreams /private/merchant/upstreams.json
starforge upstream-tls inspect --upstreams /private/merchant/upstreams.json --binding inventory
```

Inspection constructs Node's TLS context locally. PEM inspection validates the
certificate chain syntax, leaf validity dates and private-key match. PKCS12
inspection validates that Node can load the supplied bundle and password. Its
report retains the bundle SHA-256; leaf dates are available for PEM profiles.
The report gives each configured binding its own result, so one unavailable
profile remains identifiable beside the other profiles. A selected unavailable
profile gives the command exit status 2.

Use the original upstream launcher for the complete service check and launch:

```sh
starforge upstream --config /private/merchant/service.json \
  --upstreams /private/merchant/upstreams.json --check

starforge upstream --config /private/merchant/service.json \
  --upstreams /private/merchant/upstreams.json --port 8423 \
  --facilitator https://your-configured-facilitator.example
```

`--check` validates the existing seller and every selected TLS profile without
listening or contacting the supplier. A malformed, unavailable, mismatched or
expired PEM identity stops launch with a stable `UPSTREAM_TLS_*` error. An omitted
facilitator keeps the original challenge-only seller behavior: references are retained
as `DEFERRED`, and missing certificate files do not prevent payment challenges.
An embedded deferred handler loads its fixed context only when the original
admitted supplier attempt needs it. `--check` and configured paid launches load
and validate the files immediately.

The existing private operations listener's `/api/upstreams` includes each
binding's loaded TLS snapshot. It reports the authentication format, trust mode,
minimum protocol, load time, reference names, certificate SHA-256 and validity
dates where available. Runtime snapshots omit certificate contents, passwords and
private paths. Compare the loaded fingerprint with a newly inspected profile to
see whether a running process still has the earlier credential generation.

The TLS profile does not replace a configured bearer token, header credential,
OAuth grant or supplier allowance. Those controls compose through their existing
dispatch. TLS authentication, server certificate validation and hostname checks
use Node's native HTTPS connection. The configured hostname remains the server
identity; there is no profile field for disabling verification or overriding it.
Redirects and retries keep the original upstream behavior.

The normal declaration requires public HTTPS on port 443. An explicitly local
operator integration can use HTTPS on `127.0.0.1` with the existing
`--allow-loopback-upstream` switch. Its server certificate must cover that IP and
pass the selected trust validation. This also permits a local TLS sidecar to use
the same original merchant configuration and inspection commands.

## Retain the original release and rotate credentials

Stage the original OpenAPI selection and route-binding files with the same
upstream declaration:

```sh
starforge releases stage --store /private/merchant/releases --id inventory-v1 \
  --spec /private/merchant/openapi.json --config /private/merchant/selections.json \
  --bindings /private/merchant/route-bindings.json \
  --upstreams /private/merchant/upstreams.json --port 8423

starforge releases inspect --store /private/merchant/releases --id inventory-v1
starforge releases console --store /private/merchant/releases
```

Use the original console to compare, select and start the release. The immutable
upstream snapshot and route review include the TLS reference declaration, and
the release's environment list includes its certificate, key, CA and password
reference names. Staging and inspection remain possible on a machine that has
none of those values. Actual files are loaded only by the launch-time runtime or
the explicit TLS inspection command.

For a certificate rotation:

1. Put the replacement supplier-issued files in the private operator location,
   or prepare the new paths in the intended launch environment.
2. Run `upstream-tls inspect` against that environment. Review the new PEM
   fingerprint/dates or PKCS12 bundle identity.
3. Drain and stop the owned original seller. If environment variables changed,
   close its original console/launcher and reopen it from the new environment.
4. Reopen the same release store and start the existing selected release. Its
   reference declaration is retained; the new process loads the current files.
5. Read the loaded TLS snapshot from the existing operations listener and
   continue the original supplier operation.

Each constructed handler keeps one immutable TLS context. Changing a file after
startup does not change an in-flight call or the running identity. The normal
restart also creates a new in-memory response cache. A completed durable
operation retains its original response and recovery identity through rotation;
use the original operation recovery controls for an interrupted mutation.

If the receiving operator needs different environment reference names, stage
that edited declaration as a new release and compare it through the original
release workflow. Keys and certificates remain outside the release snapshots.

## Embed the same transport

```js
import { loadUpstreamTls } from './upstream-tls/profile.mjs';
import { createUpstreamHandler } from './upstream-handler.mjs';

const tls = loadUpstreamTls({
  certFileEnv: 'SUPPLIER_CERT_FILE', keyFileEnv: 'SUPPLIER_KEY_FILE',
  caFileEnv: 'SUPPLIER_CA_FILE',
}, { env: process.env, origin: 'https://api.supplier.example' });

const inventory = createUpstreamHandler({
  baseUrl: 'https://api.supplier.example', path: '/v1/inventory',
  query: ['sku'], tls,
});
```

Attach this handler through the existing seller application API. A loaded profile
can be shared across handlers. The original cache wrapper carries this native
handle and a configured host agent through its immutable request generations.
Named host proxy profiles compose with the same TLS declaration. Each loaded
TLS context has a separate native session identity, so connections and TLS
resumptions on a shared HTTPS agent retain the correct client certificate.
The host keeps ownership of agent shutdown through the original transport
lifecycle.

## Correct an inspection failure

| Error | Operator correction |
| --- | --- |
| `UPSTREAM_TLS_ENVIRONMENT_UNAVAILABLE` | Set the reported environment reference in the actual launch environment. |
| `UPSTREAM_TLS_PATH_INVALID` | Select a canonical absolute path for that reference. |
| `UPSTREAM_TLS_FILE_UNAVAILABLE` / `UPSTREAM_TLS_FILE_INVALID` | Select an accessible regular file in the supported format and size. |
| `UPSTREAM_TLS_KEY_PERMISSIONS` | Apply owner-only permissions to the private key or PKCS12 file. |
| `UPSTREAM_TLS_FILE_CHANGED` | Finish replacing the source file, then inspect its complete bytes. |
| `UPSTREAM_TLS_CERTIFICATE_INVALID` | Supply a PEM certificate chain or CA bundle containing certificate blocks. |
| `UPSTREAM_TLS_CERTIFICATE_TIME_INVALID` | Select the currently valid supplier-issued PEM certificate. |
| `UPSTREAM_TLS_PRIVATE_KEY_INVALID` | Check the PEM key and its configured password. |
| `UPSTREAM_TLS_KEY_CERTIFICATE_MISMATCH` | Select the private key belonging to the client certificate. |
| `UPSTREAM_TLS_CONTEXT_INVALID` | Check the PKCS12 bundle/password or the combined TLS material. |

## Maintained implementation and focused journey

The source command is
`node stellar/scf-starforge-20261009/sf30-seller-sdk/upstream-tls/cli.mjs`.
The single `journey.mjs` beside it uses OpenSSL-created local certificates, an
actual client-authenticated HTTPS server, the original native x402 2.28.0 seller
and controlled local facilitator responses. It exercises buffered/cached and
streaming delivery, named host proxy routing, cache management, shared-agent
certificate isolation, release-reference retention, reopen and certificate rotation.
Its temporary credential files are removed on completion. It uses only local
listeners and is excluded from the installed merchant package.

Node's [TLS context documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/tls.html#tlscreatesecurecontextoptions)
defines the PEM/PKCS12 and CA behavior. The original [HTTPS request API](https://nodejs.org/download/release/latest-v24.x/docs/api/https.html#httpsrequesturl-options-callback)
owns the authenticated connection; [X509Certificate](https://nodejs.org/download/release/latest-v24.x/docs/api/crypto.html#class-x509certificate)
provides the local PEM certificate inspection.
