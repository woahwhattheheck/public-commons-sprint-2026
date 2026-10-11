# Browser assets in the source distribution

Some workspaces serve a shared module under a local browser URL. The MongoDB
workspace serves the original PostgreSQL publisher schedule controls at
`/publisher-schedules.mjs`; the PostgreSQL workspace serves the original release controls
at `/postgres.mjs`. These URLs need not name physical files beside the browser
importer.

Each registered workspace keeps one `browser-assets.json` beside its original
server. The server loads it through `readBrowserAssets`, and the existing
distribution builder reads the same bytes from its immutable Git selection.
The manifest records a relative asset root and exact URL, source file and
content-type entries:

```json
{
  "schema": "stellar-forge.browser-assets.v1",
  "root": "./public/",
  "routes": [
    ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
    ["/postgres.mjs", ["../../../../sf82-seller-pilot/release-ui/postgres.mjs", "text/javascript; charset=utf-8"]]
  ]
}
```

The example shows two entries from the PostgreSQL contract; its maintained
manifest also contains the existing HTML and CSS routes. URLs and response
content types remain the server's existing public contract.

## Maintain a workspace

1. Add or change the exact route in that workspace's manifest.
2. Keep the server on the shared `readBrowserAssets` loader. It receives a map
   from each route to `{ url, type }`; the original handler still controls methods,
   authentication, caching, CSP and response streaming.
3. Register its server and manifest paths in `distribution.json` under
   `browserAssets`. Both must already be part of the selected component or
   explicit support inventory.
4. Keep every relative or root-relative static browser import reachable through
   that server's route map. An unserved import fails during source selection,
   even when a similarly named physical file exists.
5. Build the chosen immutable commit with the existing `build.mjs` command and
   install it with the existing runtime installer.

The collector includes each mapped asset and follows its actual static ESM
requests in every registered served-URL context. A missing neighboring physical
file can resolve through that exact browser context. This is not a global
missing-path substitution: an unrelated Node module receives ordinary
filesystem resolution and the existing missing-dependency error. A real
physical dependency is still selected and checked, including when a browser
also requests a separately mapped shared source. Existing forwarding modules
remain compatible.

Mapped paths must stay inside the Git repository. Regular-file, component
exclusion, extension, per-file size and cumulative size restrictions continue
to apply. Each server, JSON contract, helper and original shared asset appears
as its own unchanged-byte file in the existing distribution manifest, with its
Git blob, SHA-256, size and mode. There is no source rewriting, generated
forwarder, extra archive format, install hook or timestamp-dependent output.
