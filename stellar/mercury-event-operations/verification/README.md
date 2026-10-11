# Native operating outcome

The original joined operation `MERCURY-CUSTOMER-EVENT-NATIVE-A66C-20261011` ran on 2026-10-11 at 18:29:52 UTC. `native-journey.json` retains the complete result, its input origin and the exact production source hashes consumed by that operation. The provider side implements the published Mercury Classic wire contract; the application runs its actual HTTP server, REST client, SQLite operations database, signed customer HTTP delivery, worker, export and portable recovery commands.

The complete journey consumed four provider rows and retained three topic-matching canonical events, including two distinct rows from one transaction. One customer commit returned HTTP 500 after its database transaction: retry reused the original key, giving four HTTP attempts and three total customer rows. Three catch-up pages reached cursor 4204. A process restart, all 38 export records, actual CLI backup and byte-identical restored event envelopes completed in the same operation. The HTTP and CLI exports are independent snapshots with their own export metadata and hashes.

`sqlite-recovery.json` records the additional internal SQLite destination branch: the archive included the actual customer database, restore rebound the portable destination consistently, and replay retained one original customer row. An existing restore target stayed intact.

The operator JavaScript subsequently received one source-only correction that preserves exact original JSON numeric text in its record download. Its final SHA-256 is `bf521bc5f17ee9e60e876f1251416f833af6e9e27aa9b80577886dc659915146`; final JavaScript syntax was checked. The Python application, worker and adapters remain identical to the hashes in the joined result.

## Run the reusable journey

From the application source directory:

```sh
python3 -B native_journey.py --output /tmp/mercury-native-journey
```

Choose a fresh private output directory. The script creates real local databases, private runtime configuration, export and backup artifacts there and prints its result.

PostgreSQL schema deployment and the database-host transaction command are in [POSTGRES.md](../POSTGRES.md). The same adapter and canonical envelope are used by that destination.
