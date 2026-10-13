# SPDX-License-Identifier: MIT
"""Original QGIS geometry observations, using retained native maps and features."""
from __future__ import annotations
import copy
import hashlib
import json
import math
from .model import require, value_sha, utc_now
from . import qgis_project
from .parcel_evidence import exact, current, put, text

def normalize(payload):
    exact(payload,("caseId","caseVersionId","leftSubjectId","rightSubjectId","measurementCrs","purpose"),
          ("caseId","caseVersionId","leftSubjectId","rightSubjectId","measurementCrs","purpose"))
    require(payload["leftSubjectId"] != payload["rightSubjectId"],"EVIDENCE_SPATIAL_SUBJECTS","Choose two distinct subjects.")
    value=copy.deepcopy(payload)
    value["measurementCrs"]=text(value["measurementCrs"],"Explicit projected measurement CRS",12000)
    value["purpose"]=text(value["purpose"],"Purpose and scope of the geometric observation",8000)
    return value

def observe(workspace,payload,common,progress=None):
    payload=normalize(payload)
    replay=workspace.operation(common["request_id"],"evidence.spatial",payload)
    if replay is not None:
        return replay
    state=workspace.read()
    case=current(state,"cases",payload["caseId"])
    require(state["revision"]==common["revision"] and case["id"]==payload["caseVersionId"],
            "EVIDENCE_CASE_CHANGED","Review the current original case before measuring.")
    selected=[]
    for key in ("leftSubjectId","rightSubjectId"):
        subject=next((s for s in case["subjects"] if s["id"]==payload[key]),None)
        require(subject is not None and subject.get("mapObservation"),"EVIDENCE_NATIVE_BINDING",
                "Both subjects need an actual original native map-feature observation.")
        selected.append(subject)
    core=qgis_project.native()
    crs=core.QgsCoordinateReferenceSystem(payload["measurementCrs"])
    require(crs.isValid() and not crs.isGeographic(),"EVIDENCE_MEASUREMENT_CRS",
            "Select a valid projected CRS for these planar area and length measurements.")
    units=core.QgsUnitTypes.toString(crs.mapUnits())
    require(units and "unknown" not in units.lower(),"EVIDENCE_MEASUREMENT_UNITS","Use the actual projected CRS units.")
    from analyst.actions import _project, feature_value
    projects=[]
    inputs=[]
    geometries=[]
    try:
        for subject in selected:
            original=subject["mapObservation"]
            project,readback=_project(workspace,original["projectId"],progress)
            projects.append(project)
            binding=original["layer"]
            matches=[layer for layer in project.mapLayers().values() if
                     layer.id()==binding["id"] or layer.customProperty("starforge/layerId","")==binding["id"]]
            require(len(matches)==1 and isinstance(matches[0],core.QgsVectorLayer),"EVIDENCE_NATIVE_LAYER",
                    "Reopen the original source-bound vector layer.")
            layer=matches[0]
            require(layer.id()==original["nativeLayerId"],"EVIDENCE_NATIVE_LAYER_CHANGED",
                    "The original native layer identity changed.")
            raw_id=original["feature"]["featureId"]
            require(isinstance(raw_id,str) and raw_id.lstrip("-").isdigit(),"EVIDENCE_NATIVE_FEATURE",
                    "Use the exact original native feature ID in its saved layer.")
            feature=layer.getFeature(int(raw_id))
            require(feature.isValid() and feature.hasGeometry(),"EVIDENCE_NATIVE_FEATURE","The original native feature must remain available.")
            fields=[{"name":f.name(),"type":f.typeName()} for f in layer.fields()]
            values=[feature_value(v) for v in feature.attributes()]
            require(fields==original["fields"] and values==original["feature"]["values"],"EVIDENCE_NATIVE_FEATURE_CHANGED",
                    "The original native feature attributes changed.")
            geometry=core.QgsGeometry(feature.geometry())
            require(not geometry.isEmpty() and geometry.isGeosValid(),"EVIDENCE_NATIVE_GEOMETRY",
                    "Use the valid original geometry; retain any repair as a separately reviewed source edition.")
            original_wkb=bytes(geometry.asWkb())
            original_crs=layer.crs()
            require(original_crs.isValid(),"EVIDENCE_NATIVE_CRS","The original native layer CRS is required.")
            transform=core.QgsCoordinateTransform(original_crs,crs,project.transformContext())
            status=geometry.transform(transform)
            require(int(status)==0 and not geometry.isEmpty() and geometry.isGeosValid(),"EVIDENCE_NATIVE_TRANSFORM",
                    "The declared native CRS transformation must succeed without changing validity.")
            inputs.append({"subjectId":subject["id"],"kind":subject["kind"],"businessIdentity":subject["identity"],
                "sourceReferences":copy.deepcopy(subject["sourceReferences"]),"mapObservation":copy.deepcopy(original),
                "nativeLayerId":layer.id(),"fields":fields,"values":values,"originalCrsWkt":original_crs.toWkt(),
                "originalGeometryWkbSha256":hashlib.sha256(original_wkb).hexdigest(),
                "transformedGeometryWkbSha256":hashlib.sha256(bytes(geometry.asWkb())).hexdigest(),
                "readback":readback})
            geometries.append(geometry)
        left,right=geometries
        intersects=left.intersects(right)
        intersection=left.intersection(right)
        require(not intersection.lastError(),"EVIDENCE_NATIVE_INTERSECTION","The native intersection reported an error.",
                nativeError=intersection.lastError())
        area=intersection.area() if not intersection.isNull() else 0.0
        length=intersection.length() if not intersection.isNull() else 0.0
        require(math.isfinite(area) and math.isfinite(length),"EVIDENCE_NATIVE_MEASUREMENT",
                "The native geometry measurements must be finite.")
        result={"inputs":inputs,"intersects":intersects,"leftWithinRight":left.within(right),
            "rightWithinLeft":right.within(left),"touches":left.touches(right),
            "intersectionEmpty":intersection.isEmpty() or intersection.isNull(),
            "intersectionGeometry":None if intersection.isNull() else json.loads(intersection.asJson(17)),
            "intersectionGeometryWkbSha256":None if intersection.isNull() else hashlib.sha256(bytes(intersection.asWkb())).hexdigest(),
            "intersectionArea":repr(area),"areaUnit":units+" squared",
            "intersectionLength":repr(length),"lengthUnit":units,
            "qgisVersion":getattr(core.Qgis,"QGIS_VERSION","unknown"),
            "meaning":"Native projected planar geometric observation on the selected retained features. It does not determine permit eligibility, flood certification, insurance, title or legal status."}
    finally:
        for project in projects:
            project.clear()
    def update(current_state):
        require(current(current_state,"cases",payload["caseId"])==case,"EVIDENCE_CASE_CHANGED",
                "The exact case subjects changed during native observation.")
        row=put(current_state,"observations",{"caseId":case["caseId"],"caseVersionId":case["id"],
                "leftSubjectId":payload["leftSubjectId"],"rightSubjectId":payload["rightSubjectId"],
                "measurementCrs":{"input":payload["measurementCrs"],"authorityId":crs.authid(),"wkt":crs.toWkt(),"units":units},
                "measurementMethod":"QGIS/GEOS planar predicates and intersection after native transform to the explicit projected CRS; no geometry repair or snapping.",
                "purpose":payload["purpose"],"result":result,"createdAt":utc_now(),"actor":common["actor"]})
        return {"caseId":case["caseId"],"observationId":row["id"],"observation":row}
    return workspace._mutate(action="evidence.spatial",payload=payload,update=update,**common)
