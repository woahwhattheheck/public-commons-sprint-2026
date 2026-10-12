"""Retained Datasette input on the original NLD SQLFlowTask lifecycle.

No publisher requests occur here. Native by_key state, SQL write strategies,
execution history and per-step results remain owned by the pinned NLD package.
"""
from pathlib import Path
import sqlite3

from nld.flow.sql.sql_flow_task import SQLFlowTask
from nld.flow.incremental.impl.by_key.state import ByKeySourceState, ByKeySingleKeySourceState
from nld.parameters import ExecutionParameterDefinition
from nld.task.context import NldExecutionContext

from nld_contract import (need, load, verify_projection, quote, publish_json,
                          read, PROJECT_SCHEMA)

class RetainedEditionSQLFlowTask(SQLFlowTask):
    init_params = [*SQLFlowTask.init_params,
                   ExecutionParameterDefinition(name="retained_input_file", mandatory=True),
                   ExecutionParameterDefinition(name="retained_receipt_directory", mandatory=False)]

    def __init__(self, retained_input_file, retained_receipt_directory=None, **kwargs):
        super().__init__(**kwargs)
        root = Path(NldExecutionContext.require_current().project.root_folder_path).resolve()
        source_path = root / retained_input_file
        need(source_path.resolve() == root / "source.json", "NLD_RETAINED_INPUT_PATH_CHANGED")
        self.retained_projection = verify_projection(load(source_path))
        manifest = load(root / "project-manifest.json")
        need(manifest.get("schema") == PROJECT_SCHEMA and
             manifest["projection_id"] == self.retained_projection["id"], "NLD_TASK_SOURCE_CHANGED")
        self.retained_root = root
        self.retained_receipt_directory = Path(retained_receipt_directory).resolve() if retained_receipt_directory else None
        self.retained_selected_keys = []
        self.retained_empty_selection = False

    def retrieve_source_state(self):
        projection = self.retained_projection
        self.state_manager.set_source_state(ByKeySourceState(keys={
            row["_sf_source_key"]: ByKeySingleKeySourceState(
                name=row["_sf_source_key"], last_updated_at=None,
                parameters={"business_key": row["_sf_business_key"], "edition_id": projection["edition_id"],
                            "version_id": projection["version_id"], "row": row["_sf_original_row"],
                            "meaning_id": projection["meaning_id"]})
            for row in projection["rows"]
        }))

    def run_flow(self):
        processing = self.state_manager.processing_state
        need(processing is not None and hasattr(processing, "get_keys_to_process"), "NLD_BY_KEY_STATE_REQUIRED")
        keys = processing.get_keys_to_process()
        selected = [key.name for key in keys]
        originals = {row["_sf_source_key"]: row for row in self.retained_projection["rows"]}
        need(len(selected) == len(set(selected)) and set(selected).issubset(originals), "NLD_NATIVE_KEY_SELECTION_CHANGED")
        self.retained_selected_keys = selected
        selection = {"schema": "stellar-forge.datasette-nld.v1/native-selection",
                     "flow_uid": self.flow_execution_info.flow_uid,
                     "projection_id": self.retained_projection["id"],
                     "native_strategy": str(processing.strategy), "selected_keys": selected,
                     "processing_state": processing.model_dump(mode="json")}
        if self.retained_receipt_directory:
            publish_json(self.retained_receipt_directory / "native-selection.json", selection)
        if not selected:
            # Upstream ByKeySqlFilterManager returns the original SQL for zero
            # keys. A no-op therefore has to be selected before hooks or writes.
            self.retained_empty_selection = True
            return
        try:
            super().run_flow()
            credentials = self.target_connector.connection_wrapper.credentials
            need(credentials.type == "sqlite" and credentials.database_name != ":memory:", "NLD_LOCAL_TARGET_REQUIRED")
            target = Path(credentials.database_name).resolve()
            need(target == self.retained_root.parents[1] / "target.sqlite", "NLD_TARGET_BINDING_CHANGED")
            connection = sqlite3.connect(target.as_uri() + "?mode=ro", uri=True)
            connection.row_factory = sqlite3.Row
            try:
                columns = self.retained_projection["columns"]
                sql = ("SELECT " + ",".join(quote(c) for c in columns) + " FROM " +
                       quote(self.data_flow_definition.name) + " WHERE " + quote("_sf_business_key") + "=?")
                for key in keys:
                    expected = originals[key.name]
                    received = connection.execute(sql, (expected["_sf_business_key"],)).fetchall()
                    need(len(received) == 1 and dict(received[0]) == expected,
                         "NLD_SELECTED_TARGET_READBACK_CHANGED", expected["_sf_original_row"])
                # Only after the whole selected native SQL result is independently
                # read back do its original per-key states become successful.
                for key in keys:
                    key.set_to_succeeded()
            finally:
                connection.close()
        except BaseException as error:
            for key in keys:
                key.set_to_failed(error_message=str(error))
            raise
