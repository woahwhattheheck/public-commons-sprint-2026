#!/usr/bin/env python3
"""Integrate the conservation workflow into a current local Upper Savannah app.

Copyright 2026 TokenJunkieLabs. Keeps unrelated operator changes and writes a
recoverable before/after record. This command performs source installation only.
"""
from __future__ import annotations
import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

OWNED = frozenset({
    "integration/conservation_native_report_composition.json",
    "integration/conservation_native_versions_composition.json",
    "model/CONSERVATION_NATIVE_VERSIONS.md",
    "model/native_versions.py",
    "integration/conservation_catalog_browser_composition.json",
    "model/CONSERVATION.md",
    "model/CONSERVATION_CONSUMERS.md",
    "model/CONSERVATION_EXPERIMENTS.md",
    "model/CONSERVATION_OPTIMIZATION.md",
    "model/CONSERVATION_REPORTS.md",
    "model/KEOWEE_PRIORITIES.md",
    "model/PORTFOLIOS.md",
    "model/conservation.py",
    "model/conservation_bindings.py",
    "model/conservation_catalog.py",
    "model/conservation_cli.py",
    "model/conservation_optimization.py",
    "model/conservation_reporting.py",
    "model/conservation_scenarios.py",
    "model/keowee_priority.py",
    "model/keowee_profile_adapter.py",
    "model/portfolios.py",
    "model/source_lineage.py",
    "operator/CONSERVATION.md",
    "operator/CONSERVATION_CATALOG.md",
    "operator/CONSERVATION_CATALOG_BROWSER.md",
    "operator/CONSERVATION_EXPERIMENT_BROWSER.md",
    "operator/CONSERVATION_HOST.md",
    "operator/CONSERVATION_OPTIMIZATION.md",
    "operator/KEOWEE_METHOD_VIEW.md",
    "operator/conservation.py",
    "operator/conservation_browser_receiving.py",
    "operator/conservation_catalog.py",
    "operator/conservation_experiment_browser_receiving.py",
    "operator/conservation_optimization.py",
    "operator/conservation_regional_receiving.py",
    "operator/extensions/conservation-catalog.json",
    "operator/extensions/conservation-optimization.json",
    "operator/extensions/conservation.json",
    "operator/extensions/keowee-method-view.json",
    "operator/install_conservation.py",
    "operator/web/conservation.css",
    "operator/web/conservation.mjs",
    "operator/web/conservation_optimization.css",
    "operator/web/conservation_optimization.mjs",
    "operator/web/conservation_optimization_bridge.mjs",
    "operator/web/keowee-method-view.mjs",
    "operator/web/retained_desks.mjs",
    "source/capture_original_overlays.py",
    "source/conservation-documentation-integration-20261013.json",
    "source/conservation-reporting-joins-20261013.json",
    "source/keowee-native-binding-20261013.json",
    "source/keowee-native-receiving-20261013/capture.json",
    "source/keowee-native-receiving-20261013/greenwood-native-feature.json",
    "source/keowee-native-receiving-20261013/source-interval-journey.json",
    "source/keowee-native-receiving-20261013/source-selection-journey.json",
    "source/keowee-native-receiving-20261013/sources.json",
    "source/keowee-priority-integration-20261013.json",
    "source/keowee-priority-methods-20261013.json",
    "source/keowee/20261013/KEOWEE-INTEGRATION.md",
    "source/keowee/20261013/keowee-criteria.csv",
    "source/keowee/20261013/keowee-evaluator.d.mts",
    "source/keowee/20261013/keowee-evaluator.mjs",
    "source/keowee/20261013/keowee-fields.csv",
    "source/keowee/20261013/keowee-journey-check.json",
    "source/keowee/20261013/keowee-source-catalog.json",
    "source/keowee/20261013/keowee-sources-manifest.json",
    "source/keowee/20261013/lake-keowee-methodology.json",
    "source/parcel-criteria-geometry-integration-20261013.json",
    "source/parcel-criteria-integration-20261013.json",
    "source/parcel-criteria-interval-integration-20261013.json",
    "source/parcel-criteria-sources-20261013.json",
    "source/soil-floodplain-integration-20261013.json",
    "source/soil-floodplain-source-profile-20261013.json",
    "source_tools/PARCEL_CRITERIA.md",
    "source_tools/PARCEL_CRITERIA_GEOMETRY.md",
    "source_tools/PARCEL_CRITERIA_INTERVALS.md",
    "source_tools/SOIL_FLOODPLAIN_SOURCES.md",
    "source_tools/SOURCE_ACQUISITION_CONTINUATION.md",
    "source_tools/keowee_interval_receiving.mjs",
    "source_tools/parcel_criteria.py",
    "source_tools/soil_floodplain_sources.py",
    "source_tools/source_response_reuse.py",
    "source_tools/soil_sources.py",
})
SCHEMA = "upstate.conservation-addon/v1"
KNOWN_PRIOR = {
    "model/conservation.py": [
        "d407c94dd3df29ef7de6e5d8396f3a048619df0529f88dfb4e1fb4176ef72c12",
        "60b7d500a585f685886404ac23785416c6fafb0a733550169258a90413ce3464",
        "099cdbb19f03560e6cf8214605a3d2212afdc5221e8f192eab46f74ed54065ca",
        "8755fb5f3b9e7870868db8f3c5345030b117259340918e14250c85ea5d4c67f3",
        "771681f14e61426ce74b10844f203627eaf8c1a435f674fed42bb87ad08470d0",
        "fe8324135c497c1286307ba4d2aee9c56ba96873378d86aaa53078051c8f5c39",
        "b1a6595b575beac4b1f7656544e37af721df198c8499742e323e15eb7f2ebd27"
    ],
    "model/conservation_cli.py": [
        "1ead9b863bcd772e0845c7603465a24cc5eeb95a877730ccc6f9c4344310c8ed"
    ],
    "model/conservation_scenarios.py": [
        "7d219c37ccd94094bf1e3355433ed12499a5aec389220cc7608d76140643ae6d",
        "a6c5f1f98bae9e4b9add1a013a10801a9e8bb9771d35c24418f455f5c219ac91",
        "2bc3fa18d2ed4e8b59310e4a442411b7f7b91aec585ac2d1916060ce8345e25b",
        "d3518493716250749bb16804e1e8699ffa8d52da96b9c082c4dd9437ea5dbb2a"
    ],
    "model/CONSERVATION.md": [
        "5114f307d8640188ad45d09c61e32ee564f94e77f5171c81951f83dc85736c81",
        "c46d49b9d9ec84e16be050679546a11edeea6f0f5862b21544e6313e4fca7930",
        "4d51f59276d6585e817d43f44dd80c6aaeed3e15cc6cf149e9cc2b3d0d90cd87",
        "586fdf871373935689f6876c753da09051774ae76ac08b0c0b71cfef83489e19",
        "24244f46143402dfe22f432195c801e94b5a81e0b50c918f8ae1bac5fe70578e",
        "c26c81d7ec647be3d1fde1f1e57d1f36d8229a3ec1a416ad9059799d2d542af9"
    ],
    "operator/conservation.py": [
        "530d230e20704b058ffc50cebea6cab01b2af42f94d1a472de2482ce95ada0a4",
        "454b71b56f7eec4c0c175cb23a597ad32b6f053858692a8dcae92ea97aa4df2e",
        "4162a1f93e8ec39960482db85a045a0f5ef0437f7e04a8963ce9348ca6ce22db",
        "8849903b808a82b5d96d2bf2a047dba47602d3bfe098c088378384237d258891",
        "9c38b58b730209ab72daa3096bc8d7b98c776429ac4ad4249f04abe45c3dc301",
        "ba2975b292cbad34536b0f2128a76920c8cfe4e528565cf9575b618720864eda",
        "ee7206166fb73ae57b0a87e32e88855e0f378e43f5d6f31afcc117c95e45469e",
        "86a82e53e7b8e0890ecc26c5777c8d81b800f092b826bbe8af5fcb3430a1c6a9"
    ],
    "operator/web/conservation.mjs": [
        "7857010fbb286a33bde354715d067ee649304f51ce86b4c642a1bcd34f400c65",
        "ec645237ca3d8321a07e42479ce2af32c960c8b3c28113b11ac23547e16be808",
        "1ca5e8e1d45767f96c1814d2384150f4c49594c4ddae070451a230956bcc6e75",
        "e18f46038591553b4ae8e0c10f1c449f97d227a5a50170add0d2b7195ad2879b",
        "ee1ed5e75d34616416e342db99df34587cdc750d38c7f808a6d2ea58a6c2595b",
        "ee9d18d1233af1fc2e9a4d6ba84134feaac9e84497c77a83da582cb92da6b710",
        "52e834dd9675a64b57260274a358635f1c8fa25510232207e10d0885629ef25e",
        "ab542f2dcfa03e80aa1f1cb7dc8f999457cbf4a3c063668567226a852bbfbf65",
        "3e97167402d1a7864ae6e0ede8121bad2153c3cf91e4c2aab2304da355db440f",
        "60da58ce834260465f74dd03f6af420ecfabd8e4ab244e9150abdd506d3177b9"
    ],
    "operator/web/conservation.css": [
        "9eddc5584dfe6ae93c6e6a779af56ba9604b63757084cb1cd81bdca99617eb13",
        "fa8bfb6ec628f1ea618d8378b5964f8a32e12ec6cb4a2dbc6d945db3de098555",
        "8ac5b887081ce108c0a5f1aaa69313240d7c2a6bc9d738ed479a2f766e4b7654",
        "82f69e6bcf264ac5c49e5eb61b6490cbac89419eabf9877b3c3332415785cad5",
        "625e039cf970763d80ef94a1d8e0d155a28e80249de93fa8fc410e26b90351e5",
        "0808f1c93d172d7cbec13768e7789acc3669e0ff36fd02f0c7f1cd09dfd36bf8"
    ],
    "operator/CONSERVATION.md": [
        "f01c3d65fbfaea80a60299cee4058d231d1265ff68a19198519abc8240d676cc",
        "793620676d53702da2447fc0fa47f02f767c0b2b958152395db523b9683d7a12",
        "9c94af3dac766ae3fd32a2e514d1efff911960db5d01b9b3d60c2919ae81aff9",
        "c109ce231393d18f149b5f2bfc5faaec56948d1efda26ddc1c5a3144c1b5b231",
        "d39ab0132a9c32639883943994ece1c7819ae23b73d13c5957af6211d904c277",
        "606ec48543d3967cd8bef4b86d320ab273ff8b0f60f890d2bd5b91f11467fbee",
        "7478f563ff1ee1a2626b06df63e62a59c25277a91ad28d217fba7f4fe0ab7949"
    ],
    "operator/install_conservation.py": [
        "920c83ab79a998750b34a6fa49f014575b873f1b41d655baaa66d0db0dbc8aff",
        "c9aaa958816139e151fd99cc194deac931186783563738119e7b4ae69a413696",
        "3df8ad132ad6f9046b26f151ff82c29aa7faffdbbf9d1bedb5d5262cadac4e6b",
        "833aed492f04532201544e5f959ca852fe730d79969a6bc009a754f0f14dc42d",
        "85542e76771b019929c3005f0d1548b98d318c00eedfaf4ab8f3f43bdd06e132",
        "d8e9824780d84641a9ee47d180158adc18e340dff1912945fc75bce78237893f",
        "30492615ba6f862f7f676183ee293eb0252a59a159830e9976875aa2ab450bda",
        "76e556f53783d6379a53a775651415541306d9b23ba80d4eec1ff2dfb22a3644",
        "b7250a44731d3f421a6779e7c236d132e6b446166c8eaab5d34523a8553957b0",
        "1fde2cd0fd7c7960a99e7757e7724cce43ff5835a48dbab2eaa30092ffa2b37a",
        "172c2cac2e9933bc5088993e55218597776010e1c6d5c31307e7c24d6c05849a",
        "fac4eb6c7c8b7b27d1a2cbbc13fbee8d2e2ad682d1ba5fcda0126b7676255ae1",
        "5662e0ee4c342dbd8ec50a8d3cdf74b7af10841680b46559f6eb6ad2f40ab8eb",
        "1bf6aa847d00df9b1e5a5bf8d9bc347f4ae73604e1f9e36abcfac827576f2256",
        "1929be639e1ed2297e63611ce96115949b56d71e8c5a2cd58e91ed98d9b189f1",
        "2ee13bbb8b21d84a1b0267021ddb0915c6f24623f4b1d553773eb50d8f1dd195",
        "56e0e5a3a45c44c3bdbddc8725b7e62f3d15af7242e36240b4f34c70b31b2b5c",
        "5513429035921e3954d9ca4858941b7a07c663d66035b6acdc97d7335b3ada5d",
        "ed55c470f236a6ecc0b9325dcfd224c056957c8e6bc7dc1bbfcf2f1fe091569b",
        "edae3aa44e2eef6ae09e0388772552aad492ec6daa1a9b28ba5bab1aef06ae41",
        "406f90a9b6fcba4a9344c94f1ab8a579aeb1fc156cc872e3248a5e6e21249bd3"
    ],
    "operator/conservation_regional_receiving.py": [
        "a4326a019784fdb0bd03aa071ee5f01e40694d3063d0a8b6da70caed5ce9daf7",
        "a450c334ce4bded570acf1584d9623a00f60fa997049015256d0b4b7d830bae1",
        "1dd1fc8896250ff6606cb6036517b6d1b4dc2c86a335b9832d753aa2a3374721",
        "39df599c151e71c3ced1425133ba8473822feb312dfc6ac8408285c0baa7175e",
        "fc6bb0b216927c04c4cf1f665c237e397f997260de6f6457a192d987eb5d0276",
        "6db8fe4ab19613472c9e671669c66d4381d1f982b011d7bd6ce314cd0e069b5c",
        "103055f8e60711f20a3043f60e7bbc1ca55628985d4cc5308091aef527904352",
        "f02cbba6296578a498566f577edde0c7cf897e37a1916bdceb7fa3faea6ef3a2",
        "91e45b0b566ffd433cae627f3167f42123abb3c2ccf8e53c388767e4618254b3",
        "0232570ab566d79d5d2a563928c51a470098df18f760ffe71a47cb6769897dcf"
    ],
    "model/keowee_priority.py": [
        "9686b4b9224f2d09f705e09a4300877f2bf5ce39a4405c81aa5fc84b2cd8949e",
        "cb7c6f9aa1d193c594b9427cb80ddedc9a209924e4347f5759a54e51151341dd",
        "3f8e48b83d74355b280baafefe0142cd5b23924813aeeba48170ec8815497043",
        "f83004ffaf97a2f5182fffb632d8ece6570d117983e210b084ccf41da1000d7f",
        "7f0021f5d01413a5412fc97b95285a6fc1ce371980c77cf6fbe5447dd15b8431",
        "52a9c817d4871e44f18e9f9a9b909376fa83efbf49816f6393b16ffdec5ca22e"
    ],
    "source/keowee-priority-methods-20261013.json": [
        "f6f0d496697b03cdd667407ff26f0377f1262df608b21f6a3ff059357c134ec5"
    ],
    "model/KEOWEE_PRIORITIES.md": [
        "07336e7e3dd1fab21beed2330b034502c30a80f5b16af77e0cd57d5bb6b34f15",
        "4163651c9bbe009f22cd5cb6d065fbc89265d0daff9fa013e444c8b1781df45f"
    ],
    "source/keowee-priority-integration-20261013.json": [
        "36026ed1afb9f2e2de2cc50ee1b6ab0bdc965e324da023624e073ccc6c1dbcae"
    ],
    "model/conservation_bindings.py": [
        "be59aef70c5a35c8e76e5a58d5b507ecb8a8833efad0d8a829bbebc0cdc9d49a",
        "e3b3a7288817d408b9e685afb4dac7c361d3ace444cf4e99419fe830a7cdd060",
        "882f401903cc02250d8210f6a116fd3dfc27995980f50aeef5c150449a814354",
        "172dad7c968aa41c384387950ce306f1dfe34a8d3d04d4bb56c180d0c0845cda"
    ],
    "model/CONSERVATION_CONSUMERS.md": [
        "aabd1f2ca24827c783d47da103ae55e130a2d22ae77688748848762ff4cd49d0",
        "0a42f6685d086ec9bca55e6e63d891058de5be5547a5bc4d116a2d2626358123",
        "9bcc0a413f9d2e8feec08d2ff827c829e1a875d977519e3b61edb7f907f3b5e9",
        "d8d014e9731170ee849af3d09100441ff0bb1b47c65e981fa5d431386a1fd65e",
        "a8bbbc648cc4d675520f926c782c1ec6f7084fa4a3fe3784c632393ab36bc0f2"
    ],
    "model/CONSERVATION_EXPERIMENTS.md": [
        "b8859697162b7dd37e19c59fed4ab5abae8fc3e02e50a6e31e6faed9e28bd65d"
    ],
    "source_tools/parcel_criteria.py": [
        "3671c92e3315af3cd979b6a1244ea97c51924cc9ed201169725e341ae19e147c",
        "0924148f60ea61d63cd45f6e5470cd1e264fbfd343c48f619285274da49821cc",
        "07710f48afcf7e5725c058fe82498669110081144846a3555ed707ec839b9f41",
        "9b4881b0a6da0dcedfa9f2a4bb2125c216971e38479c91f0527b1497b11f76b9",
        "e8ad84d3f992cc1e2d40240abb84c33923d6f60de1dca5a3231cb9bd47f53e9c",
        "1b27a5186fe99f255856e7515609c7a4ed88ff08ccad508479ade53b3955b7b4",
        "d2f1bc510f2d64c9ed088936428f5eea28b3fa259982eb9ec1cefdba315fbe3e"
    ],
    "source/parcel-criteria-sources-20261013.json": [
        "4b2276fb7c976f08ac11d6d95a96af0ed806a914442deda5126c30916f3b57a0",
        "f4e925fc839f5c814ecaf785aa4ad8762f950ee94d4f431d269b6a545656f79a",
        "028c4cb379e39fdf9b6ca53c964862b9ed05a9582e63803784814cfb7468ae30",
        "c7dfd207ec90a25851b02f6a271cf4aed561cf33e6cc61ee96b9404be1bb9858",
        "d64314e31a4e3121fc66f3c624033cb3ae176397e0830e17fade066ecb6a192b"
    ],
    "source_tools/PARCEL_CRITERIA.md": [
        "3c1b9b9c8df3452aa5d16969be10e0917978d80130d138d3df9220a073dc72c3",
        "87779cb93017eff68557d8e8d95fef3aeb5d6fccf1d1868a611d9f22b326c8a8",
        "b870cf11dede90a07568d0be967339a75301dbb6891d5fc56015b97934a61fa8",
        "574d9ff53d930dee48d783c6cbad8771811fb5eae2257170571e8eddbec62df4"
    ],
    "source/parcel-criteria-integration-20261013.json": [
        "d11fc0238a4637af7432df34761d43bd3dd4f6abedcc72f81700dca6bf6b0da8"
    ],
    "model/conservation_optimization.py": [
        "60d91c12df8abe5db11aeff9c9473ae68e20e8c20322c95c3e03266c3ccba85c",
        "46c0c69edca2c9705ae00086f534b773540337bf04b3b96a1f888253ec8758f3",
        "0e44f1d6678294ee65e76c8f538b6a2d7a37e5cf95f3187067e47e023a4635b2",
        "1be2d82eb3c195546b1198bdea127160a9b0eec14de220ec51f07ce97d506962",
        "f29a835651918668a1a679f59573641e3366c05fda5b45f390bf8f2b27de451c"
    ],
    "operator/conservation_optimization.py": [
        "e987a181ac60463b725897c5321306871c4bc004d336b5468d57641e4b1bec63",
        "51d9926b4e0db34bf7963a486ee0026d9dfd9d3a6d531b1efc7de7e726301ae7",
        "3f16dae23b8cfe5e928cd4f4670e6dfe514bb790dee7c029e7717e8588b8ad1b",
        "991172824ba097ebb27bbaca0d7cc23edb9e40f61a4816de320c9c2407bcbacd"
    ],
    "operator/extensions/conservation-optimization.json": [
        "744ecd44e96f32aea580f09fad04cecd0d203603d40443e98ad972bbe24712ce",
        "5cf6d37ed965d78f3d4a63ad6901812af959e0afe45448e7309b8c4257a0fe72"
    ],
    "model/CONSERVATION_OPTIMIZATION.md": [
        "2a1f19d4310ec23436d154e5c0f8c6960e784becef69503d43744a2f5fae2236",
        "71de30fc9350b19e518752b432e71293507356ec8c20040e688eb41945113e4d",
        "be3c82f588ece2da730f1404038eeb3295de5f1cb13c204c51e9c7e05b35ea2b"
    ],
    "operator/CONSERVATION_OPTIMIZATION.md": [
        "0ce2dd533a1de760c342ba068b62fd6e0607deca4da2df64bb7f70eff52d99ec",
        "c100bfc5035d07f6457ab4c1cdef9e7f02a2b7814a45859fe497c2daea7e5be6",
        "d397e3cb792b2de4b934a2e9e320861c89be28f63dde9b1b6c89791240707e0d",
        "7d078a291c137ff62d6a6c2d62a34fe7b365a65a82f149cf029d8dc2aaa9d397",
        "0c87997c89de6a8550cb61b52d5a879b16e61134d2de2aea3fcb136f579a3b59"
    ],
    "model/portfolios.py": [
        "f0364a184cace554c136c04ab6d34b71963e9600a5bcc5c0fa0bf491b882c8fd",
        "932bd2ba6a3f0378d9a3c3fc19adc2bad973ee44fba8f29d2dd58e2ef3c92d98",
        "88d992732431d5b69f1b585217330975291281db96f8a03aa0aebf330a8e5808"
    ],
    "model/PORTFOLIOS.md": [
        "5807ae6b025d188e3725c945d16c87f7fc46adba45d49a4c7c1742be2101b3af",
        "4bb7f5359158207d007305fbbf91ec2715a1a08db00162a4b90239fadb0b80ce"
    ],
    "source_tools/soil_floodplain_sources.py": [
        "0b9a0792323aaeeaa6e8897c80bc3940d2010d1fef5304d3faf371d6ada5012f",
        "f88ba0144a3c15c9d09d65a286af440d22c2d423b5c30422068cf3179033376b",
        "ed8d25b2d1126c8e321b298b21c0bb6fb75eac31eb4481e3e90e14413219dc02"
    ],
    "source/soil-floodplain-source-profile-20261013.json": [
        "7c342a0de9dd1bcfae835dd89de38a26e41609cc8aa01608db0fe5e9c8c23a4b"
    ],
    "source_tools/SOIL_FLOODPLAIN_SOURCES.md": [
        "8f2af4f20478f27699c4aebfdee941276ef225637e49e7c8c9c08c83d7ba6133"
    ],
    "source/soil-floodplain-integration-20261013.json": [
        "093122c990a283d8bbf930f6445827a9a0e68d6376315369af975cc70f69771d",
        "85643aecdfad73b3cd6502a5aed0ca381e80a4fb1ed30043b40fabafa6a5202d"
    ],
    "source_tools/PARCEL_CRITERIA_INTERVALS.md": [
        "fadf7251a0e0bcce5c95a0d49d5dd2ecbf41e720d5054671bd6c8ccb823f9fab",
        "26073d412324c60e38491a32bbd87226dfaf2dfaacbc0754e53f6c403bee86dc"
    ],
    "source/parcel-criteria-interval-integration-20261013.json": [
        "ec07287aea78731d11ec5bfadd03fd43077aa762f849c0bf32fc2bdb64e6eb8e"
    ],
    "model/conservation_reporting.py": [
        "271f5bf8ba1df82766fe49efe8ec386e6de3579ad7965ec3a85221bbd6e1a8f9",
        "2dde322110556f71c0cfebf78a050e6a146f5dafeea7f16e8c744694cc3b2f1f",
        "65a6bfd15909352a8b1bfd2767e4512554c7633a20e3234c5b5a6b230da3b9c0",
        "7fc2db9e618858c7a272e04eec6404b0e8fb48f7c0cafd8ca4a3d3a505301950"
    ],
    "model/CONSERVATION_REPORTS.md": [
        "22bcfa38b6db3b78e285d53e8e1ae87a67d186fbc58bb29f837e6631a120c6b6",
        "254b52695f08b5ba43bcdba78965d55d51222d2ff2a0d9699c9c3de387a99218",
        "13be9aadd97fdda29db103fbf20af7e1416ae7121d415e63ad495ccf757767ff"
    ],
    "source/conservation-reporting-joins-20261013.json": [
        "4a6a69aca0062ad71c1919d868dabca0511e7ce65277d67dcfd4de40b65499c2"
    ],
    "operator/conservation_browser_receiving.py": [
        "92376677bdeeacdc5294a02ed89a9c9a463373b023bb6aa4ddcd170adc3e0c93",
        "8c95b46f72826e3d95f1bd79479a80e69146703b6c2088f319c1d0eb5a1d1cad",
        "e2672ff3f10f43c98604d6493615f5d076998ecdfbd5d696de3741158da02b63"
    ],
    "source_tools/receive_drive_source.py": [
        "c6771e6d8d0ed681b162f49e0d30ebf6f8bd7412666bf128409e498d83bf1b3c"
    ],
    "operator/server.py": [
        "8757233424c636a4a685d041e7d486c0c05b1ecfcd75a9a1c225a80e5a5893ce"
    ],
    "operator/web/app.mjs": [
        "328932e7405e91e2e3d194ed7fe8e865a71ecdf37ae11ef5b37136d106c6d91a"
    ],
    "operator/web/index.html": [
        "37fabd65df3e0f19f486055cfb1ed435bd7919fb63de3389784fa88ebcfb064f"
    ],
    "source_tools/soil_sources.py": [
        "082a1ed13145e0532fba7350534e71a22d1efbf68ed30c100b274baa94de8b2a",
        "9fac4ad782b733fcca8a4e013b27437e2df9cf360313f97336e3568932558d48"
    ],
    "model/conservation_catalog.py": [
        "91700433cc6e0cca672894bacc215c32e71ea83de4a3ab06305601aabbe20c4f"
    ],
    "operator/conservation_catalog.py": [
        "6d769d19b31af2c0237a7cf43e14eb4f956e4b9d700e90f54bbad28f19138c95"
    ],
    "operator/extensions/conservation-catalog.json": [
        "26cced64e361a42e4d6df7d18edb3fa3bec5b9a3523f15afb7e6b60522858d59"
    ],
    "operator/CONSERVATION_CATALOG.md": [
        "34546b7109ee378b9e5d4207b7151c3104be54564da640ac2a03769039e4c7ad"
    ],
    "operator/conservation_experiment_browser_receiving.py": [
        "3a4727836d1a78fb54e00cf16098e167618e16a7181623f32d67412365c78b2b",
        "b3d6ab4cf93b1bc65240a638ca7d2b378f2177b624c56d91cafeab11ea4e62b0"
    ],
    "operator/CONSERVATION_EXPERIMENT_BROWSER.md": [
        "703700f71cc0c849991ea89a439d436e3fef10500525f6f0bbc7c87d261afa29",
        "b440f3a59b96095aa6f8402d2521c3b25d179dcc8293255405070e057ef23057"
    ],
    "operator/web/conservation_optimization_bridge.mjs": [
        "2d79a5ff3bb86c434c9f895f00bee37a9b90c0a4bad0c26129a7d1bcb941a22a",
        "6df5b9fba0c873eb45c5bf3ea99cd6d766ad0477c390742b97ab74bce6620c31"
    ],
    "operator/web/conservation_optimization.mjs": [
        "d337ad6a2076d4611482a636cc5160e4b837b16e5fa1628b9c4325e49f272ad7",
        "7a29153e8786f0384538041c9befe12b0193c9aa5e17f138d76ebc4d3ad6f6c8"
    ],
    "operator/web/conservation_optimization.css": [
        "f8fe9a40855df1c7e241c58106c327bb1c1ef4af0ea9940572139e1c6b9237fd"
    ],
    "operator/CONSERVATION_HOST.md": [
        "6156262c9746fa163c5793cb4f15cea34a5bcdf2fbd9a1272820d09717c4cc7a",
        "e79a634aa44a5f4061d4123590a5ad3c4f592bb3eb196f0c4bb377665511c788"
    ],
    "operator/extensions/conservation.json": [
        "749b35c774827e15e732d31a11766afb5a05f6bf3abd3bb33d2118e5afdd0550",
        "3211e501743819a2d25e7c47e499d4705e57009db297ef476b09e8c19f722093"
    ],
    "operator/web/retained_desks.mjs": [
        "3313f4fa86212b12627985d6332a796ebffa913889f452b136f28df4da121d96",
        "9e53dc3f51baae9dd3a1a26901a371d82bc68bd7bc940bbc6a050d6a516136de",
        "f3641132250affeb3109f97dd0cd1f01414f7dcf009ae187154b5e27585768d9",
        "bed9b53bb6ea1ce7b0111b2c46954cc582b876112c6f553be3408f8fe3db179c"
    ],
    "source_tools/PARCEL_CRITERIA_GEOMETRY.md": [
        "35db87a06a0e4036044cca57cf1a8478a33af7a04332e2abf43455abf09cccc4"
    ],
    "source/parcel-criteria-geometry-integration-20261013.json": [
        "80bc70beec2306f299bcbbfc84e27739898c05d520312154a1f3fff660a45878"
    ],
    "source/conservation-documentation-integration-20261013.json": [
        "a334f272bebd0c16c3e79a92c98d2a5b654a9758779d22707048a375e7b377e8"
    ],
    "operator/CONSERVATION_CATALOG_BROWSER.md": [
        "252c5ec0d85a556f3f391645b2048b71707d93b2b7f21457ea37e92f6bec00ae"
    ],
    "integration/conservation_catalog_browser_composition.json": [
        "7d5078bc1d1626f218db5415d2e0e4a301aa0b94dc48fc6fd9c70b94b9ce402c"
    ],
    "model/keowee_profile_adapter.py": [
        "e36148ceb0f042cc0fd86c1525034066e9376df0b12acf06e23e57e58186b971",
        "4a4057834f3c5863620b0f324cb0acb898a3644e86c0d788c0d49251661a1183"
    ],
    "source/keowee-native-binding-20261013.json": [
        "b5e50ed043db62ad166a2f8754e502fed212225b0a54ab9ee498505ba567b465"
    ],
    "source/keowee/20261013/lake-keowee-methodology.json": [
        "388f9f7ae3246dd156fad446c616bbf8d3440a09b2edd524c45cef1d6c299da0"
    ],
    "operator/extensions/keowee-method-view.json": [
        "2e5adabaaeeb8dacc71f8b47407af7136fd912d9d23232948ae67aeb25d83234"
    ],
    "operator/KEOWEE_METHOD_VIEW.md": [
        "31f8446504c3027440bb5b8cca019c666058885ca1fd669e4c771a25e880d3a3"
    ],
    "source/keowee/20261013/keowee-evaluator.mjs": [
        "5b766947caf409026b4ea141a17b3c0a376021bf3ac51701ec94f5eb83f2cd65"
    ],
    "source/keowee/20261013/keowee-evaluator.d.mts": [
        "f721913b3290c67eab80c2c70c3ec0f881ad938a5563755bfca3e956c24db663"
    ],
    "source/keowee/20261013/KEOWEE-INTEGRATION.md": [
        "6e463f137ecc9b177ebc21766121ca27b951c77800571495c1f1ae8ff9952070"
    ],
    "source/keowee/20261013/keowee-sources-manifest.json": [
        "3f56af96c013ea1328c79d01b2601f86f51fa77dfbd9ec1b061cca8a4fb99849"
    ],
    "operator/web/keowee-method-view.mjs": [
        "f2af6b30c30daa61b0bfcde2d91551628390bcc89ffe7c6dc8f5f036a609a698"
    ],
    "source/capture_original_overlays.py": [
        "c6a055ef211c2e5b03f8f2607fed153d61d5e0ce5ca2689f6de6cfb34351159a"
    ],
    "source_tools/source_response_reuse.py": [
        "29311cededb9f006ee713e91036cd6c99b27ffbecec3e1f21202107d6967444f"
    ],
    "source_tools/SOURCE_ACQUISITION_CONTINUATION.md": [
        "8384e6d464f8bb253df82d5abce78294785579f0855e111bd3b4b22b29257416"
    ],
    "model/CONSERVATION_NATIVE_VERSIONS.md": [
        "712dda5ac675e597394d4e9d7b1976b1e2c7ab885e0fa83d1c375a5b79d7c81d",
        "66c4323cfa1def80a4cbc5c8e942daadb59fb1da76e47b0f04bc0718dddfe32f"
    ],
    "model/native_versions.py": [
        "bd4996f78c9e21ea8093499a7f7ff9adc9622ffce9bdb49b22f4121199a8b6f2"
    ]
}


