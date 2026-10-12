// MIT. Supplier projection checks and explicitly selected ETIM BMEcat export.
// Pure data transformation; the submission workspace owns original sources and reviews.

export const PROFILE_ID = 'sonepar-pdx-2026.04-3.1_etim-bmecat-5.0';
export const PROFILE_SOURCE = freeze({
  "sonepar": {
    "title": "Sonepar Product Data Guidelines",
    "edition": "3.1",
    "documentCode": "PDx_2026.04_3.1",
    "date": "2026-04",
    "url": "https://www.sonepar.com/resource/blob/85322/d6950a910363f19c4fdc060017186082/sonepar-product-data-guidelines-data.pdf",
    "bytes": 13672702,
    "sha256": "63dd77f1ac6688d54db171fd8f2fe4852207fede1bfa6978fe7a2ea5d524e65d",
    "retrievedAt": "2026-10-12T05:00:15Z"
  },
  "etim": {
    "title": "ETIM BMEcat Guideline V5.0",
    "documentDate": "2021-06-30",
    "url": "https://etim.ch/de/downloads/downloads/2-bmecat?download=12:etim-bmecat-guideline-v5-0-en",
    "pages": 204,
    "currentSchemaBundleLabel": "ETIM-BMEcat-Guideline-V5-0-2-2024-12-12.zip",
    "currentSchemaBundleLanding": "https://www.etim-international.com/downloads/",
    "schemaArchiveUrl": "https://www.etim-international.com/wp-content/uploads/2021/09/ETIM-BMEcat-Guideline-V5-0-2-2024-12-12.zip",
    "schemaArchiveBytes": 3242056,
    "schemaArchiveSha256": "aa0fdcfae703005eeeebfe542f877b4167c4e4b04594f2095fc105364d224de4",
    "schemaFile": "bmecat_etim_501.xsd",
    "schemaBytes": 99041,
    "schemaSha256": "821e4dbcec9fa32b64df4298531adc5d3cdab68507686317dd08e8266378b005"
  }
});
const S = PROFILE_SOURCE.sonepar.url, E = PROFILE_SOURCE.etim.url;
const CATEGORY_ASSETS = freeze({"hvac":{"MD12":"required","MD20":"when_applicable","MD23":"when_applicable","MD24":"when_applicable","MD25":"required_for_core","MD26":"when_applicable","MD27":"when_applicable","MD28":"when_applicable","MD29":"when_applicable","MD30":"when_applicable","MD34":"required_for_core","MD60":"required_for_core"},"household_appliances":{"MD12":"when_applicable","MD20":"required_for_core","MD23":"required_for_core","MD24":"required_for_core","MD25":"required_for_core","MD26":"required_for_core","MD27":"required_for_core","MD28":"required_for_core","MD29":"required_for_core","MD30":"required_for_core","MD34":"when_applicable","MD60":"when_applicable"},"sanitary":{"MD12":"required","MD20":"required_for_core","MD23":"required_for_core","MD24":"required_for_core","MD25":"required_for_core","MD26":"required_for_core","MD27":"required_for_core","MD28":"required_for_core","MD29":"required_for_core","MD30":"required_for_core","MD34":"when_applicable","MD60":"required_for_core"},"power_distribution":{"MD12":"required","MD20":"when_applicable","MD23":"when_applicable","MD24":"when_applicable","MD25":"required_for_core","MD26":"when_applicable","MD27":"when_applicable","MD28":"when_applicable","MD29":"when_applicable","MD30":"when_applicable","MD34":"required_for_core","MD60":"required_for_core"},"industrial_software":{"MD12":"not_applicable","MD20":"not_applicable","MD23":"not_applicable","MD24":"not_applicable","MD25":"not_applicable","MD26":"not_applicable","MD27":"not_applicable","MD28":"not_applicable","MD29":"not_applicable","MD30":"not_applicable","MD34":"not_applicable","MD60":"not_applicable"},"industrial_automation":{"MD12":"required","MD20":"when_applicable","MD23":"when_applicable","MD24":"when_applicable","MD25":"required_for_core","MD26":"when_applicable","MD27":"when_applicable","MD28":"when_applicable","MD29":"when_applicable","MD30":"when_applicable","MD34":"required_for_core","MD60":"required_for_core"},"building_automation_construction":{"MD12":"required","MD20":"when_applicable","MD23":"when_applicable","MD24":"when_applicable","MD25":"required_for_core","MD26":"when_applicable","MD27":"when_applicable","MD28":"when_applicable","MD29":"when_applicable","MD30":"when_applicable","MD34":"required_for_core","MD60":"required_for_core"},"photovoltaic":{"MD12":"required","MD20":"when_applicable","MD23":"when_applicable","MD24":"when_applicable","MD25":"required_for_core","MD26":"when_applicable","MD27":"when_applicable","MD28":"when_applicable","MD29":"when_applicable","MD30":"when_applicable","MD34":"when_applicable","MD60":"required_for_core"},"inverters":{"MD12":"required","MD20":"when_applicable","MD23":"when_applicable","MD24":"when_applicable","MD25":"required_for_core","MD26":"when_applicable","MD27":"when_applicable","MD28":"when_applicable","MD29":"when_applicable","MD30":"when_applicable","MD34":"when_applicable","MD60":"required_for_core"},"solar_energy_storage":{"MD12":"required","MD20":"when_applicable","MD23":"when_applicable","MD24":"when_applicable","MD25":"required_for_core","MD26":"when_applicable","MD27":"when_applicable","MD28":"when_applicable","MD29":"when_applicable","MD30":"when_applicable","MD34":"when_applicable","MD60":"required_for_core"},"renewable_other":{"MD12":"when_applicable","MD20":"when_applicable","MD23":"when_applicable","MD24":"when_applicable","MD25":"when_applicable","MD26":"when_applicable","MD27":"when_applicable","MD28":"when_applicable","MD29":"when_applicable","MD30":"when_applicable","MD34":"when_applicable","MD60":"when_applicable"},"luminaires":{"MD12":"required","MD15":"when_applicable","MD16":"when_applicable","MD19":"when_applicable","MD20":"required_for_core","MD23":"required_for_core","MD24":"required_for_core","MD25":"required_for_core","MD26":"required_for_core","MD27":"required_for_core","MD28":"required_for_core","MD29":"required_for_core","MD30":"required_for_core","MD34":"required_for_core","MD60":"required_for_core"},"lamps":{"MD12":"required","MD15":"when_applicable","MD16":"required","MD19":"when_applicable","MD20":"required_for_core","MD23":"required_for_core","MD24":"required_for_core","MD25":"required_for_core","MD26":"required_for_core","MD27":"required_for_core","MD28":"required_for_core","MD29":"required_for_core","MD30":"required_for_core","MD34":"when_applicable","MD60":"when_applicable"},"lighting_other":{"MD12":"when_applicable","MD15":"not_applicable","MD16":"not_applicable","MD19":"not_applicable","MD20":"when_applicable","MD23":"when_applicable","MD24":"when_applicable","MD25":"when_applicable","MD26":"when_applicable","MD27":"when_applicable","MD28":"when_applicable","MD29":"when_applicable","MD30":"when_applicable","MD34":"when_applicable","MD60":"when_applicable"},"cables_wires":{"MD12":"when_applicable","MD20":"when_applicable","MD23":"when_applicable","MD24":"when_applicable","MD25":"required_for_core","MD26":"when_applicable","MD27":"when_applicable","MD28":"when_applicable","MD29":"when_applicable","MD30":"when_applicable","MD34":"not_applicable","MD60":"when_applicable"},"safety_tools_engineering_supplies":{"MD12":"required_for_core","MD20":"required_for_core","MD23":"required_for_core","MD24":"required_for_core","MD25":"required_for_core","MD26":"required_for_core","MD27":"required_for_core","MD28":"required_for_core","MD29":"required_for_core","MD30":"required_for_core","MD34":"when_applicable","MD60":"when_applicable"},"other_product_service":{"MD12":"when_applicable","MD20":"when_applicable","MD23":"when_applicable","MD24":"when_applicable","MD25":"when_applicable","MD26":"when_applicable","MD27":"when_applicable","MD28":"when_applicable","MD29":"when_applicable","MD30":"when_applicable","MD34":"when_applicable","MD60":"when_applicable"}});
const SOURCE_ASSETS = freeze({"globalRequired":["MD01","MD22","MD54"],"conditional":["MD03","MD43","MD06","MD07","MD49","MD52","MD05","MD11","MD42","MD50","MD51","MD55","MD08","MD56"],"images":["MD01","MD02","MD12","MD20","MD23","MD24","MD25","MD26","MD27","MD28","MD29","MD30","MD47","MD59","MD60","MD62","MD64"],"imageExtensions":["jpg","jpeg","tif","tiff","png","webp","bmp"],"documents":["MD15","MD16","MD19","MD21","MD22","MD31","MD32","MD33","MD34","MD35","MD03","MD05","MD06","MD07","MD08","MD09","MD10","MD11","MD13","MD14","MD38","MD40","MD41","MD42","MD43","MD44","MD48","MD49","MD50","MD51","MD52","MD53","MD54","MD55","MD56","MD61","MD63","MD65"],"logos":["MD17","MD18"],"videos":["MD39","MD45","MD57","MD58"],"packaging":["BE","BG","BO","BX","C62","CA","CL","CQ","CR","CS","CT","CY","D99","DR","EV","KG","NE","PA","PF","PK","PL","PR","PU","RG","RL","RO","SA","SET","TN","TU","WR","Z2","Z3"]});
const BASE_PROFILE = freeze({
  "schema": "stellar-forge.supplier-profile.v1",
  "id": "sonepar-pdx-2026.04-3.1_etim-bmecat-5.0",
  "targets": [
    "sonepar",
    "bmecat-5.0"
  ],
  "languages": [
    "eng"
  ],
  "defaultLanguage": "eng",
  "countries": [],
  "officialLanguages": {},
  "role": "manufacturer",
  "channels": [],
  "category": null,
  "segment": "longtail",
  "requireVeryShort": false,
  "applicableAssetCodes": [],
  "applicableCoreManualCodes": [],
  "applicableCoreVideo": false,
  "applicableCoreAdditionalCodes": [],
  "seriesApplicable": null,
  "typeApplicable": null,
  "genericAccessory": false,
  "etim": {
    "version": null,
    "classes": [],
    "source": null
  },
  "envelope": {
    "transaction": "T_NEW_CATALOG",
    "catalogId": "",
    "catalogVersion": "",
    "catalogName": "",
    "generationDate": "",
    "buyer": {
      "name": "",
      "id": "",
      "idType": ""
    },
    "supplier": {
      "name": "",
      "id": "",
      "idType": ""
    },
    "currency": "",
    "mimeRoot": "",
    "previousVersion": null,
    "receiverAccepted": false,
    "subsetAgreed": false
  },
  "conversions": {
    "allowExactUnitConversion": false,
    "allowNetOrderBasisConversion": false
  },
  "localRules": []
});
const TEMPLATE = freeze({
  "supplierProductId": "",
  "manufacturerProductId": "",
  "productGtin": "",
  "manufacturerName": "",
  "manufacturerTypeDescription": "",
  "alternativeSupplierId": "",
  "brand": "",
  "series": [],
  "types": [],
  "descriptions": {
    "eng": {
      "veryShort": "",
      "short": "",
      "long": "",
      "titleProposal": ""
    }
  },
  "category": "",
  "segment": "longtail",
  "expiresAt": "",
  "branchNumbers": [],
  "branchSupplierIds": [],
  "classification": {
    "etim": {
      "version": "",
      "classId": "",
      "features": []
    },
    "unspsc": {
      "version": "",
      "code": ""
    },
    "eclass": {
      "version": "",
      "code": ""
    }
  },
  "customsTariff": "",
  "discountGroup": {
    "supplier": "",
    "manufacturer": ""
  },
  "order": {
    "unit": "",
    "contentUnit": "",
    "contentUnitsPerOrderUnit": "",
    "priceQuantity": "",
    "minimum": "",
    "interval": ""
  },
  "prices": [],
  "net": {
    "basis": "",
    "productsPerOrderUnit": "",
    "length": {
      "value": "",
      "unit": ""
    },
    "width": {
      "value": "",
      "unit": ""
    },
    "depth": {
      "value": "",
      "unit": ""
    },
    "diameter": {
      "value": "",
      "unit": ""
    },
    "weight": {
      "value": "",
      "unit": ""
    },
    "volume": {
      "value": "",
      "unit": ""
    }
  },
  "packaging": [],
  "deliveryTime": {
    "value": "",
    "basis": ""
  },
  "warranty": {
    "businessMonths": "",
    "consumerMonths": ""
  },
  "assets": [],
  "relations": [],
  "variants": [],
  "applicability": {
    "series": null,
    "types": null,
    "genericAccessory": null,
    "assetCodes": [],
    "coreManualCodes": [],
    "coreVideo": null,
    "coreAdditionalCodes": []
  }
});


