# Offline map atlas

Every new seven-family delivery includes an offline atlas browser alongside its original PDFs, exact map index and source context.

## Open a downloaded delivery

1. In **Map atlas**, open the saved release and choose **Download complete GIS package**.
2. Extract the whole ZIP, preserving its folders.
3. Open the package's index.html and choose **Browse map atlas**. The browser is also directly available at delivery/maps/atlas-browser.html.
4. Filter by map family, baseline/source context or the original alternative run. Search for a title, pollutant or native raster path.
5. Open a standalone map, download it, or open the complete atlas at the selected page.

The browser uses local relative links and its own inline styles and filtering script. It requires no server, account, external fonts or network connection. All maps remain visible when scripting is disabled. Its print command prints the currently visible map index; the original PDFs retain the authored map layout.

## Read the native quantities

Each map sheet shows the original panel title, physical units or dimensionless index, signed alternative-minus-baseline status and retained numerical display range. It keeps the exact native Workspace raster path and original overlay source records in expandable detail.

The browser filters the index. It does not resample a raster, renormalize a pollutant, change a displayed range or recalculate a model. For exact cell inspection, use that sheet's **Inspect** action in the installed Map atlas and the existing Spatial review.

## Follow the original source

The source section retains the exact source watershed report, saved water designations, receptor specification and its source, resolved receptor network, original source roles and overlay bindings. Report-linked releases include the copied original report files with their relative paths. JSON downloads retain the complete native index and source choices.

The delivered-file table is built from the same final manifest passed to the existing packager: original maps, selected rasters and FGDC XML, scientific report, working archive and declared project assets. It shows retained byte counts and hashes when recorded in the delivery state. Workspace raster paths identify the calculation inside the working archive; only declared delivered members receive download links.

## Continue an existing project

Create or revise a release through the existing delivery workflow. The atlas renderer identity is seven-family-atlas/v4, so this product edition receives its own delivery identity while keeping the same selected native runs. The existing pipeline reuses completed native outputs and writes the browser after the final declared source and receiving-water assets have been assembled.

The new browser is recorded as files.map_atlas_browser and as maps/atlas-browser.html in project_assets. The existing packager captures and verifies it with the other members. The package entry point shows **Browse map atlas** when the exact captured member is present.

A browser HTML file downloaded by itself needs its companion delivery files at their retained relative paths. Transfer the complete GIS ZIP for a portable review.
