# Original freshwater coverage and publisher-code supplement

This complete source edition contains the 52 original SCDES freshwater features stored under publisher HUC_12 030601030101, together with the original count, native OBJECTID response, metadata and exact query URLs. The current model domain uses HUC 030601030100, Lightwood Log Creek-Savannah River.

The original native count is 52. The complete native ID response and original geometry contain exactly the same 52 unique OBJECTIDs. None is present in the previously completed 26,931-feature exact-HUC freshwater capture. The original geometry has 4,267 vertices, all 12 nongeometry attributes, and EPSG:3857 spatial reference. Named records include Hartwell Lake, Savannah River and Seneca River. Original coordinates and publisher HUC attributes remain unchanged.

Import source/sources.json with the existing Workspace source importer. This retains the original vector source and its companions. Use source ID sc-hydroclass-fw-publisher030601030101 for the polygon comparison. The current domain code is preserved separately; physical inclusion is determined by intersection with the original domain polygon. The active 0D0F geometry-mode intake performs that selection.

The 217-row coverage CSV joins the original exact-HUC freshwater counts to the retained NRCS state-HUC context. All 113 FW-positive codes have an SC state row. The 116 SC-bearing codes include three zero-FW cases. Original class statistics explain Middle Toxaway 030601010102 (22 TN and 20 TPGT records) and Middle Chauga 030601020302 (199 ORW records). Lightwood Log 030601030100 is the publisher-code comparison above. The other 101 zero-FW model codes have no SC state row in the retained NRCS context.

Original utility-focus counts are Upper Six And Twenty Creek 272, Lower Six And Twenty Creek 500, Choestoea Creek 258 and Lower Tugaloo River 290. These are publisher feature counts. NRCS program priorities remain in separate original state rows. The retained special-class column comes from the earlier classified-source inventory; its scope is preserved in the original full-domain context companion.

The original full-domain context input and native statistical response are included so the complete coverage join can be reproduced. All original geometry fields and coordinates are retained byte for byte.

Complete exact-HUC capture receiver: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C89723D0F
Original shared sources: https://app.notion.com/p/3f7dd77231008124b767e1dccf8a706e
Layer: https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2