const TARGETS = ['sonepar', 'bmecat-5.0'];
const LANG = /^[a-z]{3}$/, COUNTRY = /^[A-Z]{2}$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
// Exact enumerations from bmecat_etim_501.xsd, original 5.0.2 archive.
const ORDER_UNITS = new Set("ANN BE BG BO BX C62 CA CL CMK CMQ CMT CQ CR CS CT D99 DAY DR GRM HUR KG KGM KTM LTR MGM MLT MMK MMT MMQ MTR MTK MTQ PA PF PK PL PR PU RG RL RO SA SEC SET ST TN TNE TU WEE Z2 Z3".split(' '));
const ETIM_PACKING_UNITS = new Set("BE BG BO BX C62 CA CL CQ CR CS CT CY D99 DR EV KG NE PA PF PK PL PR PU RG RL RO SA SET TN TU WR Z2 Z3".split(' '));
const ETIM_PACKING_NAMES = new Set(["f-pak","m-pak","d-pak","t-pak","Bas","Mellan","Topp"]);
const ETIM_ASSET_CODES = new Set("MD01 MD02 MD03 MD04 MD05 MD06 MD07 MD08 MD09 MD10 MD11 MD12 MD13 MD14 MD15 MD16 MD17 MD18 MD19 MD20 MD21 MD22 MD23 MD24 MD25 MD26 MD27 MD28 MD29 MD30 MD31 MD32 MD33 MD34 MD35 MD37 MD38 MD39 MD40 MD41 MD42 MD43 MD44 MD45 MD46 MD47 MD48 MD49 MD50 MD51 MD52 MD53 MD54 MD55 MD56 MD57 MD58 MD59 MD60 MD61 MD62 MD63 MD64 MD65 MD99".split(' '));
const ETIM_LANGUAGES = new Set("aar abk ace ach ada afa afh afr aka akk alb ale alg amh ang apa ara arc arm arn arp art arw asm ath aus ava ave awa aym aze bad bai bak bal bam ban baq bas bat bej bel bem ben ber bho bih bik bin bis bla bnt bod bos bra bre btk bua bug bul bur cad cai car cat cau ceb cel ces cha chb che chg chi chk chm chn cho chp chr chu chv chy cmc cop cor cos cpe cpf cpp cre crp cus cym cze dak dan day del den deu dgr din div doi dra dua dum dut dyu dzo efi egy eka ell elx eng enm epo est eus ewe ewo fan fao fas fat fij fin fiu fon fra fre frm fro fry ful fur gaa gay gba gem geo ger gez gil gla gle glg glv gmh goh gon gor got grb grc gre grn guj gwi hai hau haw heb her hil him hin hit hmn hmo hrv hun hup hye iba ibo ice ijo iku ile ilo ina inc ind ine ipk ira iro isl ita jav jpn jpr jrb kaa kab kac kal kam kan kar kas kat kau kaw kaz kha khi khm kho kik kin kir kmb kok kom kon kor kos kpe kro kru kua kum kur kut lad lah lam lao lat lav lez lin lit lol loz ltz lua lub lug lui lun luo lus mac mad mag mah mai mak mal man mao map mar mas may mdr men mga mic min mis mkd mkh mlg mlt mnc mni mno moh mol mon mos mri msa mul mun mus mwr mya myn nah nai nau nav nbl nde ndo nds nep new nia nic niu nld nno nob non nor nso nub nya nym nyn nyo nzi oci oji ori orm osa oss ota oto paa pag pal pam pan pap pau peo per phi phn pli pol pon por pra pro pus qaa que raj rap rar roa roh rom ron rum run rus sad sag sah sai sal sam san sas sat scc sco scr sel sem sga sgn shn sid sin sio sit sla slk slo slv sme smi smo sna snd snk sog som son sot spa sqi srd srp srr ssa ssw suk sun sus sux swa swe syr tah tai tam tat tel tem ter tet tgk tgl tha tib tig tir tiv tkl tli tmh tog ton tpi tsi tsn tso tuk tum tur tut tvl twi tyv uga uig ukr umb und urd uzb vai ven vie vol vot wak wal war was wel wen wln wol xho yao yap yid yor ypk zap zen zha zho znd zul".split(' '));
const ETIM_CURRENCIES = new Set("ADP AED AFA AFN ALL AMD ANG AOA AOK ARA ARS ATS AUD AWG AZN BAM BBD BDT BEF BGL BGN BHD BIF BMD BND BOB BOV BRC BRL BSD BTN BUK BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CSK CUC CUP CVE CYP CZK DDM DEM DJF DKK DOP DZD ECS EGP ERN ESP ETB EUR FIM FJD FKP FRF GBP GEL GHC GHS GIP GMD GNF GRD GTQ GWP GYD HKD HNL HRK HTG HUF IDR IEP ILS INR IQD IRR ISK ITL JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LUF LYD MAD MDL MGA MGF MKD MMK MNT MOP MRO MRU MTL MUR MVR MWK MXN MXP MXV MYR MZM MZN NAD NGN NIC NIO NLG NOK NPR NZD OMR PAB PEI PEN PGK PHP PKR PLZ PLN PTE PYG QAR ROL RON RSD RUB RWF SAR SBD SCR SDG SDP SEK SGD SHP SLL SKK SOS SRD SRG SSP STD STN SUR SVC SYP SZL THB TJS TMT TND TOP TPE TRL TRY TTD TWD TZS UAH UGS UGX USD USN UYI UYP UYU UYW UZS VEB VES VND VUV WST XAF XAG XAU XBA XBB XBC XBD XCD XDR XOF XPD XPF XPT XSU XTS XUA XXX YDD YER YUD ZAR ZMK ZMW ZRZ ZWD ZWL".split(' '));
const ETIM_COUNTRIES = new Set("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(' '));
const etimTerritory = value => typeof value==='string' && /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/.test(value) && ETIM_COUNTRIES.has(value.slice(0,2));
const RELATIONS = freeze({successor:'followup', accessory:'accessories', similar:'similar', sparePart:'sparepart', prerequisiteOne:'mandatory', prerequisiteChoice:'select', accessories:'accessories', base_product:'base_product', consists_of:'consists_of', followup:'followup', mandatory:'mandatory', select:'select', sparepart:'sparepart', others:'others'});
const DIMENSIONS = ['length','width','depth','diameter','weight','volume'];
const UNIT_SCALE = freeze({MMT:['length',-3], CMT:['length',-2], MTR:['length',0], KTM:['length',3], MGM:['weight',-6], GRM:['weight',-3], KGM:['weight',0], MMQ:['volume',-9], CMQ:['volume',-6], MTQ:['volume',0]});
const FIELD_BOUNDS = freeze({
  supplierProductId:{sonepar:50,'bmecat-5.0':32},
  manufacturerProductId:{sonepar:50,'bmecat-5.0':50},
  brand:{sonepar:30,'bmecat-5.0':50}, series:{sonepar:30,'bmecat-5.0':50}, types:{sonepar:30,'bmecat-5.0':50},
  veryShort:{sonepar:40,'bmecat-5.0':40}, short:{sonepar:80,'bmecat-5.0':150}, long:{sonepar:64000,'bmecat-5.0':64000}
});
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const plain = o => o !== null && typeof o === 'object' && !Array.isArray(o) && (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
const present = v => v !== undefined && v !== null && v !== '';
const supplied = v => Array.isArray(v)?v.some(supplied):plain(v)?Object.values(v).some(supplied):present(v);
const escapedPointer = v => String(v).replace(/~/g,'~0').replace(/\//g,'~1');
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const v of Object.values(value)) freeze(v); Object.freeze(value); } return value; }
function clone(value, depth = 0, seen = new Set()) {
  if (depth > 64) throw failure('SUPPLIER_JSON_DEPTH', 'Supplier data exceeds 64 nested JSON levels.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!Array.isArray(value) && !plain(value)) throw failure('SUPPLIER_JSON_TYPE', 'Supplier inputs must contain only finite JSON values.');
  if (seen.has(value)) throw failure('SUPPLIER_JSON_CYCLE', 'Supplier inputs must not contain circular references.');
  seen.add(value);
  const out = Array.isArray(value) ? value.map(x=>clone(x,depth+1,seen)) : Object.fromEntries(Object.keys(value).map(k=>[k,clone(value[k],depth+1,seen)]));
  seen.delete(value); return out;
}
function failure(code,message,details) { const error = new Error(message); error.code = code; if (details) error.details = details; return error; }
function requireValue(ok,code,message) { if (!ok) throw failure(code,message); }
function list(value,label,{pattern,allowed} = {}) {
  requireValue(Array.isArray(value),'SUPPLIER_PROFILE',label+' must be an array.');
  const values = value.map(v=>{requireValue(typeof v === 'string' && v.length > 0,'SUPPLIER_PROFILE',label+' must contain exact nonempty strings.'); if(pattern) requireValue(pattern.test(v),'SUPPLIER_PROFILE','Invalid '+label+': '+v); if(allowed) requireValue(allowed.includes(v),'SUPPLIER_PROFILE','Unsupported '+label+': '+v); return v;});
  requireValue(new Set(values).size === values.length,'SUPPLIER_PROFILE',label+' contains a duplicate.'); return values;
}
function profileBoolean(value,label,nullable=false) { requireValue(typeof value === 'boolean' || (nullable && value === null),'SUPPLIER_PROFILE',label+' must be an explicit boolean'+(nullable?' or null.':'.')); return value; }
function profileStrings(object,keys,label) { for (const k of keys) requireValue(typeof object[k] === 'string','SUPPLIER_PROFILE',label+'.'+k+' must be a string.'); }
export function supplierProductTemplate() { return clone(TEMPLATE); }
export function normalizeSupplierProfile(value = {}) {
  requireValue(plain(value),'SUPPLIER_PROFILE','Supplier profile must be an object.');
  const defaults = clone(BASE_PROFILE), input = clone(value);
  const allowed = new Set([...Object.keys(defaults),'bounds','source']);
  for (const key of Object.keys(input)) requireValue(allowed.has(key),'SUPPLIER_PROFILE','Unsupported profile option: '+key);
  const p = {...defaults,...input,
    envelope:{...defaults.envelope,...input.envelope,buyer:{...defaults.envelope.buyer,...input.envelope?.buyer},supplier:{...defaults.envelope.supplier,...input.envelope?.supplier}},
    conversions:{...defaults.conversions,...input.conversions},etim:{...defaults.etim,...input.etim}};
  requireValue(p.schema === defaults.schema && typeof p.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(p.id),'SUPPLIER_PROFILE_ID','Use the maintained profile schema and a stable, nonempty profile identifier.');
  p.targets = list(p.targets,'targets',{allowed:TARGETS}); requireValue(p.targets.length > 0,'SUPPLIER_PROFILE','At least one target is required.');
  p.languages = list(p.languages,'languages',{pattern:LANG}); requireValue(p.languages.length > 0,'SUPPLIER_PROFILE','At least one explicit content language is required.');
  requireValue(p.languages.includes(p.defaultLanguage),'SUPPLIER_PROFILE','Default language must be selected in languages.');
  p.countries = list(p.countries,'countries',{pattern:COUNTRY});
  if(p.targets.includes('bmecat-5.0')){
    for(const language of p.languages)requireValue(ETIM_LANGUAGES.has(language),'SUPPLIER_PROFILE','Language is absent from the selected original ETIM schema: '+language);
    for(const country of p.countries)requireValue(ETIM_COUNTRIES.has(country),'SUPPLIER_PROFILE','Country is absent from the selected original ETIM schema: '+country);
  }
  requireValue(plain(p.officialLanguages),'SUPPLIER_PROFILE','officialLanguages must map selected countries to their declared official language codes.');
  for (const [country,languages] of Object.entries(p.officialLanguages)) { requireValue(p.countries.includes(country),'SUPPLIER_PROFILE','Official languages contain an unselected country: '+country); p.officialLanguages[country] = list(languages,'officialLanguages.'+country,{pattern:LANG}); }
  requireValue(['manufacturer','reseller','agency'].includes(p.role),'SUPPLIER_PROFILE','Select manufacturer, reseller or agency.');
  requireValue(['longtail','core_product','special'].includes(p.segment),'SUPPLIER_PROFILE','Unsupported product segment.');
  requireValue(p.category === null || own(CATEGORY_ASSETS,p.category),'SUPPLIER_PROFILE','Select a published Sonepar category.');
  p.channels = list(p.channels,'channels',{allowed:['commerce_connector','configurator']});
  p.applicableAssetCodes = list(p.applicableAssetCodes,'applicableAssetCodes',{pattern:/^MD\d{2}$/});
  p.applicableCoreManualCodes = list(p.applicableCoreManualCodes,'applicableCoreManualCodes',{allowed:['MD14','MD21','MD32','MD38']});
  p.applicableCoreAdditionalCodes = list(p.applicableCoreAdditionalCodes,'applicableCoreAdditionalCodes',{allowed:['MD09','MD46']});
  for(const key of ['requireVeryShort','genericAccessory','applicableCoreVideo']) profileBoolean(p[key],key);
  for(const key of ['seriesApplicable','typeApplicable']) profileBoolean(p[key],key,true);
  for(const key of ['allowExactUnitConversion','allowNetOrderBasisConversion']) profileBoolean(p.conversions[key],'conversions.'+key);
  for(const key of Object.keys(p.conversions)) requireValue(own(defaults.conversions,key),'SUPPLIER_PROFILE','Unsupported conversion: '+key);
  requireValue(p.etim.version === null || (typeof p.etim.version === 'string' && /^(?:ETIM-\d+(?:\.\d+)?|DYNAMIC)$/.test(p.etim.version)),'SUPPLIER_PROFILE','ETIM version must identify the selected release.');
  requireValue(Array.isArray(p.etim.classes),'SUPPLIER_PROFILE','ETIM classes must be an array of pinned class definitions.');
  const classIds = new Set();
  for(const c of p.etim.classes) {
    requireValue(plain(c) && /^EC\d{6}$/.test(c.classId) && Array.isArray(c.features),'SUPPLIER_PROFILE','Each ETIM definition needs classId and features.');
    requireValue(!classIds.has(c.classId),'SUPPLIER_PROFILE','Duplicate ETIM class definition.'); classIds.add(c.classId);
    const codes = new Set();
    for(const f of c.features) {
      requireValue(plain(f) && /^EF\d{6}$/.test(f.code) && ['numeric','range','logical','alphanumeric'].includes(f.kind),'SUPPLIER_PROFILE','Invalid ETIM feature definition.');
      requireValue(!codes.has(f.code),'SUPPLIER_PROFILE','Duplicate ETIM feature definition.'); codes.add(f.code);
      if (f.values !== undefined) list(f.values,'ETIM permitted values',{pattern:/^EV\d{6}$/});
      if (f.unit !== undefined) requireValue(typeof f.unit === 'string','SUPPLIER_PROFILE','ETIM unit must remain an exact string.');
    }
  }
  if(p.etim.classes.length) requireValue(plain(p.etim.source) && typeof p.etim.source.url === 'string' && /^https?:\/\//.test(p.etim.source.url) && /^[0-9a-f]{64}$/.test(p.etim.source.sha256),'SUPPLIER_PROFILE','Supplied ETIM class definitions need their original URL and SHA-256.');
  requireValue(plain(p.envelope),'SUPPLIER_PROFILE','An explicit export envelope is required.');
  profileStrings(p.envelope,['catalogId','catalogVersion','generationDate','currency'],'envelope');
  for(const k of ['catalogName','mimeRoot']) requireValue(typeof p.envelope[k] === 'string' || (plain(p.envelope[k]) && Object.entries(p.envelope[k]).every(([language,text])=>p.languages.includes(language)&&typeof text==='string')),'SUPPLIER_PROFILE','envelope.'+k+' must contain exact text or declared language-keyed text.');
  for(const kind of ['buyer','supplier']) { if(p.envelope[kind].ids!==undefined) {requireValue(Array.isArray(p.envelope[kind].ids),'SUPPLIER_PROFILE','Party ids must be an array.');for(const id of p.envelope[kind].ids) requireValue(plain(id)&&typeof id.type==='string'&&typeof id.value==='string','SUPPLIER_PROFILE','Each party identifier needs exact type and value strings.');} }
  if(p.envelope.previousProductIds!==undefined&&p.envelope.previousProductIds!==null)list(p.envelope.previousProductIds,'envelope.previousProductIds');
  for(const kind of ['buyer','supplier']) profileStrings(p.envelope[kind],['name','id','idType'],'envelope.'+kind);
  requireValue(['T_NEW_CATALOG','T_UPDATE_PRODUCTS','T_UPDATE_PRICES','T_NEW_PRODUCTDATA'].includes(p.envelope.transaction),'SUPPLIER_PROFILE','Unsupported BMEcat transaction.');
  profileBoolean(p.envelope.receiverAccepted,'envelope.receiverAccepted'); profileBoolean(p.envelope.subsetAgreed,'envelope.subsetAgreed');
  requireValue(p.envelope.previousVersion === null || (typeof p.envelope.previousVersion === 'string' && /^\d+$/.test(p.envelope.previousVersion)),'SUPPLIER_PROFILE','previousVersion must be an exact nonnegative integer string.');
  requireValue(Array.isArray(p.localRules),'SUPPLIER_PROFILE','localRules must be an array.');
  for(const r of p.localRules) {
    requireValue(plain(r) && typeof r.path === 'string' && /^(?:\/(?:[^~]|~[01])*)*$/.test(r.path) && typeof r.code === 'string' && typeof r.message === 'string','SUPPLIER_PROFILE','A local rule needs an exact JSON Pointer, code and message.');
    requireValue(plain(r.rule) && typeof r.rule.url === 'string' && /^https?:\/\//.test(r.rule.url) && typeof r.rule.section === 'string','SUPPLIER_PROFILE','A local rule needs its original source URL and section.');
    if(r.required !== undefined) profileBoolean(r.required,'localRules.required');
    if(r.maxCharacters !== undefined) requireValue(Number.isSafeInteger(r.maxCharacters) && r.maxCharacters >= 0,'SUPPLIER_PROFILE','A local character bound must be a nonnegative integer.');
    if(r.allowedValues !== undefined) list(r.allowedValues,'localRules.allowedValues');
    if(r.severity !== undefined) requireValue(['error','warning','info'].includes(r.severity),'SUPPLIER_PROFILE','Invalid local severity.');
    for(const k of Object.keys(r)) requireValue(['path','code','message','rule','required','maxCharacters','allowedValues','severity'].includes(k),'SUPPLIER_PROFILE','Unsupported local rule operation: '+k);
  }
  p.bounds = clone(FIELD_BOUNDS); p.source = clone(PROFILE_SOURCE);
  return freeze(p);
}
const validDate = value => typeof value === 'string' && DATE.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
const xmlCharacters = value => !/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(value);
const characters = s => [...s].length;
function decimal(value) {
  if (typeof value !== 'string' || value.length > 1000) return null;
  const m = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d{1,4}))?$/.exec(value);
  if(!m) return null;
  const exponent = m[5] ? Number(m[5]) : 0;
  if(Math.abs(exponent)>1000) return null;
  const fraction = m[3] ?? m[4] ?? '', digits = (m[2] ?? '0')+fraction;
  let n = BigInt(digits) * (m[1] === '-' ? -1n : 1n), scale = fraction.length-exponent;
  if(scale<0){n*=10n**BigInt(-scale);scale=0}
  return {n,scale};
}
const compare = (a,b) => a.n*10n**BigInt(b.scale) < b.n*10n**BigInt(a.scale) ? -1 : a.n*10n**BigInt(b.scale) > b.n*10n**BigInt(a.scale) ? 1 : 0;
const isOne = d => d && compare(d,{n:1n,scale:0}) === 0;
function decimalText(d) {
  let n=d.n, scale=d.scale, negative=n<0n; if(negative)n=-n;
  if(scale<0){n*=10n**BigInt(-scale);scale=0;}
  while(scale>0 && n%10n===0n){n/=10n;scale--;}
  const digits=n.toString().padStart(scale+1,'0');
  return (negative&&n!==0n?'-':'')+(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits);
}
function gtinValid(value) {
  if(typeof value!=='string'||! /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false;
  let sum=0,weight=3;for(let i=value.length-2;i>=0;i--){sum+=Number(value[i])*weight;weight=weight===3?1:3}
  return (10-sum%10)%10 === Number(value.at(-1));
}
function pointerValue(value,pointer) { let v=value; for(const raw of pointer.split('/').slice(1)){const key=raw.replace(/~1/g,'/').replace(/~0/g,'~');if(v===null||typeof v!=='object'||!own(v,key))return undefined;v=v[key]}return v; }
function refs(target,section,extra={}) { return {target,section,url:target==='sonepar'?S:E,...extra}; }
function validation(profile) {
  const findings=[];
  const add=(severity,code,path,message,rule)=>findings.push({severity,code,path,message,rule});
  const text=(value,path,{required=false,max,html=false,target='sonepar',section='§2.1–2.2',label=path}={})=>{
    if(!present(value)){if(required)add('error','REQUIRED',path,label+' is required.',refs(target,section));return false}
    if(typeof value!=='string'){add('error','STRING_REQUIRED',path,'Keep '+label+' as an exact string.',refs(target,section));return false}
    if(!value.trim()){if(required)add('error','REQUIRED',path,label+' must contain text.',refs(target,section));return false}
    if(!xmlCharacters(value))add('error','XML_CHARACTER',path,'The original value contains a character that XML 1.0 cannot represent.',refs(target,section));
    if(max!==undefined && characters(value)>max)add('error','TARGET_LENGTH',path,label+' has '+characters(value)+' characters; '+target+' permits '+max+'.',refs(target,section,{limit:max,actual:characters(value)}));
    if(!html && /<\/?[A-Za-z][^>]*>/.test(value))add('error','PLAIN_TEXT_REQUIRED',path,'This target field accepts plain text.',refs(target,section));
    return true;
  };
  const number=(value,path,{required=false,positive=false,integer=false,allowZero=true,float=false,target='bmecat-5.0',section='§8'}={})=>{
    if(!present(value)){if(required)add('error','REQUIRED',path,'An explicit decimal string is required.',refs(target,section));return null}
    const d=decimal(value);
    if(!d){add('error','DECIMAL_FORMAT',path,'Use an exact finite decimal string with a dot and no thousands separators.',refs(target,section));return null}
    if((positive && d.n<0n)||(!allowZero&&d.n===0n))add('error','NUMBER_RANGE',path,'The value must be '+(allowZero?'nonnegative.':'positive.'),refs(target,section));
    if(integer&&!/^[+-]?\d+$/.test(value))add('error','INTEGER_REQUIRED',path,'Keep the original integer as digits with an optional sign; decimal points and exponents are not valid in this XML integer field.',refs(target,section));
    else if(!integer&&!float&&/[eE]/.test(value))add('error','DECIMAL_LEXICAL_FORM',path,'This XML decimal field uses an exact decimal point form without an exponent.',refs(target,section));
    return d;
  };
  const date=(value,path,{required=false,target='bmecat-5.0',section='§8'}={})=>{
    if(!present(value)){if(required)add('error','REQUIRED',path,'An explicit date is required.',refs(target,section));return false}
    if(!validDate(value)){add('error','DATE_FORMAT',path,'Use a real calendar date in YYYY-MM-DD format.',refs(target,section));return false}return true;
  };
  const array=(value,path,{required=false}={})=>{
    if(value===undefined||value===null){if(required)add('error','ARRAY_REQUIRED',path,'An array is required.',refs('sonepar','Product data structure'));return []}
    if(!Array.isArray(value)){add('error','ARRAY_REQUIRED',path,'Retain this repeating field as an array.',refs('sonepar','Product data structure'));return []}return value;
  };
  const object=(value,path)=>{
    if(value===undefined||value===null)return {};
    if(!plain(value)){add('error','OBJECT_REQUIRED',path,'This field must be a JSON object.',refs('sonepar','Product data structure'));return {}}return value;
  };
  return {findings,add,text,number,date,array,object};
}


function checkEnvelope(profile,v,submission={}) {
  if(!profile.targets.includes('bmecat-5.0')) return;
  const e=profile.envelope, rule={target:'bmecat-5.0',section:'§4b pp12–18'};
  v.text(e.catalogId,'/profile/envelope/catalogId',{...rule,required:true,max:20});
  if(v.text(e.catalogVersion,'/profile/envelope/catalogVersion',{...rule,required:true,max:7})&&!/^\d{1,3}\.\d{1,3}$/.test(e.catalogVersion)) v.add('error','CATALOG_VERSION','/profile/envelope/catalogVersion','Use a catalog version in the form xxx.yyy, with at most three digits on each side.',refs('bmecat-5.0','§4b p13'));
  localized(e.catalogName,'/profile/envelope/catalogName',profile,v,{...rule,required:true,max:100});
  v.date(e.generationDate,'/profile/envelope/generationDate',{...rule,required:true});
  for(const kind of ['buyer','supplier']) {
    v.text(e[kind].name,'/profile/envelope/'+kind+'/name',{...rule,required:true,max:50});
    if(present(e[kind].id)){
      v.text(e[kind].id,'/profile/envelope/'+kind+'/id',{...rule,max:250});
      const types=kind==='buyer'?['gln','buyer_specific']:['gln','duns'];
      if(!types.includes(e[kind].idType))v.add('error','PARTY_ID_TYPE','/profile/envelope/'+kind+'/idType','Select the original identifier type: '+types.join(', ')+'.',refs('bmecat-5.0','§4b pp15–16'));
      if(e[kind].idType==='gln'){
        if(!/^\d{13}$/.test(e[kind].id))v.add('error','GLN_FORMAT','/profile/envelope/'+kind+'/id','A GLN is an exact 13-digit identifier.',refs('bmecat-5.0','§4b pp15–16'));
        else if(!gtinValid(e[kind].id))v.add('warning','GLN_CHECK_DIGIT','/profile/envelope/'+kind+'/id','The original GLN has a nonmatching GS1 check digit; the source value is retained for receiver review.',refs('bmecat-5.0','§4b pp15–16'));
      }
      if(e[kind].idType==='duns'&&!/^\d{9}$/.test(e[kind].id))v.add('error','DUNS_FORMAT','/profile/envelope/'+kind+'/id','Keep the nine D-U-N-S digits without formatting.',refs('bmecat-5.0','§4b p15'));
    } else if(present(e[kind].idType)) v.add('error','PARTY_ID_MISSING','/profile/envelope/'+kind+'/id','An identifier type needs its original identifier.',refs('bmecat-5.0','§4b pp15–16'));
  }
  if(present(e.currency)&&!ETIM_CURRENCIES.has(e.currency))v.add('error','CURRENCY_FORMAT','/profile/envelope/currency','Use the selected three-letter ISO currency code.',refs('bmecat-5.0','§4b p14'));
  localized(e.mimeRoot,'/profile/envelope/mimeRoot',profile,v,{...rule,max:250});
  if(e.transaction==='T_UPDATE_PRODUCTS'||e.transaction==='T_UPDATE_PRICES'){
    if(!e.receiverAccepted)v.add('error','UPDATE_ACCEPTANCE','/profile/envelope/receiverAccepted','Record the selected receiver’s acceptance of this update transaction.',refs('bmecat-5.0','§2 p7'));
    if(e.previousVersion===null)v.add('error','UPDATE_SEQUENCE','/profile/envelope/previousVersion','Supply the original sequential prev_version; the first update is 0.',refs('bmecat-5.0','§2 p7'));
  }
  if(e.transaction==='T_UPDATE_PRICES' && !Array.isArray(submission.previousProductIds??e.previousProductIds))
    v.add('error','PRICE_UPDATE_COVERAGE','/submission/previousProductIds','A price-only update needs the previous complete catalog product-ID set to preserve its coverage.',refs('bmecat-5.0','§2 p7; §4e pp52–53'));
}
function textBound(v,value,path,field,profile,{required=false,html=false,section='§3–4'}={}) {
  for(const target of profile.targets) v.text(value,path,{required,html,target,max:FIELD_BOUNDS[field]?.[target],section});
}
function checkHtml(value,path,v) {
  if(typeof value!=='string')return;
  const allowed=new Set('b i u strong em br ul ol li p span div h1 h2 h3 h4 h5 h6'.split(' ')),stack=[];
  for(const m of value.matchAll(/<[^>]*>/g)){
    const tag=/^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9]*)([^>]*)>$/.exec(m[0]);
    if(!tag||!allowed.has(tag[2].toLowerCase())){v.add('error','HTML_TAG',path,'Use only the documented description formatting tags.',refs('sonepar','§4.4 pp21–23'));continue}
    const name=tag[2].toLowerCase(),tail=tag[3].trim(),closing=Boolean(tag[1]),empty=name==='br'||tail==='/';
    if(tail&&tail!=='/')v.add('warning','HTML_ATTRIBUTES',path,'Review formatting attributes separately; the selected guide lists permitted tags.',refs('sonepar','§4.4 pp21–23'));
    if(/\bon\w+\s*=|(?:javascript|vbscript)\s*:/i.test(tail))v.add('error','HTML_ACTIVE_CONTENT',path,'Remove executable attributes from the supplier description.',refs('sonepar','§4.4 pp21–23'));
    if(closing){if(stack.pop()!==name)v.add('error','HTML_NESTING',path,'Close description formatting tags in their original nesting order.',refs('sonepar','§4.4 pp21–23'))}
    else if(!empty)stack.push(name);
  }
  if(stack.length)v.add('error','HTML_UNCLOSED',path,'Close every description formatting tag.',refs('sonepar','§4.4 pp21–23'));
}
function checkDescriptions(p,profile,v) {
  const descriptions=v.object(p.descriptions,'/descriptions');
  for(const [language,entry] of Object.entries(descriptions)){
    const base='/descriptions/'+escapedPointer(language);
    if(!LANG.test(language)||!profile.languages.includes(language))v.add('error','UNDECLARED_LANGUAGE',base,'Declare every content language in the selected profile.',refs('bmecat-5.0','§4b pp12–13'));
    const d=v.object(entry,base);
    textBound(v,d.short,base+'/short','short',profile,{required:true});
    textBound(v,d.long,base+'/long','long',profile,{html:true});
    textBound(v,d.veryShort,base+'/veryShort','veryShort',profile,{required:profile.requireVeryShort});
    if(profile.targets.includes('sonepar')){
      if(!present(d.long))v.add('warning','LONG_DESCRIPTION',base+'/long','Supply the extended description used in the product detail experience.',refs('sonepar','§4.4 pp21–23'));
      checkHtml(d.long,base+'/long',v);
      if(typeof d.long==='string'&&d.long.replace(/<[^>]*>/g,' ').trim().split(/\s+/u).filter(Boolean).length>300)v.add('info','LONG_DESCRIPTION_WORDS',base+'/long','The guide recommends about 300 words for a long description.',refs('sonepar','§4.4 pp21–23',{preferredWords:300}));
      if(v.text(d.titleProposal,base+'/titleProposal',{target:'sonepar',section:'§4.3',html:false})&&characters(d.titleProposal)>200)v.add('warning','TITLE_PREFERRED_LENGTH',base+'/titleProposal','The proposed title exceeds the preferred 200 characters.',refs('sonepar','§4.3',{preferredCharacters:200}));
    }
    if(profile.targets.includes('bmecat-5.0')&&typeof d.short==='string'&&characters(d.short)>80&&characters(d.short)<=150)v.add('warning','SHORT_DESCRIPTION_PREFERRED',base+'/short','BMEcat permits 150 characters; its guideline prefers 80.',refs('bmecat-5.0','§4c p19; §5a',{preferredCharacters:80}));
    if(profile.targets.includes('bmecat-5.0')&&present(d.titleProposal))v.add('info','SEPARATE_TITLE_PROPOSAL',base+'/titleProposal','The title proposal remains a separate review/JSONL field because this guideline has no title-proposal mapping.',refs('sonepar','§4.5 pp24–25'));
  }
  for(const language of profile.languages) if(!own(descriptions,language))v.add('error','DESCRIPTION_LANGUAGE','/descriptions/'+language,'Supply the product descriptions for selected language '+language+'.',refs('sonepar','§4.2–4.4 pp17–23'));
  if(profile.targets.includes('sonepar')){
    if(!profile.countries.length)v.add('warning','TARGET_COUNTRY','/profile/countries','Select the receiving country to apply its language and branch-number requirements.',refs('sonepar','§2.2; §4.2–4.4'));
    for(const country of profile.countries){
      const languages=profile.officialLanguages[country];
      if(!languages?.length)v.add('warning','OFFICIAL_LANGUAGES','/profile/officialLanguages/'+country,'Record the official target languages used by the receiving company in '+country+'.',refs('sonepar','§4.2–4.4'));
      for(const language of languages??[])if(!profile.languages.includes(language))v.add('error','OFFICIAL_LANGUAGE_MISSING','/profile/languages','The selected profile is missing '+language+' required by its declared '+country+' language set.',refs('sonepar','§4.2–4.4'));
    }
  }
}
function checkIdentification(p,profile,v,context) {
  textBound(v,p.supplierProductId,'/supplierProductId','supplierProductId',profile,{required:true,section:'§2.1–2.2; ETIM §4c p19'});
  const sonepar=profile.targets.includes('sonepar');
  textBound(v,p.manufacturerProductId,'/manufacturerProductId','manufacturerProductId',profile,{required:sonepar&&['reseller','agency'].includes(profile.role),section:'§2.1 pp9–10; ETIM §4c p20'});
  if(sonepar&&!present(p.manufacturerProductId)&&profile.role==='manufacturer')v.add('warning','MANUFACTURER_ID_PREFERRED','/manufacturerProductId','Include the original manufacturer product identifier when available.',refs('sonepar','§2.1 pp9–10'));
  for(const key of ['manufacturerName','alternativeSupplierId']) v.text(p[key],'/'+key,{target:'bmecat-5.0',max:50,section:'§4c pp19–20'});
  localized(p.manufacturerTypeDescription,'/manufacturerTypeDescription',profile,v,{target:'bmecat-5.0',max:50,section:'§4c pp19–20'});
  if(present(p.productGtin)){
    if(!gtinValid(p.productGtin))v.add('error','GTIN_CHECK_DIGIT','/productGtin','Keep an 8, 12, 13 or 14-digit GTIN with its original leading zeros and valid GS1 check digit.',refs('sonepar','§2.2 p11'));
  }else if(sonepar)v.add(profile.channels.length?'error':'warning','GTIN_REQUIRED','/productGtin',profile.channels.length?'The selected commerce connector/configurator requires a GTIN.':'A GTIN is preferred for product identification.',refs('sonepar','§2.2 p11'));
  for(const key of ['supplierProductId','manufacturerProductId','productGtin'])if(typeof p[key]==='string'&&p[key]!==p[key].trim())v.add('warning','IDENTIFIER_WHITESPACE','/'+key,'Review the original identifier’s surrounding whitespace; its characters remain unchanged.',refs('sonepar','§2.1–2.2'));
  textBound(v,p.brand,'/brand','brand',profile,{required:sonepar,section:'§3.1 p13'});
  const applicability=v.object(p.applicability,'/applicability'),generic=applicability.genericAccessory??profile.genericAccessory;
  for(const key of ['series','types','genericAccessory','coreVideo'])if(present(applicability[key])&&typeof applicability[key]!=='boolean')v.add('error','APPLICABILITY_BOOLEAN','/applicability/'+key,'Use an explicit boolean or leave applicability undecided.',refs('sonepar','§3; §5.1'));
  if(present(p.stockIndicator)&&typeof p.stockIndicator!=='boolean')v.add('error','STOCK_BOOLEAN','/stockIndicator','Use an explicit boolean for the original stock indicator.',refs('bmecat-5.0','§4c p29'));
  for(const [key,applicable]of [['series',applicability.series??profile.seriesApplicable],['types',applicability.types??profile.typeApplicable]]){
    const values=v.array(p[key],'/'+key),seen=new Set();
    if(sonepar&&applicable===true&&!values.length)v.add('error','APPLICABLE_IDENTITY','/'+key,'Supply all applicable '+key+' values.',refs('sonepar','§3.2–3.4 pp13–14'));
    if(sonepar&&applicable===null&&!values.length&&!generic)v.add('info','IDENTITY_APPLICABILITY','/applicability/'+(key==='types'?'types':'series'),'Record whether '+key+' applies to this product.',refs('sonepar','§3.2–3.4'));
    if(sonepar&&generic&&key==='series'&&values.length)v.add('error','GENERIC_ACCESSORY_SERIES','/series','A generic accessory has no specific product-series assignment.',refs('sonepar','§3.2–3.4'));
    for(let i=0;i<values.length;i++){
      const value=values[i],path='/'+key+'/'+i;
      if(typeof value==='string'){textBound(v,value,path,key,profile);if(seen.has(value))v.add('error','DUPLICATE_IDENTITY',path,'A repeating identity value occurs more than once.',refs('sonepar','§3.2–3.4'));seen.add(value)}
      else if(plain(value)){
        const language=value.language; if(!profile.languages.includes(language))v.add('error','UNDECLARED_LANGUAGE',path+'/language','Declare this identity’s content language in the profile.',refs('bmecat-5.0','§4c p30'));
        textBound(v,value.value,path+'/value',key,profile);const identity=String(language)+'\0'+String(value.value);if(seen.has(identity))v.add('error','DUPLICATE_IDENTITY',path,'The same localized identity occurs more than once.',refs('sonepar','§3.2–3.4'));seen.add(identity);
      }else v.add('error','IDENTITY_VALUE',path,'Use an exact string or {language,value} for this localized identity.',refs('bmecat-5.0','§4c p30'));
    }
  }
  const branches=new Set();
  for(const key of ['branchNumbers','branchSupplierIds']){
    const ids=v.array(p[key],'/'+key),seen=new Set();
    for(let i=0;i<ids.length;i++){
      const row=v.object(ids[i],'/'+key+'/'+i),path='/'+key+'/'+i;
      if(!COUNTRY.test(row.country??'')||(profile.targets.includes('bmecat-5.0')&&!ETIM_COUNTRIES.has(row.country)))v.add('error','COUNTRY_FORMAT',path+'/country','Use the explicit two-letter branch country code.',refs('bmecat-5.0','§4c pp30–31'));
      v.text(row.type,path+'/type',{required:true,target:'bmecat-5.0',section:'§4c pp30–31'});
      if(!['electrical','HVAC','building','shipbuilding'].includes(row.type))v.add('error','BRANCH_TYPE',path+'/type','Choose the original electrical, HVAC, building or shipbuilding branch type.',refs('bmecat-5.0','§4c pp30–31'));
      if(v.text(row.value,path+'/value',{required:true,target:'bmecat-5.0',section:'§4c pp30–31'})&&!/^[+-]?\d+$/.test(row.value))v.add('error','BRANCH_INTEGER',path+'/value','The branch field contains an integer string; preserve any original leading zeros.',refs('bmecat-5.0','§4c pp30–31'));
      const identity=row.country+'\0'+row.type;if(seen.has(identity))v.add('error','BRANCH_DUPLICATE',path,'Only one branch value is allowed per country and type.',refs('bmecat-5.0','§4c pp30–31'));seen.add(identity);
      if(key==='branchNumbers')branches.add(row.country);
    }
  }
  if(sonepar)for(const country of profile.countries.filter(x=>['FI','NO','SE'].includes(x)))if(!branches.has(country))v.add('error','BRANCH_NUMBER_REQUIRED','/branchNumbers','A product branch number is required for '+country+'; a supplier branch identifier is a separate field.',refs('sonepar','§2.2 p11'));
  if(sonepar&&profile.targets.includes('bmecat-5.0')&&profile.countries.some(x=>['FI','NO','SE'].includes(x)))v.add('info','BRANCH_SOURCE_MAPPING','/branchNumbers','Sonepar describes a country/sector product number but prints the supplier-ID XML label in its Branch Number paragraph. This explicit mapping retains the product role as COUNTRY_BRANCH_NUMBER and the separate supplier role as COUNTRY_BRANCH_SUPPLIER_ID, following the ETIM country mapping.',refs('sonepar','§2.1.4 p10; §2.2 p11',{literalSourceXml:'UDX.EDXF.COUNTRY_BRANCH_SUPPLIER_ID',productRoleXml:'UDX.EDXF.COUNTRY_BRANCH_NUMBER',supplierRoleXml:'UDX.EDXF.COUNTRY_BRANCH_SUPPLIER_ID',mappingReference:{url:E,section:'Norway mapping p119'}}));
  if(sonepar&&typeof context.findPreviousProduct==='function'&&typeof p.supplierProductId==='string'){
    const previous=context.findPreviousProduct(p.supplierProductId);
    if(previous&&present(previous.brand)&&present(p.brand)&&previous.brand!==p.brand)v.add('error','BRAND_IDENTITY_CHANGED','/supplierProductId','Changing the brand requires a new product identifier; retain the previous product identity.',refs('sonepar','§2.1; §3.1'));
  }
  v.date(p.expiresAt,'/expiresAt',{target:'bmecat-5.0',section:'§4c p28'});
}
function checkClassification(p,profile,v,{required=true}={}) {
  const c=v.object(p.classification,'/classification'),etim=v.object(c.etim,'/classification/etim'),path='/classification/etim';
  const needed=required&&profile.targets.some(t=>t==='sonepar'||t==='bmecat-5.0');
  if(v.text(etim.classId,path+'/classId',{required:needed,target:'sonepar',section:'§7.1–7.3 pp43–46'})&&!/^EC\d{6}$/.test(etim.classId))v.add('error','ETIM_CLASS_CODE',path+'/classId','Use the original ETIM class code EC followed by six digits.',refs('sonepar','§7.1–7.3'));
  if(v.text(etim.version,path+'/version',{required:needed,target:'bmecat-5.0',section:'§4c pp22–23'})&&!/^(?:ETIM-\d+(?:\.\d+)?|DYNAMIC)$/.test(etim.version))v.add('error','ETIM_VERSION',path+'/version','Identify the selected ETIM release or DYNAMIC system.',refs('bmecat-5.0','§4c pp22–23'));
  if((needed||present(etim.version))&&profile.etim.version&&etim.version!==profile.etim.version)v.add('error','ETIM_RELEASE_MISMATCH',path+'/version','This product does not use the ETIM release pinned by the submission.',refs('sonepar','§7.1–7.3',{expected:profile.etim.version}));
  const definition=profile.etim.classes.find(x=>x.classId===etim.classId),definitions=new Map((definition?.features??[]).map(x=>[x.code,x])),features=v.array(etim.features,path+'/features'),seen=new Set();
  if((needed||present(etim.classId))&&profile.etim.classes.length&&!definition)v.add('error','ETIM_CLASS_UNKNOWN',path+'/classId','The class is absent from the selected source-bound ETIM definition set.',refs('sonepar','§7.1–7.3',{model:profile.etim.source}));
  else if(present(etim.classId)&&!profile.etim.classes.length)v.add('info','ETIM_FEATURE_MODEL','/profile/etim/classes','Bind the selected ETIM class definitions to check all required features and permitted values.',refs(profile.targets.includes('sonepar')?'sonepar':'bmecat-5.0',profile.targets.includes('sonepar')?'§7.1–7.3':'§5c'));
  const featureTarget=profile.targets.includes('sonepar')?'sonepar':'bmecat-5.0';
  for(let i=0;i<features.length;i++){
    const f=v.object(features[i],path+'/features/'+i),fp=path+'/features/'+i,expected=definitions.get(f.code);
    if(!/^EF\d{6}$/.test(f.code??''))v.add('error','ETIM_FEATURE_CODE',fp+'/code','Use an original EF code followed by six digits.',refs('bmecat-5.0','§4c pp22–23'));
    if(seen.has(f.code))v.add('error','ETIM_FEATURE_DUPLICATE',fp+'/code','Each ETIM feature occurs once within its class.',refs('bmecat-5.0','§5c pp57–60'));seen.add(f.code);
    if(definition&&!expected)v.add('error','ETIM_FEATURE_UNKNOWN',fp+'/code','This feature is absent from the pinned original class.',refs('sonepar','§7.1–7.3'));
    if(present(f.kind)&&!['numeric','range','logical','alphanumeric'].includes(f.kind))v.add('error','ETIM_FEATURE_KIND',fp+'/kind','Select the original ETIM numeric, range, logical or alphanumeric type.',refs('bmecat-5.0','§5c pp57–60'));
    if(expected&&present(f.kind)&&expected.kind!==f.kind)v.add('error','ETIM_FEATURE_KIND_MISMATCH',fp+'/kind','The feature type differs from the original class definition.',refs('sonepar','§7.1–7.3',{expected:expected.kind}));
    const kind=present(f.kind)?f.kind:expected?.kind;
    const values=v.array(f.values,fp+'/values',{required:true});
    if(!values.length)v.add('error','ETIM_FEATURE_VALUE',fp+'/values','Provide the original feature value.',refs('sonepar','§7.1–7.3'));
    const exception=values.length===1&&values[0]==='-';
    if(exception){
      if(!['NA','MV','UN'].includes(f.details))v.add('error','ETIM_EXCEPTION_REASON',fp+'/details','Retain the explicit NA, MV or UN reason alongside the minus value.',refs(featureTarget,featureTarget==='sonepar'?'§7.3':'§5c'));
      else v.add(featureTarget==='sonepar'?'warning':'info','ETIM_EXCEPTION_VALUE',fp+'/values','The original feature retains its explicit exception reason.',refs(featureTarget,featureTarget==='sonepar'?'§7.3':'§5c'));
    }else{
      if(kind==='range'&&values.length!==2)v.add('error','ETIM_RANGE_VALUES',fp+'/values','A numeric range needs exactly two original numeric values.',refs('bmecat-5.0','§5c'));
      if(present(kind)&&kind!=='range'&&values.length>1&&kind!=='alphanumeric')v.add('error','ETIM_VALUE_CARDINALITY',fp+'/values','This feature type uses one value.',refs('bmecat-5.0','§5c'));
      if(!present(kind)&&profile.targets.includes('sonepar'))v.add('warning','ETIM_FEATURE_TYPE_SOURCE',fp+'/kind','Bind the original ETIM class model to validate this feature’s type; original FVALUE text remains unchanged.',refs('sonepar','§7.1–7.3'));
      const numbers=[];
      for(let j=0;j<values.length;j++){
        const value=values[j],vp=fp+'/values/'+j;
        v.text(value,vp,{required:true,target:'bmecat-5.0',section:'§4c pp22–23'});
        if(kind==='numeric'||kind==='range'){const d=v.number(value,vp,{float:true});if(d)numbers.push(d)}
        else if(kind==='logical'){if(!['true','false'].includes(value))v.add('error','ETIM_LOGICAL_VALUE',vp,'Use the exact lowercase string true or false.',refs('bmecat-5.0','§5c'))}
        else if(kind==='alphanumeric'){
          if(typeof value!=='string'||!/^EV\d{6}$/.test(value))v.add('error','ETIM_VALUE_CODE',vp,'Use the original permitted EV code.',refs('bmecat-5.0','§5c'));
          if(expected?.values&&!expected.values.includes(value))v.add('error','ETIM_VALUE_UNKNOWN',vp,'This EV value is absent from the pinned feature definition.',refs('sonepar','§7.1–7.3'));
        }
      }
      if(kind==='range'&&numbers.length===2&&compare(numbers[0],numbers[1])>0)v.add('error','ETIM_RANGE_ORDER',fp+'/values','The lower range value must not exceed the upper value.',refs('bmecat-5.0','§5c'));
    }
    localized(f.details,fp+'/details',profile,v,{target:'bmecat-5.0',max:250,section:'§4c p23'});
    if(present(f.unit)&&expected?.unit&&f.unit!==expected.unit)v.add('error','ETIM_UNIT_MISMATCH',fp+'/unit','The feature unit differs from the fixed original ETIM unit.',refs('bmecat-5.0','§5c',{expected:expected.unit}));
    if(present(f.unit)&&!expected?.unit)v.add('warning','ETIM_UNIT_REVIEW',fp+'/unit','ETIM feature units normally come from the class model; retain this explicit unit for review.',refs('bmecat-5.0','§5c'));
  }
  for(const code of definitions.keys())if(!seen.has(code))v.add('error','ETIM_FEATURE_REQUIRED',path+'/features','The original class requires feature '+code+'.',refs('sonepar','§7.1–7.3',{featureCode:code}));
  for(const kind of ['unspsc','eclass']){
    const value=v.object(c[kind],'/classification/'+kind);
    if(present(value.code)){
      v.text(value.code,'/classification/'+kind+'/code',{target:'sonepar',section:'§7.4–7.5'});
      v.text(value.version,'/classification/'+kind+'/version',{target:'sonepar',required:true,section:'§7.4–7.5'});
      if(kind==='unspsc'&&!/^\d{8}$/.test(value.code))v.add('error','UNSPSC_FORMAT','/classification/unspsc/code','Use the original eight-digit UNSPSC code.',refs('sonepar','§7.4'));
      if(profile.targets.includes('sonepar')&&kind==='unspsc'&&value.version!=='26.0801')v.add('warning','UNSPSC_PREFERRED_VERSION','/classification/unspsc/version','The selected Sonepar guide prefers UNSPSC 26.0801.',refs('sonepar','§7.4',{preferred:'26.0801'}));
    }else if(profile.targets.includes('sonepar'))v.add('info',kind.toUpperCase()+'_PREFERRED','/classification/'+kind+'/code',kind==='eclass'?'ECLASS product categorization is preferred for European receivers.':'UNSPSC categorization is preferred.',refs('sonepar','§7.4–7.5'));
  }
  if(profile.targets.includes('sonepar')){
    if(v.text(p.customsTariff,'/customsTariff',{required:true,max:10,target:'sonepar',section:'§7.6'})&&!/^\d{1,10}$/.test(p.customsTariff))v.add('error','CUSTOMS_DIGITS','/customsTariff','Keep the original customs tariff as at most ten digits.',refs('sonepar','§7.6'));
    const discounts=v.object(p.discountGroup,'/discountGroup');
    v.text(discounts.supplier,'/discountGroup/supplier',{required:true,max:20,target:'bmecat-5.0',section:'§4c pp28–29'});
  }
  if(profile.targets.includes('bmecat-5.0')){
    if(present(p.customsTariff)&&typeof p.customsTariff==='string'&&p.customsTariff.length!==8)v.add('error','CUSTOMS_TARGET_MAPPING','/customsTariff','The base ETIM guideline describes the eight-digit customs code. Supply the explicit selected-target mapping; the original value is retained.',refs('bmecat-5.0','§4c p47'));
    const discounts=v.object(p.discountGroup,'/discountGroup');for(const key of ['supplier','manufacturer'])v.text(discounts[key],'/discountGroup/'+key,{max:20,target:'bmecat-5.0',section:'§4c pp28–29'});
  }
}