def sha(body):
    return hashlib.sha256(body).hexdigest()


def once(text, before, after, label, *, marker=None):
    if marker and marker in text:
        return text
    count = text.count(before)
    if count != 1:
        raise ValueError(f"{label}: expected one existing anchor, found {count}. "
                         "The complete source is preserved; compose this registration "
                         "with the current operator implementation.")
    return text.replace(before, after, 1)


def python_method_return(text, class_name, method_name, decorator):
    if decorator + "(" in text:
        return text
    tree = ast.parse(text)
    cls = next((x for x in tree.body if isinstance(x, ast.ClassDef)
                and x.name == class_name), None)
    if cls is None:
        raise ValueError(f"Missing original class {class_name}")
    method = next((x for x in cls.body if isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef))
                   and x.name == method_name), None)
    if method is None or not method.body or not isinstance(method.body[-1], ast.Return):
        raise ValueError(f"Expected final return in {class_name}.{method_name}")
    target = method.body[-1]
    expression = ast.get_source_segment(text, target.value)
    lines = text.splitlines(keepends=True)
    first = sum(len(x) for x in lines[:target.lineno - 1]) + target.col_offset
    last = sum(len(x) for x in lines[:target.end_lineno - 1]) + target.end_col_offset
    return text[:first] + f"return {decorator}({expression})" + text[last:]


