# Backend transport profiles

The API merchant workspace retains a backend connection choice with each paid operation. The original SF30 upstream compiler validates the profiles; the original SF82 release store preserves the generated configuration and its identity.

## Configure and review

1. Load the provider's OpenAPI source or reopen an existing package.
2. In **Backend transport profiles**, add up to 16 named profiles. Choose **Direct connection** or **Proxy from an environment variable**. A proxy profile contains the name of the variable that the receiving host will supply, such as `MERCHANT_HTTPS_PROXY`.
3. Select each operation's **Backend transport profile**, or use **Apply profile to selected routes**. An operation without a named profile uses the original direct connection.
4. Validate the complete configuration. Review the operation, profile, and receiving-host variable together with the existing backend URL, authentication, response, and payment terms.
5. Save a new package. Reopen it to recover those exact choices. **Download original upstream configuration** returns the saved `upstreams.json` and checks its recorded bytes and SHA-256 before the browser creates the download.

The saved configuration contains references. Configure the actual proxy URL in the receiving process environment before starting the workspace or seller. The original transport factory reads the value at launch. Renaming or removing a selected profile keeps a visible missing-profile choice until the operator selects or restores its intended configuration. The original compiler rejects unknown, malformed, duplicate, or unused declarations.

A named direct profile provides an explicit reviewable choice when some operations use a proxy. Every named profile must be used by at least one selected operation; remove a spare declaration before validation or assign it to its intended route.

## Retained plan and generated input

This is a transport excerpt from the original `stellar-forge.api-merchant-plan.v1` configuration. The complete plan also retains the public seller address, payment terms, and normal operation settings.

```json
{
  "transports": {
    "provider_proxy": {
      "mode": "environment-proxy",
      "proxyEnv": "MERCHANT_HTTPS_PROXY"
    },
    "direct_status": {
      "mode": "direct"
    }
  },
  "operations": [
    {
      "method": "GET",
      "path": "/search",
      "amountAtomic": "20000",
      "transport": "provider_proxy"
    },
    {
      "method": "GET",
      "path": "/status",
      "amountAtomic": "1000",
      "transport": "direct_status"
    }
  ]
}
```

The saved `upstreams.json` uses the original `stellar-forge.seller-upstreams.v1` shape: top-level `transports`, and an optional `transport` alias on each original generated binding. The merchant workspace does not construct another HTTP client or action resolver. SF30 compiles the selected profile and owns dispatch through the supplied host transport.

Profile names start with a letter and contain letters, digits, underscores or hyphens, up to 64 characters. Environment references follow normal variable-name syntax. A direct profile has only `mode`; an environment-proxy profile has `mode` and `proxyEnv`.

## Receiving host

Environment-proxy profiles require Node 22.21+, Node 24.5+, or Node 25+. This is the existing built-in proxy support required by the maintained transport factory. The host validates an HTTP or HTTPS proxy URL when it creates the selected transport. Use the original workspace/seller launcher and its current runtime requirements.

The workspace's runtime view identifies the active binding, selected profile and environment reference. Stop and restart through the original owner when changing host environment values, so an existing seller's owned sockets and in-flight operations complete through its normal shutdown.

Authentication remains configured through the original backend credential or OAuth controls. A transport profile selects the connection path to the backend. For provider OAuth token-exchange transport, use the existing connection host's separate configured transport and lifecycle; a route's named profile does not silently redefine that authorization host.

## Review a provider source revision

Use **Review an API contract revision** on a saved package. Its exact original source and complete plan remain the baseline. The review lists the configured profiles and shows any profile removed from the candidate when its final consumer is explicitly dropped.

Each retained or remapped route has **Revision backend transport** alongside its operation decision. Select a profile from the baseline's declarations, or choose the direct default. The chosen alias is included in that route's retained settings. The operation settings editor preserves authentication, prices, cache, stream, request and durable-operation values through the original source-refresh rules.

For a new profile definition, reopen the original merchant configuration, edit its profiles and save a new package before selecting a replacement source. Source revision then compares against that explicitly saved plan.

The original source-refresh compiler compares each operation using only the profiles that operation actually references. It validates the complete original plan first and the complete candidate afterward. Explicitly dropped operations remove their unused profiles from the resulting plan, so unrelated retained operations remain valid. The comparison includes the normalized selected profile, which makes a change in receiving-host reference visible even when the provider's OpenAPI declaration is unchanged.

Save a review snapshot to reopen the exact source and mapping decisions. Save the fully reviewed candidate under a new package name. The existing manifest binds its source, plan, generated `upstreams.json`, compiled seller and source-revision record.

## Stage and reopen with SF82

Use **Stage this saved candidate** in the original revision desk, or the existing `sf82-seller-pilot/release-cli.mjs stage --workspace ...` command for a saved package. The original release store imports that package, reads the configuration through `inspectUpstreamConfiguration`, and retains the exact upstream input.

SF82 configuration review includes both the binding and its selected normalized transport profile. A changed alias, mode, or environment reference changes the receiving configuration identity. Review and activate the desired original release through the existing release console. Reopen that release to inspect the same bytes and declarations.

The downloadable upstream file is useful for host setup and review. Use the complete saved merchant package with SF82 so its original source, offers, configuration, and receiving identities travel together.

## Existing code seams

- `transport-plan.mjs`: pure plan selection and original compiler composition.
- `transport-browser.mjs`: profile configuration, route selection, retained review, exact configuration download, runtime display.
- `model.mjs`: original merchant generation and saved-package reader.
- `../source-refresh.mjs`: original per-operation and complete candidate review.
- `revisions.mjs`: saved source review and release staging.
- `../../sf30-seller-sdk/upstream-transports.mjs`: original transport contract and owned host agents.
- `../../sf82-seller-pilot/release-upstreams.mjs`: original immutable release configuration review.
