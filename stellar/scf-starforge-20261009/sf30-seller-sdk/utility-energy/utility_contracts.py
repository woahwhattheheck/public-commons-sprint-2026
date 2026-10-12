"""MIT. ESPI 4.0.20231213 code values from the retained Green Button schema."""
ESPI_SOURCE = {
    "commit":"06666dc82396b53ed14e7a5c45266ed54015c1ce",
    "path":"openespi-common/src/main/resources/schema/ESPI_4.0/espi.xsd",
    "gitBlob":"4846013003b693db9bbbe94cfec6ed6bfa0a1a2f",
    "bytes":235186,
}
UOM = {"72":"Wh","38":"W","71":"VAh","73":"VArh","61":"VA","63":"VAr",
       "31":"J","132":"BTU","169":"therm","133":"BTU/h"}
FLOW = {"0":"none","1":"forward","2":"lagging","3":"leading","4":"net",
        "5":"q1plusQ2","7":"q1plusQ3","8":"q1plusQ4","9":"q1minusQ4",
        "10":"q2plusQ3","11":"q2plusQ4","12":"q2minusQ3","13":"q3plusQ4",
        "14":"q3minusQ2","15":"quadrant1","16":"quadrant2","17":"quadrant3",
        "18":"quadrant4","19":"reverse","20":"total","21":"totalByPhase"}
ACCUMULATION = {"0":"none","1":"bulkQuantity","2":"continuousCumulative","3":"cumulative",
                "4":"deltaData","6":"indicating","9":"summation","10":"timeDelay",
                "12":"instantaneous","13":"latchingQuantity","14":"boundedQuantity"}
KIND = {"12":"energy","8":"demand","37":"power","3":"currency","150":"billLastPeriod",
        "151":"billToDate","153":"connectionFee"}
QUALITY = {"0":"valid","7":"manually-edited","8":"estimated-reference-day",
           "9":"estimated-linear-interpolation","10":"questionable","11":"derived",
           "12":"projected","13":"mixed","14":"raw","15":"weather-normalized",
           "16":"other","17":"validated","18":"verified","19":"revenue"}
CURRENCY = {"840":"USD","124":"CAD","978":"EUR","826":"GBP"}

def reading_type_view(source):
    return {**source,"uom_name":UOM.get(source.get("uom"),"unknown"),
            "flow_name":FLOW.get(source.get("flowDirection"),"unknown"),
            "accumulation_name":ACCUMULATION.get(source.get("accumulationBehaviour"),"unknown"),
            "kind_name":KIND.get(source.get("kind"),"unknown")}
