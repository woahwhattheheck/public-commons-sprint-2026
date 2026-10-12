# ERDDAP primary sources and exact public selections

## Maintained upstream contract

The CoastWatch deployment read during this implementation identified ERDDAP 2.31.1. The retained upstream source contract is the ERDDAP repository tag commit:

- Repository: https://github.com/ERDDAP/erddap
- Selected commit: 881f92117e698a0647aae8796fa9b8aee41dec7e
- TableWriterJson.java: Git blob 1ed2bdfc53c164be3cea2b86ba4fa2891a030eee
- TableWriterSeparatedValue.java: Git blob e69366d8c46af03097456180dda471369201c54c

Original API and format documentation:

- https://coastwatch.pfeg.noaa.gov/erddap/rest.html
- https://coastwatch.pfeg.noaa.gov/erddap/griddap/documentation.html
- https://coastwatch.pfeg.noaa.gov/erddap/tabledap/documentation.html
- https://coastwatch.pfeg.noaa.gov/erddap/info/jplMURSST41/index.html
- https://coastwatch.pfeg.noaa.gov/erddap/info/cwwcNDBCMet/index.html

The source adapter follows the actual writers. The JSON writer emits columnNames, columnTypes, columnUnits and rows, using original destination values and JSON numeric serialization; time fields are formatted strings and missing values are null. The separated-value writer emits names and units before the observations, uses its declared original ISO-8859-1 encoding and source string escaping, and has format-specific missing/time representation. The adapter compares those representations while retaining every original response byte.

The original metadata/DDS/DAS describe provider dimensions, fields, types, units, missing and fill values, scale/offset and flags. Scale/offset metadata remains source evidence; destination values are not scaled a second time. The exact row response is authoritative for returned coordinates and scientific values.

## Original MUR selection

Base: https://coastwatch.pfeg.noaa.gov/erddap/
Route: jplMURSST41
Protocol: griddap
Publisher NC_GLOBAL.id: MUR-JPL-L4-GLOB-v04.1

The provider route and publisher ID are separate identities. The original metadata includes dataset-specific source/license and EUMETSAT attribution; preserve the current complete metadata response with any delivered edition.

The exact selected original variables are analysed_sst, analysis_error, mask and sea_ice_fraction. Their DDS dimensions are selected in time, latitude, longitude order:

~~~json
{
  "variables": ["analysed_sst", "analysis_error", "mask", "sea_ice_fraction"],
  "axes": [
    {"name":"time","mode":"value","start":"2025-06-01T09:00:00Z","stop":"2025-06-03T09:00:00Z","stride":1},
    {"name":"latitude","mode":"value","start":"36.00","stop":"36.04","stride":2},
    {"name":"longitude","mode":"value","start":"-123.00","stop":"-122.96","stride":2}
  ]
}
~~~

The complete metadata endpoints are:

- https://coastwatch.pfeg.noaa.gov/erddap/info/jplMURSST41/index.json
- https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.dds
- https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.das

Append the query produced by delivery/acquire_noaa.py to the same griddap/jplMURSST41.json and .csv endpoints. It requests each selected variable with the same explicit three-axis selector. The exact ten complete URL strings are also stored in delivery/noaa-selection.json.

ERDDAP resolves value bounds to actual original coordinates. A selection's intended dimensions are not an observed response count. The collector writes actual response bytes and native intake derives the resulting row count.

## Original NDBC station selection

Route: cwwcNDBCMet
Protocol: tabledap

Fields use the provider's exact spelling and case: station, longitude, latitude, time, WD, WSPD, WVHT, ATMP and WTMP. The complete selection asks for station 46042 and timestamps greater than or equal to June 1, 2025 00:00 UTC and strictly before June 2, 2025 00:00 UTC.

~~~json
{
  "variables": ["station","longitude","latitude","time","WD","WSPD","WVHT","ATMP","WTMP"],
  "constraints": [
    {"variable":"station","operator":"=","kind":"string","value":"46042"},
    {"variable":"time","operator":">=","kind":"time","value":"2025-06-01T00:00:00Z"},
    {"variable":"time","operator":"<","kind":"time","value":"2025-06-02T00:00:00Z"}
  ]
}
~~~

Complete endpoints:

- https://coastwatch.pfeg.noaa.gov/erddap/info/cwwcNDBCMet/index.json
- https://coastwatch.pfeg.noaa.gov/erddap/tabledap/cwwcNDBCMet.dds
- https://coastwatch.pfeg.noaa.gov/erddap/tabledap/cwwcNDBCMet.das
- https://coastwatch.pfeg.noaa.gov/erddap/tabledap/cwwcNDBCMet.json?station%2Clongitude%2Clatitude%2Ctime%2CWD%2CWSPD%2CWVHT%2CATMP%2CWTMP&station%3D%2246042%22&time%3E%3D2025-06-01T00%3A00%3A00Z&time%3C2025-06-02T00%3A00%3A00Z
- https://coastwatch.pfeg.noaa.gov/erddap/tabledap/cwwcNDBCMet.csv?station%2Clongitude%2Clatitude%2Ctime%2CWD%2CWSPD%2CWVHT%2CATMP%2CWTMP&station%3D%2246042%22&time%3E%3D2025-06-01T00%3A00%3A00Z&time%3C2025-06-02T00%3A00%3A00Z

The original NOAA dataset metadata explains its consolidation of source observations, duplicate handling and source quality differences. The workbench retains the resulting original rows and metadata. It adds no secondary gap filling, duplicate selection, quality exclusion or unit conversion.

## Capture and reuse

delivery/acquire_noaa.py is the maintained exact HTTP source collector. It requires only Python's standard library and actual provider network access. The same output directory retains the original URLs, completed bytes/receipts and exact operation result across a retry.

Each complete source ZIP contains one manifest and the five actual responses. The manifest distinguishes source route, publisher metadata, protocol, selection, decoded query, response URL, actual HTTP status/headers, retrieval time, body size and SHA256. It declares completeness for the explicit selected request, not the provider's entire global dataset.

Another retrieval route can supply source research if it exposes a complete provider representation. Record that actual route and available metadata. An extracted web view cannot manufacture missing HTTP headers or become an HTTP-body receipt. The native source importer consumes the complete original capture contract.

A future comparable edition should be acquired from the real provider through the same selected source/mapping. Retain its independently returned original preparation time, history, metadata and observations. Editing an existing response or inventing an acquisition receipt is not a source refresh.

## Rights and customer handover

Carry the selected dataset's exact NC_GLOBAL license, attribution, references and source notices with the complete edition. Public NOAA hosting can include upstream third-party rights. Retain the original metadata rather than replacing it with a blanket license statement.

The authored workbench and helpers carry their repository license. The surrounding SF30 merchant/buyer implementation and installed dependencies retain their existing licenses. Public data examples retain their original source rights separately from the software.

The customer receives complete source/mapping/native output through the original packet importer. Public-terms selection governs the implementation's actual merchant transaction; original source rights govern the included scientific data.
