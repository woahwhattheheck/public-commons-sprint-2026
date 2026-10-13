# Complete Upper Savannah profile and utility report source

This exact39-file source edition contains the merged PR3761 report and every original dependency required for its offline replay and existing native Scientific Reports consumer. It preserves the original17 data inputs and three D3 modules/licenses. All complete source bodies come from the public repository; no private runtime or customer data is included.

## Exact content

{
  "file_count": 39,
  "source_member_bytes": 6193619,
  "json_bytes": 6490849,
  "json_sha256": "cae5fb8b1df095b45d3524cfbd02332f3fb009793a9bb1b2d7174f3ca3e635ae",
  "gzip_bytes": 1035190,
  "gzip_sha256": "b913101e7558759d55067a44d16f8dcd35a19bcb36e7919cd4e10ee231b11739",
  "source_commit": "f2267c44a51315cbcc94d9eebbaf7997d22f4c6f"
}

Receive with standard Python: `python receive.py upstate-profile-report-39.json.gz NEW_SOURCE_DIRECTORY`.

Then run `node NEW_SOURCE_DIRECTORY/observations/landcover_observation_profiles_20261013/report/rebuild.mjs --verify-only`.

From the retained application, run its current `source/observed-report-20261013/render.py --app-root APP --workspace EXISTING_WORKSPACE --manifest NEW_SOURCE_DIRECTORY/landcover_observation_profiles.report.sources.json --output FRESH_REPORT_DIRECTORY --title 'Upper Savannah land cover, utility geography and observation context'`.

The source directory is separate from the maintained application and its original Workspace. Seven report sections and two scientific figures retain original source dates, utility anchor sets, distinct upstream unions, eight class-group balances and local observation identities.