# The complete application registers Conservation through retained_desks. Older
# bare applications still use the original direct adapter below.
REGISTERED_REPAIR = json.loads(r'''{"server_removals":["from conservation import Conservation, ACTIONS as CONSERVATION_ACTIONS, READS as CONSERVATION_READS\n","ACTIONS.update(CONSERVATION_ACTIONS)\n","        self.conservation = Conservation(self, Fault)\n","        if action in CONSERVATION_ACTIONS:\n            return self.conservation.invoke(task)\n","                conservation_reads = {\"/api/conservation/\" + name: name for name in CONSERVATION_READS}\n                if url.path in conservation_reads:\n                    return self.send_json(200, self.app.conservation.read(workspace,\n                        conservation_reads[url.path], {name: one(name) for name in (\"study_id\", \"plan_id\")}))\n","                conservation_reads = {\"/api/conservation/\" + name: name for name in CONSERVATION_READS}\n                if url.path in conservation_reads:\n                    return self.send_json(200, self.app.conservation.read(workspace,\n                        conservation_reads[url.path], {name: one(name) for name in (\"study_id\", \"plan_id\", \"operation_id\")}))\n"],"app_patterns":[["(?m)^import \\{attachConservation(?:WithOptimization)?\\} from '[^'\\n]+';\\n",""],["(?ms)^const conservation=attachConservation(?:WithOptimization)?\\(.*?\\);\\n",""],["(?ms)^  if\\(view==='conservation'\\)\\{\\n.*?conservation\\.mount\\(\\$\\('#content'\\),state\\);return;\\n  \\}\\n",""],["(?m)^[ \\t]*conservation\\.detach\\(\\);\\n",""],["(?m)^[ \\t]*if\\(typeof conservation!=='undefined'\\)conservation\\.detach\\(\\);\\n",""],["if\\(typeof conservation!=='undefined'\\)conservation\\.detach\\(\\);",""],["(?ms)^ if\\(button\\.dataset\\.action\\?\\.startsWith\\('conservation-'\\).*?return conservation\\.dispatch\\(button\\);\\n \\}\\n",""],["\\+conservation\\.taskActions\\(row\\)",""]],"registered_block":"  // Registered desks retain sole ownership of their controller and actions.\n  if(extensions.hasView(view)){\n    community.detach();customerReviews.detach();spatialWorkspace.suspend();\n    if(typeof programmes!=='undefined')programmes.detach();\n    if(typeof experiments!=='undefined')experiments.detach();\n    if(typeof experimentDiagnostics!=='undefined')experimentDiagnostics.detach();\n    if(typeof receivingWaters!=='undefined')receivingWaters.detach();\n    if(typeof rehearsal!=='undefined')rehearsal.detach();\n    if(typeof journey!=='undefined'){journey.detach();journey.updateRail(view);}\n    if(typeof scenarioAnalysis!=='undefined')scenarioAnalysis.detach();\n    extensions.render(view,$('#content'),state);return;\n  }"}''')


