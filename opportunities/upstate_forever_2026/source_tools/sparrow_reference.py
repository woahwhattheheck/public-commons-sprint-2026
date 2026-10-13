"""Admit the original USGS Southeast SPARROW calibration targets.

These are source-estimated calibration targets, distinct from the regional
SPARROW predictions. The complete published attribute rows, original network
reach attribution, source-global target horizon and current NLDI geometry
are retained with every selected Workspace observation.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import io
import json
import math
from pathlib import Path
import re
from urllib.parse import quote

from model.common import (atomic_bytes, atomic_json, describe_file, digest,
                          file_digest, held, now, read_json, relative_file,
                          verify_file)
from . import usgs_annual as annual_source

DOI = "10.5066/P9A682GW"
URI = "https://doi.org/" + DOI
SERVICE = "https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer"
SOURCE_SCHEMA = "upstate.sparrow-regional-reference-source/v1"
SELECTION_SCHEMA = "upstate.sparrow-regional-reference-selection/v1"
DEFAULT_SOURCE_ROOT = Path(__file__).resolve().parents[1] / "source" / "usgs-southeast-sparrow-2012"
NLDI_ROOT = annual_source.NLDI_ROOT
COLUMNS = annual_source.COLUMNS
SERIES = annual_source.SERIES
PERIOD_START = "1999-10-01"
PERIOD_END = "2014-10-01"
PERIOD_LAST = "2014-09-30"
TABLES = {
    "nitrogen-calibration.json": {"layer": 37, "series": "tn", "records": 598},
    "phosphorus-calibration.json": {"layer": 36, "series": "tp", "records": 589},
    "sediment-calibration.json": {"layer": 39, "series": None, "records": 395},
}
# FILES is the exact retained source edition; each public URL reproduces its
# complete original response rather than a locally rewritten subset.
FILES = {
    "nitrogen-calibration.json": {
        "bytes": 139120,
        "sha256": "f7e2bb7c22c644bf618d48e8fbb0729b44ab5c1f5343fb4a61261fd460911f48",
        "uri": "https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/37/query?where=1%3D1&outFields=*&returnGeometry=false&orderByFields=OBJECTID&resultRecordCount=1000&f=json"
    },
    "phosphorus-calibration.json": {
        "bytes": 136921,
        "sha256": "6e70bccc5666d8e4bd3389026bfc1242516817c462e4149c063b5e678c8a1ec0",
        "uri": "https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/36/query?where=1%3D1&outFields=*&returnGeometry=false&orderByFields=OBJECTID&resultRecordCount=1000&f=json"
    },
    "sediment-calibration.json": {
        "bytes": 107033,
        "sha256": "81b0ee67b2898e4b3c9c95a04253eb98a9f3dabc29bb5a41f463ee609041b91e",
        "uri": "https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/39/query?where=1%3D1&outFields=*&returnGeometry=false&orderByFields=OBJECTID&resultRecordCount=1000&f=json"
    },
    "P9A682GW-original-metadata.xml": {
        "bytes": 174636,
        "sha256": "236439342336e3ceb0fe749335f5893910793eeb6fad25cd6aad8ebe099f067d",
        "uri": "https://www.sciencebase.gov/catalog/file/get/5d6e70e5e4b0c4f70cf635a1?allowOpen=true&f=__disk__93%2Fba%2F5c%2F93ba5c50c58ced4116ad2e5b9783fc7848ab2cb5"
    },
    "service-definition.json": {
        "bytes": 11453,
        "sha256": "7fd8d3587b0a6da5f63270f0ab0551ea344d9db74a62d8ddbf57cc21acc5c6fa",
        "uri": "https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer?f=json"
    },
    "flowline-definition.json": {
        "bytes": 4899,
        "sha256": "0b2822f3d1e332eb9ccf1427fd850e73f00aeb76dcde6e9fdb42cf844008b3a6",
        "uri": "https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/42?f=json"
    },
    "reach-crosswalk-1.json": {
        "bytes": 16246,
        "sha256": "af3b3e5b81f969031c3799aaea16888c3d280fdcb103957e7e76c02655905442",
        "uri": "https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/42/query?where=COMID%20IN%20(448444%2C448560%2C476177%2C789206%2C790978%2C791526%2C791714%2C792126%2C793858%2C801223%2C894557%2C896197%2C897115%2C1048273%2C1050083%2C1970563%2C1984358%2C1984364%2C1984368%2C1997544%2C1997572%2C2016562%2C2016602%2C2041749%2C2041873%2C2043147%2C2043375%2C2043397%2C2043501%2C2044673%2C2044799%2C2044955%2C2045253%2C2047815%2C2047911%2C2047963%2C2047971%2C2047989%2C2048013%2C2048057%2C2048139%2C2048177%2C2048245%2C2066534%2C2066998%2C2067234%2C2067240%2C2077651%2C2157192%2C2161384%2C2161778%2C2161822%2C2161874%2C2161876%2C2171465%2C2171553%2C2172289%2C2178951%2C2189757%2C2214110%2C2230475%2C2230489%2C2230497%2C2232693%2C2232703%2C2232713%2C2235919%2C2235931%2C2235945%2C2236085%2C2240423%2C2242015%2C2244465%2C2293124%2C2298964%2C2306739%2C2312915%2C2323396%2C2402121%2C2413994%2C3285608%2C3285770%2C3286256%2C3286354%2C3286494%2C3286570%2C3289348%2C3290264%2C3291248%2C3291986%2C3298592%2C3350287%2C3350831%2C3350885%2C3350897%2C3351025%2C3424530%2C3425836%2C3434304%2C3434372%2C3438596%2C6269342%2C6280111%2C6330544%2C6330580%2C6330794%2C6330798%2C6330838%2C6330976%2C6331014%2C6331074%2C6331142%2C6331298%2C6333364%2C6333538%2C6333720%2C6333824%2C6333864%2C6333958%2C6334126%2C6334130%2C6335902%2C6336552%2C6341486%2C6367034%2C6396033%2C6397397%2C6442772%2C6444276%2C6447636%2C6459927%2C6460241%2C6477869%2C6478071%2C6479057%2C6479383%2C6479507%2C6479637%2C6486392%2C6489002)&outFields=COMID%2CREACHCODE%2CFDATE%2CGNIS_NAME&returnGeometry=false&orderByFields=COMID&resultRecordCount=1000&f=json"
    },
    "reach-crosswalk-2.json": {
        "bytes": 15891,
        "sha256": "a9d7f5779373f72d671372b0e1d47c57fd38b8f67b55cd3521121c96ea02961c",
        "uri": "https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/42/query?where=COMID%20IN%20(6489782%2C6489840%2C6498024%2C6498632%2C6498944%2C6499012%2C6499058%2C6499800%2C6500350%2C8623895%2C8625113%2C8626299%2C8626733%2C8627131%2C8627315%2C8627467%2C8629163%2C8629195%2C8629291%2C8630895%2C8632147%2C8632371%2C8647822%2C8647998%2C8648280%2C8648984%2C8649972%2C8651902%2C8653008%2C8653080%2C8671855%2C8672015%2C8673051%2C8673065%2C8673551%2C8673773%2C8673791%2C8674971%2C8675163%2C8675313%2C8675421%2C8675427%2C8677803%2C8693153%2C8693577%2C8693739%2C8693827%2C8696463%2C8696811%2C8724015%2C8725761%2C8725915%2C8731529%2C8741001%2C8741021%2C8742277%2C8742283%2C8744133%2C8746117%2C8755825%2C8759419%2C8759739%2C8760623%2C8760657%2C8762423%2C8762453%2C8762549%2C8762639%2C8764167%2C8777369%2C8777381%2C8777403%2C8777415%2C8777467%2C8777529%2C8777849%2C8778363%2C8778383%2C8780571%2C8782655%2C8782837%2C8783201%2C8783277%2C8783329%2C8783503%2C8783667%2C8783675%2C8784179%2C8784187%2C8784409%2C8784535%2C8784675%2C8784827%2C8785035%2C8785323%2C8785685%2C8785963%2C8785997%2C8786017%2C8786045%2C8786063%2C8790163%2C8816187%2C8831706%2C8831734%2C8831736%2C8831780%2C8831818%2C8831852%2C8834908%2C8834932%2C8834960%2C8834978%2C8842475%2C8842561%2C8844555%2C8845373%2C8845507%2C8845627%2C8846059%2C8846179%2C8846189%2C8847195%2C8847219%2C8852039%2C8853165%2C8866534%2C8868790%2C8869040%2C8869108%2C8869804%2C8870074%2C8870530%2C8871292%2C8872476%2C8872958%2C8889706%2C8890012%2C8890310%2C8890540)&outFields=COMID%2CREACHCODE%2CFDATE%2CGNIS_NAME&returnGeometry=false&orderByFields=COMID&resultRecordCount=1000&f=json"
    },
    "reach-crosswalk-3.json": {
        "bytes": 16050,
        "sha256": "0cf0535842dd4f5f756f367cbb027c5d889b0ea1e250ae0f58fc0ce5d1a58e4f",
        "uri": "https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/42/query?where=COMID%20IN%20(8890580%2C8890846%2C8890848%2C8891356%2C8891478%2C8891488%2C8891502%2C8891642%2C8892370%2C8893722%2C8893782%2C8894150%2C8894172%2C8894192%2C8894216%2C8895436%2C8896094%2C8896240%2C8896526%2C8897518%2C8897926%2C8898146%2C8898400%2C9064270%2C9069040%2C9090136%2C9091268%2C9117154%2C9125942%2C9130462%2C9130674%2C9150508%2C9150580%2C9153118%2C9153272%2C9155732%2C9167976%2C9168432%2C9168578%2C9171250%2C9173704%2C9173768%2C9175254%2C9177256%2C9179734%2C9202129%2C9202375%2C9202419%2C9202749%2C9202827%2C9202871%2C9202911%2C9210446%2C9211318%2C9221441%2C9221483%2C9221767%2C9221967%2C9222463%2C9223419%2C9235493%2C9236229%2C9245516%2C9248978%2C9249426%2C9249546%2C9249606%2C9249832%2C9250570%2C9250814%2C9250868%2C9251726%2C9252852%2C9608872%2C9609466%2C9614545%2C9619179%2C9680968%2C9681484%2C9691190%2C9692564%2C9699821%2C9700085%2C9700903%2C9705130%2C9705136%2C9707862%2C9710626%2C9713497%2C9718007%2C9731328%2C9731340%2C9731398%2C9731482%2C9731500%2C9734212%2C9735844%2C9736188%2C9736378%2C9736516%2C9737016%2C9745124%2C9745224%2C9745600%2C9747316%2C9753760%2C9753828%2C9754776%2C9755474%2C9756782%2C9866018%2C9867154%2C9867192%2C9867238%2C9867484%2C9867682%2C9867714%2C9868300%2C9868688%2C9869384%2C9869412%2C9869898%2C9870422%2C9871292%2C9873100%2C9944858%2C9945090%2C10362294%2C10362516%2C10365476%2C10365534%2C10365698%2C10365922%2C10366208%2C10451176%2C10451378%2C10510596%2C10511316%2C10511334%2C10511808)&outFields=COMID%2CREACHCODE%2CFDATE%2CGNIS_NAME&returnGeometry=false&orderByFields=COMID&resultRecordCount=1000&f=json"
    },
    "reach-crosswalk-4.json": {
        "bytes": 16386,
        "sha256": "a4e03d4581829d5ac0b8106d4fefbe3a6edeb6b59203e088b06c5d12bb4dbe54",
        "uri": "https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/42/query?where=COMID%20IN%20(10518518%2C10527019%2C10538734%2C10542338%2C10542346%2C10549446%2C10551046%2C10853975%2C10853977%2C10853999%2C10854075%2C10854185%2C10976591%2C10977145%2C10977161%2C10996335%2C10996421%2C10996475%2C10996491%2C10996507%2C10996529%2C10996581%2C10996601%2C10996629%2C10996631%2C10997161%2C10997201%2C10997263%2C10997281%2C10997289%2C10997321%2C10997327%2C10997359%2C10997569%2C10997775%2C11002807%2C11002833%2C11002981%2C11011281%2C11012805%2C11238957%2C11239241%2C11239365%2C11239391%2C11239411%2C11239465%2C11239503%2C11572286%2C11572788%2C11572834%2C11573494%2C11574070%2C11574598%2C11582436%2C11584904%2C11585440%2C11585444%2C11585460%2C11585548%2C11585558%2C11585580%2C11585584%2C11730084%2C12034371%2C12034925%2C12035561%2C12035605%2C12037613%2C12038275%2C12048602%2C12193718%2C12194190%2C12194272%2C14347322%2C14347354%2C14352856%2C14353056%2C15810699%2C15811425%2C15820849%2C15822875%2C15822925%2C15822929%2C15823141%2C15823319%2C15823427%2C15823441%2C16658973%2C16699889%2C16801677%2C16802007%2C16802959%2C16802977%2C16806195%2C16806271%2C16806475%2C16807219%2C16807511%2C16807555%2C16807631%2C16808187%2C16812461%2C16837084%2C16837092%2C16837288%2C16837332%2C16837536%2C16837792%2C16837810%2C16837818%2C16837980%2C16838894%2C16852126%2C16865295%2C16867787%2C16875106%2C16877194%2C16877564%2C16877690%2C16877722%2C16878468%2C16883442%2C16883564%2C16883892%2C16883900%2C16883918%2C16883956%2C16884022%2C16896092%2C16896140%2C16896184%2C16896198%2C16896240%2C16896286%2C16896592%2C16896598%2C16896602%2C16896616%2C16896620%2C16896626)&outFields=COMID%2CREACHCODE%2CFDATE%2CGNIS_NAME&returnGeometry=false&orderByFields=COMID&resultRecordCount=1000&f=json"
    },
    "reach-crosswalk-5.json": {
        "bytes": 12341,
        "sha256": "b400a6ab05d31c8037908235efa009486b868e4a96bf39bfe9e522665283d5c2",
        "uri": "https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/42/query?where=COMID%20IN%20(16896634%2C16896636%2C16906283%2C16906323%2C16906451%2C16906977%2C16906985%2C16907019%2C16907067%2C16907135%2C16916300%2C16916386%2C16916762%2C16916816%2C16918090%2C16918106%2C16918142%2C16918174%2C16918210%2C16918284%2C16918326%2C16918808%2C16932250%2C16933094%2C16934542%2C16934588%2C16949534%2C16949536%2C16949670%2C16949806%2C16949882%2C16949944%2C16949962%2C16955656%2C18075806%2C18094145%2C18094981%2C18107208%2C18107248%2C18135774%2C18155133%2C18172814%2C18178477%2C18195331%2C18208384%2C18225421%2C18229143%2C18260325%2C18514402%2C18515640%2C18516128%2C18523647%2C18523733%2C18531726%2C18566029%2C18566179%2C18567421%2C18590656%2C18604744%2C18673952%2C18683048%2C20104145%2C20104159%2C20107061%2C20169948%2C20172208%2C21640642%2C21654166%2C21654346%2C21655464%2C21655592%2C21655846%2C21655896%2C21656498%2C21661814%2C21676818%2C21712124%2C21717690%2C22035157%2C22042575%2C22200595%2C22204871%2C22724211%2C22726623%2C26129469%2C26325148%2C26810196%2C166737168%2C166737729%2C166740336%2C166742210%2C166743365%2C166743835%2C166743839%2C166743841%2C166743978%2C166743979%2C166757234%2C166758626%2C166758628%2C166759201%2C933020162%2C933080038%2C933100042%2C933130036)&outFields=COMID%2CREACHCODE%2CFDATE%2CGNIS_NAME&returnGeometry=false&orderByFields=COMID&resultRecordCount=1000&f=json"
    }
}


# Current NLDI responses are a separate retained geometry edition.
CATCHMENT_FILES = {"nldi/comid-6269342.json": {"bytes": 567,
"sha256": "0e985e1459d067f3230b033df92ffda1c6c450e84c5bac71c30782022dec1f26",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/6269342?f=json"},
"nldi/basin-comid-6269342.json": {"bytes": 27736,
"sha256": "206b6a6654e538b188212914634a7fa1fcf11c3c55b13eca7ea124cad0b2bb62",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/6269342/basin?f=json&simplified=false&splitCatchment=false"},
"nldi/comid-6280111.json": {"bytes": 878,
"sha256": "37714639a340507c5cb759f665c0e6468c9d9b88ed320cd05db12496a68180ab",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/6280111?f=json"},
"nldi/basin-comid-6280111.json": {"bytes": 63709,
"sha256": "444ef5e5987fb5b834333c83a356c71e8e02aad486d6d8dd9e1f1a4ef54d17cb",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/6280111/basin?f=json&simplified=false&splitCatchment=false"},
"nldi/comid-11730084.json": {"bytes": 803,
"sha256": "8f181918336be3f88919755a150f1643c9984b573bd0417ca6af627bd542fa9b",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/11730084?f=json"},
"nldi/basin-comid-11730084.json": {"bytes": 37813,
"sha256": "338793342fe1db2c63788e6970ccdb4581f7c83df8f7a7df596271078d9202e4",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/11730084/basin?f=json&simplified=false&splitCatchment=false"},
"nldi/comid-22724211.json": {"bytes": 647,
"sha256": "5d5b2f754d06053178638a4c89c1cce2be35eeff3f3a6d7d5d504431dbe500e4",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/22724211?f=json"},
"nldi/basin-comid-22724211.json": {"bytes": 167485,
"sha256": "992240027a83b262ffe4dcd854f4b0acce2cc45fcf6138005849e4c40a4cb89c",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/22724211/basin?f=json&simplified=false&splitCatchment=false"},
"nldi/comid-22726623.json": {"bytes": 2306,
"sha256": "e302840ee846b7975a5160aa2e997d629bf20fd5e774cc9ad96b9e532a83d448",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/22726623?f=json"},
"nldi/basin-comid-22726623.json": {"bytes": 197133,
"sha256": "1c73ac19a6fe22e1e5397e1e7aad07445ee71b9bbd8aab3efb4e44c079745594",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/22726623/basin?f=json&simplified=false&splitCatchment=false"}}
CATCHMENT_CHOICES = {"6269342": {"source": "comid",
"identifier": "6269342",
"station_role": "published_reach",
"split_catchment": False,
"feature": {"path": "nldi/comid-6269342.json",
"bytes": 567,
"sha256": "0e985e1459d067f3230b033df92ffda1c6c450e84c5bac71c30782022dec1f26",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/6269342?f=json"},
"basin": {"path": "nldi/basin-comid-6269342.json",
"bytes": 27736,
"sha256": "206b6a6654e538b188212914634a7fa1fcf11c3c55b13eca7ea124cad0b2bb62",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/6269342/basin?f=json&simplified=false&splitCatchment=false"},
"component_indices": [0]},
"6280111": {"source": "comid",
"identifier": "6280111",
"station_role": "published_reach",
"split_catchment": False,
"feature": {"path": "nldi/comid-6280111.json",
"bytes": 878,
"sha256": "37714639a340507c5cb759f665c0e6468c9d9b88ed320cd05db12496a68180ab",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/6280111?f=json"},
"basin": {"path": "nldi/basin-comid-6280111.json",
"bytes": 63709,
"sha256": "444ef5e5987fb5b834333c83a356c71e8e02aad486d6d8dd9e1f1a4ef54d17cb",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/6280111/basin?f=json&simplified=false&splitCatchment=false"},
"component_indices": [0]},
"11730084": {"source": "comid",
"identifier": "11730084",
"station_role": "published_reach",
"split_catchment": False,
"feature": {"path": "nldi/comid-11730084.json",
"bytes": 803,
"sha256": "8f181918336be3f88919755a150f1643c9984b573bd0417ca6af627bd542fa9b",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/11730084?f=json"},
"basin": {"path": "nldi/basin-comid-11730084.json",
"bytes": 37813,
"sha256": "338793342fe1db2c63788e6970ccdb4581f7c83df8f7a7df596271078d9202e4",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/11730084/basin?f=json&simplified=false&splitCatchment=false"},
"component_indices": [0]},
"22724211": {"source": "comid",
"identifier": "22724211",
"station_role": "published_reach",
"split_catchment": False,
"feature": {"path": "nldi/comid-22724211.json",
"bytes": 647,
"sha256": "5d5b2f754d06053178638a4c89c1cce2be35eeff3f3a6d7d5d504431dbe500e4",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/22724211?f=json"},
"basin": {"path": "nldi/basin-comid-22724211.json",
"bytes": 167485,
"sha256": "992240027a83b262ffe4dcd854f4b0acce2cc45fcf6138005849e4c40a4cb89c",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/22724211/basin?f=json&simplified=false&splitCatchment=false"},
"component_indices": [0],
"component_selection_reason": "Retain the original Savannah basin component 0. The omitted original component 1 is a separate Virginia triangle at bounds [-80.460739101,36.693154613,-80.460283095,36.693418822], geographically remote from the published Savannah reach and its connected upstream basin. Preserve its complete original geometry and ellipsoidal area in catchment context."},
"22726623": {"source": "comid",
"identifier": "22726623",
"station_role": "published_reach",
"split_catchment": False,
"feature": {"path": "nldi/comid-22726623.json",
"bytes": 2306,
"sha256": "e302840ee846b7975a5160aa2e997d629bf20fd5e774cc9ad96b9e532a83d448",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/22726623?f=json"},
"basin": {"path": "nldi/basin-comid-22726623.json",
"bytes": 197133,
"sha256": "1c73ac19a6fe22e1e5397e1e7aad07445ee71b9bbd8aab3efb4e44c079745594",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/22726623/basin?f=json&simplified=false&splitCatchment=false"},
"component_indices": [0, 1],
"component_selection_reason": "Retain the original Savannah basin components 0 and 1, including the small local component near [-81.4223,32.8047]. The omitted original component 2 is a separate Virginia triangle at bounds [-80.460739101,36.693154613,-80.460283095,36.693418822], geographically remote from the published Savannah reach and its connected upstream basin. Preserve its complete original geometry and ellipsoidal area in catchment context."}}


COMPONENT_REVIEWS = {"6269342": {"published_comid": "6269342",
"source_feature": {"path": "nldi/comid-6269342.json",
"bytes": 567,
"sha256": "0e985e1459d067f3230b033df92ffda1c6c450e84c5bac71c30782022dec1f26",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/6269342?f=json"},
"source_basin": {"path": "nldi/basin-comid-6269342.json",
"bytes": 27736,
"sha256": "206b6a6654e538b188212914634a7fa1fcf11c3c55b13eca7ea124cad0b2bb62",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/6269342/basin?f=json&simplified=false&splitCatchment=false"},
"original_component_count": 1,
"components": [{"index": 0,
"bounds": [-83.370866592, 34.805498031, -83.037900049, 35.124579319],
"positions": 960}],
"selected_component_indices": [0],
"omitted_component_indices": [],
"component_selection_reason": None,
"catchment_id": "d6a97f6c3d3a4951b1e1819e117bf27d182259596a3a14af0728ed66a8ef93c5"},
"6280111": {"published_comid": "6280111",
"source_feature": {"path": "nldi/comid-6280111.json",
"bytes": 878,
"sha256": "37714639a340507c5cb759f665c0e6468c9d9b88ed320cd05db12496a68180ab",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/6280111?f=json"},
"source_basin": {"path": "nldi/basin-comid-6280111.json",
"bytes": 63709,
"sha256": "444ef5e5987fb5b834333c83a356c71e8e02aad486d6d8dd9e1f1a4ef54d17cb",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/6280111/basin?f=json&simplified=false&splitCatchment=false"},
"original_component_count": 1,
"components": [{"index": 0,
"bounds": [-83.668251426, 33.721891108, -82.741199786, 34.592378634],
"positions": 2209}],
"selected_component_indices": [0],
"omitted_component_indices": [],
"component_selection_reason": None,
"catchment_id": "4c39889618c8345116860a8f829022b2f606ebd681f4a374e1adc4f9b7ebe658"},
"11730084": {"published_comid": "11730084",
"source_feature": {"path": "nldi/comid-11730084.json",
"bytes": 803,
"sha256": "8f181918336be3f88919755a150f1643c9984b573bd0417ca6af627bd542fa9b",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/11730084?f=json"},
"source_basin": {"path": "nldi/basin-comid-11730084.json",
"bytes": 37813,
"sha256": "338793342fe1db2c63788e6970ccdb4581f7c83df8f7a7df596271078d9202e4",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/11730084/basin?f=json&simplified=false&splitCatchment=false"},
"original_component_count": 1,
"components": [{"index": 0,
"bounds": [-82.319927912, 33.670597343, -81.787612253, 34.197573708],
"positions": 1310}],
"selected_component_indices": [0],
"omitted_component_indices": [],
"component_selection_reason": None,
"catchment_id": "c09358d30c690db19c117274400e28e15b4ea2e60cb0c3e30f420a6e44b47af7"},
"22724211": {"published_comid": "22724211",
"source_feature": {"path": "nldi/comid-22724211.json",
"bytes": 647,
"sha256": "5d5b2f754d06053178638a4c89c1cce2be35eeff3f3a6d7d5d504431dbe500e4",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/22724211?f=json"},
"source_basin": {"path": "nldi/basin-comid-22724211.json",
"bytes": 167485,
"sha256": "992240027a83b262ffe4dcd854f4b0acce2cc45fcf6138005849e4c40a4cb89c",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/22724211/basin?f=json&simplified=false&splitCatchment=false"},
"original_component_count": 2,
"components": [{"index": 0,
"bounds": [-83.668251426, 33.258340935, -81.682661182, 35.172833451],
"positions": 5810}, {"index": 1,
"bounds": [-80.460739101, 36.693154613, -80.460283095, 36.693418822],
"positions": 4}],
"selected_component_indices": [0],
"omitted_component_indices": [1],
"component_selection_reason": "Retain the original Savannah basin component 0. The omitted original component 1 is a separate Virginia triangle at bounds [-80.460739101,36.693154613,-80.460283095,36.693418822], geographically remote from the published Savannah reach and its connected upstream basin. Preserve its complete original geometry and ellipsoidal area in catchment context.",
"catchment_id": "b6e4785354946c3feac7d0bb8a0ff47eff9fa16712c26fd175d2974957385a56"},
"22726623": {"published_comid": "22726623",
"source_feature": {"path": "nldi/comid-22726623.json",
"bytes": 2306,
"sha256": "e302840ee846b7975a5160aa2e997d629bf20fd5e774cc9ad96b9e532a83d448",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/22726623?f=json"},
"source_basin": {"path": "nldi/basin-comid-22726623.json",
"bytes": 197133,
"sha256": "1c73ac19a6fe22e1e5397e1e7aad07445ee71b9bbd8aab3efb4e44c079745594",
"uri": "https://api.water.usgs.gov/nldi/linked-data/comid/22726623/basin?f=json&simplified=false&splitCatchment=false"},
"original_component_count": 3,
"components": [{"index": 0,
"bounds": [-83.668251426, 32.803541858, -81.330449958, 35.172833451],
"positions": 6836}, {"index": 1,
"bounds": [-81.422629531, 32.804535163, -81.421943382, 32.80488307],
"positions": 5}, {"index": 2,
"bounds": [-80.460739101, 36.693154613, -80.460283095, 36.693418822],
"positions": 4}],
"selected_component_indices": [0, 1],
"omitted_component_indices": [2],
"component_selection_reason": "Retain the original Savannah basin components 0 and 1, including the small local component near [-81.4223,32.8047]. The omitted original component 2 is a separate Virginia triangle at bounds [-80.460739101,36.693154613,-80.460283095,36.693418822], geographically remote from the published Savannah reach and its connected upstream basin. Preserve its complete original geometry and ellipsoidal area in catchment context.",
"catchment_id": "e19aeb1676a2b078f3eb0066303cf8d436d3e8819b9562ca97d11ad8a7c2c150"}}


def receive(directory):
    """Adopt packaged originals first; capture missing original entities once."""
    root = Path(directory).resolve()
    root.mkdir(parents=True, exist_ok=True)
    for name, expected in {**FILES, **CATCHMENT_FILES}.items():
        path = root / name
        if not path.exists():
            packaged = DEFAULT_SOURCE_ROOT / name
            if packaged.is_file():
                verify_file(DEFAULT_SOURCE_ROOT, {"path": name, **expected})
                atomic_bytes(path, packaged.read_bytes(), immutable=True)
            else:
                from .raster_sources import capture
                capture(expected["uri"], path, maximum_bytes=expected["bytes"])
        verify_file(root, {"path": name, **expected})
    source = _source(root)
    atomic_json(root / "annual-source.json", source, immutable=True)
    return source


def _source(directory):
    root = Path(directory).resolve(strict=True)
    files = {}
    for name, expected in FILES.items():
        verify_file(root, {"path": name, **expected})
        files[name] = {**describe_file(root, root / name), "uri": expected["uri"]}
    value = {
        "schema": SOURCE_SCHEMA,
        "release": {
            "doi": DOI, "reference_base_year": 2012,
            "service_edition": "Republished with 10.06.2019 data update -ESM",
            "target_horizon": {
                "start_inclusive": PERIOD_START, "end_inclusive": PERIOD_LAST,
                "end_exclusive": PERIOD_END, "scope": "source_global",
                "source_field": "FGDC timeperd/timeinfo/rngdates",
                "meaning": "Period covered by model calibration targets and some input variables",
            },
            "prediction_fields_excluded": ["PLOAD_TOTA", "PLOAD_MT"],
            "uncertainty": "The original mapper does not publish target standard errors",
        },
        "files": files,
    }
    value["id"] = digest(value)
    return value


def _attributes(root, name, required):
    body = read_json(root / name)
    if body.get("error") or body.get("exceededTransferLimit"):
        raise ValueError("Original service query is incomplete: " + name)
    fields = [field["name"] for field in body.get("fields", [])]
    if not set(required).issubset(fields) or len(fields) != len(set(fields)):
        raise ValueError("Original service field schema differs: " + name)
    rows = [feature["attributes"] for feature in body.get("features", [])]
    if any(not set(required).issubset(row) for row in rows):
        raise ValueError("An original service row lacks required attributes: " + name)
    return fields, rows


def _reach_index(root):
    index = {}
    for name in FILES:
        if not name.startswith("reach-crosswalk-"):
            continue
        _, rows = _attributes(root, name, ["COMID", "REACHCODE"])
        for row in rows:
            comid = str(row["COMID"])
            code = str(row["REACHCODE"])
            if not re.fullmatch(r"[0-9]{14}", code):
                raise ValueError("Original published reach code is not 14 digits")
            if comid in index and index[comid]["attributes"] != row:
                raise ValueError("Published COMID has conflicting original reach attribution")
            index[comid] = {"file": name, "attributes": row, "huc8": code[:8]}
    return index


def _estimate(source, name, row, reaches):
    table = TABLES[name]
    if table["series"]:
        series = table["series"]
    else:
        constituent = row["CONSTITUEN"]
        if constituent not in ("TSS", "SUSPSED"):
            raise ValueError("Unrecognized original sediment constituent: " + str(constituent))
        series = "tss" if constituent == "TSS" else "ssc"
    definition = SERIES[series]
    field = "ACTUAL_MT" if definition["parameter"] == "sediment" else "ACTUAL"
    unit = "metric_tonnes/year" if definition["parameter"] == "sediment" else "kg/year"
    comid = str(row["COMID"])
    reach = reaches.get(comid)
    record = {
        "record_id": digest({"source_id": source["id"], "layer": table["layer"],
                             "object_id": row["OBJECTID"]}),
        "series": series, "parameter": definition["parameter"],
        "parameter_code": definition["code"],
        "source_constituent": row.get("CONSTITUEN", definition["title"]),
        "station_id": str(row["STATION_ID"]), "station_name": row["STATION_NM"],
        "flow_station_id": "", "comid": comid,
        "huc8": [reach["huc8"]] if reach else [], "huc8_original": [reach["huc8"]] if reach else [],
        "original_reach": reach, "member": {"member": name},
        "record_number": row["OBJECTID"], "original_attributes": row, "row": row,
        "final_method": "published_regional_target",
        "selected_load_field": field, "selected_standard_error_field": None,
        "unit": unit, "value_unit": unit, "period_start": PERIOD_START, "period_end": PERIOD_END,
        "uncertainty": {
            "kind": "target standard error not published in regional mapper",
            "value": None, "unit": unit, "original_field": None,
            "scope": "unknown; regional model prediction errors are not target errors",
        },
        "temporal_basis": {
            "kind": "published regional long-term average annual calibration target",
            "scope": "source_global",
            "flow_start_inclusive": PERIOD_START, "flow_end_inclusive": PERIOD_LAST,
            "station_sampling_start": None, "station_sampling_end": None,
            "reference_base_year": 2012, "complete_anniversary_period": True,
            "source_metadata": "P9A682GW-original-metadata.xml",
            "meaning": "Published global calibration-target horizon; individual station periods are not exposed",
        },
        "issues": [],
    }
    try:
        value = annual_source._number(row[field], field)
        lon, lat = float(row["LON"]), float(row["LAT"])
        if not math.isfinite(lon) or not math.isfinite(lat) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
            raise ValueError("Original station coordinates are outside geographic limits")
        if not record["station_id"]:
            raise ValueError("Original station identifier is empty")
        if reach is None:
            raise ValueError("No exact published-network COMID/HUC attribution was returned")
        record.update(value=float(value), value_exact=str(value), longitude=lon, latitude=lat)
    except (ValueError, OverflowError) as error:
        record["issues"].append(str(error))
    if comid in CATCHMENT_CHOICES:
        record["retained_catchment"] = CATCHMENT_CHOICES[comid]
        record["component_review"] = COMPONENT_REVIEWS[comid]
    return record


def inventory(directory, *, huc8=None):
    root = Path(directory).resolve(strict=True)
    source = _source(root)
    reaches = _reach_index(root)
    desired = {str(value) for value in (huc8 or [])}
    if any(not re.fullmatch(r"[0-9]{8}", value) for value in desired):
        raise ValueError("HUC8 selections must retain eight numeric characters")
    records, tables = [], []
    for name, definition in TABLES.items():
        required = ["OBJECTID", "COMID", "LAT", "LON", "STATION_ID", "STATION_NM"]
        required += ["ACTUAL_MT", "CONSTITUEN", "TSS_CONV", "PLOAD_MT"] if definition["series"] is None else ["ACTUAL", "PLOAD_TOTA"]
        fields, rows = _attributes(root, name, required)
        if len(rows) != definition["records"] or len({r["OBJECTID"] for r in rows}) != len(rows):
            raise ValueError("Original complete calibration-table row count or object identity differs")
        tables.append({"series": definition["series"] or "ssc/tss",
                       "loads": {**source["files"][name], "member": name, "fields": fields, "records": len(rows)},
                       "sites": "Original station attributes and publisher-network reach crosswalk retained together"})
        for row in rows:
            record = _estimate(source, name, row, reaches)
            if not desired or desired.intersection(record["huc8"]):
                records.append(record)
    return {
        "schema": "upstate.sparrow-regional-reference-inventory/v1",
        "published_reach_count": len(reaches),
        "source": source, "selected_huc8": sorted(desired), "tables": tables,
        "records": records,
        "record_counts": dict(Counter(r["series"] for r in records)),
        "usable_counts": dict(Counter(r["series"] for r in records if not r["issues"])),
        "station_count": len({r["station_id"] for r in records}),
        "selection_basis": "Original calibration-table COMID joined to the same publisher's layer 42 REACHCODE; its first eight digits identify HUC8",
    }


def _catchment(directory, source_root, record, choice):
    """Use the maintained NLDI receiver and original geometry validator."""
    if set(choice) != {"source", "identifier", "station_role", "split_catchment"}:
        raise ValueError("Catchment choice needs source, identifier, station_role and split_catchment")
    if choice["source"] != "comid" or choice["station_role"] != "published_reach":
        raise ValueError("Regional targets must use their explicit published COMID or a retained documented catchment")
    if str(choice["identifier"]) != record["comid"]:
        raise ValueError("Catchment COMID differs from the original published target")
    from .raster_sources import capture
    target = source_root / "nldi-received" / record["comid"]
    target.mkdir(parents=True, exist_ok=True)
    feature_uri = NLDI_ROOT + "/comid/" + quote(record["comid"], safe="") + "?f=json"
    basin_uri = NLDI_ROOT + "/comid/" + quote(record["comid"], safe="") + "/basin?f=json&simplified=false&splitCatchment=" + ("true" if choice["split_catchment"] else "false")
    spec = dict(choice)
    for key, uri in (("feature", feature_uri), ("basin", basin_uri)):
        path = target / (key + ".json")
        if not path.exists():
            capture(uri, path, maximum_bytes=128 * 1024 * 1024)
        spec[key] = {**describe_file(source_root, path), "uri": uri}
    return annual_source._retained_catchment(directory, source_root, record, spec)


bind = annual_source.bind
def prepare(directory, *, original_root, selection_path):
    root = Path(original_root).resolve(strict=True)
    destination = Path(directory).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    selection = read_json(selection_path)
    if (selection.get("schema") != SELECTION_SCHEMA or not selection.get("title")
            or not isinstance(selection.get("records"), list) or not selection["records"]):
        raise ValueError("Select the actual inventory record IDs with " + SELECTION_SCHEMA)
    inventory_value = inventory(root)
    if selection.get("source_id") != inventory_value["source"]["id"]:
        raise ValueError("Selection belongs to another original annual source edition")
    by_id = {row["record_id"]: row for row in inventory_value["records"]}
    plan = {"schema": "upstate.sparrow-regional-reference-plan/v1", "source": inventory_value["source"],
            "selection": selection}
    with held(destination / ".prepare.lock"):
        atomic_json(destination / "plan.json", plan, immutable=True)
        result_path = destination / "result.json"
        if result_path.exists():
            result = read_json(result_path)
            identity = dict(result)
            if identity.pop("id", None) != digest(identity) or result.get("plan_id") != digest(plan):
                raise ValueError("Prepared annual reference identity differs")
            for item in result["files"]:
                verify_file(destination, item)
            return result
        copies = annual_source._copy_source(destination, root, inventory_value["source"])
        compact_inventory = {key: value for key, value in inventory_value.items() if key != "records"}
        compact_inventory["selected_original_records"] = [
            by_id[item["record_id"]] for item in selection["records"] if item.get("record_id") in by_id]
        atomic_json(destination / "inventory.json", compact_inventory, immutable=True)
        features, contexts, annual, seen, catchment_parameters = {}, [], [], set(), set()
        for selected in selection["records"]:
            key = selected.get("record_id")
            if key in seen or key not in by_id:
                raise ValueError("Select each original annual record once from this inventory")
            seen.add(key)
            record = by_id[key]
            if record["issues"]:
                raise ValueError("Original selected annual record needs correction: " + "; ".join(record["issues"]))
            if "retained_catchment" in selected:
                feature, context = annual_source._retained_catchment(destination, root, record, selected["retained_catchment"])
            else:
                feature, context = _catchment(destination, root, record, selected["catchment"])
            context["annual_release"] = DOI
            context["published_reach_attribution"] = record["original_reach"]
            catchment_id = feature["properties"]["catchment_id"]
            pair = (catchment_id, record["parameter"])
            if pair in catchment_parameters:
                raise ValueError("Select one original constituent/estimator series for each catchment and native parameter")
            catchment_parameters.add(pair)
            if catchment_id in features and features[catchment_id]["geometry"] != feature["geometry"]:
                raise ValueError("One catchment identity resolved to different original geometry")
            features[catchment_id] = feature
            contexts.append(context)
            method = "USGS published Southeast regional calibration target; underlying annual-load estimator family is documented in Saad et al. (2019)"
            source_record = {**record, "original_table": copies[record["member"]["member"]],
                             "dictionary": copies["P9A682GW-original-metadata.xml"],
                             "publisher_reach_table": copies[record["original_reach"]["file"]],
                             "catchment_source": context, "comparability_note": selected.get("comparability_note")}
            annual.append({"record_id": key, "station_id": record["station_id"],
                           "catchment_id": catchment_id, "parameter": record["parameter"],
                           "value": record["value"], "unit": record["unit"],
                           "period_start": record["period_start"], "period_end": record["period_end"],
                           "qualifier": "published_regional_calibration_target", "method": method,
                           "uncertainty": record["uncertainty"], "source_records": source_record})
        atomic_json(destination / "annual-records.json", annual, immutable=True)
        atomic_json(destination / "catchments.geojson",
                    {"type": "FeatureCollection", "features": list(features.values())}, immutable=True)
        atomic_json(destination / "catchment-sources.json", {"catchments": contexts}, immutable=True)
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=COLUMNS, lineterminator="\n")
        writer.writeheader()
        for row in annual:
            writer.writerow({key: json.dumps(row[key], ensure_ascii=False, sort_keys=True,
                                             separators=(",", ":"), allow_nan=False)
                             if isinstance(row[key], (dict, list)) else row[key] for key in COLUMNS})
        atomic_bytes(destination / "annual-loads.csv", stream.getvalue().encode(), immutable=True)
        metadata = {
            "title": selection["title"], "source_uri": URI, "release": inventory_value["source"]["release"],
            "value_basis": "annual_mass_rate", "accepted_qualifiers": ["published_regional_calibration_target"],
            "annualization_method": "Use original ACTUAL for nitrogen/phosphorus in kg/year and ACTUAL_MT for sediment "
                                    "in metric tonnes/year. These are already annual calibration-target rates. Do not use "
                                    "PLOAD_TOTA/PLOAD_MT predictions or apply the model's TSS_CONV coefficient. The original "
                                    "regional FGDC metadata publishes a global target horizon 1999-10-01 through 2014-09-30; "
                                    "period_end is the exclusive 2014-10-01. This is source-global support, not an individual "
                                    "station sampling window, and rates are not multiplied by the horizon length.",
            "recommended_temporal_weighting": "whole_years",
            "sha256": file_digest(destination / "annual-loads.csv"),
            "constituents": sorted({by_id[row["record_id"]]["parameter_code"] for row in annual}),
            "notes": [
                "The regional targets describe 2012 reference conditions; current land cover and climate scenarios retain their distinct vintages.",
                "Individual final estimator identity and target standard error are not exposed in this original mapper.",
                "The reported 15-year horizon is source-global. Selected targets must not be presented as individual yearly measurements.",
                "Suspended sediment 80154 and total suspended solids 00530 retain their original identity; "
                "the selection chooses one source series per catchment/native parameter.",
            ],
        }
        atomic_json(destination / "observation-metadata.json", metadata, immutable=True)
        companions = [describe_file(destination, path) for path in sorted(destination.rglob("*"))
                      if path.is_file() and not path.is_symlink()
                      and path.name not in ("annual-loads.csv", "catchments.geojson", "source-manifest.json", "result.json")
                      and not path.name.endswith((".lock", ".partial"))]
        prefix = "usgs-southeast-reference-" + digest(plan)[:16]
        entries = [
            {"id": prefix + "-loads", "kind": "table", "role": "OBSERVED_LOADS",
             "title": selection["title"], "uri": URI, "vintage": "2012 reference conditions; global target horizon water years 2000–2014",
             **describe_file(destination, destination / "annual-loads.csv"),
             "observation_metadata": metadata, "companions": companions},
            {"id": prefix + "-catchments", "kind": "vector", "role": "OBSERVATION_CATCHMENTS",
             "title": "Upstream catchments for the selected published annual loads",
             "uri": NLDI_ROOT, "vintage": "Original retained NLDI response edition",
             **describe_file(destination, destination / "catchments.geojson"),
             "id_field": "catchment_id", "companions": companions},
        ]
        manifest_path = destination / "source-manifest.json"
        captured_at = read_json(manifest_path)["captured_at"] if manifest_path.exists() else now()
        manifest = {"schema": "upstate.sources/v1", "title": selection["title"], "captured_at": captured_at,
                    "scope": selection.get("scope", {}), "entries": entries,
                    "notes": metadata["notes"]}
        atomic_json(destination / "source-manifest.json", manifest, immutable=True)
        files = [describe_file(destination, destination / name)
                 for name in ("source-manifest.json", "annual-loads.csv", "catchments.geojson")]
        files.extend(companions)
        result = {"schema": "upstate.sparrow-regional-reference-preparation/v1", "plan_id": digest(plan),
                  "records": len(annual), "stations": len({r["station_id"] for r in annual}),
                  "catchments": len(features), "parameters": sorted({r["parameter"] for r in annual}),
                  "source_manifest": "source-manifest.json", "observation_csv": "annual-loads.csv",
                  "observation_metadata": "observation-metadata.json", "files": files}
        result["id"] = digest(result)
        atomic_json(result_path, result, immutable=True)
        return result



def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    receive_parser = commands.add_parser("receive")
    receive_parser.add_argument("--output", required=True)
    inventory_parser = commands.add_parser("inventory")
    inventory_parser.add_argument("--original-root", required=True)
    inventory_parser.add_argument("--huc8", nargs="*")
    inventory_parser.add_argument("--output")
    prepare_parser = commands.add_parser("prepare")
    prepare_parser.add_argument("--original-root", required=True)
    prepare_parser.add_argument("--selection", required=True)
    prepare_parser.add_argument("--output", required=True)
    bind_parser = commands.add_parser("bind")
    bind_parser.add_argument("--workspace", required=True)
    bind_parser.add_argument("--prepared", required=True)
    args = parser.parse_args(argv)
    if args.command == "receive":
        result = receive(args.output)
    elif args.command == "inventory":
        result = inventory(args.original_root, huc8=args.huc8)
        if args.output:
            atomic_json(Path(args.output), result)
    elif args.command == "prepare":
        result = prepare(args.output, original_root=args.original_root, selection_path=args.selection)
    else:
        result = bind(args.workspace, args.prepared)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
