# SPDX-License-Identifier: MIT
"""Additive commands on the original desktop workspace CLI."""
from ..model import require,QgisReceivingError
from . import native

COMMANDS=("postgis-layers","native-postgis-check","native-postgis-select","native-postgis-refresh")

def execute(workspace,command,payload=None,*,project_id=None,progress=None):
    payload=payload or {}
    if command=="postgis-layers":
        source=workspace.source(payload.get("sourceId"))
        require(source.sourceKind=="postgis","POSTGIS_SOURCE_REQUIRED","Select an accepted PostGIS source.")
        return {"sourceId":source.id,"source":source.source,"layers":list(source.layers.values())}
    if command=="native-postgis-refresh":
        from ..qgis_project import reopen_project
        project,_=reopen_project(workspace,project_id,progress=progress)
        return native.refresh_project(workspace,project,progress=progress)
    common={"revision":payload.get("revision"),"request_id":payload.get("requestId"),"actor":payload.get("actor")}
    if command=="native-postgis-check":
        return native.record_check(workspace,payload["sourceId"],payload["layerIds"],payload["connection"],
                                   progress=progress,**common)
    if command=="native-postgis-select":
        return native.save_selection(workspace,payload["layers"],**common)
    raise QgisReceivingError("POSTGIS_COMMAND","Select a documented native PostGIS receiving command.")

def main(argv=None):
    from ..cli import main as original_main
    return original_main(argv)

if __name__=="__main__":
    raise SystemExit(main())
