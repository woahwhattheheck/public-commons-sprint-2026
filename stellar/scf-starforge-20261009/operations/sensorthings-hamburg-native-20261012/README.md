# Hamburg charging-point source operation

This directory retains the public source for `SCF_SENSORTHINGS_HAMBURG_NATIVE_1B40_20261012`. The selected stream is Datastream 18571, **Ladepunkt DE*HHM*E1011*02**. The first fixed window starts at 2026-09-14T00:00:00Z and ends, exclusively, at 2026-10-12T10:31:58Z. Its seven pages contain 660 observations with 660 distinct IDs; the last page has no nextLink. The second actual retrieval of that same window is in progress in this checkpoint.

Every original JSON file contains the complete literal UTF-8 text returned by the declared public attachment/download connector. Its companion receipt retains both complete tool responses, the exact URL, attachment identity and byte counts. Provider HTTP status, headers and request times were not exposed. Connector attachment content types are recorded separately from provider HTTP headers. The JSON bodies have not been reformatted.

The native SensorThings implementation is merged in PR 1981. The connector-source reader and the same original customer delivery are being integrated. This checkpoint establishes the first complete source window. Node execution, native capture, browser operation and customer receiving have not yet occurred for these source files.

The manifest identifies every original and receipt by SHA-256, length and Git blob. The first catalogue page contains 3 of 2,485 reported Datastreams, with its original continuation retained. State-code counts describe received events; they do not measure uptime or charging utilization. Provider observations and metadata are sequential reads, without an atomic snapshot guarantee.

Attribution: **Freie und Hansestadt Hamburg, Behörde für Wirtschaft und Innovation**. The original metadata edition dated 2 July 2024 identifies [Datenlizenz Deutschland Namensnennung 2.0](https://www.govdata.de/dl-de/by-2-0). Its [published source page](https://suche.transparenz.hamburg.de/dataset/elektro-ladestandorte-hamburg36) was reread on 12 October 2026 and links to a newer metadata edition. Current service metadata and observed timestamps are independently retained in the JSON files.
