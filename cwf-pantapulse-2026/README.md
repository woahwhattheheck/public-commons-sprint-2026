# PantaPulse — Panta prediction-market evidence, not a trading bot

Original, local-first candidate for the **GLOBAL** Panta API Crypto World's Fair Sidetrack (competitive $5,000 USDG pool). A clean browser dashboard for source-linked Panta market records, implied YES probabilities, available liquidity and volume, explicit unknown fields, reproducible SHA-256 observation digests, explainable watchlist warnings, and Markdown export. Read-only; no wallets, signing, buying, custody or live-money requests.

## Zero-dependency demo (Python 3.10+)

    cd pantapulse_20261009
    python3 server.py

Open http://127.0.0.1:8766. The screen explicitly says **SYNTHETIC OFFLINE FIXTURE**. Those three fictional events are fabricated product samples, not live prediction markets or Panta data. Use the Refresh button and export the Markdown evidence report.

## Actual Panta API

First obtain an API account/key via sponsor's documented path and the correct Panta API HTTPS host. In the official Panta playground, the market discovery endpoint is `GET /markets/`, authenticated using an API key; API base URL is product-configuration-specific (the public playground defaults to localhost:8000/api/v1). We do not guess a production hostname.

    export PANTA_API_BASE_URL='https://your-authorized-panta-provider.example/api/v1'
    export PANTA_API_KEY='your-private-key'
    python3 server.py

No secrets belong in the repo, response payload, browser or logs. The backend sends `X-Api-Key` to the explicitly configured HTTPS host and refuses credential-bearing redirects. The JSON body is bounded to 1 MiB with 9s timeout. It reads up to 100 markets, recognizes documented common fields, and fails to a conspicuous error on unknown collection layouts; **it never silently substitutes fictional values on live feed failure**. Price fields missing/unknown are displayed as UNKNOWN and produce warning cards. This is a schema-adapter demo: independently confirm real Panta field names with a provider response before claiming a working live integration. The system intentionally never sends financial transactions or makes investment recommendations.

## Evidence and focused regression

    python3 -m unittest discover -s tests -p 'test_market_boundary.py'

One focused local predicate check covers ordinary YES price, low liquidity, unknown/out-of-range price and nonfinite rejection. No full repository tests. `GET /api/feed` produces an observation with UTC timestamp and SHA256 over sorted normalized records; `GET /api/report` produces Markdown. The digest proves only local consistency of the observed normalized fields, not third-party authenticity or that a market resolved correctly.

## Official entry/award gates

Official global sidetrack: https://superteam.fun/earn/listing/panta-api-side-track (as checked October 9, 2026); $5,000 USDG distributed $2,000/$1,000/$1,000/$1,000 on competitive judging, not guaranteed. Real, meaningful Panta API integration, a working demo, a **separate authenticated Colosseum Crypto World's Fair project submission** and a Superteam sidetrack submission are required. Main hackathon closes October 12. This source package is **not yet submitted or awarded**, and has not demonstrated an authenticated live Panta feed, a real Panta key, an entrant account, or a provider result. Preserve original contributors and sponsor attribution. “Powered by Panta” is visible in the interface. Source documentation reference: https://github.com/Kaito-HQ/panta-api-playground.

## Operator handoff

Copy these five source files to a unique original-author public project subtree `cwf-pantapulse-2026/` after Github authenticated actor quota recovers. Do not force any ref or duplicate a competing PR. Run the demo, install real authenticated Panta configuration, verify actual market payload schema / adapt when needed, show valid market observations, record a judge walkthrough, then submit using existing authorized entrant. Never claim an award or cash until the provider issues an award/payment receipt.