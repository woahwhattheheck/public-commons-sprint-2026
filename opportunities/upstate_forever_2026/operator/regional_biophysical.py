"""Regional biophysical library on original operator tasks and verified downloads."""
from copy import deepcopy
from model import regional_biophysical as model
from model.common import describe_file

ACTIONS = frozenset({"regional-biophysical.prepare", "regional-biophysical.export",
                     "regional-biophysical.experiment.prepare"})

class RegionalBiophysical:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _downloads(self, key, ident):
        ws = self.operator.ws(key)
        directory = ws.root / "regional-biophysical-exports" / ident
        result = []
        for filename, label in (("selection.json", "Complete source-bound selection"),
                                ("report.html", "Readable regional profile"),
                                ("Regional_Profile.zip", "Original sources and editable native profiles")):
            path = directory / filename
            if path.is_file():
                result.append(self.operator._ticket(key, path, describe_file(ws.root, path), label))
        return result

    def read(self, workspace_key, operation, payload=None):
        ws = self.operator.ws(workspace_key)
        value = {k: v for k, v in (payload or {}).items() if k != "workspace"}
        if operation == "catalog":
            result = model.catalog(ws, value.get("baseline_profile_id"))
        elif operation == "library":
            result = model.read_library(ws, value["library"])
        elif operation == "preview":
            result = model.preview(ws, value["definition"])
        elif operation == "detail":
            result = model.inspect(ws, value["id"])
            result["_downloads"] = self._downloads(workspace_key, result["id"])
        else:
            raise self.Fault("REGIONAL_READ", "Choose an original regional source view.", 404)
        return {"workspace_key": workspace_key, **result}

    def invoke(self, task):
        ws = self.operator.ws(task["workspace"])
        if task["action"] == "regional-biophysical.prepare":
            return model.prepare(ws, task["payload"])
        if task["action"] == "regional-biophysical.export":
            record = model.inspect(ws, task["payload"]["id"])
            model.export(ws, record["id"])
            return {"id": record["id"], "profile_id": record["profile_id"]}
        if task["action"] == "regional-biophysical.experiment.prepare":
            return model.prepare_experiment(ws, task["payload"])
        raise self.Fault("REGIONAL_ACTION", "Choose an original regional source action.", 404)

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or not isinstance(task.get("result"), dict):
            return task
        value = deepcopy(task)
        if task["action"] == "regional-biophysical.export":
            value["_downloads"] = self._downloads(task["workspace"], task["result"]["id"])
        return value

    def verify_workspace(self, workspace):
        return model.verify_all(workspace)
