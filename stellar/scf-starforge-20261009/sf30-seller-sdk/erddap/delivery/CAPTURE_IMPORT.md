# Receiving original NOAA ERDDAP source captures

This delivery uses the existing ERDDAP source importer, original SF30 dataset
engine, merchant export and independent customer importer. The acquisition
connector returns actual provider files. The offline assembly command packages
those files into the same six-member source archive used by direct HTTP
acquisition. It does not query NOAA or regenerate numeric responses.

## Complete operating sequence

1. Retain the complete acquisition receipt and the exact returned bodies under
   RAW_ROOT/SELECTION/NAME. Each selection uses metadata.json, dataset.dds,
   dataset.das, data.json and data.csv. Shared whole-dataset metadata remains in
   its original selection directory; the assembler resolves one unambiguous
   original response for the same dataset and protocol.
2. If the text-download connector cannot decode an original binary body, resolve
   that existing attachment from its containing page and download its bytes.
   Keep the stable notion-file-block reference and the actual carrier receipt
   described below. Preserve the original body encoding. Do not repeat the
   provider query merely to obtain another carrier.
3. Assemble the returned files with the maintained source parser:

   ```sh
python3 delivery/assemble_captures.py \
  --receipt /private/capture/source-receipts.json \
  --raw-root /private/capture/raw \
  --binary-return /private/capture/raw/mur-sst-june-2025/dataset.das.carrier.json \
  --output /private/capture/sources
```

   Omit --binary-return when every actual downloaded body is UTF-8 text.
   Repeat it when several original files were returned through binary carriers.
   The command writes one deterministic SELECTION.erddap.zip for every complete
   selection and capture-index.json with complete and incomplete selections.
   Incomplete requests are retained as failures; they never become empty tables.
   Existing output files must match their original bytes on a resumed invocation.

4. Run the complete maintained native receiving operation using the completed
   source archives. Keep the same operation directory on continuation:

   ```sh
python3 delivery/native-receive.py \
  --source-root /path/to/sf30-seller-sdk/erddap \
  --operation-root /private/erddap-original-receiving \
  --temporary-root /private/tmp \
  --source-packet /private/capture/sources/mur-sst-june-2025.erddap.zip \
  --source-packet /private/capture/sources/ndbc-46042-june-2023.erddap.zip \
  --source-packet /private/capture/sources/mur-sst-june-2023.erddap.zip
```

   Add the separately named colocated three-day captures when selected. The
   operation records original source, mapping, native build and snapshot IDs;
   reads every native cursor page; exports the seller dataset and six-member
   customer packet; reconstructs that packet in an independent workspace; and
   closes and reopens the receiver to read the complete edition again. These are
   actual product operations. A retained or failed generation is resumed through
   its original directory, with the original input identities.

5. Give the coastal workbook the accepted source/build IDs and the complete
   packets. Source-row paging preserves the original column names, types, units,
   lexical numeric tokens and missing values. The workbook uses its own retained
   comparison choices and report; it does not recreate the source acquisition or
   a second dataset engine.

## Source receipt contract

The existing direct-HTTP receipt is unchanged: literal requested URL, successful
HTTP status, exact body size and SHA-256, with the final URL on the reviewed
provider origin. Its original HTTP response fields remain available.

A native public HTTPS import is identified by
notion-public-https-import.v1 in files[NAME].transport. It retains the literal
sourceUrl, the successful upload's file_upload_id, filename, content_type,
content_length and status, plus the complete download's matching file identity.
The outer file record binds that receipt to its exact requested URL, byte length
and SHA-256. Before assembly, every text body must also match the immutable Git
blob recorded when that complete response was returned. A same-length changed
file cannot be relabeled as the original provider response. The capture index
identifies the exact acquisition-receipt bytes read at the start of assembly.

The connector does not expose upstream HTTP status, headers, redirect history or
final URL on a successful import. Those fields are absent in this receipt kind.
The original filename and declared type are preserved even when a binary download
is needed to read the body correctly.

All six time fields are present and nullable: startedAt, completedAt, observedAt,
downloadStartedAt, downloadCompletedAt and downloadObservedAt. Start/completion
fields describe the respective source import or file download. An observedAt
field records a later observation of an already completed call. Unknown exact
times remain null. The importer requires a completion or separately labeled
observation for both phases and checks ordering only where the actual times are
known.

For a text download, the returned content must encode as the complete original
UTF-8 bytes. The NOAA text bodies in this acquisition are ASCII and their actual
byte lengths match the native upload and download lengths; ASCII is also byte
identical under ISO-8859-1.

