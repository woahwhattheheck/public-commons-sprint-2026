import {compute} from "../observations/observed_hydrology_20261013/nutrient_flow_contrasts/compute.mjs";

export const ORIGINAL_NUTRIENT_FLOW_INPUTS = [
  {
    "path": "observations/observed_hydrology_20261013/derived/calendar_month_flow.csv",
    "bytes": 334352,
    "sha256": "0ea7464700941ae5ff747629cde13f1ac003710e3ee7225b55ad0fa1f439995f"
  },
  {
    "path": "observations/observed_hydrology_20261013/derived/calendar_year_flow.csv",
    "bytes": 29200,
    "sha256": "79dd0fbc02203ec2994b971613376147fd02fd6905e3cf8f77a0559923d5b9bf"
  },
  {
    "path": "observations/observed_hydrology_20261013/derived/calendar_year_stage.csv",
    "bytes": 650,
    "sha256": "6035eacca48b465688d4edf1a39c236456a695c83b754b8687706cc8e7f8db64"
  },
  {
    "path": "observations/observed_hydrology_20261013/derived/coverage.json",
    "bytes": 2168,
    "sha256": "4f13fadd07a683dc2c08569529ad9fce2f3ec1e62649d8eeab0c583d2297919f"
  },
  {
    "path": "observations/observed_hydrology_20261013/derived/daily_flow.csv",
    "bytes": 2273280,
    "sha256": "59df488cc9820a6eef7750d6938cf91573f701c8ad4683a6c102ec26c7a04863"
  },
  {
    "path": "observations/observed_hydrology_20261013/derived/daily_stage.csv",
    "bytes": 60112,
    "sha256": "ba0a82dcf20b48d037358b3273a0be0e1ef163571a3081d4ebff9e7f3b0d9959"
  },
  {
    "path": "observations/observed_hydrology_20261013/derived/eighteenmile_gage_whole_catchments.geojson",
    "bytes": 41692,
    "sha256": "8f19b120756c1a2822f8f0a2b977279cd0caa8f76c9002f3921cf176b8da3691"
  },
  {
    "path": "observations/observed_hydrology_20261013/derived/monitoring_stations_nad83.geojson",
    "bytes": 155365,
    "sha256": "b42d862f55d4dbf20dab9852f4f6ede927ae3977e80053a84ba17b588759b45e"
  },
  {
    "path": "observations/observed_hydrology_20261013/derived/nutrient_activity_total_nitrogen.csv",
    "bytes": 6639,
    "sha256": "abdd1ddee9852679dd2c6c174f4aed3e8602885f371a18ab765e65c720dfde04"
  },
  {
    "path": "observations/observed_hydrology_20261013/derived/nutrient_concentration_summary.csv",
    "bytes": 1197,
    "sha256": "fca1ba6019adb0976fc8212543890e98d4fd0ac9ded0951aecafc40757016e3e"
  },
  {
    "path": "observations/observed_hydrology_20261013/derived/nutrient_results_with_flow.csv",
    "bytes": 36518,
    "sha256": "67b8349bf110ff2ca012bb92a20a67894213d7a65d1f0bb62c6da6fdf87c7831"
  },
  {
    "path": "observations/observed_hydrology_20261013/derived/nutrient_source_coverage.csv",
    "bytes": 1417,
    "sha256": "51465ac5145a59f1b673da9ba81a0bdbdb83035193199d31a87c54f1c8c42d32"
  },
  {
    "path": "observations/observed_hydrology_20261013/derived/original_series_metadata.json",
    "bytes": 135659,
    "sha256": "c692f2c9f43c2effbec1d47c8d9ceda410175460c41cf7f0827a934c3f3e2765"
  },
  {
    "path": "observations/observed_hydrology_20261013/derived/study_period_flow.csv",
    "bytes": 5385,
    "sha256": "df954baa0926a635bccb727f119cef8869328913ec2d7e892a25ae4b440e53d0"
  },
  {
    "path": "observations/observed_hydrology_20261013/hydrology_core.mjs",
    "bytes": 22803,
    "sha256": "789d5d515e8eae2b9860d5291acb80d6923a88a8dfb805386304fdc027ef9bde"
  },
  {
    "path": "observations/observed_hydrology_20261013/inputs.json",
    "bytes": 48663,
    "sha256": "6e1aab71f84ce1cbc690cbe79606188f9c5a8702d03c819acd96fdf476e30a02"
  },
  {
    "path": "observations/observed_hydrology_20261013/model-sources.json",
    "bytes": 25766,
    "sha256": "48efe065df256ee81b614dbe42ac10efd17a2a3dd36e77b52aae9b700acecd37"
  },
  {
    "path": "observations/observed_hydrology_20261013/nutrient_flow_contrasts/compute.mjs",
    "bytes": 14115,
    "sha256": "7b6e2e6b3aeca619d965ac83bb7904f53c44c0939ee6334a3be3c6261e838d46"
  },
  {
    "path": "observations/observed_hydrology_20261013/nutrient_flow_contrasts/dated_values.csv",
    "bytes": 171981,
    "sha256": "0cccdbcc3831f376caad25bb81b783ab76dda3430197ace0927ec42a126e5a2b"
  },
  {
    "path": "observations/observed_hydrology_20261013/nutrient_flow_contrasts/import_into_workspace.py",
    "bytes": 4092,
    "sha256": "19d5ab4e4e39c40c73add805af0b52bedb6d6a40260f45709e30a043dcaff724"
  },
  {
    "path": "observations/observed_hydrology_20261013/nutrient_flow_contrasts/inputs.json",
    "bytes": 1236,
    "sha256": "bd74db1c9e62b5ec1726ce2242814b97c5ee04e7ab8946970018199e0b946e29"
  },
  {
    "path": "observations/observed_hydrology_20261013/nutrient_flow_contrasts/june12_contrast.csv",
    "bytes": 3669,
    "sha256": "fa4eef5696dbb8cca9cbc7aa0e031eebd89f269cf41ef3bc034a295ef4a2e93f"
  },
  {
    "path": "observations/observed_hydrology_20261013/nutrient_flow_contrasts/methods.json",
    "bytes": 1544,
    "sha256": "8ddc526972d3ec669d4b25a5de8dd886db7b3242cdf620bfe05ef4d8dc48222c"
  },
  {
    "path": "observations/observed_hydrology_20261013/nutrient_flow_contrasts/model-sources.json",
    "bytes": 11704,
    "sha256": "4429768ba2fafebb2399bb038282d943b598a49549436644247323cf8144e11b"
  },
  {
    "path": "observations/observed_hydrology_20261013/nutrient_flow_contrasts/README.md",
    "bytes": 5573,
    "sha256": "33ef6a32859f72cb81a935c41d976dfb160fd75057868bfd1b39472b310db852"
  },
  {
    "path": "observations/observed_hydrology_20261013/nutrient_flow_contrasts/replay.mjs",
    "bytes": 1379,
    "sha256": "9365a67a04973b1662724d779fdfe3ec336fa7290315c321a61b49263899950e"
  },
  {
    "path": "observations/observed_hydrology_20261013/nutrient_flow_contrasts/same_date.csv",
    "bytes": 1922,
    "sha256": "47d4516fee1f7a14089270b2ee1d3b270a3edb3c5ee1412d66c9bb8d31231392"
  },
  {
    "path": "observations/observed_hydrology_20261013/nutrient_flow_contrasts/sampling_calendar.csv",
    "bytes": 8008,
    "sha256": "c7775e8948e8ed775776bb3dab17a3f5b66252e88adc4bd5a8a80b4088674a89"
  },
  {
    "path": "observations/observed_hydrology_20261013/nutrient_flow_contrasts/station_contrasts.csv",
    "bytes": 13645,
    "sha256": "ee99785f67ecdd1673bee08d818e31b918d05c7690354fc17e77d71b6fb8b09b"
  },
  {
    "path": "observations/observed_hydrology_20261013/nutrient_flow_contrasts/station_flow_summary.csv",
    "bytes": 37633,
    "sha256": "6034e6740be5fd3fd87be57c189b3acf62cedab8c68bc1e2eb16c37a28224fd7"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/chauga_series_metadata.json",
    "bytes": 8239,
    "sha256": "d965e63760432bc4e4e4536e241276536f81e858fcfaa1509c255e3c02548e75"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/chauga_stage_2023.json",
    "bytes": 8421,
    "sha256": "0f5db8664955927823f12e702c5e38a3f3ada7755afe93d9fd787bc666d0d792"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/chauga_stage_2024_2025.json",
    "bytes": 55755,
    "sha256": "f02b4f14cf350bf2d9859158ebc73a9dc0d9b073638d65a2975da1f6ca2e5647"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02176930_2020_2021.json",
    "bytes": 55528,
    "sha256": "2872c62a982c8a4b0ce6c956bc5e74f416bc10072163e45764cd6e4440c872f5"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02176930_2022_2023.json",
    "bytes": 55669,
    "sha256": "ffe7afbb905b7d707fc031a9f90a0e51d79c93be2ecc716abff82816816d7a26"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02176930_2024_2025.json",
    "bytes": 55683,
    "sha256": "9330b65674c5f2d991307d5a22ced1b3bd607ed11938ef9021b0a8948a59f995"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02177000_2020_2021.json",
    "bytes": 55595,
    "sha256": "3c3768fb8cba3444fedf6e4923ae0a0b888d0d88d9ec87f771e36086c68059a6"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02177000_2022_2023.json",
    "bytes": 55405,
    "sha256": "4c6f2676d75443e9d9e9d4cb528c6b23aa3e3ca1c583dd07da253421f3fd94ec"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02177000_2024_2025.json",
    "bytes": 55290,
    "sha256": "e7c587289520a672420db4cb1c29288c9bb908aa77daf2736ca4f3b8e9551c47"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02178400_2020_2021.json",
    "bytes": 55484,
    "sha256": "5267c47c0d3718de5031a601e1e6d44213db36a597b09e834391b9de625be299"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02178400_2022_2023.json",
    "bytes": 55581,
    "sha256": "2c6740dc5826b07b24221d5bcacf09bc5a405befc372058ce8afd62a8e47d199"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02178400_2024_2025.json",
    "bytes": 55512,
    "sha256": "627b12a65b6d0efe40840f3abe9522261886ab42bd4ba6888b0835f949eaa505"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02180400_2020_2021.json",
    "bytes": 40728,
    "sha256": "f758b79de4ef630bcadadd83a1c4dd8ea1f781e96cf18347228b646b0d5e1088"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02180400_2022_2023.json",
    "bytes": 56001,
    "sha256": "31d612ef5f75c6cab4de048771e465311398e133afc49dc4c389ed0919f7bd57"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02180400_2024_2025.json",
    "bytes": 56072,
    "sha256": "a30ce5ff5e2f5ee3d62044564825e57144ae9e8ead59ac46a72a3f7e8c41d26c"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02181350_2020_2021.json",
    "bytes": 55965,
    "sha256": "9e3f5d820a741f0b94af993d4adea5e5db7a0b4b26c1f8a839fca2dad878644a"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02181350_2022_2023.json",
    "bytes": 55881,
    "sha256": "975fa755c56c375d453680d0cda5badb9c1d571f08f54ff2bbf8f275e3950d4d"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02181350_2024_2025.json",
    "bytes": 55838,
    "sha256": "f186d856915ecc9d95f0063942c4839a4114fbdb601add3424041c18d99df6f4"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02181580_2020_2021.json",
    "bytes": 56048,
    "sha256": "afa80b13c3eb0bad6ba92f43b43739b0c32741eaee415c43cb4782917ce49907"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02181580_2022_2023.json",
    "bytes": 55933,
    "sha256": "126508186d0e8ad178f0f41a1c325afb26246665aebda0cc852fd08a52d3b413"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02181580_2024_2025.json",
    "bytes": 56170,
    "sha256": "e1012815e5e428d9296c77e34743216d7a68d63cf88e66c491859f17b8a57acd"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02185010_2020_2021.json",
    "bytes": 42941,
    "sha256": "1bbc36bd93fa29f3cece08a11dbd24b69e31e2e358d79d67248880276c6c06cb"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02185010_2022_2023.json",
    "bytes": 55880,
    "sha256": "a7def4a665b0e142d26d5347352cef6d4d8075d7e0653306c1108f71902054c7"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02185010_2024_2025.json",
    "bytes": 56401,
    "sha256": "c3e8bb20bc350a837fca318981ab6430d46d5a2aa25071dfa98b15718ab9e8db"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02186000_2020_2021.json",
    "bytes": 55442,
    "sha256": "11b593a97242ec33540918885c25455a2d0f1d51b3549c5d87d22a47044b1723"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02186000_2022_2023.json",
    "bytes": 55624,
    "sha256": "e70ad3b7bdf58f0dfe283b2b93bde3584ba51344d545fe013208edc651f14783"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02186000_2024_2025.json",
    "bytes": 55880,
    "sha256": "803f1c5a3af7b57434c1fbb671c098ed0abcb681e05fbd25a179f1c80e9ef751"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02186645_2020_2021.json",
    "bytes": 2442,
    "sha256": "4af67973f7a8cdde1a6c2056cfe79995cf7e0337b28aaa6cd58ae11e7d5e2e14"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02186645_2022_2023.json",
    "bytes": 19939,
    "sha256": "480a6a503ed916e739dbf5d68f233cf1488590ee5af86e7bb96a3bad124584f9"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02186645_2024_2025.json",
    "bytes": 55934,
    "sha256": "17fd8028a244bf4ebe0480d65079f087ab29fc88eebb24396841aa5241d614e9"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02186702_2020_2020.json",
    "bytes": 29226,
    "sha256": "9e2e9bb3ea640d84bca1b1cf1a90b1073ec5506f58461cf8012330dfad4fbd4c"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02186702_2021_2021.json",
    "bytes": 29353,
    "sha256": "8fb74ba84877b38995350ecd4120c8437ada515893d12af7d52d6d93a23bc933"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02186702_2022_2022.json",
    "bytes": 29216,
    "sha256": "8428422778feb5b07534db9b49f55ec4eab19b1297451b8a82ff41b094e07b32"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02186702_2023_2023.json",
    "bytes": 29226,
    "sha256": "973897d3813100b498482b4acf88ba705da50dcf6e28baea5fe7fe818e76d3f9"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02186702_2024_2024.json",
    "bytes": 29295,
    "sha256": "03f7561b6e5a41948e97934a74c300645ba70f10b574148b56050115e4e98650"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02186702_2025_2025.json",
    "bytes": 29522,
    "sha256": "2247249df5fe769f9cec48479e61646d0b3fd5d90398c46a9ad4f35099bb848e"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02187910_2020_2021.json",
    "bytes": 56094,
    "sha256": "915bfbb45a13b9b4b66e0bb251a40e823ad8e2ee39bb62fdcb0251446fff53f3"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02187910_2022_2023.json",
    "bytes": 55791,
    "sha256": "5371e44939230f8f62e8f2c38eb529e3865831d1c520ad02b54e68a1e892ab70"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02187910_2024_2025.json",
    "bytes": 56514,
    "sha256": "17c5470800a2f70280bc8231d8b6ae68f3dacbe867c1954ae973256879691895"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02188600_2020_2021.json",
    "bytes": 55927,
    "sha256": "08735af3e5de4fbdbfb1d562fb2fef86f6e606a9054faddd74e41c90221ed032"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02188600_2022_2023.json",
    "bytes": 56114,
    "sha256": "5bc4b297173f08e4e529faa0dd845c40372b6d75bc8bd58a9975ac8299677b81"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02188600_2024_2025.json",
    "bytes": 56178,
    "sha256": "f8e9c8893f4cb2050342d8c16a7c45f730d831ba6925d8ebda543bc72cce92e2"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02191227_2020_2021.json",
    "bytes": 55965,
    "sha256": "8f7de521d23c02269168950dba482e3103e03768ff5937aeb912ac502e37c756"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02191227_2022_2023.json",
    "bytes": 55913,
    "sha256": "e3650eae08d0c591a89a35dc0a17652d219561fa9941ed59445ef08f0a1c4b36"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02191227_2024_2025.json",
    "bytes": 56054,
    "sha256": "7b0e470c59dada23c2a3bd736a11e8789dc2228d993b64a0d492104f7f2c6bfa"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02191300_2020_2021.json",
    "bytes": 55540,
    "sha256": "c3c96f66a841e9b49ae2edc0de805e5319d4a9d8d67fb83f4f13e952a0bb3fc3"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02191300_2022_2023.json",
    "bytes": 55518,
    "sha256": "a2d5727d2c80c5e76229149a8404e8175e3b330d81397441fcae6a18ff465631"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02191300_2024_2025.json",
    "bytes": 55383,
    "sha256": "db483fa220aa0b7315475f3335075b45428564cd2ce5a16f1b9e6df3a3317bc4"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02192000_2020_2021.json",
    "bytes": 56009,
    "sha256": "bf847ef6120559dfd7b03e28ec862c6b23713f12213c8fab4b494f2c019872e2"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02192000_2022_2023.json",
    "bytes": 55553,
    "sha256": "b49261c25aeba2dd3ed2ead185d5d5568b1b75658ca608cd8461cb11b5c2c9da"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02192000_2024_2025.json",
    "bytes": 55577,
    "sha256": "2b6e880259b2d2242df9b1df4a2a9b66b20b601664cac5b9c9284691fa1aa89f"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02192500_2020_2021.json",
    "bytes": 55506,
    "sha256": "f9100025aa603ac2bc3a80af34c1195e84063081fc7d8cfd0cd957813cc46ce6"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02192500_2022_2023.json",
    "bytes": 55605,
    "sha256": "f46e28faf8e2ff9bbcf6d07da34f159f3eab4ed125d6493922b9df012252c698"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/daily/usgs_02192500_2024_2025.json",
    "bytes": 55734,
    "sha256": "5e82a1967c2f3c5163f4883c5c9a54a64f4956bdc9ab64a7cec467db22541073"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/eighteenmile_nldi_reference.json",
    "bytes": 601,
    "sha256": "4ba9c663f4734dae1216d99564d9ae2392e7e139b5208aeaa174fa63489cb0c8"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/eighteenmile_nldi_whole_basin.geojson",
    "bytes": 13935,
    "sha256": "097050d2b09e371feb2dbcf3fe1d2fba90730086db45d4a90be514706145dc88"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/eighteenmile_station_metadata.json",
    "bytes": 3671,
    "sha256": "24585cb3c63a1e92e38e371d3741628abd8cb7f8e08a8a84f205e35e0c407a56"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/nutrients/wqp_SV-268_2023.csv",
    "bytes": 19192,
    "sha256": "bcd93081e98fc9c9abdda3b920a1020052b6d56a60e6c3cb202d99bd36ad6400"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/nutrients/wqp_SV-374_2023.csv",
    "bytes": 19783,
    "sha256": "9ee56281988e39171afac146d08f3c28df87c6f1a771d01cb8e61d7d89d900ed"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/nutrients/wqp_SV-838_2023.csv",
    "bytes": 1754,
    "sha256": "86a29ee0c9323c0dec6b90ee30afffe5c8a0ba4853ff6dc8d350f54430e3450f"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/nutrients/wqp_SV-839_2023.csv",
    "bytes": 1754,
    "sha256": "86a29ee0c9323c0dec6b90ee30afffe5c8a0ba4853ff6dc8d350f54430e3450f"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/nutrients/wqp_SV-840_2023.csv",
    "bytes": 1754,
    "sha256": "86a29ee0c9323c0dec6b90ee30afffe5c8a0ba4853ff6dc8d350f54430e3450f"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/series_seneca_tugaloo.rdb",
    "bytes": 10347,
    "sha256": "cc8866b8fd3a5a224346b1b1696b16c0673d76d616e9ee67f05be48f482c9707"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/series_upper_savannah_broad.rdb",
    "bytes": 7811,
    "sha256": "c22ce4ce0219d11366d256cea880526ec01627f599e9ea35abbc49b54ddb4fbb"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/sites_seneca_tugaloo.rdb",
    "bytes": 9026,
    "sha256": "c32e2e296a92464471a09a4c5275af31252d99782be2b3cc68757e6425834f32"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/sites_upper_savannah_broad.rdb",
    "bytes": 12446,
    "sha256": "df6fdf7ffc31001e93dc739c4989c233c136c75ce02ebda269943c9bfef5c994"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/usgs_daily_queryables.json",
    "bytes": 19821,
    "sha256": "574b3d93e2d64f1d861b798a626b900d72dc414e59d3d0a0c3a1c226226ea637"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/usgs_nldi_basin_method.html",
    "bytes": 4962,
    "sha256": "3eea0f5fa49dc48e1b650adad82daa06ce0f6daf7a319b2c3de7efed4c9ca2de"
  },
  {
    "path": "observations/observed_hydrology_20261013/original/usgs_series_queryables.json",
    "bytes": 9747,
    "sha256": "3c635ccc35cdc40c1b5f843583655b6931e6610474ab2796ae3e1ed43a50fe03"
  },
  {
    "path": "observations/observed_hydrology_20261013/README.md",
    "bytes": 11469,
    "sha256": "60a439ab4f0d14aea8e3e38f719c60e6f877e218f83bf442142491588318ad4d"
  },
  {
    "path": "observations/observed_hydrology_20261013/rebuild_hydrology.mjs",
    "bytes": 2411,
    "sha256": "19ecc87b71a3e74c4ee714015e0885cd0d62a4570e1ff61fd60d9a88160354bc"
  }
];

