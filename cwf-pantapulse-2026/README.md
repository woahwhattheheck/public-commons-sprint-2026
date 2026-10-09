# PantaPulse — Panta prediction-market evidence, not a trading bot

Original, local-first candidate for the **GLOBAL** Panta API Crypto World's Fair Sidetrack (competitive $5,000 USDG pool). A clean browser dashboard for source-linked Panta market records, implied YES probabilities, available liquidity and volume, explicit unknown fields, reproducible SHA-256 observation digests, explainable watchlist warnings, and Markdown export. Read-only; no wallets, signing, buying, custody or live-money requests.

## Zero-dependency demo (Python 3.10+)

    cd pantapulse_20261009
    python3 server.py

Open http://127.0.0.1:8766. The screen explicitly says **SYNTHETIC OFFLINE FIXTURE**. Those three fictional events are fabricated product samples, not live prediction markets or Panta data. Use the Refresh button and export the Markdown evidence report.

## Actual Panta API

Use the sponsor-documented production API base `https://live-api.panta.market/api/v1`. Market discovery is `GET /markets/`, authenticated with `X-Api-Key`. Obtain the key only through an authorized entrant account; do not place it in source, logs, browser output, or Slack.

    export PANTA_API_BASE_URL='https://live-api.panta.market/api/v1'
    export PANTA_API_KEY='your-private-key'
    python3 server.py

The backend refuses credential-bearing redirects, bounds JSON to 1 MiB, and uses a 9-second timeout. It reads up to 100 markets from the documented `items` envelope and accepts `marketId`, `title`, `volumeUsdc`, and `status`/`phase`, while retaining legacy fallbacks. Documented list rows may have null `yesPrice`/`noPrice` and no liquidity field; those values remain visibly UNKNOWN rather than being guessed. Unknown collection layouts still fail conspicuously, and live-feed failures never substitute fictional values. This is a read-only schema adapter and never sends financial transactions or makes investment recommendations.

## Evidence and focused regression

    python3 -m unittest discover -s tests -p 'test_market_boundary.py'

One focused local predicate check covers ordinary YES price, low liquidity, unknown/out-of-range price and nonfinite rejection. No full repository tests. `GET /api/feed` produces an observation with UTC timestamp and SHA256 over sorted normalized records; `GET /api/report` produces Markdown. The digest proves only local consistency of the observed normalized fields, not third-party authenticity or that a market resolved correctly.

## Official entry/award gates

Official global sidetrack: https://superteam.fun/earn/listing/panta-api-side-track (as checked October 9, 2026); $5,000 USDG distributed $2,000/$1,000/$1,000/$1,000 on competitive judging, not guaranteed. Real, meaningful Panta API integration, a working demo, a **separate authenticated Colosseum Crypto World's Fair project submission** and a Superteam sidetrack submission are required. Main hackathon closes October 12. This source package is **not yet submitted or awarded**, and has not demonstrated an authenticated live Panta feed, a real Panta key, an entrant account, or a provider result. Preserve original contributors and sponsor attribution. “Powered by Panta” is visible in the interface. Source documentation reference: https://github.com/Kaito-HQ/panta-api-playground.

## Operator handoff

Copy these five source files to a unique original-author public project subtree `cwf-pantapulse-2026/` after Github authenticated actor quota recovers. Do not force any ref or duplicate a competing PR. Run the demo, install real authenticated Panta configuration, verify actual market payload schema / adapt when needed, show valid market observations, record a judge walkthrough, then submit using existing authorized entrant. Never claim an award or cash until the provider issues an award/payment receipt.