function localized(value,path,profile,v,{required=false,max=250,target='bmecat-5.0',section='§4c'}={}) {
  if(typeof value==='string'||!present(value))return v.text(value,path,{required,max,target,section});
  if(!plain(value)){v.add('error','LOCALIZED_TEXT',path,'Use an exact string or an object keyed by declared language.',refs(target,section));return false}
  if(required&&!Object.keys(value).length)v.add('error','REQUIRED',path,'Provide at least one localized value.',refs(target,section));
  for(const [language,text]of Object.entries(value)){
    if(!profile.languages.includes(language))v.add('error','UNDECLARED_LANGUAGE',path+'/'+escapedPointer(language),'Declare this content language in the profile.',refs('bmecat-5.0','§4b pp12–13'));
    v.text(text,path+'/'+escapedPointer(language),{required:true,max,target,section});
  }
  return true;
}
function checkMeasurement(value,path,field,profile,v,{net=false,basis,productsPerOrderUnit}={}) {
  if(value===undefined||value===null)return;
  const m=v.object(value,path);
  if(!present(m.value)&&!present(m.unit))return;
  const amount=v.number(m.value,path+'/value',{required:true,positive:true,target:'sonepar',section:'§8.3–8.8 pp51–54'});
  const dimension=['weight','volume'].includes(field)?field:'length',unit=UNIT_SCALE[m.unit];
  if(!unit||unit[0]!==dimension){v.add('error','MEASUREMENT_UNIT',path+'/unit','Select an explicit '+dimension+' unit from the published target units.',refs('sonepar','§8.3–8.8'));return}
  if(profile.targets.includes('bmecat-5.0')){
    if(unit[1]!==0&&!profile.conversions.allowExactUnitConversion)v.add('error','MEASUREMENT_TARGET_UNIT',path+'/unit','ETIM uses metres, kilograms and cubic metres. Select the explicit exact-conversion option or provide the matching target unit.',refs('bmecat-5.0','§4c pp31–33'));
    if(net&&basis!=='order_unit'){
      if(basis!=='unpacked_product')v.add('error','NET_MEASUREMENT_BASIS',path,'Declare whether the measurement describes one order unit or one unpacked product.',refs('bmecat-5.0','§4c p33'));
      else if(!profile.conversions.allowNetOrderBasisConversion)v.add('error','NET_ORDER_BASIS',path,'ETIM net measurements refer to one ORDER_UNIT; select an explicit basis conversion for unpacked-product measurements.',refs('bmecat-5.0','§4c p33'));
      else if(!decimal(productsPerOrderUnit)||decimal(productsPerOrderUnit).n<=0n)v.add('error','NET_ORDER_FACTOR','/net/productsPerOrderUnit','Supply the exact positive count of unpacked products represented by one order unit.',refs('bmecat-5.0','§4c p33'));
      else if(dimension==='length'&&!isOne(decimal(productsPerOrderUnit)))v.add('error','NET_ORDER_GEOMETRY',path,'The dimensions of several products cannot be derived by multiplying one product’s dimensions. Supply the original dimensions of one order unit explicitly.',refs('bmecat-5.0','§4c p33'));
    }
    if(amount&&(unit[1]!==0||net&&basis==='unpacked_product')&&profile.conversions.allowExactUnitConversion&&(!net||basis==='order_unit'||profile.conversions.allowNetOrderBasisConversion))v.add('info','EXACT_MEASUREMENT_CONVERSION',path,'The selected export converts this explicit unit/basis with exact decimal arithmetic; the review retains the original measurement.',refs('bmecat-5.0','§4c pp31–33'));
  }
  if(net&&profile.targets.includes('sonepar')&&present(basis)&&basis!=='unpacked_product')v.add('warning','SONEPAR_NET_BASIS',path,'Sonepar defines net measurements per single unpacked product; this input explicitly describes a different basis.',refs('sonepar','§8.3–8.8'));
}
function checkOrdersAndPrices(p,profile,v,{priceOnly=false,required=profile.targets.includes('bmecat-5.0')}={}) {
  const order=v.object(p.order,'/order');
  if(!priceOnly){
  for(const key of ['unit','contentUnit'])if(v.text(order[key],'/order/'+key,{required,target:'bmecat-5.0',section:'§4c p24'})&&!ORDER_UNITS.has(order[key]))v.add('error','ORDER_UNIT_CODE','/order/'+key,'Select an order/content unit from the published ETIM subset of UN/ECE codes.',refs('bmecat-5.0','§9 pp99–100'));
  for(const key of ['contentUnitsPerOrderUnit','priceQuantity','minimum','interval'])v.number(order[key],'/order/'+key,{positive:true,float:['minimum','interval'].includes(key),section:'§4c pp24–25'});
  if(order.unit===order.contentUnit&&present(order.contentUnitsPerOrderUnit)&&!isOne(decimal(order.contentUnitsPerOrderUnit)))v.add('error','CONTENT_ORDER_FACTOR','/order/contentUnitsPerOrderUnit','When order and content units are identical, NO_CU_PER_OU is 1.',refs('bmecat-5.0','§4c p24'));
  }
  const prices=v.array(p.prices,'/prices'),seen=new Set();
  if(required&&!prices.length)v.add('error','PRICE_DETAILS_REQUIRED','/prices','Supply the original price group, validity date and amount, including explicit daily-price terms when applicable.',refs('bmecat-5.0','§4c pp25–26; §5e'));
  for(let i=0;i<prices.length;i++){
    const price=v.object(prices[i],'/prices/'+i),path='/prices/'+i;
    if(!['net_list','net_customer','nrp'].includes(price.type))v.add('error','PRICE_TYPE',path+'/type','Choose net_list, net_customer or nrp from the original price terms.',refs('bmecat-5.0','§4c pp25–26'));
    const amount=v.number(price.amount,path+'/amount',{required:true,section:'§4c pp25–26'});
    if(price.dailyPrice!==undefined&&typeof price.dailyPrice!=='boolean')v.add('error','DAILY_PRICE_BOOLEAN',path+'/dailyPrice','dailyPrice must be an explicit boolean.',refs('bmecat-5.0','§5e pp65–66'));
    if(amount&&amount.n===0n&&!(price.dailyPrice===true&&price.type==='net_list'))v.add('error','ZERO_PRICE_TERMS',path+'/amount','A zero price requires the original daily-price declaration and net_list terms.',refs('bmecat-5.0','§5e p66'));
    v.date(price.validFrom,path+'/validFrom',{required:true,section:'§4c p25'});
    v.date(price.validTo,path+'/validTo',{section:'§4c p25'});
    if(validDate(price.validFrom)&&validDate(price.validTo)&&price.validTo<price.validFrom)v.add('error','PRICE_DATE_ORDER',path+'/validTo','Price validity must end on or after its start.',refs('bmecat-5.0','§4c p25'));
    const currency=present(price.currency)?price.currency:profile.envelope.currency;
    if(typeof currency!=='string'||!ETIM_CURRENCIES.has(currency))v.add('error','PRICE_CURRENCY',path+'/currency','Set the exact three-letter currency on the price or in the catalog header.',refs('bmecat-5.0','§4c p26'));
    const tax=v.number(price.tax,path+'/tax',{positive:true,section:'§4c p26'});
    if(tax&&compare(tax,{n:1n,scale:0})>0)v.add('warning','TAX_FACTOR',path+'/tax','Tax is a decimal factor such as 0.19, not a percentage such as 19.',refs('bmecat-5.0','§4c p26'));
    v.number(price.priceFactor,path+'/priceFactor',{positive:true,section:'§4c p26'});
    v.number(price.lowerBound,path+'/lowerBound',{section:'§4c p26'});
    const territories=v.array(price.territories,path+'/territories');for(let j=0;j<territories.length;j++)if(!etimTerritory(territories[j]))v.add('error','PRICE_TERRITORY',path+'/territories/'+j,'Use the original ISO country/territory code.',refs('bmecat-5.0','§4c p26'));
    const key=[price.validFrom,price.validTo??'',price.dailyPrice===true,price.type,currency,present(price.lowerBound)?decimalText(decimal(price.lowerBound)??{n:0n,scale:0}):'1',...territories].join('\0');
    if(seen.has(key))v.add('error','PRICE_DUPLICATE',path,'Only one original price is allowed for the same validity/type/lower-bound/territory identity.',refs('bmecat-5.0','§5e p65'));seen.add(key);
    if(present(price.priceBase)){
      const base=v.object(price.priceBase,path+'/priceBase');
      if(!ORDER_UNITS.has(base.unit))v.add('error','PRICE_UNIT',path+'/priceBase/unit','Select the explicit original price unit.',refs('bmecat-5.0','§4c p26'));
      v.number(base.factor,path+'/priceBase/factor',{float:true,section:'§4c p26'});
    }
  }
}
function checkLogistics(p,profile,v) {
  const net=v.object(p.net,'/net'),packages=v.array(p.packaging,'/packaging');
  for(const key of DIMENSIONS)checkMeasurement(net[key],'/net/'+key,key,profile,v,{net:true,basis:net.basis,productsPerOrderUnit:net.productsPerOrderUnit});
  const ids=new Set(),gtins=new Set(),packingKeys=new Set();
  if(present(p.productGtin))gtins.add(p.productGtin);
  for(let i=0;i<packages.length;i++){
    const row=v.object(packages[i],'/packaging/'+i),path='/packaging/'+i;
    const min=v.number(row.min,path+'/min',{required:true,positive:true,float:true,section:'§4c pp31–33'}),max=v.number(row.max,path+'/max',{positive:true,float:true,section:'§4c pp31–33'});
    if(min&&max&&compare(min,max)>0)v.add('error','PACKING_QUANTITY_RANGE',path+'/max','The maximum packing quantity must not be below its minimum.',refs('sonepar','§8.3–8.8'));
    if(typeof row.code!=='string'||!(profile.targets.includes('bmecat-5.0')?ETIM_PACKING_UNITS.has(row.code):SOURCE_ASSETS.packaging.includes(row.code)))v.add('error','PACKING_CODE',path+'/code','Choose the original code from the published packing-unit list.',refs('sonepar','§8.3–8.8'));
    if(present(row.breakable)&&typeof row.breakable!=='boolean')v.add('error','PACKAGE_BREAK_BOOLEAN',path+'/breakable','Use an explicit boolean for whether this package may be broken.',refs('sonepar','§8.3–8.8'));
    v.number(row.parts,path+'/parts',{integer:true,positive:true,section:'§4c pp31–33'});
    localized(row.name,path+'/name',profile,v,{max:20,section:'§4c pp31–33'});
    if(profile.targets.includes('bmecat-5.0'))for(const name of typeof row.name==='string'?[row.name]:plain(row.name)?Object.values(row.name):[])if(present(name)&&!ETIM_PACKING_NAMES.has(name))v.add('error','PACKING_NAME_CODE',path+'/name','The native packing-name field permits f-pak, m-pak, d-pak, t-pak, Bas, Mellan or Topp; retain any other descriptive name separately in the review.',refs('bmecat-5.0','§4c pp31–33'));
    if(profile.targets.includes('bmecat-5.0')&&present(row.supplierProductId))v.add('info','PACKING_IDENTIFIER_RETAINED',path+'/supplierProductId','This packaging identifier remains in the review/JSONL; the native BMEcat packing-unit node carries a GTIN and has no supplier-product-ID field.',refs('bmecat-5.0','§4c pp31–33'));
    const id=row.supplierProductId;
    if(profile.targets.includes('sonepar')){
      textBound(v,id,path+'/supplierProductId','supplierProductId',profile,{required:true,section:'§2.1–2.2'});
      if(present(id)&&ids.has(id))v.add('error','PACKING_ID_DUPLICATE',path+'/supplierProductId','Each packaging level needs its own supplier identifier.',refs('sonepar','§2.1–2.2'));ids.add(id);
      if(id===p.supplierProductId&&!(row.code==='NE'&&isOne(min)&&(!max||isOne(max))))v.add('warning','PACKING_BASE_IDENTIFIER',path+'/supplierProductId','Confirm this packing level is the same original trade item before reusing the product identifier.',refs('sonepar','§2.1–2.2'));
    }
    if(present(row.gtin)){
      if(!gtinValid(row.gtin))v.add('error','GTIN_CHECK_DIGIT',path+'/gtin','Use the original packing GTIN with a valid length and GS1 check digit.',refs('sonepar','§2.2'));
      if(profile.targets.includes('sonepar')&&gtins.has(row.gtin)&&!(row.gtin===p.productGtin&&row.code==='NE'&&isOne(min)&&(!max||isOne(max))))v.add('error','PACKING_GTIN_DUPLICATE',path+'/gtin','Different trade-item packing levels must not share the same GTIN.',refs('sonepar','§2.2'));
      gtins.add(row.gtin);
    }else if(profile.targets.includes('sonepar'))v.add(profile.channels.length?'error':'warning','PACKING_GTIN',path+'/gtin','Supply the GTIN identifying this packaging level.',refs('sonepar','§2.2'));
    const identity=String(row.code)+'\0'+String(row.min)+'\0'+String(row.max);if(packingKeys.has(identity))v.add('error','PACKING_LEVEL_DUPLICATE',path,'This packing level is listed twice.',refs('sonepar','§8.3–8.8'));packingKeys.add(identity);
    for(const key of DIMENSIONS){
      checkMeasurement(row[key],path+'/'+key,key,profile,v);
      if(profile.targets.includes('sonepar')&&row.code==='NE'&&plain(row[key])&&plain(net[key])&&present(row[key].value)&&present(net[key].value)&&net.basis==='unpacked_product'){
        const a=convertedMeasurement(row[key],key),b=convertedMeasurement(net[key],key);
        if(a!==null&&b!==null&&compare(decimal(a),decimal(b))!==0)v.add('error','UNPACKED_GROSS_NET',path+'/'+key,'For an unpacked product, gross and net measurements must agree.',refs('sonepar','§8.3–8.8'));
      }
    }
    if(['C62','MTR','KGM'].includes(row.code)&&packages.filter(x=>x?.code===row.code).length>1)v.add('error','BASE_PACKING_LEVEL',path+'/code','The base piece/metre/kilogram unit cannot describe several different packing levels.',refs('bmecat-5.0','§5j pp76–83'));
  }
  checkDeliveryAndWarranty(p,profile,v);
}