export function buildRoutineSections(result){
 const num=value=>{const n=Number(value);if(!Number.isFinite(n))throw Error("Nonfinite retained concentration");return n.toFixed(6).replace(/0+$/,"").replace(/\.$/,"");};
 const enclosure=(lo,hi)=>Number(lo)===Number(hi)?num(lo):num(lo)+"–"+num(hi);
 const all=result.contrasts.filter(row=>row.flow_group==="ALL");
 const bands=result.contrasts.filter(row=>["Phosphorus","Total nitrogen (TKN + NOx)"].includes(row.parameter)&&/^Q[1-4]$/.test(row.flow_group));
 const shared=result.sameDate, event=result.event;
 if(all.length!==5||bands.length!==8||shared.length!==5||event.length!==5)throw Error("Retained nutrient contrast layout differs");
 return [
 ["Routine nutrient observations: original visits and censor bounds",[
  "This section uses the original 2023 SWS-2023 routine nutrient cohort at SV-268 and SV-374: 96 reported results in 24 source activities, with 12 visits at each station. Twenty-four total-nitrogen values combine Kjeldahl nitrogen and nitrate plus nitrite within the same source activity, date, fraction, project and sample clock. Ammonia remains part of Kjeldahl nitrogen and is not added again. The 120 calculated value rows comprise those 96 original results and 24 within-activity sums.",
  "Each reported below-limit result retains a conservative nonnegative concentration enclosure and its original strict relation. Mean lower and upper endpoints use every selected visit and the same denominator; no half-limit value or zero-valued measurement is substituted. These enclosures describe retained measurement limits, rather than statistical confidence intervals.",
  {kind:"table",columns:["Constituent","SV-268 mean enclosure (mg/L)","SV-374 mean enclosure (mg/L)","SV-268 minus SV-374 (mg/L)","Visits at each site"],rows:all.map(row=>[row.parameter,enclosure(row.mean_a_lower_mg_l,row.mean_a_upper_mg_l),enclosure(row.mean_b_lower_mg_l,row.mean_b_upper_mg_l),enclosure(row.difference_a_minus_b_lower_mg_l,row.difference_a_minus_b_upper_mg_l),String(row.visits_a)+" / "+String(row.visits_b)]),caption:"All original routine visits; the station date sets differ. Full-precision values, activity identities and original source rows accompany the report.",widths:[1.4,1.4,1.4,1.4,.7]},
  "The routine nutrient cohort and the separate special-study chlorophyll campaign retain their own dates, depths and programme identities. Their counts are presented separately throughout the source tables."
 ]],
 ["Routine nutrient contrasts within observed flow bands",[
  "The complete 365-day approved record at upstream gauge USGS 02186702 defines discharge quartile boundaries of 30.6, 53.9 and 75.3 ft³/s. Q1 includes values at or below the first boundary; Q2 and Q3 exclude their lower boundary and include their upper boundary; Q4 contains values above 75.3 ft³/s. Each original routine visit is assigned its same-calendar-day gauge mean.",
  {kind:"table",columns:["Constituent","Flow band","SV-268 visits","SV-374 visits","SV-268 mean enclosure (mg/L)","SV-374 mean enclosure (mg/L)"],rows:bands.map(row=>[row.parameter,row.flow_group,String(row.visits_a),String(row.visits_b),enclosure(row.mean_a_lower_mg_l,row.mean_a_upper_mg_l),enclosure(row.mean_b_lower_mg_l,row.mean_b_upper_mg_l)]),caption:"Descriptive, unmatched visit groups with two to five visits per station/band. Flow bands retain the actual gauge-day context; they do not establish matching water parcels or hydraulic travel time.",widths:[1.6,.6,.7,.7,1.4,1.4]},
  "The phosphorus and within-activity total-nitrogen mean enclosures remain separated between these stations in all four observed-flow bands. Interpreting transport, retention or annual nutrient load requires the relevant outlet geometry, concentration coverage and flow-weighting method."
 ]],
 ["Same-date routine measurements and the June 12 event",[
  "May 17 is the sole calendar date shared by the two routine station cohorts. The original SV-268 activity began 13:39 EDT and SV-374 began 11:32 EDT; the upstream gauge daily mean was 64.7 ft³/s. The table retains this timing difference.",
  {kind:"table",columns:["Constituent","SV-268 (mg/L)","SV-374 (mg/L)","SV-268 minus SV-374 (mg/L)"],rows:shared.map(row=>[row.parameter,enclosure(row.lower_a_mg_l,row.upper_a_mg_l),enclosure(row.lower_b_mg_l,row.upper_b_mg_l),enclosure(row.difference_lower_mg_l,row.difference_upper_mg_l)]),caption:"2023-05-17 source activities AF02075 and AF02069; full original activity prefixes and source-result IDs are retained in same_date.csv.",widths:[1.7,1.4,1.4,1.6]},
  "The June 12 SV-268 activity AF03778 coincided with a 604 ft³/s gauge daily mean, at the 99.315th midrank percentile of the year's daily values. Its constituent contrasts are calculated against the other 11 routine visits at that station, all below the annual gauge 95th percentile.",
  {kind:"table",columns:["Constituent","June 12 concentration (mg/L)","Other 11 visits' mean enclosure (mg/L)","June 12 minus comparison (mg/L)"],rows:event.map(row=>[row.parameter,enclosure(row.event_lower_mg_l,row.event_upper_mg_l),enclosure(row.comparison_mean_lower_mg_l,row.comparison_mean_upper_mg_l),enclosure(row.event_minus_comparison_lower_mg_l,row.event_minus_comparison_upper_mg_l)]),caption:"Constituents respond differently: event phosphorus was 0.180 mg/L, while within-activity total nitrogen was 0.660 mg/L. Comparison dates, source activities and original strict bounds travel with june12_contrast.csv.",widths:[1.7,1.4,1.7,1.6]}
 ]],
 ["Routine nutrient source files",[{kind:"links",items:[
  ["All 120 source-bound concentration intervals","dated_values.csv"],
  ["Original 24-activity sampling calendar","sampling_calendar.csv"],
  ["Station and flow-band summaries","station_flow_summary.csv"],
  ["Unmatched station contrasts","station_contrasts.csv"],
  ["Original same-date contrasts","same_date.csv"],
  ["June 12 constituent contrasts","june12_contrast.csv"],
  ["Calculation methods and cohort definitions","methods.json"]
 ].map(([title,name])=>({title,path:"observations/observed_hydrology_20261013/nutrient_flow_contrasts/"+name}))}]]
 ];
}