def registered_conservation(application, files=None):
    descriptor = application / "operator" / "extensions" / "conservation.json"
    incoming = (files or {}).get("operator/extensions/conservation.json")
    if incoming is None and not descriptor.is_file():
        return False
    value = json.loads(incoming if incoming is not None else descriptor.read_text(encoding="utf-8"))
    backend = value.get("backend", {})
    factory = backend.get("factory", {})
    expected = {
        "conservation.prepare", "conservation.build", "conservation.plan.save",
        "conservation.export", "conservation.scenario.create",
        "conservation.criteria.prepare", "conservation.experiment.prepare",
    }
    if (value.get("schema") != "upstate.operator-extension/v1"
            or value.get("id") != "conservation"
            or backend.get("module") != "conservation"
            or factory.get("name", factory.get("handler")) != "Conservation"
            or not expected.issubset(set(backend.get("actions", [])))
            or value.get("client", {}).get("view", {}).get("id") != "conservation"):
        raise ValueError("Preserve and compose the existing Conservation registration before installation")
    for asset in value.get("assets", []):
        if not isinstance(asset, str) or Path(asset).name != asset:
            raise ValueError("The Conservation descriptor must name original web assets")
        if ("operator/web/" + asset not in (files or {})
                and not (application / "operator" / "web" / asset).is_file()):
            raise ValueError("Receive the complete registered Conservation desk asset: " + asset)
    for name in ("operator/extension_registry.py", "operator/web/extension_host.mjs"):
        if not (application / name).is_file():
            raise ValueError("Receive the existing registered operator host: " + name)
    return True