function checkDeliveryAndWarranty(p,profile,v,{includeWarranty=true}={}) {
  const delivery=v.object(p.deliveryTime,'/deliveryTime');
  if(present(delivery.value)){
    v.number(delivery.value,'/deliveryTime/value',{positive:true,section:'§4c p20'});
    if(!['calendar_days','working_days'].includes(delivery.basis))v.add('error','DELIVERY_DAY_BASIS','/deliveryTime/basis','Declare calendar_days or working_days explicitly.',refs('sonepar','§8.8'));
    if(profile.targets.includes('bmecat-5.0')&&delivery.basis!=='working_days')v.add('error','DELIVERY_TIME_MAPPING','/deliveryTime/basis','BMEcat DELIVERY_TIME uses working days. Supply a separately established working-day value; calendar days are retained unchanged.',refs('bmecat-5.0','§4c p20'));
    if(profile.targets.includes('sonepar')&&delivery.basis==='working_days')v.add('warning','DELIVERY_CALENDAR_PREFERRED','/deliveryTime/basis','Sonepar prefers calendar days; the original working-day basis is retained.',refs('sonepar','§8.8'));
  }
  if(!includeWarranty)return;
  const warranty=v.object(p.warranty,'/warranty');
  for(const key of ['businessMonths','consumerMonths'])v.number(warranty[key],'/warranty/'+key,{positive:true,integer:true,section:'§4c; §8.8'});
  if((present(warranty.businessMonths)||present(warranty.consumerMonths))&&profile.targets.includes('sonepar')&&!v.array(p.assets,'/assets').some(x=>x?.code==='MD56'))v.add('error','WARRANTY_ASSET','/assets','Supply the applicable MD56 warranty document with the declared warranty period.',refs('sonepar','§8.8'));
}

