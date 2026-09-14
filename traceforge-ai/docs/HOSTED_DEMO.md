# Hosted TraceForge demo

Public demo: **https://traceforge-ai-production.up.railway.app**

This deployment runs the authoritative Python TraceForge application from this repository. It is not a static mock or a JavaScript port: the browser UI and `/api/*` endpoints are served by `python -m traceforge serve` from the `traceforge-ai` subtree.

## Deployment contract

- source repository: `woahwhattheheck/public-commons-sprint-2026`
- branch: `main`
- service root: `/traceforge-ai`
- start command: `python -m traceforge serve --host 0.0.0.0 --port $PORT`
- health check: `GET /api/config`
- runtime requirement: Python 3.11+
- deterministic demo mode: no API key and no paid inference service required
- live AI mode: disabled unless an operator explicitly supplies the documented `TRACEFORGE_*` environment variables

The provider configuration is intentionally deployment-only. It does not grant TraceForge remediation, messaging, purchasing, payment, signing, or cloud-account mutation authority.

## Verified public flow

On 2026-09-14 the generated public domain was verified end to end against the deployed service:

1. `GET /` returned HTTP 200 and the TraceForge browser UI.
2. `GET /api/config` returned HTTP 200 with `liveConfigured: false`.
3. `GET /api/demo` returned HTTP 200 with the built-in synthetic incident.
4. `POST /api/analyze` in `demo` mode returned a `traceforge-analysis/v1` result with a `traceforge-receipt/v1` receipt and at least one `CLAIM PASS` finding.
5. Posting that exact analysis object to `POST /api/verify` returned HTTP 200 and `{"valid": true}`.

The hosted verification is deliberately stronger than an HTTP health check: it proves that the UI route, deterministic analysis pipeline, receipt generation, and receipt verification are reachable through the public deployment.

## Re-run the hosted smoke test

From the `traceforge-ai` directory:

```bash
python scripts/smoke_hosted.py
```

Or target another deployment explicitly:

```bash
python scripts/smoke_hosted.py https://your-traceforge-host.example
```

The verifier uses only the Python standard library. It performs read-only GET requests plus deterministic demo analysis/verification POSTs. It does not invoke live-model inference or any remediation/action surface.

A successful run exits 0 and prints a compact JSON receipt covering the UI, config, demo, analyze, and verify stages. Any transport, schema, receipt, or deterministic-analysis mismatch exits nonzero.