def patch_registered_server(text):
    for fragment in REGISTERED_REPAIR["server_removals"]:
        if text.count(fragment) > 1:
            raise ValueError("The current server has duplicated direct Conservation wiring")
        text = text.replace(fragment, "")
    # Preserve every other owner's nested task decorator.
    text = re.sub(r"(?m)^(\s*return )self\.conservation\.decorate_task\((.*)\)$",
                  lambda match: match.group(1) + match.group(2), text)
    if re.search(r"self\.conservation|CONSERVATION_ACTIONS|CONSERVATION_READS", text):
        raise ValueError("Compose the remaining direct Conservation server wiring before installation")
    if "self.extensions" not in text:
        raise ValueError("The registered Conservation desk requires its original extension host")
    ast.parse(text)
    return text


def catalog_action_labels(text):
    for action, label in [["conservation.catalog.prepare","Prepare candidate search"],["conservation.catalog.select","Retain candidate selection"],["conservation.catalog.plan.save","Save retained candidate plan"],["conservation.catalog.export","Export complete candidate rows"]]:
        if repr(action) + ":" not in text:
            text = once(text, "const actionLabels={",
                        "const actionLabels={" + repr(action) + ":" + repr(label) + ",",
                        "Candidate catalog action label")
    return text


def patch_registered_app(text):
    text = catalog_action_labels(text)
    for pattern, replacement in REGISTERED_REPAIR["app_patterns"]:
        text = re.sub(pattern, lambda match: replacement, text)
    branch = REGISTERED_REPAIR["registered_block"]
    if branch not in text:
        pattern = r"(?m)^  if\(extensions\.render\(view,\$\('#content'\),state\)\)\{[^\n]+\}\s*$"
        text, count = re.subn(pattern, lambda match: branch, text)
        if count != 1:
            raise ValueError("Expected the current registered desk render branch")
    if re.search(r"\bconservation\.(render|mount|detach|dispatch|taskActions)|const conservation=|import \{attachConservation", text):
        raise ValueError("Compose the remaining direct Conservation browser wiring before installation")
    return text