function checkAssets(p,profile,v,context) {
  const assets=v.array(p.assets,'/assets'),byCode=new Map(),byFile=new Map(),now=profile.envelope.generationDate;
  const applicability=v.object(p.applicability,'/applicability');
  for(let i=0;i<assets.length;i++){
    const a=v.object(assets[i],'/assets/'+i),path='/assets/'+i;
    if(typeof a.code!=='string'||(profile.targets.includes('bmecat-5.0')?!ETIM_ASSET_CODES.has(a.code):!/^MD(?:0[1-9]|[1-5]\d|6[0-5])$/.test(a.code)))v.add('error','ASSET_CODE',path+'/code','Use the selected source’s MD asset code.',refs('sonepar','§5.1 pp27–31'));
    v.text(a.source,path+'/source',{required:true,max:profile.targets.includes('bmecat-5.0')?512:undefined,target:'bmecat-5.0',section:'§4c p27; §5f'});
    v.text(a.filename,path+'/filename',{required:profile.targets.includes('sonepar'),max:250,target:'bmecat-5.0',section:'§4c p27; §5f'});
    const file=typeof a.filename==='string'?a.filename:'',extension=file.includes('.')?file.slice(file.lastIndexOf('.')+1).toLowerCase():'';
    if(profile.targets.includes('sonepar')&&file&&/[\/\\]/.test(file))v.add('error','ASSET_FILENAME',path+'/filename','Use a file name and extension without a directory component.',refs('sonepar','§5.2 p32'));
    if(profile.targets.includes('sonepar')&&file&&byFile.has(file)&&byFile.get(file).code!==a.code)v.add('error','ASSET_TYPE_CONFLICT',path+'/code','One file name and extension can identify only one asset type.',refs('sonepar','§5.2 p32'));
    else if(file)byFile.set(file,{code:a.code,index:i});
    v.date(a.issuedAt,path+'/issuedAt',{section:'§4c p27'});
    v.date(a.expiresAt,path+'/expiresAt',{section:'§4c p27'});
    if(validDate(a.issuedAt)&&validDate(a.expiresAt)&&a.expiresAt<a.issuedAt)v.add('error','ASSET_DATE_ORDER',path+'/expiresAt','An asset cannot expire before its issue date.',refs('bmecat-5.0','§4c p27'));
    const expired=validDate(a.expiresAt)&&validDate(now)&&a.expiresAt<=now;
    if(!expired){if(!byCode.has(a.code))byCode.set(a.code,[]);byCode.get(a.code).push({asset:a,index:i});}
    if(present(a.language)&&!profile.languages.includes(a.language))v.add('error','ASSET_LANGUAGE',path+'/language','Declare this asset language in the submission profile.',refs('bmecat-5.0','§4b; §5f'));
    for(const key of ['designation','alt'])localized(a[key],path+'/'+key,profile,v,{max:key==='alt'?80:250,section:'§4c p27; §5f'});
    v.number(a.order,path+'/order',{integer:true,section:'§4c p27'});
    const delivery=a.delivery??'file';
    if(!['file','direct_download','active_deeplink','direct_playable_video','direct_360_view'].includes(delivery))v.add('error','ASSET_DELIVERY',path+'/delivery','Select the original file or supported direct URL delivery method.',refs('sonepar','§5.2'));
    if(delivery!=='file'){
      let valid=false;try{const url=new URL(a.source);valid=['https:','http:'].includes(url.protocol)&&!url.username&&!url.password}catch{}
      if(!valid)v.add('error','ASSET_URL',path+'/source','Use a complete HTTP(S) URL to the direct asset, page or playable media.',refs('sonepar','§5.2'));
    }
    if(profile.targets.includes('sonepar')&&expired&&typeof context.findPreviousProduct==='function'&&typeof p.supplierProductId==='string'){
      const previous=context.findPreviousProduct(p.supplierProductId);
      if(!Array.isArray(previous?.assets)||!previous.assets.some(x=>x.filename===a.filename))v.add('warning','ASSET_EXPIRY_IDENTITY',path+'/filename','The expiry instruction does not match a retained prior file name and extension.',refs('sonepar','§5.2'));
    }
    if(profile.targets.includes('sonepar')&&!expired){
      if(SOURCE_ASSETS.images.includes(a.code)){
        if(!SOURCE_ASSETS.imageExtensions.includes(extension))v.add('error','IMAGE_FORMAT',path+'/filename','Select JPG, JPEG, TIF, TIFF, PNG, WebP or BMP for this image.',refs('sonepar','§5.3 pp33–35'));
        const media=v.object(a.media,path+'/media');
        for(const key of ['width','height']){
          const size=v.number(media[key],path+'/media/'+key,{required:true,integer:true,positive:true,target:'sonepar',section:'§5.3'});
          if(size&&compare(size,{n:1000n,scale:0})<0)v.add('error','IMAGE_DIMENSIONS',path+'/media/'+key,'Image dimensions must be at least 1000 pixels on each side.',refs('sonepar','§5.3',{minimum:1000}));
          else if(size&&compare(size,{n:2000n,scale:0})<0)v.add('warning','IMAGE_RECOMMENDED_DIMENSIONS',path+'/media/'+key,'The preferred image dimension is at least 2000 pixels.',refs('sonepar','§5.3',{preferred:2000}));
        }
        if(media.colorMode!=='RGB')v.add('error','IMAGE_COLOR_MODE',path+'/media/colorMode','Deliver this image in RGB color mode.',refs('sonepar','§5.3'));
        const ppi=v.number(media.ppi,path+'/media/ppi',{positive:true,integer:true,target:'sonepar',section:'§5.3'});
        if(ppi&&compare(ppi,{n:72n,scale:0})!==0)v.add('warning','IMAGE_PPI',path+'/media/ppi','The selected source requests 72 ppi.',refs('sonepar','§5.3'));
        const area=v.number(media.occupiedAreaPercent,path+'/media/occupiedAreaPercent',{positive:true,target:'sonepar',section:'§5.3'});
        if(area&&compare(area,{n:85n,scale:0})<0)v.add('warning','IMAGE_OCCUPIED_AREA',path+'/media/occupiedAreaPercent','The product should occupy at least 85% of the image area.',refs('sonepar','§5.3'));
        if(media.hasWatermark===true)v.add('error','IMAGE_WATERMARK',path+'/media/hasWatermark','Remove the watermark from the original product image.',refs('sonepar','§5.3'));
        else if(present(media.hasWatermark)&&typeof media.hasWatermark!=='boolean')v.add('error','MEDIA_BOOLEAN',path+'/media/hasWatermark','Use an explicit boolean for the inspected watermark property.',refs('sonepar','§5.3'));
        const contrast=v.number(media.embeddedTextContrast,path+'/media/embeddedTextContrast',{positive:true,target:'sonepar',section:'§5.3'});
        if(contrast&&compare(contrast,{n:45n,scale:1})<0)v.add('error','IMAGE_TEXT_CONTRAST',path+'/media/embeddedTextContrast','Embedded image text needs a contrast ratio of at least 4.5.',refs('sonepar','§5.3'));
        v.number(media.sizeBytes,path+'/media/sizeBytes',{positive:true,integer:true,target:'sonepar',section:'§5.3'});
      }else if(SOURCE_ASSETS.documents.includes(a.code)){
        if(!['pdf',...(a.code==='MD19'?['ies','ldt']:[])].includes(extension))v.add('error','DOCUMENT_FORMAT',path+'/filename','Use PDF for this document type'+(a.code==='MD19'?', or its original IES/LDT photometric file.':'.'),refs('sonepar','§5.3'));
      }else if(SOURCE_ASSETS.logos.includes(a.code)&&!['eps','jpg','jpeg','png'].includes(extension))v.add('error','LOGO_FORMAT',path+'/filename','Use EPS, JPG, JPEG or PNG for the logo.',refs('sonepar','§5.3'));
      if(SOURCE_ASSETS.videos.includes(a.code)){
        if(delivery!=='direct_playable_video')v.add('error','VIDEO_DELIVERY',path+'/delivery','Deliver a direct playable video URL.',refs('sonepar','§5.3'));
        const media=v.object(a.media,path+'/media'),height=v.number(media.height,path+'/media/height',{positive:true,integer:true,target:'sonepar',section:'§5.3'});
        if(height&&compare(height,{n:720n,scale:0})<0)v.add('error','VIDEO_RESOLUTION',path+'/media/height','Video resolution must be at least 720p.',refs('sonepar','§5.3'));
        if(media.captionsToggleable===false)v.add('warning','VIDEO_CAPTIONS',path+'/media/captionsToggleable','Supplied captions should be toggleable.',refs('sonepar','§5.3'));
      }
      if(a.code==='MD37'&&!['step','dxf','stp','dwg','rfa','ifc','rvt'].includes(extension))v.add('error','CAD_FORMAT',path+'/filename','Use one of the published CAD/BIM file formats.',refs('sonepar','§5.3'));
      if(a.code==='MD46'&&delivery!=='direct_360_view')v.add('error','VIEW_360_DELIVERY',path+'/delivery','Use the direct 360-degree view URL.',refs('sonepar','§5.3'));
      if(a.code==='MD04'&&delivery!=='active_deeplink')v.add('error','PRODUCT_PAGE_DELIVERY',path+'/delivery','Use the active direct product-page URL.',refs('sonepar','§5.3'));
    }
  }
  if(profile.targets.includes('sonepar')){
    if((byCode.get('MD01')??[]).length>1)v.add('error','PRIMARY_IMAGE_CARDINALITY','/assets','A product can have one active MD01 primary image.',refs('sonepar','§5.2'));
    const category=present(p.category)?p.category:profile.category,segment=present(p.segment)?p.segment:profile.segment,required=new Set(SOURCE_ASSETS.globalRequired);
    if(category!==null&&!own(CATEGORY_ASSETS,category))v.add('error','PRODUCT_CATEGORY','/category','Select a category from the source asset matrix.',refs('sonepar','§5.1'));
    if(!category)v.add('warning','ASSET_CATEGORY_REVIEW','/category','Choose the product category to apply its required asset matrix.',refs('sonepar','§5.1'));
    const applicable=new Set([...profile.applicableAssetCodes,...v.array(applicability.assetCodes,'/applicability/assetCodes')]);
    for(const code of applicable){if(!/^MD\d{2}$/.test(code))v.add('error','APPLICABLE_ASSET_CODE','/applicability/assetCodes','Use explicit MD asset codes for applicability.',refs('sonepar','§5.1'));required.add(code)}
    for(const [code,level]of Object.entries(CATEGORY_ASSETS[category]??{}))if(level==='required'||level==='required_for_core'&&segment==='core_product'||level==='when_applicable'&&applicable.has(code))required.add(code);
    if(segment==='core_product'){
      for(const code of [...profile.applicableCoreManualCodes,...v.array(applicability.coreManualCodes,'/applicability/coreManualCodes'),...profile.applicableCoreAdditionalCodes,...v.array(applicability.coreAdditionalCodes,'/applicability/coreAdditionalCodes')])required.add(code);
      if((applicability.coreVideo??profile.applicableCoreVideo)&&!SOURCE_ASSETS.videos.some(code=>byCode.has(code)))v.add('error','CORE_VIDEO_REQUIRED','/assets','Supply at least one applicable product video for this core product.',refs('sonepar','§5.1'));
    }
    for(const code of required)if(!byCode.has(code))v.add('error','ASSET_REQUIRED','/assets','The selected product/category profile requires active asset '+code+'.',refs('sonepar','§5.1',{assetCode:code,category,segment}));
    for(const [code,entries]of byCode)if(SOURCE_ASSETS.documents.includes(code))for(const language of profile.languages)if(!entries.some(x=>x.asset.language===language||!present(x.asset.language)&&language===profile.defaultLanguage))v.add('warning','DOCUMENT_LANGUAGE','/assets','Provide '+code+' in selected language '+language+'.',refs('sonepar','§5.1–5.3',{assetCode:code,language}));
  }
}