export function composeRoutineContext({files,reportRecipeText,reportManifestText},hash){
 const bytes=value=>unescape(encodeURIComponent(value)).length;
 const index=new Map(files.map(file=>[file.path,file]));
 for(const expected of ORIGINAL_NUTRIENT_FLOW_INPUTS){
  const actual=index.get(expected.path);
  if(!actual||bytes(actual.content)!==expected.bytes||hash(actual.content)!==expected.sha256)throw Error("Original source differs: "+expected.path);
 }
 const prefix="observations/observed_hydrology_20261013/nutrient_flow_contrasts/";
 const originalManifest=JSON.parse(index.get(prefix+"model-sources.json").content);
 const sourceInputs=JSON.parse(index.get(prefix+"inputs.json").content);
 const values={};
 for(const input of sourceInputs.inputs)values[input.path]=index.get(sourceInputs.root+"/"+input.path).content;
 const result=compute(values);
 for(const[name,content]of Object.entries(result.files)){
  if(content!==index.get(prefix+name).content)throw Error("Original computation differs: "+name);
 }
 const allMembers=ORIGINAL_NUTRIENT_FLOW_INPUTS.map(item=>({...item}));
 const native={...originalManifest,title:"Routine nutrient observations and flow: complete retained source",entries:originalManifest.entries.map(entry=>({
  ...entry,path:prefix+entry.path,companions:allMembers.filter(item=>item.path!==prefix+entry.path),
  metadata:{...entry.metadata,source_scope:"Original 96 routine results, 24 within-activity TN sums and retained original hydrology source inputs"}
 }))};
 const nativePath="eighteenmile_routine_nutrient_flow.sources.json";
 const nativeContent=JSON.stringify(native,null,2)+"\n";
 const sections=buildRoutineSections(result);
 const sectionPath=prefix+"report-sections.json";
 const sectionContent=JSON.stringify({schema:"upstate.observed-report-sections/v1",edition:"routine-nutrient-flow-20261013-v1",sections,source_manifest:nativePath,source_cohort:{original_results:96,original_activities:24,calculated_value_rows:120}},null,2)+"\n";
 const generated=[{path:nativePath,content:nativeContent},{path:sectionPath,content:sectionContent}].map(file=>({...file,bytes:bytes(file.content),sha256:hash(file.content)}));
 const recipe=JSON.parse(reportRecipeText),manifest=JSON.parse(reportManifestText);
 if(recipe.schema!=="upstate.observed-report/v1"||manifest.schema!=="upstate.sources/v1")throw Error("Select the maintained observed report recipe and source manifest");
 const selected=manifest.entries.filter(entry=>entry.metadata?.report_schema==="upstate.observed-report/v1");
 if(selected.length!==1)throw Error("Select one maintained observed report source");
 const entry=selected[0];
 if(entry.bytes!==bytes(reportRecipeText)||entry.sha256!==hash(reportRecipeText))throw Error("Maintained recipe differs from its source manifest");
 const keys=new Set(sections.map(section=>section[0]));
 for(const existing of recipe.sections.filter(section=>keys.has(section[0]))){
  if(JSON.stringify(existing)!==JSON.stringify(sections.find(section=>section[0]===existing[0])))throw Error("An existing routine section differs: "+existing[0]);
 }
 recipe.sections=[...recipe.sections.filter(section=>!keys.has(section[0])),...sections];
 function union(existing,additional){
  const union=new Map(existing.map(item=>[item.path,item]));
  for(const item of additional){
   const before=union.get(item.path);
   if(before&&(before.bytes!==item.bytes||before.sha256!==item.sha256))throw Error("Retained report member differs: "+item.path);
   if(!before)union.set(item.path,{path:item.path,bytes:item.bytes,sha256:item.sha256});
  }
  return [...union.values()].sort((a,b)=>a.path.localeCompare(b.path));
 }
 const additions=[...allMembers,...generated];
 recipe.inputs=union(recipe.inputs||[],additions);
 recipe.source_links=[...new Set([...(recipe.source_links||[]),...sections.at(-1)[1][0].items.map(item=>item.path),nativePath])];
 recipe.routine_nutrient_context={edition:"routine-nutrient-flow-20261013-v1",original_results:96,original_activities:24,calculated_value_rows:120};
 const recipeContent=JSON.stringify(recipe,null,2)+"\n";
 entry.bytes=bytes(recipeContent);entry.sha256=hash(recipeContent);
 entry.companions=union(entry.companions||[],additions);
 entry.metadata={...entry.metadata,routine_nutrient_result_rows:96,routine_nutrient_activities:24,routine_nutrient_value_rows:120};
 return {files:[...generated,{path:entry.path,content:recipeContent,bytes:entry.bytes,sha256:entry.sha256},{path:"observed_hydrology_context.sources.json",content:JSON.stringify(manifest,null,2)+"\n"}],reproduced_files:Object.keys(result.files),original_source_files:allMembers.length,native_source_entries:native.entries.length,sections_added:sections.length};
}