def patch_server(text, registered=False):
    if registered:
        return patch_registered_server(text)
    text = once(text, "from model import portable\n",
                "from model import portable\n"
                "sys.path.insert(0, str(Path(__file__).resolve().parent))\n"
                "from conservation import Conservation, ACTIONS as CONSERVATION_ACTIONS, READS as CONSERVATION_READS\n",
                "Conservation backend import", marker="from conservation import Conservation,")
    if "ACTIONS.update(CONSERVATION_ACTIONS)" not in text:
        tree = ast.parse(text)
        assignment = next((n for n in tree.body if isinstance(n, ast.Assign)
                           and any(isinstance(t, ast.Name) and t.id == "ACTIONS" for t in n.targets)), None)
        if assignment is None:
            raise ValueError("Missing original operator ACTIONS declaration")
        lines = text.splitlines(keepends=True)
        lines.insert(assignment.end_lineno, "ACTIONS.update(CONSERVATION_ACTIONS)\n")
        text = "".join(lines)
    text = once(text, "        self.downloads = {}\n",
                "        self.downloads = {}\n        self.conservation = Conservation(self, Fault)\n",
                "Conservation service", marker="self.conservation = Conservation(self, Fault)")
    text = once(text, '        action = task["action"]\n',
                '        action = task["action"]\n'
                '        if action in CONSERVATION_ACTIONS:\n'
                '            return self.conservation.invoke(task)\n',
                "Conservation task execution", marker="return self.conservation.invoke(task)")
    text = python_method_return(text, "Operator", "task_view",
                                "self.conservation.decorate_task")
    text = once(text, '                workspace = one("workspace", self.app.primary)\n',
                '                workspace = one("workspace", self.app.primary)\n'
                '                conservation_reads = {"/api/conservation/" + name: name for name in CONSERVATION_READS}\n'
                '                if url.path in conservation_reads:\n'
                '                    return self.send_json(200, self.app.conservation.read(workspace,\n'
                '                        conservation_reads[url.path], {name: one(name) for name in ("study_id", "plan_id", "operation_id")}))\n',
                "Conservation read routes", marker='conservation_reads = {"/api/conservation/"')
    text = text.replace('for name in ("study_id", "plan_id")',
                        'for name in ("study_id", "plan_id", "operation_id")')
    # Preserve the current extension-host union and either quote style.
    # Edit only the literal static set inside the original selected-file guard.
    static_sets = []
    for comparison in ast.walk(ast.parse(text)):
        if (not isinstance(comparison, ast.Compare)
                or not isinstance(comparison.left, ast.Name)
                or comparison.left.id != "selected"
                or len(comparison.ops) != 1
                or not isinstance(comparison.ops[0], ast.NotIn)):
            continue
        for node in ast.walk(comparison.comparators[0]):
            if isinstance(node, ast.Set) and any(
                    isinstance(item, ast.Constant) and item.value == "index.html"
                    for item in node.elts):
                static_sets.append(node)
    if len(static_sets) != 1:
        raise ValueError("Expected one current operator selected-file static set")
    target = static_sets[0]
    present = {item.value for item in target.elts if isinstance(item, ast.Constant)}
    missing_assets = [name for name in ("conservation.mjs", "conservation.css")
                      if name not in present]
    if missing_assets:
        literal = ast.get_source_segment(text, target)
        if literal is None or not literal.endswith("}"):
            raise ValueError("Cannot locate the current operator static set source")
        lines = text.splitlines(keepends=True)
        first = sum(len(line) for line in lines[:target.lineno - 1]) + target.col_offset
        last = sum(len(line) for line in lines[:target.end_lineno - 1]) + target.end_col_offset
        separator = " " if literal[:-1].rstrip().endswith(",") else ", "
        addition = separator + ", ".join(repr(name) for name in missing_assets)
        text = text[:first] + literal[:-1] + addition + "}" + text[last:]
    ast.parse(text)
    return text


def conservation_lifecycle(text):
    """Detach the current host's other desks before replacing their shared root."""
    opening = "  if(view==='conservation'){\n"
    start = text.find(opening)
    end = text.find("conservation.mount($('#content'),state)", start)
    if start < 0 or end < 0:
        raise ValueError("Expected the installed original Conservation render branch")
    current = text[start:end]
    lifecycle = (
        "    if(typeof extensions!=='undefined')extensions.detach();\n",
        "    if(typeof experiments!=='undefined')experiments.detach();\n",
        "    if(typeof experimentDiagnostics!=='undefined')experimentDiagnostics.detach();\n",
        "    if(typeof programmes!=='undefined')programmes.detach();\n",
        "    if(typeof receivingWaters!=='undefined')receivingWaters.detach();\n",
        "    if(typeof rehearsal!=='undefined')rehearsal.detach();\n",
        "    if(typeof journey!=='undefined'){journey.detach();journey.updateRail(view);}\n",
        "    if(typeof scenarioAnalysis!=='undefined')scenarioAnalysis.detach();\n",
    )
    addition = "".join(line for line in lifecycle if line.strip() not in current)
    position = start + len(opening)
    return text[:position] + addition + text[position:]


def conservation_action_labels(text):
    for action, label in (
        ("conservation.criteria.prepare", "Prepare original parcel criteria"),
        ("conservation.experiment.prepare", "Prepare paired conservation experiment"),
        ("conservation.sources.capture", "Acquire soil and floodplain sources"),
        ("conservation.optimization.preview", "Preview conservation portfolio"),
        ("conservation.optimization.save", "Save optimized conservation portfolio"),
        ("conservation.optimization.export", "Export conservation decision packet"),
    ):
        if repr(action) + ":" not in text and json.dumps(action) + ":" not in text:
            text = once(text, "const actionLabels={",
                        "const actionLabels={" + repr(action) + ":" + repr(label) + ",",
                        "Conservation continuation operation label")
    return text


