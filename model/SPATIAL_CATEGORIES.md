# Original land-cover legends and point inspection

The spatial viewer uses categorical grayscale swatches for retained class rasters. A swatch identifies a class; its shade has no quantitative meaning. Physical export and rate rasters keep their numeric scales.

Class names are read from the selected source collection's original CSV columns `lucode` and `description`. For a run, a description-bearing selected biophysical table takes precedence. When the selected combined table contains coefficients only, the viewer uses agreeing descriptions from its retained source-edition tables. It records each table source ID, URI and SHA256. Conflicting or unavailable descriptions display the original numeric code. No NLCD classification is inferred from a logical input role. Biophysical class names are used only for retained land-cover roles; binary reporting/contribution masks and other categorical layers keep their own original numeric codes, even when they share a run or profile identity.

The Gura intake already retains its original NDR and SDR tables alongside the combined coefficient table, so the source tables supply the original ten land-cover descriptions without changing the intake, scenario, profile, grid or native-run identities.

## Browser response

`frame.images.primary` and `comparison` include `categorical`, `categories` (value, label, colour) and `category_source` (sources and conflicting codes). The PNG uses the same discrete colours. Linked categorical panels share their code palette; numeric subtraction stays disabled for classes. The categorical scale has mode `categorical` and no numeric range.

Point inspection reads the original cell and adds `category.value`, `category.label` and the original table identities. A missing cell keeps its original nodata state.

The maintained browser renders category swatches and names in the legend and shows the description beside the inspected original code. Nearest-neighbour display cells remain a preview; scientific pixels, masks and quantitative outputs remain in the retained source rasters.

Saved-review PDF, SVG and PNG maps use the same discrete swatches. The PDF retains the complete original class key and table identities; a compact map key includes up to twelve class names per panel. Export source identity already includes the full renderer and spatial source hashes, so corrected prints receive a fresh content identity.

Original source IDs may be arbitrary, such as `GURA_NLCD`. For a completed native grid, the catalogue follows its retained `spec.input_sources.NLCD` binding to identify that original source as land cover. This supplies class names in the raw-source view while preserving the original source ID and source body. It does not infer class semantics from identifier spelling or apply land-cover names to binary masks.