function checkRelations(p,profile,v,context) {
  const relations=v.array(p.relations,'/relations'),seen=new Set();let successors=0;
  const referenceDate=profile.envelope.generationDate;
  for(let i=0;i<relations.length;i++){
    const row=v.object(relations[i],'/relations/'+i),path='/relations/'+i,type=RELATIONS[row.type];
    if(!type)v.add('error','RELATION_TYPE',path+'/type','Use a documented Sonepar relation or an original BMEcat reference type.',refs('bmecat-5.0','§4c pp46–47; §5g pp70–71'));
    v.text(row.targetSupplierProductId,path+'/targetSupplierProductId',{required:true,max:80,target:'bmecat-5.0',section:'§4c pp46–47'});
    if(row.targetSupplierProductId===p.supplierProductId)v.add('error','RELATION_SELF',path+'/targetSupplierProductId','A product relation must identify another product.',refs('sonepar','§6.1–6.7 pp37–41'));
    const identity=String(type)+'\0'+String(row.targetSupplierProductId)+'\0'+String(row.catalogId??'');
    if(seen.has(identity))v.add('error','RELATION_DUPLICATE',path,'The same typed relation occurs twice.',refs('sonepar','§6.1–6.7'));seen.add(identity);
    v.number(row.quantity,path+'/quantity',{integer:true,section:'§4c pp46–47'});
    v.text(row.catalogId,path+'/catalogId',{max:20,target:'bmecat-5.0',section:'§4c pp46–47'});
    if(present(row.catalogVersion)&&!/^\d{1,3}\.\d{1,3}$/.test(row.catalogVersion))v.add('error','RELATION_CATALOG_VERSION',path+'/catalogVersion','Use the exact referenced catalog version.',refs('bmecat-5.0','§4c pp46–47'));
    localized(row.description,path+'/description',profile,v,{max:250,section:'§4c pp46–47'});
    const external=present(row.catalogId)&&row.catalogId!==profile.envelope.catalogId;
    let target=null;
    if(typeof context.findProduct==='function'&&typeof row.targetSupplierProductId==='string'&&!external){
      target=context.findProduct(row.targetSupplierProductId);
      if(target&&typeof target.then==='function')throw failure('SUPPLIER_CONTEXT_ASYNC','findProduct must read the current immutable review synchronously.');
      if(target?.product&&plain(target.product))target=target.product;
      if(!target)v.add('error','RELATION_TARGET_MISSING',path+'/targetSupplierProductId','The referenced product is absent from this immutable submission review.',refs('sonepar','§6.1–6.7'));
    }else if(!external&&profile.targets.includes('sonepar'))v.add('info','RELATION_TARGET_REVIEW',path+'/targetSupplierProductId','Cross-product target checks run against the complete immutable review.',refs('sonepar','§6.1–6.7'));
    if(profile.targets.includes('sonepar')&&type==='followup'){
      successors++;
      if(!validDate(p.expiresAt))v.add('error','SUCCESSOR_SOURCE_EXPIRY','/expiresAt','A successor relation requires the original product’s expiry or planned expiry date.',refs('sonepar','§6.1'));
      if(target&&validDate(target.expiresAt)&&validDate(referenceDate)&&target.expiresAt<=referenceDate)v.add('error','SUCCESSOR_TARGET_ACTIVE',path+'/targetSupplierProductId','The successor must be active at the submission’s declared generation date.',refs('sonepar','§6.1'));
      if(target&&typeof context.findProduct==='function'){
        const visited=new Set([p.supplierProductId]);let cursor=target;
        while(cursor&&typeof cursor.supplierProductId==='string'){
          if(visited.has(cursor.supplierProductId)){v.add('error','SUCCESSOR_CYCLE',path,'The successor references form a cycle in the immutable review.',refs('sonepar','§6.1'));break}
          visited.add(cursor.supplierProductId);
          const next=Array.isArray(cursor.relations)?cursor.relations.find(x=>RELATIONS[x?.type]==='followup'&&!present(x.catalogId)):null;
          if(!next)break;cursor=context.findProduct(next.targetSupplierProductId);if(cursor?.product)cursor=cursor.product;
        }
      }
    }
    if(profile.targets.includes('sonepar')&&['base_product','consists_of','others'].includes(type))v.add('info','NATIVE_RELATION_RETAINED',path+'/type','This original BMEcat relation is retained with its native semantics.',refs('bmecat-5.0','§5g pp70–71'));
  }
  if(profile.targets.includes('sonepar')&&successors>1)v.add('error','SUCCESSOR_CARDINALITY','/relations','Sonepar successor relations are one-to-one.',refs('sonepar','§6.1'));
  const segment=present(p.segment)?p.segment:profile.segment;
  if(profile.targets.includes('sonepar')&&segment==='core_product'&&!relations.length&&!v.array(p.variants,'/variants').length)v.add('warning','CORE_RELATIONS','/relations','Supply the applicable product relations for this core product.',refs('sonepar','§6; §7.6'));
  const variants=v.array(p.variants,'/variants'),groups=new Set();
  const identityValues=value=>JSON.stringify((Array.isArray(value)?value:[]).map(x=>typeof x==='string'?['',x]:[x?.language,x?.value]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  for(let i=0;i<variants.length;i++){
    const group=v.object(variants[i],'/variants/'+i),path='/variants/'+i;
    v.text(group.groupId,path+'/groupId',{required:true,target:'sonepar',section:'§6.7'});
    if(groups.has(group.groupId))v.add('error','VARIANT_GROUP_DUPLICATE',path+'/groupId','A product must not repeat the same variant group.',refs('sonepar','§6.7'));groups.add(group.groupId);
    if(!/^EF\d{6}$/.test(group.featureCode??'')||!Array.isArray(p.classification?.etim?.features)||!p.classification.etim.features.some(x=>x.code===group.featureCode))v.add('error','VARIANT_FEATURE',path+'/featureCode','Choose an existing original ETIM feature from this product’s class.',refs('sonepar','§6.7'));
    const targets=v.array(group.targetSupplierProductIds,path+'/targetSupplierProductIds',{required:true}),targetIds=new Set();
    if(!targets.length)v.add('error','VARIANT_TARGETS',path+'/targetSupplierProductIds','A variant group needs at least one other product.',refs('sonepar','§6.7'));
    for(let j=0;j<targets.length;j++){
      const id=targets[j],tp=path+'/targetSupplierProductIds/'+j;
      v.text(id,tp,{required:true,target:'sonepar',section:'§6.7'});
      if(id===p.supplierProductId||targetIds.has(id))v.add('error','VARIANT_TARGET_IDENTITY',tp,'Variant references contain all distinct other products exactly once.',refs('sonepar','§6.7'));targetIds.add(id);
      if(typeof context.findProduct==='function'){
        let target=context.findProduct(id);if(target?.product)target=target.product;
        if(!target){v.add('error','VARIANT_TARGET_MISSING',tp,'The variant product is absent from this immutable review.',refs('sonepar','§6.7'));continue}
        if(target.brand!==p.brand||target.classification?.etim?.classId!==p.classification?.etim?.classId||identityValues(target.series)!==identityValues(p.series))v.add('error','VARIANT_IDENTITY',tp,'Variants share the same brand, ETIM class and product series.',refs('sonepar','§6.7'));
        if(Array.isArray(p.types)&&p.types.length&&identityValues(target.types)!==identityValues(p.types))v.add('error','VARIANT_TYPE',tp,'Retain the shared type when it is available for this variant group.',refs('sonepar','§6.7'));
        const reverse=Array.isArray(target.variants)?target.variants.find(x=>x.groupId===group.groupId&&x.featureCode===group.featureCode):null;
        const expected=new Set([p.supplierProductId,...targets].filter(x=>x!==id));
        if(!reverse||!Array.isArray(reverse.targetSupplierProductIds)||reverse.targetSupplierProductIds.length!==expected.size||reverse.targetSupplierProductIds.some(x=>!expected.has(x)))v.add('error','VARIANT_ALL_PAIRS',tp,'Every product in the group must reference each other product under the same feature.',refs('sonepar','§6.7'));
      }
    }
  }
  if(profile.targets.includes('sonepar')&&groups.size>4)v.add('warning','VARIANT_GROUP_COUNT','/variants','The guide recommends publishing about three to four variant groups.',refs('sonepar','§6.7',{preferredMaximum:4}));
  if(profile.targets.includes('bmecat-5.0')&&variants.length)v.add('info','VARIANT_MAPPING_RETAINED','/variants','Variant group/feature semantics remain in the lossless review and JSONL; no undocumented BMEcat reference type is inserted.',refs('sonepar','§6.7; §4.5'));
}
function checkPartyIds(profile,v){
  for(const kind of ['buyer','supplier']){
    const party=profile.envelope[kind],ids=partyIdentifiers(party),allowed=kind==='buyer'?['gln','buyer_specific']:['gln','duns'];
    if(ids.length>2)v.add('error','PARTY_ID_CARDINALITY','/profile/envelope/'+kind+'/ids','BMEcat permits up to two identifiers for this party.',refs('bmecat-5.0','§4b pp15–16'));
    const types=new Set();
    for(let i=0;i<ids.length;i++){
      const id=ids[i],path='/profile/envelope/'+kind+'/ids/'+i;
      if(!allowed.includes(id.type))v.add('error','PARTY_ID_TYPE',path+'/type','Select the original '+allowed.join(' or ')+' type.',refs('bmecat-5.0','§4b pp15–16'));
      v.text(id.value,path+'/value',{required:true,max:250,target:'bmecat-5.0',section:'§4b pp15–16'});
      if(types.has(id.type))v.add('error','PARTY_ID_DUPLICATE',path+'/type','Use each party identifier type once.',refs('bmecat-5.0','§4b pp15–16'));types.add(id.type);
      if(id.type==='gln'){
        if(!/^\d{13}$/.test(id.value??''))v.add('error','GLN_FORMAT',path+'/value','A GLN needs its original 13 digits.',refs('bmecat-5.0','§4b pp15–16'));
        else if(!gtinValid(id.value))v.add('warning','GLN_CHECK_DIGIT',path+'/value','The original GLN has a nonmatching GS1 check digit; its exact source value remains available for receiver review.',refs('bmecat-5.0','§4b pp15–16'));
      }
      if(id.type==='duns'&&!/^\d{9}$/.test(id.value??''))v.add('error','DUNS_FORMAT',path+'/value','A D-U-N-S identifier contains nine unformatted digits.',refs('bmecat-5.0','§4b p15'));
    }
  }
  const address=profile.envelope.supplier.address;
  if(present(address)){
    const a=v.object(address,'/profile/envelope/supplier/address');
    for(const [key,max]of [['contact',50],['street',50],['zip',20],['city',50],['country',50]])localized(a[key],'/profile/envelope/supplier/address/'+key,profile,v,{max,section:'§4b pp15–16'});
    v.text(a.vatId,'/profile/envelope/supplier/address/vatId',{max:50,target:'bmecat-5.0',section:'§4b p16'});
    v.text(a.email,'/profile/envelope/supplier/address/email',{required:true,max:255,target:'bmecat-5.0',section:'§4b p16'});
    v.text(a.url,'/profile/envelope/supplier/address/url',{max:255,target:'bmecat-5.0',section:'§4b p16'});
  }
}
export function checkSupplierProduct(product, profile, context = {}) {
  const selected=normalizeSupplierProfile(profile),p=clone(product),v=validation(selected);
  if(!plain(p)){v.add('error','PRODUCT_OBJECT','/','A supplier product must be a JSON object.',refs('sonepar','Product data structure'));return freeze({product:p,findings:v.findings})}
  checkEnvelope(selected,v,context.submission??{});
  if(selected.targets.includes('bmecat-5.0'))checkPartyIds(selected,v);
  const transaction=selected.envelope.transaction;
  if(transaction==='T_UPDATE_PRICES'){
    textBound(v,p.supplierProductId,'/supplierProductId','supplierProductId',selected,{required:true,section:'§4e'});
    checkOrdersAndPrices(p,selected,v,{priceOnly:true,required:true});
  }else{
    checkIdentification(p,selected,v,context);
    checkDescriptions(p,selected,v);
    checkClassification(p,selected,v,{required:transaction==='T_NEW_CATALOG'||selected.targets.includes('sonepar')});
    if(transaction==='T_NEW_PRODUCTDATA'){
      checkDeliveryAndWarranty(p,selected,v,{includeWarranty:false});
      for(const key of ['order','prices','discountGroup','net','packaging','warranty','customsTariff','stockIndicator'])if(supplied(p[key]))v.add('info','TRANSACTION_FIELD_RETAINED','/'+key,'T_NEW_PRODUCTDATA omits this commercial/logistics field; the exact source remains in the review and JSONL.',refs('bmecat-5.0','§4f; typeudxPRODUCTDATA'));
    }else{
      checkOrdersAndPrices(p,selected,v);
      checkLogistics(p,selected,v);
    }
    checkAssets(p,selected,v,context);
    checkRelations(p,selected,v,context);
  }
  if(present(p.mode)){
    const allowed=transaction==='T_UPDATE_PRODUCTS'?['new','update','delete']:transaction==='T_UPDATE_PRICES'?['update']:['new'];
    if(!allowed.includes(p.mode))v.add('error','PRODUCT_MODE','/mode','Select a product mode supported by the declared transaction.',refs('bmecat-5.0','§2; §4c–f'));
  }else if(transaction==='T_UPDATE_PRODUCTS')v.add('error','PRODUCT_MODE','/mode','A product update must declare new, update or delete.',refs('bmecat-5.0','§4d'));
  if(present(p.segment)&&!['longtail','core_product','special'].includes(p.segment))v.add('error','PRODUCT_SEGMENT','/segment','Select longtail, core_product or special.',refs('sonepar','§7.6'));
  for(const rule of selected.localRules){
    const value=pointerValue(p,rule.path),severity=rule.severity??'error';
    if(rule.required&&(!present(value)||typeof value==='string'&&!value.trim()))v.add(severity,rule.code,rule.path,rule.message,rule.rule);
    if(rule.maxCharacters!==undefined&&typeof value==='string'&&characters(value)>rule.maxCharacters)v.add(severity,rule.code,rule.path,rule.message,rule.rule);
    if(rule.allowedValues&&present(value)&&!rule.allowedValues.includes(value))v.add(severity,rule.code,rule.path,rule.message,rule.rule);
  }
  return freeze({product:p,findings:v.findings});
}
function partyIdentifiers(party){
  const ids=Array.isArray(party.ids)?party.ids.map(x=>({type:x.type,value:x.value})):[];
  if(present(party.id)&&!ids.some(x=>x.type===party.idType&&x.value===party.id))ids.push({type:party.idType,value:party.id});
  return ids;
}
function convertedMeasurement(m,field,{basis,productsPerOrderUnit}={}){
  if(!plain(m)||!present(m.value))return null;
  const d=decimal(m.value),scale=UNIT_SCALE[m.unit],dimension=['weight','volume'].includes(field)?field:'length';
  if(!d||!scale||scale[0]!==dimension)return null;
  if(scale[1]===0&&basis!=='unpacked_product')return m.value;
  let result={n:d.n,scale:d.scale-scale[1]};
  if(basis==='unpacked_product'){
    const count=decimal(productsPerOrderUnit);if(!count||count.n<=0n||dimension==='length'&&!isOne(count))return null;
    if(scale[1]===0&&isOne(count))return m.value;
    result={n:result.n*count.n,scale:result.scale+count.scale};
  }
  return decimalText(result);
}


function xml(value){
  if(typeof value!=='string'||!xmlCharacters(value))throw failure('SUPPLIER_XML_VALUE','Only checked original strings can be serialized as XML text.');
  return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function element(name,value,attributes={}){
  if(!present(value))return '';
  const attrs=Object.entries(attributes).filter(([,v])=>present(v)).map(([k,v])=>' '+k+'="'+xml(v)+'"').join('');
  return '<'+name+attrs+'>'+xml(value)+'</'+name+'>';
}
function localizedElements(name,value,profile,attributes={}){
  if(!present(value))return '';
  if(typeof value==='string')return element(name,value,attributes);
  if(!plain(value))throw failure('SUPPLIER_XML_LOCALIZED','A localized export value must be a string or language map.');
  return Object.entries(value).map(([language,text])=>element(name,text,{...attributes,lang:language})).join('');
}
function identityElements(name,values,profile){
  return (Array.isArray(values)?values:[]).map(value=>typeof value==='string'?element(name,value):element(name,value.value,{lang:value.language})).join('');
}
function headerXml(profile){
  const e=profile.envelope;
  let catalog=profile.languages.map(language=>element('LANGUAGE',language,language===profile.defaultLanguage?{default:'true'}:{})).join('');
  catalog+=element('CATALOG_ID',e.catalogId)+element('CATALOG_VERSION',e.catalogVersion)+localizedElements('CATALOG_NAME',e.catalogName,profile);
  catalog+='<DATETIME type="generation_date">'+element('DATE',e.generationDate)+'</DATETIME>';
  catalog+=profile.countries.map(country=>element('TERRITORY',country)).join('')+element('CURRENCY',e.currency)+localizedElements('MIME_ROOT',e.mimeRoot,profile);
  const party=kind=>{
    const p=e[kind],name=kind.toUpperCase();let body=partyIdentifiers(p).map(id=>element(name+'_ID',id.value,{type:id.type})).join('')+element(name+'_NAME',p.name);
    if(kind==='supplier'&&plain(p.address)){
      const a=p.address;
      body+='<ADDRESS type="supplier">';
      for(const [key,node]of [['contact','CONTACT'],['street','STREET'],['zip','ZIP'],['city','CITY'],['country','COUNTRY']])body+=localizedElements(node,a[key],profile);
      body+=element('VAT_ID',a.vatId)+element('EMAIL',a.email)+element('URL',a.url)+'</ADDRESS>';
    }
    return '<'+name+'>'+body+'</'+name+'>';
  };
  return '<HEADER>'+element('GENERATOR_INFO','Stellar Merchant Workspace supplier profile '+PROFILE_ID)+'<CATALOG>'+catalog+'</CATALOG>'+party('buyer')+party('supplier')+'<USER_DEFINED_EXTENSIONS><UDX.EDXF.VERSION>5.0</UDX.EDXF.VERSION></USER_DEFINED_EXTENSIONS></HEADER>';
}
function pricesXml(prices){
  const groups=new Map();
  for(const price of prices){
    const identity=JSON.stringify([price.validFrom,price.validTo??'',price.dailyPrice??null,price.priceBase??null]);
    if(!groups.has(identity))groups.set(identity,[]);groups.get(identity).push(price);
  }
  return [...groups.values()].map(rows=>{
    const first=rows[0];let body='<DATETIME type="valid_start_date">'+element('DATE',first.validFrom)+'</DATETIME>';
    if(present(first.validTo))body+='<DATETIME type="valid_end_date">'+element('DATE',first.validTo)+'</DATETIME>';
    if(typeof first.dailyPrice==='boolean')body+=element('DAILY_PRICE',first.dailyPrice?'true':'false');
    for(const p of rows){
      body+='<PRODUCT_PRICE price_type="'+xml(p.type)+'">'+element('PRICE_AMOUNT',p.amount)+element('PRICE_CURRENCY',p.currency)+element('TAX',p.tax)+element('PRICE_FACTOR',p.priceFactor)+element('LOWER_BOUND',p.lowerBound)+(p.territories??[]).map(value=>element('TERRITORY',value)).join('')+'</PRODUCT_PRICE>';
    }
    if(first.priceBase)body+='<PRICE_BASE>'+element('PRICE_UNIT',first.priceBase.unit)+element('PRICE_UNIT_FACTOR',first.priceBase.factor)+'</PRICE_BASE>';
    return '<PRODUCT_PRICE_DETAILS>'+body+'</PRODUCT_PRICE_DETAILS>';
  }).join('');
}
function featuresXml(classification,profile){
  const c=classification??{},etim=c.etim??{};
  let result='';
  if(present(etim.version)||present(etim.classId)||etim.features?.length){
  result='<PRODUCT_FEATURES>'+element('REFERENCE_FEATURE_SYSTEM_NAME',etim.version)+element('REFERENCE_FEATURE_GROUP_ID',etim.classId);
  for(const f of etim.features??[]){
    result+='<FEATURE>'+element('FNAME',f.code)+(f.values??[]).map(value=>element('FVALUE',value)).join('')+element('FUNIT',f.unit)+localizedElements('FVALUE_DETAILS',f.details,profile)+'</FEATURE>';
  }
  result+='</PRODUCT_FEATURES>';
  }
  for(const [key,name]of [['unspsc','UNSPSC'],['eclass','ECLASS']])if(present(c[key]?.code))result+='<PRODUCT_FEATURES>'+element('REFERENCE_FEATURE_SYSTEM_NAME',name+'-'+c[key].version)+element('REFERENCE_FEATURE_GROUP_ID',c[key].code)+'</PRODUCT_FEATURES>';
  return result;
}
function orderXml(order){
  return '<PRODUCT_ORDER_DETAILS>'+[['unit','ORDER_UNIT'],['contentUnit','CONTENT_UNIT'],['contentUnitsPerOrderUnit','NO_CU_PER_OU'],['priceQuantity','PRICE_QUANTITY'],['minimum','QUANTITY_MIN'],['interval','QUANTITY_INTERVAL']].map(([key,node])=>element(node,order?.[key])).join('')+'</PRODUCT_ORDER_DETAILS>';
}
function assetsXml(assets,profile){
  if(!Array.isArray(assets)||!assets.length)return '';
  return '<UDX.EDXF.MIME_INFO>'+assets.map(a=>{
    const language=present(a.language)?{lang:a.language}:{};
    let body=element('UDX.EDXF.MIME_SOURCE',a.source,language)+element('UDX.EDXF.MIME_CODE',a.code)+element('UDX.EDXF.MIME_FILENAME',a.filename,language);
    body+=typeof a.designation==='string'?element('UDX.EDXF.MIME_DESIGNATION',a.designation,language):localizedElements('UDX.EDXF.MIME_DESIGNATION',a.designation,profile);
    body+=typeof a.alt==='string'?element('UDX.EDXF.MIME_ALT',a.alt,language):localizedElements('UDX.EDXF.MIME_ALT',a.alt,profile);
    body+=element('UDX.EDXF.MIME_ISSUE_DATE',a.issuedAt)+element('UDX.EDXF.MIME_EXPIRY_DATE',a.expiresAt)+element('UDX.EDXF.MIME_ORDER',a.order);
    return '<UDX.EDXF.MIME>'+body+'</UDX.EDXF.MIME>';
  }).join('')+'</UDX.EDXF.MIME_INFO>';
}
function packingXml(packages,profile){
  if(!Array.isArray(packages)||!packages.length)return '';
  return '<UDX.EDXF.PACKING_UNITS>'+packages.map(p=>{
    let body=element('UDX.EDXF.QUANTITY_MIN',p.min)+element('UDX.EDXF.QUANTITY_MAX',p.max)+element('UDX.EDXF.PACKING_UNIT_CODE',p.code)+localizedElements('UDX.EDXF.PACKING_UNIT_NAME',p.name,profile);
    if(typeof p.breakable==='boolean')body+=element('UDX.EDXF.PACKAGE_BREAK',p.breakable?'true':'false');
    body+=element('UDX.EDXF.PACKING_PARTS',p.parts);
    for(const key of ['volume','weight','length','width','depth','diameter'])body+=element('UDX.EDXF.'+key.toUpperCase(),convertedMeasurement(p[key],key));
    body+=element('UDX.EDXF.GTIN',p.gtin);
    return '<UDX.EDXF.PACKING_UNIT>'+body+'</UDX.EDXF.PACKING_UNIT>';
  }).join('')+'</UDX.EDXF.PACKING_UNITS>';
}
function netXml(net){
  if(!plain(net))return '';
  const body=['volume','weight','length','width','depth','diameter'].map(key=>element('UDX.EDXF.NET'+key.toUpperCase(),convertedMeasurement(net[key],key,{basis:net.basis,productsPerOrderUnit:net.productsPerOrderUnit}))).join('');
  return body?'<UDX.EDXF.PRODUCT_LOGISTIC_DETAILS>'+body+'</UDX.EDXF.PRODUCT_LOGISTIC_DETAILS>':'';
}
function branchXml(p,key){
  const rows=p[key];if(!Array.isArray(rows)||!rows.length)return '';
  const plural=key==='branchNumbers'?'UDX.EDXF.COUNTRY_BRANCH_NUMBERS':'UDX.EDXF.COUNTRY_BRANCH_SUPPLIER_IDS',single=key==='branchNumbers'?'UDX.EDXF.COUNTRY_BRANCH_NUMBER':'UDX.EDXF.COUNTRY_BRANCH_SUPPLIER_ID';
  return '<'+plural+'>'+rows.map(row=>element(single,row.value,{type:row.type,country:row.country})).join('')+'</'+plural+'>';
}
function extensionsXml(p,profile,{productData=false}={}){
  let body=assetsXml(p.assets,profile);
  for(const [language,d]of Object.entries(p.descriptions??{}))body+=element('UDX.EDXF.DESCRIPTION_VERY_SHORT',d.veryShort,{lang:language});
  body+=element('UDX.EDXF.BRAND_NAME',p.brand)+element('UDX.EDXF.EXPIRATION_DATE',p.expiresAt);
  const discounts=p.discountGroup??{};
  if(!productData&&(present(discounts.manufacturer)||present(discounts.supplier)))body+='<UDX.EDXF.DISCOUNT_GROUP>'+element('UDX.EDXF.DISCOUNT_GROUP_MANUFACTURER',discounts.manufacturer)+element('UDX.EDXF.DISCOUNT_GROUP_SUPPLIER',discounts.supplier)+'</UDX.EDXF.DISCOUNT_GROUP>';
  if(!productData&&typeof p.stockIndicator==='boolean')body+=element('UDX.EDXF.PRODUCT_TO_STOCK',p.stockIndicator?'true':'false');
  body+=identityElements('UDX.EDXF.PRODUCT_SERIES',p.series,profile)+identityElements('UDX.EDXF.PRODUCT_VARIATION',p.types,profile);
  body+=branchXml(p,'branchNumbers')+branchXml(p,'branchSupplierIds');
  if(!productData)body+=packingXml(p.packaging,profile)+netXml(p.net);
  const warranty=p.warranty??{};
  if(!productData&&(present(warranty.businessMonths)||present(warranty.consumerMonths)))body+='<UDX.EDXF.WARRANTY>'+element('UDX.EDXF.WARRANTY_BUSINESS',warranty.businessMonths)+element('UDX.EDXF.WARRANTY_CONSUMER',warranty.consumerMonths)+'</UDX.EDXF.WARRANTY>';
  return '<USER_DEFINED_EXTENSIONS>'+body+'</USER_DEFINED_EXTENSIONS>';
}
function productXml(p,profile){
  const transaction=profile.envelope.transaction,mode=p.mode??(transaction==='T_UPDATE_PRICES'?'update':'new');
  let result='<PRODUCT mode="'+xml(mode)+'">'+element('SUPPLIER_PID',p.supplierProductId);
  if(transaction==='T_UPDATE_PRICES')return result+pricesXml(p.prices??[])+'</PRODUCT>';
  let details='';
  for(const [language,d]of Object.entries(p.descriptions??{}))details+=element('DESCRIPTION_SHORT',d.short,{lang:language});
  for(const [language,d]of Object.entries(p.descriptions??{}))details+=element('DESCRIPTION_LONG',d.long,{lang:language});
  details+=element('INTERNATIONAL_PID',p.productGtin,{type:'gtin'})+element('SUPPLIER_ALT_PID',p.alternativeSupplierId)+element('MANUFACTURER_PID',p.manufacturerProductId)+element('MANUFACTURER_NAME',p.manufacturerName)+localizedElements('MANUFACTURER_TYPE_DESCR',p.manufacturerTypeDescription,profile);
  details+=element('DELIVERY_TIME',p.deliveryTime?.value);
  if((present(p.segment)?p.segment:profile.segment)==='core_product')details+=element('PRODUCT_STATUS','core_assortment',{type:'core_product'});
  const productData=transaction==='T_NEW_PRODUCTDATA';
  result+='<PRODUCT_DETAILS>'+details+'</PRODUCT_DETAILS>'+featuresXml(p.classification,profile);
  if(!productData)result+=orderXml(p.order)+pricesXml(p.prices??[]);
  result+=extensionsXml(p,profile,{productData});
  for(const reference of p.relations??[]){
    const attrs={type:RELATIONS[reference.type]};if(present(reference.quantity))attrs.quantity=reference.quantity;
    result+='<PRODUCT_REFERENCE'+Object.entries(attrs).map(([key,value])=>' '+key+'="'+xml(value)+'"').join('')+'>'+element('PROD_ID_TO',reference.targetSupplierProductId)+element('CATALOG_ID',reference.catalogId)+element('CATALOG_VERSION',reference.catalogVersion)+localizedElements('REFERENCE_DESCR',reference.description,profile)+'</PRODUCT_REFERENCE>';
  }
  if(!productData&&present(p.customsTariff))result+='<PRODUCT_LOGISTIC_DETAILS><CUSTOMS_TARIFF_NUMBER>'+element('CUSTOMS_NUMBER',p.customsTariff)+'</CUSTOMS_TARIFF_NUMBER></PRODUCT_LOGISTIC_DETAILS>';
  return result+'</PRODUCT>';
}

/**
 * Verify transaction coverage from the immutable review's supplier-ID column.
 * Only IDs are retained; products and XML are never materialized a second time.
 */
export function checkSupplierProductCoverage(productIdsIterable, profile, {submission = {}} = {}) {
  const selected=normalizeSupplierProfile(profile),v=validation(selected),ids=new Set();
  requireValue(productIdsIterable&&typeof productIdsIterable!=='string'&&typeof productIdsIterable[Symbol.iterator]==='function','SUPPLIER_COVERAGE_IDS','Provide the original synchronous immutable supplier-ID iterator.');
  requireValue(plain(submission),'SUPPLIER_COVERAGE_SUBMISSION','Provide the immutable submission metadata object.');
  let productCount=0;
  for(const id of productIdsIterable){
    const path='/supplierProductIds/'+productCount;productCount++;
    if(typeof id!=='string'||!id.length){
      v.add('error','SUPPLIER_ID_REQUIRED',path,'The immutable review contains a product without its exact supplier product identifier.',refs('bmecat-5.0','§4c–f'));
      continue;
    }
    if(ids.has(id))v.add('error','SUPPLIER_EXPORT_DUPLICATE',path,'The immutable review contains repeated supplier product identifier '+JSON.stringify(id)+'. Keep one product per supplier identifier.',refs('bmecat-5.0','§4c–f'));
    ids.add(id);
  }
  if(!productCount)v.add('error','SUPPLIER_EXPORT_EMPTY','/supplierProductIds','A BMEcat transaction must include at least one original product.',refs('bmecat-5.0','§4c–f'));
  let expectedProductCount=null;
  if(selected.envelope.transaction==='T_UPDATE_PRICES'){
    const suppliedPrevious=submission.previousProductIds??selected.envelope.previousProductIds;
    const path=submission.previousProductIds!==undefined&&submission.previousProductIds!==null?'/submission/previousProductIds':'/profile/envelope/previousProductIds';
    if(!Array.isArray(suppliedPrevious)){
      v.add('error','PRICE_UPDATE_COVERAGE',path,'A price-only update needs the previous complete catalog product-ID set to preserve its coverage.',refs('bmecat-5.0','§2 p7; §4e pp52–53'));
    }else{
      const expected=list(suppliedPrevious,path),expectedSet=new Set(expected);expectedProductCount=expected.length;
      for(let index=0;index<expected.length;index++)if(!ids.has(expected[index]))
        v.add('error','PRICE_UPDATE_PRODUCT_MISSING',path+'/'+index,'The price-only update is missing original catalog product '+JSON.stringify(expected[index])+'. Include that product in the selected edition.',refs('bmecat-5.0','§2 p7; §4e pp52–53'));
      for(const id of ids)if(!expectedSet.has(id))
        v.add('error','PRICE_UPDATE_PRODUCT_ADDED','/supplierProductIds/'+escapedPointer(id),'The price-only update contains product '+JSON.stringify(id)+' outside the original catalog. Select the correct previous catalog or a product-update transaction.',refs('bmecat-5.0','§2 p7; §4e pp52–53'));
    }
  }
  return freeze({productCount,distinctProductCount:ids.size,expectedProductCount,findings:v.findings});
}

export function exportSupplierProducts(rowsIterable,{profile,submission={},format='products.jsonl',productIds}={}){
  const selected=normalizeSupplierProfile(profile);
  submission=freeze(clone(submission));
  requireValue(rowsIterable&&typeof rowsIterable[Symbol.iterator]==='function','SUPPLIER_EXPORT_ROWS','Provide the original synchronous immutable review row iterator.');
  if(['jsonl','products.jsonl','supplier.jsonl'].includes(format)){
    const metadata=freeze({schema:'stellar-forge.supplier-export.v1',profile:selected,submission:clone(submission),format:'products.jsonl'});
    return {contentType:'application/x-ndjson; charset=utf-8',filename:'supplier-products.jsonl',metadata,body:(function*(){yield JSON.stringify({kind:'supplier-export',...metadata})+'\n';for(const row of rowsIterable)yield JSON.stringify({kind:'review-row',row:clone(row)})+'\n';})()};
  }
  requireValue(['bmecat.xml','bmecat-5.0','xml'].includes(format),'SUPPLIER_EXPORT_FORMAT','Select products.jsonl or bmecat.xml.');
  requireValue(selected.targets.includes('bmecat-5.0'),'SUPPLIER_EXPORT_TARGET','Select the BMEcat 5.0 target before XML export.');
  const global=validation(selected);checkEnvelope(selected,global,submission);checkPartyIds(selected,global);
  const coverage=productIds===undefined?null:checkSupplierProductCoverage(productIds,selected,{submission});
  if(coverage)global.findings.push(...coverage.findings);
  const globalErrors=global.findings.filter(x=>x.severity==='error');
  if(globalErrors.length)throw failure('SUPPLIER_EXPORT_REVIEW','Resolve the catalog-envelope findings before XML export.',{findings:globalErrors});
  const e=selected.envelope,metadata=freeze({schema:'stellar-forge.supplier-export.v1',profileId:selected.id,implementation:PROFILE_ID,target:'bmecat-5.0',sources:PROFILE_SOURCE,submission:clone(submission),transaction:e.transaction,catalogId:e.catalogId,catalogVersion:e.catalogVersion,generationDate:e.generationDate});
  return {contentType:'application/xml; charset=utf-8',filename:'catalog_'+e.generationDate+'.xml',metadata,body:(function*(){
    yield '<?xml version="1.0" encoding="UTF-8"?>\n<BMECAT xmlns="https://www.etim-international.com/bmecat/50" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="https://www.etim-international.com/bmecat/50 https://www.etim-international.com/bmecat_etim_50.xsd" version="2005">\n';
    yield headerXml(selected)+'\n';
    yield '<'+e.transaction+(e.transaction.startsWith('T_UPDATE_')?' prev_version="'+xml(e.previousVersion)+'"':'')+'>\n';
    const ids=new Set(),expected=e.transaction==='T_UPDATE_PRICES'?new Set(submission.previousProductIds??e.previousProductIds):null;
    let count=0;
    for(const row of rowsIterable){
      const input=plain(row)&&own(row,'product')?row.product:row,checked=checkSupplierProduct(input,selected,{submission}),p=checked.product;
      const errors=[...(Array.isArray(row?.findings)?row.findings:[]),...checked.findings].filter(x=>x?.severity==='error');
      if(errors.length)throw failure('SUPPLIER_EXPORT_REVIEW','Resolve the selected product findings before XML export.',{supplierProductId:p?.supplierProductId,findings:errors});
      if(ids.has(p.supplierProductId))throw failure('SUPPLIER_EXPORT_DUPLICATE','The immutable export contains a duplicate supplier product ID.',{supplierProductId:p.supplierProductId});
      if(expected&&!expected.has(p.supplierProductId))throw failure('SUPPLIER_PRICE_COVERAGE','A price-only update contains a product outside the original catalog.');
      ids.add(p.supplierProductId);count++;
      yield productXml(p,selected)+'\n';
    }
    if(!count)throw failure('SUPPLIER_EXPORT_EMPTY','A BMEcat transaction must include at least one original product.');
    if(expected&&(ids.size!==expected.size||[...expected].some(id=>!ids.has(id))))throw failure('SUPPLIER_PRICE_COVERAGE','A price-only update must include all original catalog products.');
    yield '</'+e.transaction+'>\n</BMECAT>\n';
  })()};
}
