# BIM in an existing Next application

This is the same complete SQLite workspace and provider catalogue used by the standalone operator. It is a Node server integration. It does not run in the Edge runtime, an ephemeral function, or a separately replicated writer. Keep one persistent original process for each workspace; the existing file lease rejects concurrent owners.

## Install the reviewed source first

Run the complete `native/install.py` entry on a new selected installation using its input contract. Keep the exact generated `package-lock.json`, complete browser bundle, legal comments, build receipt and final `source-files.json`. The authored `source-inputs.json` is a different roster from this installed source. A workspace binds the installed roster before opening its database. Do not edit that roster, swap dependencies or rebuild inside an installation already used by a workspace.

The installed package exports `createBimNextHandler` from `next-handler.mjs` and `createProviders` from `providers/index.mjs`. These are ordinary server modules. Your chosen host framework and its exact dependency lock remain the host application's own selection.

## Mount the real API

Copy `examples/next/bim-server.mjs` into `app/bim-server.mjs`, and `examples/next/route.mjs` into `app/api/bim/[...path]/route.js`. The supplied relative import resolves to that exact helper path. Keep the helper out of every client bundle. Its two fully computed imports use both webpackIgnore and turbopackIgnore so the host leaves the exact selected installation as a native runtime import; see the [official Next runtime-import guidance](https://nextjs.org/docs/app/guides/lazy-loading#webpackignore--turbopackignore). Do not remove those comments or replace the original installation with a generated context module.

Select absolute host paths using server environment variables:
- `BIM_INSTALLATION`: the completed immutable installation.
- `BIM_WORKSPACE`: the original selected workspace directory, outside the installation.
- `BIM_TOKEN_FILE`: the private regular file containing the operator access token.
- `BIM_CREDENTIALS_FILE`: optional private regular JSON map of server credential aliases to exact allowed origins and injected headers.

The helper uses one retained global startup promise, including through parallel initial requests and development module reload. Failed startup is visible and does not silently retry. The process owner must call and await `closeBimOwner()` at its original orderly shutdown boundary before releasing its own process/host ownership. An active original HTTP request is aborted and drained by the same Workspace close path. Do not open the standalone host against this workspace concurrently.

Every command sends the original request ID, expected revision and full immutable arguments. It requires the bearer token and `X-BIM-Workspace-ID`. Lookup and portable inspection never dispatch an external operation. Imported requests require explicit original recovery. The `X-BIM-Replayed` header is the original admission distinction; missing is never permission for a wallet send.

## Mount the complete operator UI

Publish into a new selected public directory:

```sh
node /ABS/INSTALLATION/tools/export-next-assets.mjs --out /ABS/NEXT_APP/public/bim-app --api-prefix /api/bim
```

The source-bound publisher copies every actual browser asset, both legal files, full domain module and original styles. It changes only the HTML API prefix and relative asset URLs; `BIM_ASSETS.json` retains each complete source/output identity. Existing different bytes are rejected. Open `/bim-app/index.html` in a normal full page, or use that exact same-origin URL inside an application-owned iframe. Links and module loads resolve inside this directory while commands use `/api/bim`. The access token is entered in the actual operator and remains session-local. Never put credentials or a MoneyGram session token in HTML, an exported browser working copy or a public environment variable.

A native workspace export contains the original installed source, full public request/history/provider evidence and original files. Receive creates a separately selected child workspace; it does not silently replace the current Next owner. Stop the original owner explicitly before selecting a different workspace in server configuration.

## Optional Privy component

`web/privy-stellar.jsx` is an optional host component. Mount it only inside the host's actual configured `PrivyProvider`; it does not log in, create a wallet, sign or perform a network request on mount. The source-backed optional peer is `@privy-io/react-auth@3.13.0`, with React and React DOM 18 or 19. Preserve the host's actual lock and app ID. It passes only public account selection and original XDR/hash requests; private keys remain in the wallet. The standalone bundle uses Wallets Kit2.7.1 and SDK16.0.1, preserving Kit's own transitive SDK selection.

## Receiving the integration

Open this exact mounted Next page and the original standalone page at desktop and narrow widths. Enter actual selected public source and configuration, operate reads/preparations only where authorized, open the full retained originals, save and reopen the browser working copy, download and inspect/receive the complete native portable workspace, and reopen every resulting file in its normal viewer. Exercise the original pending-request and error recovery controls without creating a substitute request. Inspect the actual rendered screen and downloaded attachments; merely compiling or capturing unviewed screenshots is insufficient. Preserve all existing native, wallet, provider and sender owners. Source assembly does not claim a rendered product, a wallet signature, a transaction or a provider session.