For a binary download, download additionally contains:

| Field | Meaning |
| --- | --- |
| method | signed-file |
| fileReference | Stable original notion-file-block reference from the containing page |
| carrierStatus | Actual successful file-download status, 200 |
| carrierContentType | Actual file-download content type, or null when absent |

These are attachment-carrier facts. They are not NOAA upstream HTTP fields. Signed
HTTP URLs and credentials are not retained in the source manifest.

The --binary-return JSON has path, bytes, sha256, fileReference, status,
contentType, startedAt and completedAt from the actual byte download. Its path
must identify the same retained raw member; an optional file_upload_id must
match the original source upload. The assembler validates the returned bytes
before attaching this carrier information to the original upload identity.

## The actual NOAA selections

The first requested historical period was June 2025. MUR returned its complete
27-row JSON and CSV selection: June 1–3 at the nominal 09:00 UTC field time,
latitude 36.00–36.04 and longitude -123.00–-122.96 at index stride 2, for
analysed_sst, analysis_error, mask and sea_ice_fraction.

The original station-46042 June 1, 2025 tabledap JSON and CSV requests each
returned HTTP 404 through the source-import connector, without a returned body.
The global dataset time range does not establish availability for every station.
NOAA's original station-history page lists standard meteorological archives
through 2023 and does not list 2024 or 2025. A separately named, otherwise
identical June 1, 2023 request returned 144 actual observations, confirming the
station identifier, variable names and encoded query. Its matching CSV contains
the same 144 records. That result does not rewrite the failed 2025 selection.

The paired MUR June 2023 selection changes only the original time endpoints and
returns 27 grid rows. Both 2023 selections reuse the original whole-dataset
metadata responses with their original acquisition receipts.

The observed June 2023 buoy position is 36.789, -122.404, about 100 km from the
original MUR tile. The additional coastal comparison uses the actual nearby
MUR tile at latitude 36.78–36.80 and longitude -122.42–-122.40 with index stride
1, June 1–3, 2023 at 09:00 UTC, and station 46042 from June 1 through June 4
exclusive. It is a distinct source selection. Its exact returned coordinates,
times, coverage and native IDs determine the comparison; distance tolerances
are not enlarged to accommodate the earlier remote tile.

## Scientific handling

MUR analysed_sst and analysis_error are already returned in degrees Celsius.
The error field is the provider's estimated standard deviation. Its quality
mask is a bit field; ice fraction has units 1. Keep missing ice values as missing,
rather than converting them to zero. Apply any quality selection as an explicit
reviewed analysis choice while preserving the complete original response.

NDBC WTMP and ATMP are already in degrees Celsius, WSPD is metres per second,
WVHT is metres and WD is degrees true. Wind direction is circular. A linear
average across north can be wrong. Preserve the source timestamp, historical
position and missing entries; a modern station page is not a substitute for
historical coordinates. In the original June 1, 2023 response, 96 of 144 WVHT
values and two WTMP values are missing.

MUR represents a foundation sea-surface temperature analysis at its nominal
field time. Buoy water temperature is an in-situ observation. Geographic and
time matching make a descriptive comparison possible; they do not remove
measurement-depth, sampling or representativeness differences. MUR also
incorporates in-situ inputs, so a buoy comparison is not automatically an
independent validation experiment.

JSON is the canonical provider response. Preserve exact numeric tokens and
explicit provider types through the existing source parser. Ordinary ERDDAP CSV
includes a units row and uses ISO-8859-1. The source mapper's default
require-equivalent policy checks it against JSON before publication; an explicit
canonical-json choice is retained when the provider's two original responses
differ. No scale/offset, unit conversion, interpolation or quality filtering is
reapplied by acquisition or assembly.

## Primary source documentation

- [MUR dataset metadata](https://coastwatch.pfeg.noaa.gov/erddap/info/jplMURSST41/index.html)
- [NDBC dataset metadata](https://coastwatch.pfeg.noaa.gov/erddap/info/cwwcNDBCMet/index.html)
- [NOAA station 46042 historical files](https://www.ndbc.noaa.gov/station_history.php?station=46042)
- [ERDDAP griddap protocol and response formats](https://coastwatch.pfeg.noaa.gov/erddap/griddap/documentation.html)
- [ERDDAP tabledap protocol and response formats](https://coastwatch.pfeg.noaa.gov/erddap/tabledap/documentation.html)
