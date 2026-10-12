// MIT. Field metadata derived from the pinned public Open Waters import interface.
// This file contains interoperability names and constraints, not upstream C# implementation.
export const OPEN_WATERS_CONTRACT = Object.freeze({
  "schema": "starforge.open-waters-import-contract.v1",
  "source": {
    "repository": "open-environment/open-waters",
    "directory": "OpenWaters/OpenWaters",
    "configurationBlob": "6675d0a595e75fe48b6a27e23be50c4e65cc5440",
    "mappingBlob": "13230edb6d2ed79ca40fb36606bd1a3b72c29cdb",
    "importerBlob": "f185089d17b41d47ce6d2b84df4eb6d6f0c7ed1a",
    "validationBlob": "9ed998b6906b2b67f213b42e94bd1378d471298d",
    "url": "https://github.com/open-environment/open-waters"
  },
  "delimiter": "\t",
  "lineDelimiters": [
    "\r",
    "\n"
  ],
  "headerMatch": "trimmed-uppercase-alias",
  "fields": [
    {
      "level": "M",
      "name": "MONLOC_ID",
      "required": true,
      "length": 35,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Station ID",
        "MonLoc ID"
      ]
    },
    {
      "level": "M",
      "name": "MONLOC_NAME",
      "required": true,
      "length": 255,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Station Name"
      ]
    },
    {
      "level": "M",
      "name": "MONLOC_TYPE",
      "required": true,
      "length": 45,
      "dataType": "",
      "reference": "MonitoringLocationType",
      "addField": null,
      "aliases": [
        "Primary Type"
      ]
    },
    {
      "level": "M",
      "name": "MONLOC_DESC",
      "required": false,
      "length": 1999,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Description Text"
      ]
    },
    {
      "level": "M",
      "name": "HUC_EIGHT",
      "required": false,
      "length": 8,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "HUC Eight Digit Code",
        "Generated Hydrologic Unit Code"
      ]
    },
    {
      "level": "M",
      "name": "HUC_TWELVE",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "HUC Twelve Digit Code",
        "Generated HUC Twelve Digit Code"
      ]
    },
    {
      "level": "M",
      "name": "TRIBAL_LAND_IND",
      "required": false,
      "length": 1,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Tribal Land Indicator"
      ]
    },
    {
      "level": "M",
      "name": "TRIBAL_LAND_NAME",
      "required": false,
      "length": 200,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Tribal Land Name"
      ]
    },
    {
      "level": "M",
      "name": "LATITUDE_MSR",
      "required": true,
      "length": 30,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Latitude"
      ]
    },
    {
      "level": "M",
      "name": "LONGITUDE_MSR",
      "required": true,
      "length": 30,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Longitude"
      ]
    },
    {
      "level": "M",
      "name": "SOURCE_MAP_SCALE",
      "required": false,
      "length": null,
      "dataType": "int",
      "reference": "",
      "addField": null,
      "aliases": [
        "Map Scale"
      ]
    },
    {
      "level": "M",
      "name": "HORIZ_COLL_METHOD",
      "required": true,
      "length": 150,
      "dataType": "",
      "reference": "HorizontalCollectionMethod",
      "addField": null,
      "aliases": [
        "Geopositioning Method"
      ]
    },
    {
      "level": "M",
      "name": "HORIZ_REF_DATUM",
      "required": true,
      "length": 6,
      "dataType": "",
      "reference": "HorizontalCoordinateReferenceSystemDatum",
      "addField": null,
      "aliases": [
        "Horizontal Datum"
      ]
    },
    {
      "level": "M",
      "name": "VERT_MEASURE",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Elevation"
      ]
    },
    {
      "level": "M",
      "name": "VERT_MEASURE_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Elevation Unit"
      ]
    },
    {
      "level": "M",
      "name": "VERT_COLL_METHOD",
      "required": false,
      "length": 50,
      "dataType": "",
      "reference": "VerticalCollectionMethod",
      "addField": null,
      "aliases": [
        "Elevation Method"
      ]
    },
    {
      "level": "M",
      "name": "VERT_REF_DATUM",
      "required": false,
      "length": 10,
      "dataType": "",
      "reference": "VerticalCoordinateReferenceSystemDatum",
      "addField": null,
      "aliases": [
        "Elevation Datum"
      ]
    },
    {
      "level": "M",
      "name": "COUNTRY_CODE",
      "required": false,
      "length": 2,
      "dataType": "",
      "reference": "Country",
      "addField": null,
      "aliases": [
        "Country Code",
        "Country Name"
      ]
    },
    {
      "level": "M",
      "name": "STATE_CODE",
      "required": false,
      "length": 2,
      "dataType": "",
      "reference": "State",
      "addField": null,
      "aliases": [
        "State Code",
        "State"
      ]
    },
    {
      "level": "M",
      "name": "COUNTY_CODE",
      "required": false,
      "length": 3,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "County Code",
        "County"
      ]
    },
    {
      "level": "M",
      "name": "WELL_TYPE",
      "required": false,
      "length": 255,
      "dataType": "",
      "reference": "WellType",
      "addField": null,
      "aliases": [
        "Well Type"
      ]
    },
    {
      "level": "M",
      "name": "AQUIFER_NAME",
      "required": false,
      "length": 120,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Aquifer Name"
      ]
    },
    {
      "level": "M",
      "name": "FORMATION_TYPE",
      "required": false,
      "length": 50,
      "dataType": "",
      "reference": "WellFormationType",
      "addField": null,
      "aliases": [
        "Formation Type"
      ]
    },
    {
      "level": "M",
      "name": "WELLHOLE_DEPTH_MSR",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Well Hole Depth Measure"
      ]
    },
    {
      "level": "M",
      "name": "WELLHOLE_DEPTH_MSR_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Well Hole Depth Measure Unit"
      ]
    },
    {
      "level": "S",
      "name": "MONLOC_ID",
      "required": true,
      "length": 35,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Station ID"
      ]
    },
    {
      "level": "S",
      "name": "ACTIVITY_ID",
      "required": true,
      "length": 35,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Activity ID",
        "Sample ID",
        "LabSampID"
      ]
    },
    {
      "level": "S",
      "name": "ACT_TYPE",
      "required": true,
      "length": 70,
      "dataType": "",
      "reference": "ActivityType",
      "addField": null,
      "aliases": [
        "Activity Type Code"
      ]
    },
    {
      "level": "S",
      "name": "ACT_MEDIA",
      "required": true,
      "length": 20,
      "dataType": "",
      "reference": "ActivityMedia",
      "addField": null,
      "aliases": [
        "Activity Media",
        "Media",
        "Matrix"
      ]
    },
    {
      "level": "S",
      "name": "ACT_SUBMEDIA",
      "required": false,
      "length": 45,
      "dataType": "",
      "reference": "ActivityMediaSubdivision",
      "addField": null,
      "aliases": [
        "Activity Submedia"
      ]
    },
    {
      "level": "S",
      "name": "ACT_START_DT",
      "required": true,
      "length": null,
      "dataType": "datetime",
      "reference": "",
      "addField": "ACT_START_TIME",
      "aliases": [
        "Activity Start Date",
        "Sample Date",
        "SampDate"
      ]
    },
    {
      "level": "S",
      "name": "ACT_START_TIME",
      "required": false,
      "length": null,
      "dataType": "datetime",
      "reference": "",
      "addField": null,
      "aliases": [
        "Activity Start Time",
        "Sample Time",
        "SampTime"
      ]
    },
    {
      "level": "S",
      "name": "ACT_END_DT",
      "required": false,
      "length": null,
      "dataType": "datetime",
      "reference": "",
      "addField": "ACT_END_TIME",
      "aliases": [
        "Activity End Date"
      ]
    },
    {
      "level": "S",
      "name": "ACT_END_TIME",
      "required": false,
      "length": null,
      "dataType": "datetime",
      "reference": "",
      "addField": null,
      "aliases": [
        "Activity End Time"
      ]
    },
    {
      "level": "S",
      "name": "ACT_TIME_ZONE",
      "required": false,
      "length": 4,
      "dataType": "",
      "reference": "TimeZone",
      "addField": null,
      "aliases": [
        "Activity Time Zone"
      ]
    },
    {
      "level": "S",
      "name": "RELATIVE_DEPTH_NAME",
      "required": false,
      "length": 15,
      "dataType": "",
      "reference": "ActivityRelativeDepth",
      "addField": null,
      "aliases": [
        "Relative Depth"
      ]
    },
    {
      "level": "S",
      "name": "ACT_DEPTHHEIGHT_MSR",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Depth Measure"
      ]
    },
    {
      "level": "S",
      "name": "ACT_DEPTHHEIGHT_MSR_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Depth Measure Unit"
      ]
    },
    {
      "level": "S",
      "name": "TOP_DEPTHHEIGHT_MSR",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Top Depth Measure"
      ]
    },
    {
      "level": "S",
      "name": "TOP_DEPTHHEIGHT_MSR_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Top Depth Measure Unit"
      ]
    },
    {
      "level": "S",
      "name": "BOT_DEPTHHEIGHT_MSR",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Bottom Depth Measure"
      ]
    },
    {
      "level": "S",
      "name": "BOT_DEPTHHEIGHT_MSR_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Bottom Depth Measure Unit"
      ]
    },
    {
      "level": "S",
      "name": "DEPTH_REF_POINT",
      "required": false,
      "length": 125,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Depth Ref Point"
      ]
    },
    {
      "level": "S",
      "name": "ACT_COMMENT",
      "required": false,
      "length": 4000,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Activity Comment"
      ]
    },
    {
      "level": "S",
      "name": "BIO_ASSEMBLAGE_SAMPLED",
      "required": false,
      "length": 50,
      "dataType": "",
      "reference": "Assemblage",
      "addField": null,
      "aliases": [
        "Bio Assemblage Sampled"
      ]
    },
    {
      "level": "S",
      "name": "BIO_DURATION_MSR",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Bio Duration"
      ]
    },
    {
      "level": "S",
      "name": "BIO_DURATION_MSR_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Bio Duration Unit"
      ]
    },
    {
      "level": "S",
      "name": "BIO_SAMP_COMPONENT",
      "required": false,
      "length": 15,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Sampling Component"
      ]
    },
    {
      "level": "S",
      "name": "BIO_SAMP_COMPONENT_SEQ",
      "required": false,
      "length": null,
      "dataType": "int",
      "reference": "",
      "addField": null,
      "aliases": [
        "Sampling Component Place"
      ]
    },
    {
      "level": "S",
      "name": "BIO_REACH_LEN_MSR",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Reach Length"
      ]
    },
    {
      "level": "S",
      "name": "BIO_REACH_LEN_MSR_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Reach Length Unit"
      ]
    },
    {
      "level": "S",
      "name": "BIO_REACH_WID_MSR",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Reach Width"
      ]
    },
    {
      "level": "S",
      "name": "BIO_REACH_WID_MSR_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Reach Width Unit"
      ]
    },
    {
      "level": "S",
      "name": "BIO_PASS_COUNT",
      "required": false,
      "length": null,
      "dataType": "int",
      "reference": "",
      "addField": null,
      "aliases": [
        "Pass Count"
      ]
    },
    {
      "level": "S",
      "name": "BIO_NET_TYPE",
      "required": false,
      "length": 30,
      "dataType": "",
      "reference": "NetType",
      "addField": null,
      "aliases": [
        "Net Type"
      ]
    },
    {
      "level": "S",
      "name": "BIO_NET_AREA_MSR",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Net Surface Area"
      ]
    },
    {
      "level": "S",
      "name": "BIO_NET_AREA_MSR_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Surface Area Unit"
      ]
    },
    {
      "level": "S",
      "name": "BIO_NET_MESHSIZE_MSR",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Net Mesh Size"
      ]
    },
    {
      "level": "S",
      "name": "BIO_MESHSIZE_MSR_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Mesh Size Unit"
      ]
    },
    {
      "level": "S",
      "name": "BIO_BOAT_SPEED_MSR",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Boat Speed"
      ]
    },
    {
      "level": "S",
      "name": "BIO_BOAT_SPEED_MSR_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Boat Speed Unit"
      ]
    },
    {
      "level": "S",
      "name": "BIO_CURR_SPEED_MSR",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Current Speed"
      ]
    },
    {
      "level": "S",
      "name": "BIO_CURR_SPEED_MSR_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Current Speed Unit"
      ]
    },
    {
      "level": "S",
      "name": "BIO_TOXICITY_TEST_TYPE",
      "required": false,
      "length": 7,
      "dataType": "",
      "reference": "ToxicityTestType",
      "addField": null,
      "aliases": [
        "Toxicity Test Type"
      ]
    },
    {
      "level": "S",
      "name": "SAMP_COLL_METHOD_IDX",
      "required": false,
      "length": null,
      "dataType": "int",
      "reference": "",
      "addField": null,
      "aliases": [
        "Collection Method IDX"
      ]
    },
    {
      "level": "S",
      "name": "SAMP_COLL_METHOD_ID",
      "required": false,
      "length": 20,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Collection Method ID"
      ]
    },
    {
      "level": "S",
      "name": "SAMP_COLL_METHOD_CTX",
      "required": false,
      "length": 120,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Collection Method Context"
      ]
    },
    {
      "level": "S",
      "name": "SAMP_COLL_EQUIP",
      "required": false,
      "length": 40,
      "dataType": "",
      "reference": "SampleCollectionEquipment",
      "addField": null,
      "aliases": [
        "Collection Equipment"
      ]
    },
    {
      "level": "S",
      "name": "SAMP_COLL_EQUIP_COMMENT",
      "required": false,
      "length": 4000,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Collection Equipment Comment"
      ]
    },
    {
      "level": "S",
      "name": "SAMP_PREP_IDX",
      "required": false,
      "length": null,
      "dataType": "int",
      "reference": "",
      "addField": null,
      "aliases": [
        "Sample Prep IDX"
      ]
    },
    {
      "level": "S",
      "name": "SAMP_PREP_ID",
      "required": false,
      "length": 20,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Sample Prep ID",
        "PrepName",
        "PrepID"
      ]
    },
    {
      "level": "S",
      "name": "SAMP_PREP_CTX",
      "required": false,
      "length": 120,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Sample Prep Context"
      ]
    },
    {
      "level": "S",
      "name": "SAMP_PREP_CONT_TYPE",
      "required": false,
      "length": 35,
      "dataType": "",
      "reference": "SampleContainerType",
      "addField": null,
      "aliases": [
        "Container Type"
      ]
    },
    {
      "level": "S",
      "name": "SAMP_PREP_CONT_COLOR",
      "required": false,
      "length": 15,
      "dataType": "",
      "reference": "SampleContainerColor",
      "addField": null,
      "aliases": [
        "Container Color"
      ]
    },
    {
      "level": "S",
      "name": "SAMP_PREP_CHEM_PRESERV",
      "required": false,
      "length": 250,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Chem Preservative Used"
      ]
    },
    {
      "level": "S",
      "name": "SAMP_PREP_THERM_PRESERV",
      "required": false,
      "length": 25,
      "dataType": "",
      "reference": "ThermalPreservativeUsed",
      "addField": null,
      "aliases": [
        "Thermal Preservative Used"
      ]
    },
    {
      "level": "S",
      "name": "SAMP_PREP_STORAGE_DESC",
      "required": false,
      "length": 250,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Transport Storage Description"
      ]
    },
    {
      "level": "S",
      "name": "DATA_LOGGER_LINE",
      "required": false,
      "length": 15,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Data Logger Line"
      ]
    },
    {
      "level": "S",
      "name": "RESULT_DETECT_CONDITION",
      "required": false,
      "length": 35,
      "dataType": "",
      "reference": "ResultDetectionCondition",
      "addField": null,
      "aliases": [
        "Result Detection Condition",
        "DETECTIONCONDITION",
        "DETECTION CONDITION"
      ]
    },
    {
      "level": "S",
      "name": "CHAR_NAME",
      "required": false,
      "length": 120,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Characteristic",
        "ANALYTE"
      ]
    },
    {
      "level": "S",
      "name": "METHOD_SPECIATION_NAME",
      "required": false,
      "length": 20,
      "dataType": "",
      "reference": "MethodSpeciation",
      "addField": null,
      "aliases": [
        "Method Speciation"
      ]
    },
    {
      "level": "S",
      "name": "RESULT_SAMP_FRACTION",
      "required": false,
      "length": 25,
      "dataType": "",
      "reference": "ResultSampleFraction",
      "addField": null,
      "aliases": [
        "Sample Fraction"
      ]
    },
    {
      "level": "S",
      "name": "RESULT_MSR",
      "required": false,
      "length": 60,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Result"
      ]
    },
    {
      "level": "S",
      "name": "RESULT_MSR_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Unit",
        "UNITS_RESULT"
      ]
    },
    {
      "level": "S",
      "name": "RESULT_MSR_QUAL",
      "required": false,
      "length": 5,
      "dataType": "",
      "reference": "ResultMeasureQualifier",
      "addField": null,
      "aliases": [
        "Measure Qualifier"
      ]
    },
    {
      "level": "S",
      "name": "RESULT_STATUS",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "ResultStatus",
      "addField": null,
      "aliases": [
        "Result Status"
      ]
    },
    {
      "level": "S",
      "name": "STATISTIC_BASE_CODE",
      "required": false,
      "length": 25,
      "dataType": "",
      "reference": "StatisticalBase",
      "addField": null,
      "aliases": [
        "Statistical Base Code"
      ]
    },
    {
      "level": "S",
      "name": "RESULT_VALUE_TYPE",
      "required": false,
      "length": 20,
      "dataType": "",
      "reference": "ResultValueType",
      "addField": null,
      "aliases": [
        "Result Value Type"
      ]
    },
    {
      "level": "S",
      "name": "WEIGHT_BASIS",
      "required": false,
      "length": 15,
      "dataType": "",
      "reference": "ResultWeightBasis",
      "addField": null,
      "aliases": [
        "Weight Basis"
      ]
    },
    {
      "level": "S",
      "name": "TIME_BASIS",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "ResultTimeBasis",
      "addField": null,
      "aliases": [
        "Time Basis"
      ]
    },
    {
      "level": "S",
      "name": "TEMP_BASIS",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "ResultTemperatureBasis",
      "addField": null,
      "aliases": [
        "Temperature Basis"
      ]
    },
    {
      "level": "S",
      "name": "PARTICLESIZE_BASIS",
      "required": false,
      "length": 40,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Particle Size Basis"
      ]
    },
    {
      "level": "S",
      "name": "PRECISION_VALUE",
      "required": false,
      "length": 60,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Precision"
      ]
    },
    {
      "level": "S",
      "name": "BIAS_VALUE",
      "required": false,
      "length": 60,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Bias"
      ]
    },
    {
      "level": "S",
      "name": "CONFIDENCE_INTERVAL_VALUE",
      "required": false,
      "length": 15,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Confidence Interval"
      ]
    },
    {
      "level": "S",
      "name": "UPPER_CONFIDENCE_LIMIT",
      "required": false,
      "length": 15,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Confidence Upper"
      ]
    },
    {
      "level": "S",
      "name": "LOWER_CONFIDENCE_LIMIT",
      "required": false,
      "length": 15,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Confidence Lower"
      ]
    },
    {
      "level": "S",
      "name": "RESULT_COMMENT",
      "required": false,
      "length": 4000,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Result Comments"
      ]
    },
    {
      "level": "S",
      "name": "DEPTH_HEIGHT_MSR",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Result Depth"
      ]
    },
    {
      "level": "S",
      "name": "DEPTH_HEIGHT_MSR_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Result Depth Unit"
      ]
    },
    {
      "level": "S",
      "name": "DEPTHALTITUDEREFPOINT",
      "required": false,
      "length": 125,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Result Depth Ref Point"
      ]
    },
    {
      "level": "S",
      "name": "BIO_INTENT_NAME",
      "required": false,
      "length": 35,
      "dataType": "",
      "reference": "BiologicalIntent",
      "addField": null,
      "aliases": [
        "Bio Intent Name"
      ]
    },
    {
      "level": "S",
      "name": "BIO_INDIVIDUAL_ID",
      "required": false,
      "length": 4,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Bio Individual ID"
      ]
    },
    {
      "level": "S",
      "name": "BIO_SUBJECT_TAXONOMY",
      "required": false,
      "length": 120,
      "dataType": "",
      "reference": "Taxon",
      "addField": null,
      "aliases": [
        "Taxonomic Name"
      ]
    },
    {
      "level": "S",
      "name": "BIO_UNIDENTIFIED_SPECIES_ID",
      "required": false,
      "length": 120,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Unidentified Species"
      ]
    },
    {
      "level": "S",
      "name": "BIO_SAMPLE_TISSUE_ANATOMY",
      "required": false,
      "length": 30,
      "dataType": "",
      "reference": "SampleTissueAnatomy",
      "addField": null,
      "aliases": [
        "Tissue Anatomy"
      ]
    },
    {
      "level": "S",
      "name": "GRP_SUMM_COUNT_WEIGHT_MSR",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Group Summary Total"
      ]
    },
    {
      "level": "S",
      "name": "GRP_SUMM_COUNT_WEIGHT_MSR_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Group Summary Total Unit"
      ]
    },
    {
      "level": "S",
      "name": "TAX_DTL_CELL_FORM",
      "required": false,
      "length": 11,
      "dataType": "",
      "reference": "CellForm",
      "addField": null,
      "aliases": [
        "Cell Form"
      ]
    },
    {
      "level": "S",
      "name": "TAX_DTL_CELL_SHAPE",
      "required": false,
      "length": 18,
      "dataType": "",
      "reference": "CellShape",
      "addField": null,
      "aliases": [
        "Cell Shape"
      ]
    },
    {
      "level": "S",
      "name": "TAX_DTL_HABIT",
      "required": false,
      "length": 15,
      "dataType": "",
      "reference": "Habit",
      "addField": null,
      "aliases": [
        "Habit Name"
      ]
    },
    {
      "level": "S",
      "name": "TAX_DTL_VOLTINISM",
      "required": false,
      "length": 25,
      "dataType": "",
      "reference": "Voltinism",
      "addField": null,
      "aliases": [
        "Voltinism Name"
      ]
    },
    {
      "level": "S",
      "name": "TAX_DTL_POLL_TOLERANCE",
      "required": false,
      "length": 4,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Pollution Tolerance"
      ]
    },
    {
      "level": "S",
      "name": "TAX_DTL_POLL_TOLERANCE_SCALE",
      "required": false,
      "length": 50,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Pollution Tolerance Scale"
      ]
    },
    {
      "level": "S",
      "name": "TAX_DTL_TROPHIC_LEVEL",
      "required": false,
      "length": 4,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Trophic Level"
      ]
    },
    {
      "level": "S",
      "name": "TAX_DTL_FUNC_FEEDING_GROUP1",
      "required": false,
      "length": 6,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Functional Feeding Group"
      ]
    },
    {
      "level": "S",
      "name": "TAX_DTL_FUNC_FEEDING_GROUP2",
      "required": false,
      "length": 6,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Functional Feeding Group 2"
      ]
    },
    {
      "level": "S",
      "name": "TAX_DTL_FUNC_FEEDING_GROUP3",
      "required": false,
      "length": 6,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Functional Feeding Group 3"
      ]
    },
    {
      "level": "S",
      "name": "FREQ_CLASS_CODE",
      "required": false,
      "length": 50,
      "dataType": "",
      "reference": "FrequencyClassDescriptor",
      "addField": null,
      "aliases": [
        "Frequency Class"
      ]
    },
    {
      "level": "S",
      "name": "FREQ_CLASS_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Frequency Class Unit"
      ]
    },
    {
      "level": "S",
      "name": "FREQ_CLASS_UPPER",
      "required": false,
      "length": 8,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Frequency Class Upper"
      ]
    },
    {
      "level": "S",
      "name": "FREQ_CLASS_LOWER",
      "required": false,
      "length": 8,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Frequency Class Lower"
      ]
    },
    {
      "level": "S",
      "name": "ANALYTIC_METHOD_IDX",
      "required": false,
      "length": null,
      "dataType": "int",
      "reference": "",
      "addField": null,
      "aliases": [
        "Analytical Method IDX"
      ]
    },
    {
      "level": "S",
      "name": "ANALYTIC_METHOD_ID",
      "required": false,
      "length": 20,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Analytical Method ID"
      ]
    },
    {
      "level": "S",
      "name": "ANALYTIC_METHOD_CTX",
      "required": false,
      "length": 120,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Analytical Method Context"
      ]
    },
    {
      "level": "S",
      "name": "LAB_NAME",
      "required": false,
      "length": 60,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Lab Name",
        "LabName",
        "Lab"
      ]
    },
    {
      "level": "S",
      "name": "LAB_ANALYSIS_START_DT",
      "required": false,
      "length": null,
      "dataType": "datetime",
      "reference": "",
      "addField": "LAB_ANALYSIS_START_TIME",
      "aliases": [
        "Analysis Start Date"
      ]
    },
    {
      "level": "S",
      "name": "LAB_ANALYSIS_START_TIME",
      "required": false,
      "length": null,
      "dataType": "datetime",
      "reference": "",
      "addField": null,
      "aliases": [
        "Analysis Start Time"
      ]
    },
    {
      "level": "S",
      "name": "LAB_ANALYSIS_END_DT",
      "required": false,
      "length": null,
      "dataType": "datetime",
      "reference": "",
      "addField": null,
      "aliases": [
        "Analysis End Date"
      ]
    },
    {
      "level": "S",
      "name": "RESULT_LAB_COMMENT_CODE",
      "required": false,
      "length": 3,
      "dataType": "",
      "reference": "ResultLaboratoryComment",
      "addField": null,
      "aliases": [
        "Lab Comment Code"
      ]
    },
    {
      "level": "S",
      "name": "METHOD_DETECTION_LEVEL",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Method Detection Level"
      ]
    },
    {
      "level": "S",
      "name": "LAB_REPORTING_LEVEL",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Laboratory Reporting Level"
      ]
    },
    {
      "level": "S",
      "name": "PQL",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Practical Quantitation Limit"
      ]
    },
    {
      "level": "S",
      "name": "LOWER_QUANT_LIMIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Lower Quantitation Limit"
      ]
    },
    {
      "level": "S",
      "name": "UPPER_QUANT_LIMIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Upper Quantitation Limit"
      ]
    },
    {
      "level": "S",
      "name": "DETECTION_LIMIT_UNIT",
      "required": false,
      "length": 12,
      "dataType": "",
      "reference": "MeasureUnit",
      "addField": null,
      "aliases": [
        "Detection Threshold Limit Unit",
        "UNITS_DL",
        "DETECTION LIMIT UNIT"
      ]
    },
    {
      "level": "S",
      "name": "LAB_SAMP_PREP_IDX",
      "required": false,
      "length": null,
      "dataType": "int",
      "reference": "",
      "addField": null,
      "aliases": [
        "Lab Sample Prep IDX"
      ]
    },
    {
      "level": "S",
      "name": "LAB_SAMP_PREP_ID",
      "required": false,
      "length": 20,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Lab Sample Prep ID"
      ]
    },
    {
      "level": "S",
      "name": "LAB_SAMP_PREP_CTX",
      "required": false,
      "length": 120,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Lab Sample Prep Context"
      ]
    },
    {
      "level": "S",
      "name": "LAB_SAMP_PREP_START_DT",
      "required": false,
      "length": null,
      "dataType": "datetime",
      "reference": "",
      "addField": "LAB_SAMP_PREP_START_TIME",
      "aliases": [
        "Preparation Start Date"
      ]
    },
    {
      "level": "S",
      "name": "LAB_SAMP_PREP_START_TIME",
      "required": false,
      "length": null,
      "dataType": "datetime",
      "reference": "",
      "addField": null,
      "aliases": [
        "Preparation Start Time"
      ]
    },
    {
      "level": "S",
      "name": "LAB_SAMP_PREP_END_DT",
      "required": false,
      "length": null,
      "dataType": "datetime",
      "reference": "",
      "addField": null,
      "aliases": [
        "Preparation End Date"
      ]
    },
    {
      "level": "S",
      "name": "DILUTION_FACTOR",
      "required": false,
      "length": 10,
      "dataType": "",
      "reference": "",
      "addField": null,
      "aliases": [
        "Dilution Factor",
        "Dilution"
      ]
    }
  ]
});