def patch_app(text, registered=False):
    text = catalog_action_labels(text)
    if registered:
        return conservation_action_labels(patch_registered_app(text))
    text = text.replace("for(const node of $('[data-view]'))",
                        "for(const node of $$('[data-view]'))")
    text = text.replace("parameter('sdr','l_max','Maximum slope length','Metres.','min=\"0\"')", "parameter('sdr','l_max','Maximum L factor','Dimensionless maximum for the LS slope-length factor.','min=\"0\"')")
    if ("import {attachConservation}" not in text
            and "import {attachConservationWithOptimization}" not in text):
        text = "import {attachConservation} from './conservation.mjs';\n" + text
    text = once(text, "const viewLabels={",
                "const viewLabels={conservation:'Conservation plans',",
                "Conservation view", marker="conservation:'Conservation plans'")
    text = once(text, "const actionLabels={",
                "const actionLabels={'conservation.prepare':'Prepare conservation study',"
                "'conservation.build':'Build conservation inventory',"
                "'conservation.plan.save':'Save conservation plan',"
                "'conservation.export':'Export conservation packet','conservation.scenario.create':'Create selected-land scenario',",
                "Conservation operation labels", marker="'conservation.build':")
    text = conservation_action_labels(text)
    if ("const conservation=attachConservation(" not in text
            and "const conservation=attachConservationWithOptimization(" not in text):
        matches = list(re.finditer(r"(?m)^const endpoint = [^\n]+\n", text))
        if len(matches) != 1:
            raise ValueError("Expected the original endpoint helper")
        i = matches[0].end()
        text = text[:i] + (
            "const conservation=attachConservation({getState:()=>state,api,endpoint,"
            "openForm,submitAction,detail,fileList,showTask,toast,"
            "closeForm:()=>{formDialog.close();formContext=null;}});\n"
        ) + text[i:]
    branch = (
        "function render(){\n  if(!state)return;\n"
        "  if(view==='conservation'){\n"
        "    for(const node of $$('[data-view]'))node.setAttribute('aria-current',node.dataset.view===view?'page':'false');\n"
        "    if(typeof spatialWorkspace!=='undefined')spatialWorkspace.suspend();\n"
        "    if(typeof community!=='undefined')community.detach();\n"
        "    if(typeof customerReviews!=='undefined')customerReviews.detach();\n"
        "    $('#content').innerHTML=conservation.render(state);\n"
        "    conservation.mount($('#content'),state);return;\n"
        "  }\n  conservation.detach();\n"
    )
    text = once(text, "function render(){\n  if(!state)return;\n", branch,
                "Conservation mounted view", marker="conservation.mount($('#content'),state)")
    text = conservation_lifecycle(text)
    text = once(text, "async function dispatch(button){\n",
                "async function dispatch(button){\n"
                " if(button.dataset.action?.startsWith('conservation-')){\n"
                "  if(['conservation-open-study','conservation-open-plan'].includes(button.dataset.action)){\n"
                "   detailDialog.close(); detailContext=null; await navigate('conservation');\n"
                "  }\n"
                "  return conservation.dispatch(button);\n"
                " }\n",
                "Conservation controls", marker="return conservation.dispatch(button)")
    text = text.replace("detailDialog.close(); await navigate('conservation');",
                        "detailDialog.close(); detailContext=null; await navigate('conservation');")
    text = text.replace(
        "['conservation-open-study','conservation-open-plan'].includes(button.dataset.action)",
        "['conservation-open-study','conservation-open-plan','conservation-use-criteria',"
        "'conservation-new-parcel-study'].includes(button.dataset.action)")
    navigation_pattern = r"(\[[^\n\]]*'conservation-open-study'[^\n\]]*\])\.includes\(button\.dataset\.action\)"
    navigation = (
        "['conservation-open-study','conservation-open-plan','conservation-use-criteria',"
        "'conservation-new-parcel-study','conservation-new-experiment',"
        "'conservation-open-source-capture','conservation-criteria-from-sources',"
        "'conservation-optimization-open-preview','conservation-optimization-open-analysis']"
    )
    matches = list(re.finditer(navigation_pattern, text))
    if len(matches) != 1:
        raise ValueError("Expected one Conservation task navigation route")
    selected_navigation = matches[0]
    text = (text[:selected_navigation.start(1)] + navigation +
            text[selected_navigation.end(1):])
    prior_task_stamp = "(data.tasks||[]).filter(t=>String(t.action||'').startsWith('conservation.')).map(t=>[t.id,t.state])"
    current_task_stamp = (
        "(data.tasks||[]).filter(t=>String(t.action||'').startsWith('conservation.')||"
        "['experiment.save','experiment.run','experiment.summarize'].includes(t.action))"
        ".map(t=>[t.id,t.state,t.updated_at||null,t.progress||null])"
    )
    text = text.replace(prior_task_stamp, current_task_stamp)
    if "conservation_tasks:" not in text:
        pattern = r'(?m)^(\s*const fingerprint=JSON\.stringify\(\{)(.*?)(\}\);)$'
        matches = list(re.finditer(pattern, text))
        if len(matches) != 1:
            raise ValueError("Expected the original retained-state fingerprint")
        match = matches[0]
        extra = "conservation_tasks:view==='conservation'?" + current_task_stamp + ":undefined,"
        text = text[:match.start()] + match.group(1) + extra + match.group(2) + match.group(3) + text[match.end():]
    workspace_start = text.find("async function selectWorkspace(id){\n")
    workspace_end = text.find("\nasync function ", workspace_start + 1)
    if workspace_start < 0 or workspace_end < 0:
        raise ValueError("Expected the original guarded workspace transition")
    workspace_section = text[workspace_start:workspace_end]
    workspace_section = workspace_section.replace(" conservation.detach();\n", "")
    workspace_guard = " if(formDialog.open)throw Error('Finish or close the current draft before changing workspaces.');\n"
    workspace_section = once(workspace_section, workspace_guard,
                             workspace_guard + " conservation.detach();\n",
                             "Conservation workspace transition after accepted draft guard",
                             marker=workspace_guard + " conservation.detach();\n")
    text = text[:workspace_start] + workspace_section + text[workspace_end:]
    if "conservation.taskActions(row)" not in text:
        start = text.find("async function showTask(")
        end = text.find("\nconst input=", start)
        if start < 0 or end < 0:
            raise ValueError("Expected original operation-detail function")
        section = text[start:end]
        section = once(section, "fileList(row._downloads||[])",
                       "conservation.taskActions(row)+fileList(row._downloads||[])",
                       "Conservation operation links")
        text = text[:start] + section + text[end:]
    return text



def patch_soil_sources(text, registered=False):
    """Keep retained original K-source editions reopenable with their manifest."""
    before = (
        '                path = directory / item["path"]\n'
        '                if path.stat().st_size != item["bytes"] or file_digest(path) != item["sha256"]:\n'
        '                    raise ValueError("Retained soil source or companion bytes changed")\n'
        '            return entry\n\n'
        '        client = Sda(directory, resume=resume)\n'
    )
    after = (
        '                path = directory / item["path"]\n'
        '                if path.stat().st_size != item["bytes"] or file_digest(path) != item["sha256"]:\n'
        '                    raise ValueError("Retained soil source or companion bytes changed")\n'
        '            atomic_json(directory / "source-manifest.json", {\n'
        '                "schema": "upstate.sources/v1", "title": entry["title"],\n'
        '                "entries": [entry]}, immutable=True)\n'
        '            return entry\n\n'
        '        client = Sda(directory, resume=resume)\n'
    )
    if after in text:
        return text
    return once(text, before, after, "Retained original soil source manifest")


def patch_index(text, registered=False):
    if registered:
        return text
    if re.search(r'\bdata-view=["\']conservation["\']', text):
        return text
    pattern = r'(?m)^([ \t]*)<button\b[^\n>]*\bdata-view=(["\'])comparisons\2[^\n>]*>[^\n]*?</button>'
    matches = list(re.finditer(pattern, text))
    if len(matches) != 1:
        raise ValueError("Expected one current Run comparisons navigation button")
    match = matches[0]
    addition = '\n' + match.group(1) + '<button type="button" data-view="conservation">Conservation plans</button>'
    return text[:match.end()] + addition + text[match.end():]


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".conservation-write-", dir=path.parent)
    pending = Path(temporary)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(pending, path)
    finally:
        pending.unlink(missing_ok=True)


def read_packet(path):
    if path is None:
        bundle = Path(__file__).resolve().parent.parent
        files = {name: (bundle / name).read_text(encoding="utf-8")
                 for name in sorted(OWNED) if (bundle / name).is_file()}
        value = {
            "schema": SCHEMA, "operation_id": "ES-EXP-2319/COMPLETE-CONSERVATION-20261013",
            "edition": "complete-directory",
            "files": files,
            "file_metadata": {name: {"sha256": sha(body.encode("utf-8")),
                                      "bytes": len(body.encode("utf-8"))}
                              for name, body in files.items()},
        }
    else:
        value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema") not in (SCHEMA, "commons.source-bank/v1", "upstate.conservation-source/v1"):
        raise ValueError("Select the complete conservation source packet")
    if isinstance(value.get("files"), list):
        bodies, metadata = {}, {}
        for row in value["files"]:
            if not isinstance(row, dict) or not isinstance(row.get("path"), str):
                raise ValueError("A complete source entry needs its original path")
            name = row["path"]
            if name in bodies:
                raise ValueError("A source path occurs more than once: " + name)
            if row.get("encoding", "utf-8") != "utf-8":
                raise ValueError("Source files must retain their UTF-8 bodies: " + name)
            bodies[name] = row.get("content")
            metadata[name] = {key: row.get(key) for key in ("bytes", "sha256")}
        value = {**value, "schema": SCHEMA, "files": bodies, "file_metadata": metadata}
    files = value.get("files")
    if not isinstance(files, dict) or not files:
        raise ValueError("Source packet has no complete source bodies")
    forbidden = set(files) - OWNED
    if forbidden:
        raise ValueError("Source packet contains unrelated paths: " + ", ".join(sorted(forbidden)))
    for name, body in files.items():
        if not isinstance(body, str):
            raise ValueError("Source body is not complete UTF-8 text: " + name)
        expected = value.get("file_metadata", {}).get(name, {})
        encoded = body.encode("utf-8")
        if expected.get("sha256") != sha(encoded) or expected.get("bytes") != len(encoded):
            raise ValueError("Source body differs from its retained identity: " + name)
    needed = {
        "model/native_versions.py",
        "integration/conservation_catalog_browser_composition.json",
        "model/conservation.py",
        "model/conservation_bindings.py",
        "model/conservation_catalog.py",
        "model/conservation_cli.py",
        "model/conservation_optimization.py",
        "model/conservation_reporting.py",
        "model/conservation_scenarios.py",
        "model/keowee_priority.py",
        "model/keowee_profile_adapter.py",
        "model/portfolios.py",
        "model/source_lineage.py",
        "operator/conservation.py",
        "operator/conservation_browser_receiving.py",
        "operator/conservation_catalog.py",
        "operator/conservation_experiment_browser_receiving.py",
        "operator/conservation_optimization.py",
        "operator/conservation_regional_receiving.py",
        "operator/extensions/conservation-catalog.json",
        "operator/extensions/conservation-optimization.json",
        "operator/extensions/conservation.json",
        "operator/extensions/keowee-method-view.json",
        "operator/install_conservation.py",
        "operator/web/conservation.css",
        "operator/web/conservation.mjs",
        "operator/web/conservation_optimization.css",
        "operator/web/conservation_optimization.mjs",
        "operator/web/conservation_optimization_bridge.mjs",
        "operator/web/keowee-method-view.mjs",
        "operator/web/retained_desks.mjs",
        "source/capture_original_overlays.py",
        "source/conservation-documentation-integration-20261013.json",
        "source/conservation-reporting-joins-20261013.json",
        "source/keowee-native-binding-20261013.json",
        "source/keowee-native-receiving-20261013/capture.json",
        "source/keowee-native-receiving-20261013/greenwood-native-feature.json",
        "source/keowee-native-receiving-20261013/source-interval-journey.json",
        "source/keowee-native-receiving-20261013/source-selection-journey.json",
        "source/keowee-native-receiving-20261013/sources.json",
        "source/keowee-priority-integration-20261013.json",
        "source/keowee-priority-methods-20261013.json",
        "source/keowee/20261013/KEOWEE-INTEGRATION.md",
        "source/keowee/20261013/keowee-criteria.csv",
        "source/keowee/20261013/keowee-evaluator.d.mts",
        "source/keowee/20261013/keowee-evaluator.mjs",
        "source/keowee/20261013/keowee-fields.csv",
        "source/keowee/20261013/keowee-journey-check.json",
        "source/keowee/20261013/keowee-source-catalog.json",
        "source/keowee/20261013/keowee-sources-manifest.json",
        "source/keowee/20261013/lake-keowee-methodology.json",
        "source/parcel-criteria-geometry-integration-20261013.json",
        "source/parcel-criteria-integration-20261013.json",
        "source/parcel-criteria-interval-integration-20261013.json",
        "source/parcel-criteria-sources-20261013.json",
        "source/soil-floodplain-integration-20261013.json",
        "source/soil-floodplain-source-profile-20261013.json",
        "source_tools/keowee_interval_receiving.mjs",
        "source_tools/parcel_criteria.py",
        "source_tools/SOURCE_ACQUISITION_CONTINUATION.md",
        "source_tools/soil_floodplain_sources.py",
        "source_tools/source_response_reuse.py",
        "source_tools/soil_sources.py",
    }
    if needed - set(files):
        raise ValueError("The complete backend, CLI and operator source must travel together")
    return value


def verify_application_dependencies(application, incoming):
    """Resolve source dependencies against the actual receiving application."""
    required = (
        "model/common.py", "model/workspace.py", "model/rasters.py",
        "model/model_selection.py",
        "source/capture_original_overlays.py", "source/capture_upstream_network.py",
        "source_tools/soil_sources.py", "operator/extension_registry.py",
    )
    missing = [name for name in required
               if name not in incoming and not (application / name).is_file()]
    if missing:
        raise ValueError("Receive the current complete application sources: " + ", ".join(missing))
    server = (application / "operator/server.py").read_text(encoding="utf-8")
    required_registrations = (
        "from extension_registry import ExtensionRegistry",
        "self.extensions.handles_action(action)",
        'self.app.extensions.has_route("GET", url.path)',
        "self.extensions.decorate_task(",
    )
    if any(marker not in server for marker in required_registrations):
        raise ValueError("Receive the current registry-integrated operator core before its "
                         "Conservation source cohort; its registered actions and routes "
                         "serve the existing optimization descriptor.")
    solver_text = incoming.get("model/portfolios.py")
    if solver_text is None:
        solver_text = (application / "model/portfolios.py").read_text(encoding="utf-8")
    solver_tree = ast.parse(solver_text)
    functions = {node.name for node in solver_tree.body if isinstance(node, ast.FunctionDef)}
    if not {"_optimize", "_money", "_usd", "_area_capacity"} <= functions:
        raise ValueError("Receive the maintained portfolio solver with its numeric resource contract.")
    soil_text = incoming.get("source_tools/soil_sources.py")
    if soil_text is None:
        soil_text = (application / "source_tools/soil_sources.py").read_text(encoding="utf-8")
    if not any(isinstance(node, ast.ClassDef) and node.name == "Sda"
               for node in ast.parse(soil_text).body):
        raise ValueError("Receive the maintained original USDA SDA source client.")


def install(application, source):
    application = application.resolve(strict=True)
    if not (application / "model" / "workspace.py").is_file():
        raise ValueError("Select the existing Upper Savannah application directory")
    packet = read_packet(source)
    registered = registered_conservation(application, packet["files"])
    verify_application_dependencies(application, packet["files"])
    marker = sha(source.read_bytes() if source is not None else
                 json.dumps(packet, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    bank = application.parent / ".upstate-conservation-install" / application.name
    bank.mkdir(parents=True, exist_ok=True)
    lock = bank / "source.lock"
    with lock.open("a+b") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        updates, original = {}, {}
        for name, body in packet["files"].items():
            path = application / name
            if not path.parent.resolve().is_relative_to(application):
                raise ValueError("Source directory leaves the selected application: " + name)
            if path.is_symlink():
                raise ValueError("Owned source path is a symlink: " + name)
            incoming = body.encode("utf-8")
            current = path.read_bytes() if path.exists() else None
            if current is not None and current != incoming:
                known = set(KNOWN_PRIOR.get(name, ()))
                known.update(packet.get("compatible_base_sha256", {}).get(name, ()))
                if sha(current) not in known:
                    raise ValueError("Compose the current conservation source before installing its successor: " + name)
            if current != incoming:
                updates[name], original[name] = incoming, current
        for name, patch in (("operator/server.py", patch_server),
                            ("operator/web/app.mjs", patch_app),
                            ("operator/web/index.html", patch_index),
                            ("source_tools/soil_sources.py", patch_soil_sources)):
            path = application / name
            if not path.parent.resolve().is_relative_to(application):
                raise ValueError("Source directory leaves the selected application: " + name)
            if path.is_symlink():
                raise ValueError("Shared operator source is a symlink: " + name)
            current = path.read_bytes()
            # Shared compatibility joins must compose the incoming owned source,
            # including the current acquisition client's recovery behavior.
            candidate = updates.get(name, current)
            incoming = patch(candidate.decode("utf-8"), registered=registered).encode("utf-8")
            if incoming != current:
                updates[name], original[name] = incoming, current
            elif name in updates:
                del updates[name]
                del original[name]
        for name, content in updates.items():
            if name.endswith(".py"):
                compile(content.decode("utf-8"), str(application / name), "exec")
            elif name.endswith(".json"):
                json.loads(content)
        receipt_dir = bank / marker
        receipt_dir.mkdir(parents=True, exist_ok=True)
        written = []
        record = {
            "schema": "upstate.conservation-install/v1",
            "operation_id": packet["operation_id"], "source_sha256": marker,
            "application": str(application), "files": {}, "state": "prepared",
            "conservation_owner": "registered" if registered else "direct",
        }
        for name, content in updates.items():
            before = original[name]
            if before is not None:
                atomic(receipt_dir / "before" / name, before)
            record["files"][name] = {
                "before": sha(before) if before is not None else None,
                "after": sha(content), "bytes": len(content),
            }
        atomic(receipt_dir / "install.json",
               (json.dumps(record, indent=2, sort_keys=True) + "\n").encode("utf-8"))
        try:
            for name, content in updates.items():
                path = application / name
                current = path.read_bytes() if path.exists() else None
                if current != original[name]:
                    raise ValueError("Concurrent source update detected: " + name)
                atomic(path, content)
                written.append(name)
        except BaseException:
            # Roll back only our own exact postimages, preserving concurrent edits.
            for name in reversed(written):
                path = application / name
                if path.is_file() and path.read_bytes() == updates[name]:
                    if original[name] is None:
                        path.unlink()
                    else:
                        atomic(path, original[name])
            record["state"] = "rolled_back"
            atomic(receipt_dir / "install.json",
                   (json.dumps(record, indent=2, sort_keys=True) + "\n").encode("utf-8"))
            raise
        record["state"] = "installed" if updates else "already_installed"
        atomic(receipt_dir / "install.json",
               (json.dumps(record, indent=2, sort_keys=True) + "\n").encode("utf-8"))
        return {**record, "record": str(receipt_dir / "install.json"),
                "opening_route": "Use the existing authenticated operator URL, then Conservation plans."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--source", type=Path,
                        help="Complete JSON source packet; defaults to the source files beside this installer")
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
