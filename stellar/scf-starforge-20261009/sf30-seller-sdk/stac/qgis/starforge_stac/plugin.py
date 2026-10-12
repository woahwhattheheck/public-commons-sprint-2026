# SPDX-License-Identifier: MIT
"""Complete native QGIS operator dock for original STAC and vector receiving."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import traceback
import uuid

from qgis.PyQt.QtCore import Qt, QSettings, QTimer, QUrl
from qgis.PyQt.QtGui import QDesktopServices
try:
    from qgis.PyQt.QtGui import QAction
except ImportError:
    from qgis.PyQt.QtWidgets import QAction
from qgis.PyQt.QtWidgets import (QApplication, QDockWidget, QWidget, QVBoxLayout, QHBoxLayout,
    QFormLayout, QLabel, QPushButton, QLineEdit, QTabWidget, QTableWidget, QTableWidgetItem,
    QAbstractItemView, QHeaderView, QPlainTextEdit, QComboBox, QDialog, QDialogButtonBox,
    QFileDialog, QMessageBox, QInputDialog, QProgressDialog, QCheckBox, QDoubleSpinBox)
from qgis.core import QgsProject

from .model import (QgisWorkspace, receive_package, read_json, file_digest,
                    value_sha, QgisReceivingError, require, utc_now)
from .qgis_project import (inspect_asset, add_to_project, capture_styles, save_project,
                           reopen_project, native_version, zoom_managed)

USER_ROLE = Qt.ItemDataRole.UserRole
GRAY = """
QWidget#StarforgeReceiving {background:#f5f5f5;color:#202020;}
QWidget#StarforgeReceiving QLabel {color:#202020;}
QWidget#StarforgeReceiving QLineEdit,QWidget#StarforgeReceiving QPlainTextEdit,
QWidget#StarforgeReceiving QTableWidget,QWidget#StarforgeReceiving QComboBox {background:#fff;color:#202020;border:1px solid #aaa;padding:4px;}
QWidget#StarforgeReceiving QPushButton {background:#ebebeb;color:#202020;border:1px solid #999;padding:6px 9px;min-height:20px;}
QWidget#StarforgeReceiving QPushButton:hover {background:#ddd;}
QWidget#StarforgeReceiving QPushButton:disabled {color:#777;border-color:#bbb;}
QWidget#StarforgeReceiving QHeaderView::section {background:#e6e6e6;color:#222;padding:5px;border:0;border-bottom:1px solid #aaa;}
QWidget#StarforgeReceiving QTabBar::tab {padding:7px;background:#e7e7e7;color:#222;}
QWidget#StarforgeReceiving QTabBar::tab:selected {background:#fff;border-bottom:2px solid #333;}
QWidget#StarforgeReceiving QTableWidget::item:selected {background:#d1d1d1;color:#111;}
"""


def pretty(value):
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)


def short(value, length=16):
    return str(value or "")[:length]


def source_label(row):
    source = row["source"]
    if source.get("sourceKind") == "vector":
        edition = source.get("sourceEdition", {})
        label = edition.get("editionId") or edition.get("id") or edition.get("version") or short(row["id"])
        return "Vector · " + str(label)
    return str(source.get("editionId") or short(row["id"]))


def button(text, callback, layout):
    item = QPushButton(text)
    item.clicked.connect(callback)
    layout.addWidget(item)
    return item


def table(headers, *, multiple=False):
    widget = QTableWidget(0, len(headers))
    widget.setHorizontalHeaderLabels(headers)
    widget.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
    widget.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection if multiple else QAbstractItemView.SelectionMode.SingleSelection)
    widget.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
    widget.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.ResizeToContents)
    widget.horizontalHeader().setStretchLastSection(True)
    widget.verticalHeader().hide()
    widget.setAlternatingRowColors(False)
    return widget


def fill(widget, rows):
    widget.setRowCount(len(rows))
    for index, (values, data) in enumerate(rows):
        for column, value in enumerate(values):
            item = QTableWidgetItem("" if value is None else str(value))
            if column == 0:
                item.setData(USER_ROLE, data)
            item.setToolTip("" if value is None else str(value))
            widget.setItem(index, column, item)


def selected(widget):
    return [widget.item(index, 0).data(USER_ROLE) for index in sorted({i.row() for i in widget.selectedIndexes()})
            if widget.item(index, 0)]


class DetailDialog(QDialog):
    def __init__(self, title, value, parent=None):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.resize(850, 580)
        layout = QVBoxLayout(self)
        text = QPlainTextEdit(pretty(value))
        text.setReadOnly(True)
        layout.addWidget(text)
        controls = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        controls.rejected.connect(self.reject)
        layout.addWidget(controls)


class LayerDialog(QDialog):
    def __init__(self, source_id, asset, inspection, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Add retained native GIS layer")
        self.resize(600, 560)
        self.source_id, self.asset, self.inspection = source_id, asset, inspection
        layout = QVBoxLayout(self)
        note = QLabel("Choose native layer and display settings. Original asset metadata and file bytes remain retained.")
        note.setWordWrap(True)
        layout.addWidget(note)
        form = QFormLayout()
        layout.addLayout(form)
        self.label = QLineEdit(asset.get("title") or asset["assetKey"])
        form.addRow("Layer name", self.label)
        self.kind = QComboBox()
        for row in inspection.get("layers", []):
            label = row["kind"] + " — " + (row.get("sublayer") or row.get("name") or asset["assetKey"])
            self.kind.addItem(label, row)
        if not self.kind.count():
            self.kind.addItem("Raster: ask the native GDAL provider", {"kind": "raster"})
            self.kind.addItem("Vector: ask the native OGR provider", {"kind": "vector"})
        if asset.get("nativeLayer") is not None:
            require(self.kind.count() == 1, "VECTOR_ORIGINAL_LAYER_SELECTION",
                    "Inspect the original native layer before adding this vector output.")
            self.kind.setEnabled(False)
        form.addRow("Native layer", self.kind)
        self.crs = QLineEdit()
        self.crs.setPlaceholderText("Keep source CRS; enter a verified CRS only to override")
        form.addRow("Explicit CRS override", self.crs)
        self.bands = QLineEdit()
        self.bands.setPlaceholderText("Native default, one gray band, or R,G,B band numbers")
        if asset.get("sourceKind") == "vector":
            self.bands.setEnabled(False)
        form.addRow("Band selection", self.bands)
        self.subset = QLineEdit()
        self.subset.setPlaceholderText("Optional explicit filter supported by the selected native vector provider")
        form.addRow("Vector filter", self.subset)
        self.opacity = QDoubleSpinBox()
        self.opacity.setRange(0, 1)
        self.opacity.setSingleStep(.1)
        self.opacity.setValue(1)
        form.addRow("Opacity", self.opacity)
        self.visible = QCheckBox("Visible")
        self.visible.setChecked(True)
        form.addRow("", self.visible)
        facts = QPlainTextEdit(pretty(inspection))
        facts.setReadOnly(True)
        layout.addWidget(facts)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def definition(self):
        native = self.kind.currentData()
        raw = self.bands.text().strip()
        bands = None
        if raw:
            try:
                values = [int(x.strip()) for x in raw.split(",")]
            except ValueError as exc:
                raise QgisReceivingError("RASTER_BANDS", "Enter one native band number or three comma-separated RGB band numbers.") from exc
            require(len(values) in (1, 3) and all(x > 0 for x in values), "RASTER_BANDS", "Enter one band or three RGB bands.")
            bands = {"gray": values[0]} if len(values) == 1 else {"rgb": values}
        return {"id": "layer-" + uuid.uuid4().hex, "sourceId": self.source_id,
                "kind": native["kind"], "label": self.label.text().strip(),
                "collection": self.asset.get("collection"), "itemId": self.asset["itemId"], "assetKey": self.asset["assetKey"],
                "vectorLayer": native.get("sublayer", "") if native["kind"] == "vector" else "",
                "bands": bands, "vectorSubsetString": self.subset.text(), "crsOverride": self.crs.text().strip() or None,
                "opacity": self.opacity.value(), "visible": self.visible.isChecked()}


class ReceivingDock(QDockWidget):
    def __init__(self, iface):
        super().__init__("Starforge STAC Receiving", iface.mainWindow())
        self.iface, self.workspace, self.state, self.source = iface, None, None, None
        self.settings = QSettings()
        self.busy = False
        self.pending = None
        self.pending_count = 0
        self.setObjectName("StarforgeSTACReceivingDock")
        self.container = QWidget()
        self.container.setObjectName("StarforgeReceiving")
        self.container.setStyleSheet(GRAY)
        self.setWidget(self.container)
        layout = QVBoxLayout(self.container)
        top = QHBoxLayout()
        layout.addLayout(top)
        button("Create project", self.create_workspace, top)
        button("Open project", self.open_workspace, top)
        button("Receive archive", self.receive_archive, top)
        button("Guide", self.guide, top)
        self.summary = QLabel("Open an existing GIS workspace or create a new project.")
        self.summary.setWordWrap(True)
        layout.addWidget(self.summary)
        actor_row = QHBoxLayout()
        layout.addLayout(actor_row)
        actor_row.addWidget(QLabel("Analyst"))
        self.actor = QLineEdit(self.settings.value("starforge_stac/actor", ""))
        self.actor.setPlaceholderText("Name retained with project changes")
        actor_row.addWidget(self.actor)
        self.actor.editingFinished.connect(lambda: self.settings.setValue("starforge_stac/actor", self.actor.text().strip()))
        self.tabs = QTabWidget()
        layout.addWidget(self.tabs)
        self._sources_tab()
        self._layers_tab()
        self._review_tab()
        self._project_tab()
        from .field_ui import FieldPanel
        self.field_panel = FieldPanel(self)
        self.tabs.addTab(self.field_panel, "Field")
        self._history_tab()
        self.status = QLabel("Native QGIS " + native_version()["qgis"])
        self.status.setWordWrap(True)
        layout.addWidget(self.status)
        root = self.settings.value("starforge_stac/workspace", "")
        if root:
            QTimer.singleShot(0, lambda: self.run("Open retained project", lambda: self.set_workspace(QgisWorkspace(root))))

    def page(self, title):
        page = QWidget()
        layout = QVBoxLayout(page)
        self.tabs.addTab(page, title)
        return layout

    def _sources_tab(self):
        layout = self.page("Sources")
        instructions = QLabel("Import the original qgis-receiving.json or vector-export.json. Each source edition, native layer and complete file bundle is retained.")
        instructions.setWordWrap(True)
        layout.addWidget(instructions)
        controls = QHBoxLayout()
        layout.addLayout(controls)
        button("Import original receiving", self.import_source, controls)
        button("Select edition", self.activate_source, controls)
        button("View original metadata", self.source_details, controls)
        self.sources = table(["Edition", "Source groups", "Outputs", "Receiving SHA-256", "Imported"])
        layout.addWidget(self.sources)
        self.sources.itemDoubleClicked.connect(lambda *_: self.source_details())

    def _layers_tab(self):
        layout = self.page("Sources and layers")
        scene_controls = QHBoxLayout()
        layout.addLayout(scene_controls)
        self.all_footprints = button("All footprints", lambda: self.add_footprints(True), scene_controls)
        self.selected_footprints = button("Selected footprints", lambda: self.add_footprints(False), scene_controls)
        self.scene_metadata = button("Source metadata", self.scene_details, scene_controls)
        self.all_footprints.setEnabled(False)
        self.selected_footprints.setEnabled(False)
        self.scenes = table(["Collection", "Item", "Observed", "Cloud %", "Assets"], multiple=True)
        self.scenes.setMinimumHeight(140)
        self.scenes.itemSelectionChanged.connect(self.refresh_assets)
        layout.addWidget(self.scenes)
        self.assets = table(["Asset", "Kind", "Outcome", "Bytes", "SHA-256"])
        self.assets.setMinimumHeight(120)
        layout.addWidget(self.assets)
        asset_controls = QHBoxLayout()
        layout.addLayout(asset_controls)
        button("Inspect native file", self.inspect_selected, asset_controls)
        button("Add selected asset", self.add_asset, asset_controls)
        button("Open retained file folder", self.open_asset_folder, asset_controls)
        self.layers = table(["Map layer", "Kind", "Edition", "Style", "Visible"])
        self.layers.setMinimumHeight(130)
        layout.addWidget(self.layers)
        controls = QHBoxLayout()
        layout.addLayout(controls)
        button("Edit selected", self.edit_layer, controls)
        button("Remove selected", self.remove_layer, controls)
        button("Move up", lambda: self.move_layer(-1), controls)
        button("Move down", lambda: self.move_layer(1), controls)
        button("Apply to QGIS map", self.apply_layers, controls)
        second = QHBoxLayout()
        layout.addLayout(second)
        button("Zoom to layers", lambda: self.run("Zoom to retained map layers", lambda: zoom_managed(self.iface, self.need_workspace())), second)
        button("Native layer properties", self.layer_properties, second)
        button("Capture current styles", self.capture_styles, second)

    def _review_tab(self):
        layout = self.page("Later edition")
        note = QLabel("Review every existing map layer against a selected later edition. Keep retains its original data; Update selects the later received file; Remove removes that map layer. Changed file bytes reset native bands, CRS override and custom style for inspection.")
        note.setWordWrap(True)
        layout.addWidget(note)
        controls = QHBoxLayout()
        layout.addLayout(controls)
        self.left = QComboBox()
        self.right = QComboBox()
        controls.addWidget(QLabel("Prior"))
        controls.addWidget(self.left)
        controls.addWidget(QLabel("Later"))
        controls.addWidget(self.right)
        button("Compare", self.compare, controls)
        self.review_summary = QLabel("Select two imported editions.")
        self.review_summary.setWordWrap(True)
        layout.addWidget(self.review_summary)
        self.review = table(["Map layer", "Current asset / scope", "Later availability", "Decision"])
        layout.addWidget(self.review)
        self.review_note = QLineEdit()
        self.review_note.setPlaceholderText("Reason for the reviewed edition change")
        layout.addWidget(self.review_note)
        control = QHBoxLayout()
        layout.addLayout(control)
        button("View complete comparison", self.compare_details, control)
        button("Apply reviewed decisions", self.apply_review, control)
        self.comparison = None

    def _project_tab(self):
        layout = self.page("Saved maps and receiving")
        instructions = QLabel("Save a native QGZ version from the retained layer choices. The complete receiving archive includes every imported edition, native map, style resource, review and original history.")
        instructions.setWordWrap(True)
        layout.addWidget(instructions)
        form = QFormLayout()
        layout.addLayout(form)
        self.project_crs = QLineEdit()
        self.project_crs.setPlaceholderText("Use the first native layer CRS, or enter an explicit project CRS")
        form.addRow("Project CRS", self.project_crs)
        buttons = QHBoxLayout()
        layout.addLayout(buttons)
        button("Save native map version", self.save_native, buttons)
        button("Reopen selected map", self.reopen_native, buttons)
        self.projects = table(["Saved", "Analyst", "Layers", "Project", "SHA-256"])
        layout.addWidget(self.projects)
        bottom = QHBoxLayout()
        layout.addLayout(bottom)
        button("Saved map details", self.project_details, bottom)
        button("Export complete project", self.export_archive, bottom)
        button("Open project folder", self.open_project_folder, bottom)

    def _history_tab(self):
        layout = self.page("History and recovery")
        buttons = QHBoxLayout()
        layout.addLayout(buttons)
        button("Refresh project", lambda: self.run("Refresh", self.refresh), buttons)
        button("Resume pending action", self.resume_pending, buttons)
        button("Release local pending action", self.release_pending, buttons)
        self.pending_label = QLabel("No local pending action.")
        self.pending_label.setWordWrap(True)
        layout.addWidget(self.pending_label)
        self.history = table(["Revision", "Time", "Analyst", "Action", "Request"])
        layout.addWidget(self.history)
        self.history.itemDoubleClicked.connect(lambda *_: self.history_details())
        button("Open history record", self.history_details, layout)

    def progress(self, value):
        if self.progress_dialog.wasCanceled():
            raise QgisReceivingError("CANCELLED", "The current local operation was cancelled. Its retained files and request remain available.")
        path = value.get("path", "")
        self.progress_dialog.setLabelText(value.get("phase", "Working") + "\n" + path)
        if value.get("totalBytes"):
            self.progress_dialog.setRange(0, 1000)
            self.progress_dialog.setValue(min(1000, int(1000 * value.get("completedBytes", 0) / value["totalBytes"])))
        else:
            self.progress_dialog.setRange(0, 0)
        QApplication.processEvents()

    def run(self, title, callback):
        if self.busy:
            return
        self.busy = True
        self.progress_dialog = QProgressDialog(title, "Cancel", 0, 0, self)
        self.progress_dialog.setWindowModality(Qt.WindowModality.WindowModal)
        self.progress_dialog.setMinimumDuration(500)
        self.container.setEnabled(False)
        try:
            result = callback()
            self.status.setText(title + " completed.")
            return result
        except QgisReceivingError as exc:
            self.status.setText(exc.code + ": " + str(exc))
            QMessageBox.warning(self, title, str(exc) + ("\n\n" + pretty(exc.details) if exc.details else ""))
        except Exception as exc:
            self.status.setText(type(exc).__name__ + ": " + str(exc))
            dialog = QMessageBox(QMessageBox.Icon.Critical, title, str(exc), parent=self)
            dialog.setDetailedText(traceback.format_exc())
            dialog.exec()
        finally:
            self.progress_dialog.close()
            self.container.setEnabled(True)
            self.busy = False
            self.show_pending()

    def selected_one(self, widget, noun):
        rows = selected(widget)
        require(len(rows) == 1, "SELECTION_REQUIRED", "Select one " + noun + ".")
        return rows[0]

    def need_workspace(self):
        require(self.workspace is not None, "WORKSPACE_REQUIRED", "Create or open a GIS project workspace.")
        return self.workspace

    def flush_settings(self):
        self.settings.sync()
        status = self.settings.status()
        require(getattr(status, "value", status) == 0, "PENDING_STORAGE",
                "The local pending action could not be saved. Restore access to the QGIS settings location before continuing.")

    @staticmethod
    def pending_key(task):
        binding = {"workspace": task["workspace"], "workspaceId": task["workspaceId"]}
        return "starforge_stac/pending_by_workspace/" + value_sha(binding) + "/" + value_sha(task["requestId"])

    def retain_pending(self, task):
        key = self.pending_key(task)
        self.settings.sync()
        existing = self.settings.value(key, "")
        if existing:
            require(json.loads(existing) == task, "PENDING_RECORD_CHANGED",
                    "This original pending request already has different retained inputs.")
        else:
            self.settings.setValue(key, pretty(task))
        self.flush_settings()

    def clear_pending(self, task):
        key = self.pending_key(task)
        self.settings.sync()
        existing = self.settings.value(key, "")
        if existing:
            require(json.loads(existing) == task, "PENDING_RECORD_CHANGED",
                    "Refresh the original pending request before releasing its saved marker.")
            self.settings.remove(key)
            self.flush_settings()

    def load_pending(self):
        self.pending, self.pending_count = None, 0
        if self.workspace is None:
            return
        binding = {"workspace": str(self.workspace.root), "workspaceId": self.workspace.read()["id"]}
        self.settings.sync()
        legacy_raw = self.settings.value("starforge_stac/pending", "")
        if legacy_raw:
            try:
                legacy = json.loads(legacy_raw)
            except (TypeError, ValueError):
                legacy = None
            if isinstance(legacy, dict) and legacy.get("workspace") == binding["workspace"]:
                candidate = {**legacy, "workspaceId": binding["workspaceId"]}
                self.retain_pending(candidate)
                if self.settings.value("starforge_stac/pending", "") == legacy_raw:
                    self.settings.remove("starforge_stac/pending")
                    self.flush_settings()
        group = "starforge_stac/pending_by_workspace/" + value_sha(binding)
        self.settings.beginGroup(group)
        try:
            keys = list(self.settings.childKeys())
        finally:
            self.settings.endGroup()
        tasks = []
        for key in keys:
            raw = self.settings.value(group + "/" + key, "")
            try:
                task = json.loads(raw)
            except (TypeError, ValueError) as exc:
                raise QgisReceivingError("PENDING_RECORD_INVALID", "The saved local action could not be read.") from exc
            require(isinstance(task, dict) and task.get("workspace") == binding["workspace"] and
                    task.get("workspaceId") == binding["workspaceId"] and type(task.get("revision")) is int and
                    isinstance(task.get("requestId"), str) and isinstance(task.get("payload"), dict) and
                    isinstance(task.get("action"), str) and isinstance(task.get("actor"), str) and
                    self.pending_key(task) == group + "/" + key, "PENDING_RECORD_INVALID",
                    "Retain the pending action with its original workspace, analyst and request.")
            tasks.append(task)
        tasks.sort(key=lambda task: (task["revision"], task["requestId"]))
        self.pending_count = len(tasks)
        self.pending = tasks[0] if tasks else None

    def set_workspace(self, workspace):
        self.workspace = workspace
        self.settings.setValue("starforge_stac/workspace", str(workspace.root))
        self.refresh()

    def refresh(self):
        if self.workspace is None:
            return
        self.state = self.workspace.read()
        self.load_pending()
        self.source = self.workspace.source() if self.state["activeSourceId"] else None
        self.summary.setText(self.state["title"] + " · revision " + str(self.state["revision"]) + "\n" + str(self.workspace.root))
        fill(self.sources, [([source_label(x), x.get("summary", {}).get("scenes", ""),
                             x.get("summary", {}).get("assets", ""), x["id"], x["importedAt"]], x) for x in self.state["sources"]])
        vector = self.source is not None and self.source.sourceKind == "vector"
        self.all_footprints.setEnabled(self.source is not None and not vector)
        self.selected_footprints.setEnabled(self.source is not None and not vector)
        if vector:
            self.scenes.setHorizontalHeaderLabels(["Source", "Source layer", "Formats", "Source features", "Native layers"])
            self.scene_metadata.setText("Original layer metadata")
            fill(self.scenes, [([x["sourceId"],
                                self.source.scenes[x["key"]]["layers"][0]["sourceReference"]["nativeSourceLayer"],
                                ", ".join(x["formats"]), x["sourceFeatureCount"], x["assetCount"]], x)
                               for x in self.source.scene_rows()])
        else:
            self.scenes.setHorizontalHeaderLabels(["Collection", "Item", "Observed", "Cloud %", "Assets"])
            self.scene_metadata.setText("Scene metadata")
            fill(self.scenes, [([x.get("collection"), x["itemId"], x.get("datetime") or
                                " / ".join(str(x.get(k) or "") for k in ("startDatetime", "endDatetime")),
                                x.get("cloudCover"), x["assetCount"]], x)
                               for x in self.source.scene_rows()] if self.source else [])
        self.refresh_assets()
        source_names = {x["id"]: source_label(x) for x in self.state["sources"]}
        fill(self.layers, [([x["label"], x["kind"], source_names[x["sourceId"]],
                            short((x.get("styleFile") or {}).get("sha256")) or "Native default",
                            "Yes" if x["visible"] else "No"], x) for x in self.state["layers"]])
        fill(self.projects, [([x["at"], x["actor"], len(x["layers"]), x["id"], x["file"]["sha256"]], x)
                             for x in reversed(self.state["projects"])])
        for widget in (self.left, self.right):
            old = widget.currentData()
            widget.clear()
            for row in self.state["sources"]:
                widget.addItem(source_label(row) + " · " + short(row["id"], 10), row["id"])
            index = widget.findData(old)
            if index >= 0:
                widget.setCurrentIndex(index)
        fill(self.history, [([x["revision"], x["at"], x["actor"], x["action"], x["requestId"]], x)
                            for x in reversed(self.workspace.history())])
        self.field_panel.refresh(self.state)
        self.show_pending()

    def refresh_assets(self):
        if self.source is None:
            fill(self.assets, [])
            return
        chosen = selected(self.scenes)
        keys = {x["key"] for x in chosen}
        rows = [x for x in self.source.asset_rows() if not keys or x["sceneKey"] in keys]
        vector = self.source.sourceKind == "vector"
        self.assets.setHorizontalHeaderLabels(["Native layer", "Format", "Outcome", "Bytes", "Bundle SHA-256"]
                                               if vector else ["Asset", "Kind", "Outcome", "Bytes", "SHA-256"])
        fill(self.assets, [([x["title"], x.get("driver", x["kindHint"]) if vector else x["kindHint"],
                            x["outcome"], (x.get("file") or {}).get("bytes"),
                            (x.get("file") or {}).get("nativeBundleSha256") if vector
                            else (x.get("file") or {}).get("sha256")], x) for x in rows])

    def show_pending(self):
        self.pending_label.setText("Pending " + self.pending["action"] + " · " + self.pending["requestId"] +
                                   " · input revision " + str(self.pending["revision"]) +
                                   (" · " + str(self.pending_count - 1) + " additional retained action(s)" if self.pending_count > 1 else "")
                                   if self.pending else "No local pending action.")

    def mutate(self, action, payload):
        self.need_workspace()
        self.load_pending()
        require(self.pending is None, "PENDING_ACTION", "Resume the pending action, or release its local marker before starting another change.")
        actor = self.actor.text().strip()
        require(actor, "ACTOR_REQUIRED", "Enter the analyst name retained with this change.")
        self.pending = {"workspace": str(self.workspace.root), "workspaceId": self.state["id"],
                        "action": action, "payload": payload, "revision": self.state["revision"],
                        "requestId": "qgis-" + uuid.uuid4().hex, "actor": actor}
        self.retain_pending(self.pending)
        self.pending_count = 1
        return self.execute_pending()

    def execute_pending(self):
        task = self.pending
        require(task is not None, "PENDING_ACTION", "There is no local pending action.")
        workspace = self.need_workspace()
        require(task.get("workspace") == str(workspace.root) and task.get("workspaceId") == workspace.read()["id"],
                "PENDING_WORKSPACE_CHANGED", "Reopen the original workspace for this retained action.")
        self.retain_pending(task)
        common = {"revision": task["revision"], "request_id": task["requestId"], "actor": task["actor"]}
        data = task["payload"]
        action = task["action"]
        if action == "import":
            result = workspace.import_source(data["directory"], expected_manifest_sha256=data["sha256"], progress=self.progress, **common)
        elif action == "activate":
            result = workspace.activate_source(data["sourceId"], **common)
        elif action == "layers":
            result = workspace.save_layers(data["layers"], **common)
        elif action == "review":
            result = workspace.review_successor(data["left"], data["right"], data["decisions"], note=data["note"], **common)
        elif action == "styles":
            result = capture_styles(workspace, QgsProject.instance(), **common)
        elif action == "save":
            result = save_project(workspace, project_crs=data.get("projectCrs"), progress=self.progress, **common)
        elif action.startswith("field."):
            result = self.field_panel.execute(workspace, action, data, **common)
        else:
            raise QgisReceivingError("PENDING_ACTION_INVALID", "This saved local action is unknown.")
        self.clear_pending(task)
        self.pending = None
        self.refresh()
        return result

    def resume_pending(self):
        self.run("Resume original project action", self.execute_pending)

    def release_pending(self):
        if not self.pending:
            return
        answer = QMessageBox.question(self, "Release local pending action",
                                      "Keep all retained files and original operation history, and release this local pending marker?",
                                      QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        if answer == QMessageBox.StandardButton.Yes:
            self.clear_pending(self.pending)
            self.load_pending()
            self.show_pending()

    def create_workspace(self):
        parent = QFileDialog.getExistingDirectory(self, "Choose parent for a new GIS workspace")
        if not parent:
            return
        name, ok = QInputDialog.getText(self, "Create GIS project", "New directory name")
        if not ok or not name.strip():
            return
        def work():
            require(Path(name).name == name and name not in (".", ".."), "NEW_WORKSPACE_NAME", "Enter one new directory name.")
            root = Path(parent) / name
            self.set_workspace(QgisWorkspace(root, create=True, title=name))
        self.run("Create GIS workspace", work)

    def open_workspace(self):
        root = QFileDialog.getExistingDirectory(self, "Open existing GIS workspace")
        if root:
            self.run("Open GIS workspace", lambda: self.set_workspace(QgisWorkspace(root)))

    def receive_archive(self):
        filename, _ = QFileDialog.getOpenFileName(self, "Receive complete GIS project", "", "Project archive (*.zip)")
        if not filename:
            return
        parent = QFileDialog.getExistingDirectory(self, "Choose parent for received project")
        if not parent:
            return
        name, ok = QInputDialog.getText(self, "Received project", "New or same unfinished receiving directory name")
        if not ok or not name:
            return
        def work():
            require(Path(name).name == name and name not in (".", ".."), "NEW_WORKSPACE_NAME", "Enter one receiving directory name.")
            answer = receive_package(filename, Path(parent) / name, progress=self.progress)
            self.set_workspace(answer["workspace"])
            DetailDialog("Complete project received", answer["receipt"], self).exec()
        self.run("Receive complete project", work)

    def import_source(self):
        filename, _ = QFileDialog.getOpenFileName(self, "Select original receiving manifest", "",
                                                 "Original receiving (qgis-receiving.json vector-export.json)")
        if not filename:
            return
        def work():
            require(Path(filename).name in ("qgis-receiving.json", "vector-export.json"),
                    "RECEIVING_MANIFEST", "Select the original qgis-receiving.json or vector-export.json.")
            measured = file_digest(filename)
            self.mutate("import", {"directory": str(Path(filename).parent), "sha256": measured["sha256"]})
        self.run("Import original receiving", work)

    def activate_source(self):
        self.run("Select source edition", lambda: self.mutate("activate", {"sourceId": self.selected_one(self.sources, "source edition")["id"]}))

    def source_details(self):
        self.run("Read source metadata", lambda: DetailDialog("Original receiving source",
                 self.workspace.source(self.selected_one(self.sources, "source edition")["id"]).manifest, self).exec())

    def scene_details(self):
        self.run("Read original source layers", lambda: DetailDialog("Original source layer metadata",
                 [self.source.scenes[x["key"]] for x in selected(self.scenes)], self).exec())

    def add_footprints(self, all_scenes):
        def work():
            self.need_workspace()
            require(self.source is not None, "SOURCE_NOT_SELECTED", "Select an imported source edition.")
            require(self.source.sourceKind == "stac", "VECTOR_LAYER_KIND",
                    "Select the actual native vector output for this source.")
            keys = list(self.source.scenes) if all_scenes else [x["key"] for x in selected(self.scenes)]
            require(keys, "SCENE_SELECTION", "Select original scenes to map.")
            row = {"id": "layer-" + uuid.uuid4().hex, "sourceId": self.source.id, "kind": "footprints",
                   "label": "Scene footprints", "allScenes": all_scenes, "sceneKeys": keys, "visible": True, "opacity": 1}
            self.mutate("layers", {"layers": copy.deepcopy(self.state["layers"]) + [row]})
        self.run("Add original scene footprints", work)

    def inspect_selected(self):
        def work():
            row = self.selected_one(self.assets, "asset")
            value = inspect_asset(self.workspace, self.source.id, row.get("collection"), row["itemId"], row["assetKey"], progress=self.progress)
            DetailDialog("Original asset and native provider", value, self).exec()
        self.run("Inspect native received asset", work)

    def add_asset(self):
        def work():
            self.need_workspace()
            row = self.selected_one(self.assets, "asset")
            require(row.get("file"), "ASSET_NOT_RECEIVED", "This asset has metadata only. Select an actually received file.")
            inspection = inspect_asset(self.workspace, self.source.id, row.get("collection"), row["itemId"], row["assetKey"], progress=self.progress)
            dialog = LayerDialog(self.source.id, row, inspection, self)
            if dialog.exec() == QDialog.DialogCode.Accepted:
                self.mutate("layers", {"layers": copy.deepcopy(self.state["layers"]) + [dialog.definition()]})
        self.run("Add retained native asset", work)

    def open_asset_folder(self):
        def work():
            row = self.selected_one(self.assets, "asset")
            require(row.get("file"), "ASSET_NOT_RECEIVED", "Select a received local file.")
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(self.source.path(row["file"]["path"]).parent)))
        self.run("Open retained asset folder", work)

    def edit_layer(self):
        def work():
            row = self.selected_one(self.layers, "map layer")
            if row["kind"] == "footprints":
                label, ok = QInputDialog.getText(self, "Edit footprint layer", "Layer name", text=row["label"])
                if not ok:
                    return
                replacement = copy.deepcopy(row)
                replacement["label"] = label
            else:
                source = self.workspace.source(row["sourceId"])
                asset = next(x for x in source.asset_rows() if x["itemId"] == row["itemId"] and
                             x.get("collection") == row.get("collection") and x["assetKey"] == row["assetKey"])
                inspection = inspect_asset(self.workspace, source.id, row.get("collection"),
                                           row["itemId"], row["assetKey"], progress=self.progress)
                dialog = LayerDialog(source.id, asset, inspection, self)
                dialog.label.setText(row["label"])
                dialog.crs.setText(row.get("crsOverride") or "")
                bands = row.get("bands")
                dialog.bands.setText(str(bands["gray"]) if bands and "gray" in bands else
                                     ",".join(map(str, bands["rgb"])) if bands else "")
                dialog.subset.setText(row.get("vectorSubsetString", ""))
                dialog.opacity.setValue(row["opacity"])
                dialog.visible.setChecked(row["visible"])
                for index in range(dialog.kind.count()):
                    detail = dialog.kind.itemData(index)
                    if detail["kind"] == row["kind"] and (not row.get("vectorLayer") or detail.get("sublayer") == row["vectorLayer"]):
                        dialog.kind.setCurrentIndex(index)
                        break
                if dialog.exec() != QDialog.DialogCode.Accepted:
                    return
                replacement = dialog.definition()
                replacement["id"] = row["id"]
                # Explicit native band/CRS/sublayer edits select the current native renderer.
                if all(replacement.get(k) == row.get(k) for k in ("kind", "bands", "crsOverride", "vectorLayer")):
                    replacement["styleFile"] = row.get("styleFile")
                    replacement["styleDependencies"] = row.get("styleDependencies", [])
            self.mutate("layers", {"layers": [replacement if x["id"] == row["id"] else x for x in self.state["layers"]]})
        self.run("Edit retained layer choices", work)

    def remove_layer(self):
        def work():
            row = self.selected_one(self.layers, "map layer")
            self.mutate("layers", {"layers": [x for x in self.state["layers"] if x["id"] != row["id"]]})
        self.run("Remove selected map layer", work)

    def move_layer(self, direction):
        def work():
            row = self.selected_one(self.layers, "map layer")
            rows = copy.deepcopy(self.state["layers"])
            at = next(i for i, x in enumerate(rows) if x["id"] == row["id"])
            target = at + direction
            require(0 <= target < len(rows), "LAYER_ORDER", "This layer is already at that end of the selection.")
            rows[at], rows[target] = rows[target], rows[at]
            self.mutate("layers", {"layers": rows})
        self.run("Change map layer order", work)

    def apply_layers(self):
        def work():
            result = add_to_project(self.need_workspace(), QgsProject.instance(), progress=self.progress)
            self.iface.mapCanvas().refresh()
            return result
        self.run("Apply retained layers to QGIS", work)

    def layer_properties(self):
        def work():
            row = self.selected_one(self.layers, "map layer")
            layer = next((x for x in QgsProject.instance().mapLayers().values()
                          if x.customProperty("starforge/workspaceId") == self.state["id"] and
                          x.customProperty("starforge/layerId") == row["id"]), None)
            require(layer is not None, "MANAGED_LAYER_NOT_OPEN", "Apply this workspace's layers to QGIS first.")
            self.iface.showLayerProperties(layer)
        self.run("Native layer properties", work)

    def capture_styles(self):
        self.run("Capture current native styles", lambda: self.mutate("styles", {}))

    def compare(self):
        def work():
            self.need_workspace()
            self.comparison = self.workspace.compare(self.left.currentData(), self.right.currentData())
            result = self.comparison
            identity_note = ("Same original source/layer identities: " + str(result["sameSourceIdentities"])
                             if result.get("leftSourceKind") == result.get("rightSourceKind") == "vector"
                             else "Same original query: " + str(result["sameQuery"]))
            self.review_summary.setText(pretty(result["counts"]) + "\n" + identity_note)
            assets = {x["key"]: x for x in result["assets"]}
            rows = [x for x in self.state["layers"] if x["sourceId"] == result["leftSourceId"]]
            fill(self.review, [([x["label"], x.get("assetKey") or str(len(x["sceneKeys"])) + " original scenes",
                                "", ""], x) for x in rows])
            for index, row in enumerate(rows):
                if row["kind"] == "footprints":
                    availability = "Original later footprint selection"
                else:
                    key = json.dumps([row.get("collection"), row["itemId"], row["assetKey"]], ensure_ascii=False, separators=(",", ":"))
                    outcome = assets.get(key, {})
                    availability = str(outcome.get("status")) + " · " + ("same bytes" if outcome.get("sameReceivedBytes") else "review file")
                self.review.setItem(index, 2, QTableWidgetItem(availability))
                choice = QComboBox()
                choice.addItem("Choose decision", None)
                for text in ("keep", "update", "remove"):
                    choice.addItem(text.capitalize(), text)
                self.review.setCellWidget(index, 3, choice)
        self.run("Compare original receiving editions", work)

    def compare_details(self):
        self.run("Read complete comparison", lambda: DetailDialog("Original edition comparison",
                 self.comparison or {"message": "Compare two source editions first."}, self).exec())

    def apply_review(self):
        def work():
            require(self.comparison is not None, "COMPARISON_REQUIRED", "Compare two original source editions first.")
            require(self.left.currentData() == self.comparison["leftSourceId"] and self.right.currentData() == self.comparison["rightSourceId"],
                    "COMPARISON_CHANGED", "Compare the newly selected source pair before accepting it.")
            decisions = [{"layerId": self.review.item(i, 0).data(USER_ROLE)["id"],
                          "decision": self.review.cellWidget(i, 3).currentData()} for i in range(self.review.rowCount())]
            require(all(x["decision"] for x in decisions), "COMPLETE_REVIEW_REQUIRED", "Choose each map layer's explicit decision.")
            self.mutate("review", {"left": self.comparison["leftSourceId"], "right": self.comparison["rightSourceId"],
                                   "decisions": decisions, "note": self.review_note.text().strip()})
            self.comparison = None
            fill(self.review, [])
            self.review_summary.setText("Reviewed layer choices are retained. Inspect changed native files and apply the new selection to QGIS.")
        self.run("Apply reviewed successor choices", work)

    def save_native(self):
        self.run("Save native map version", lambda: self.mutate("save", {"projectCrs": self.project_crs.text().strip() or None}))

    def reopen_native(self):
        def work():
            row = self.selected_one(self.projects, "saved map")
            project, readback = reopen_project(self.workspace, row["id"], progress=self.progress)
            # addProject uses the application's native save-current-project prompt.
            self.iface.addProject(str(self.workspace.root / row["file"]["path"]))
            self.status.setText("Opened original map " + row["id"])
            return readback
        self.run("Reopen retained native map", work)

    def project_details(self):
        self.run("Read saved map", lambda: DetailDialog("Saved native map and original layer choices",
                 self.selected_one(self.projects, "saved map"), self).exec())

    def export_archive(self):
        self.need_workspace()
        filename, _ = QFileDialog.getSaveFileName(self, "Export complete native GIS project", self.state["title"] + ".zip", "ZIP archive (*.zip)")
        if not filename:
            return
        def work():
            result = self.workspace.export_package(filename, expected_revision=self.state["revision"], progress=self.progress)
            DetailDialog("Complete project receiving archive", result, self).exec()
        self.run("Export complete GIS project", work)

    def open_project_folder(self):
        self.run("Open GIS project folder", lambda: QDesktopServices.openUrl(QUrl.fromLocalFile(str(self.need_workspace().root))))

    def history_details(self):
        self.run("Read original history", lambda: DetailDialog("Project history event",
                 self.selected_one(self.history, "history event"), self).exec())

    def guide(self):
        name = "VECTOR_RECEIVING.md" if self.source is not None and self.source.sourceKind == "vector" else "OPERATIONS.md"
        path = Path(__file__).resolve().parent / name
        if not path.is_file():
            path = path.parent.parent / name
        if path.is_file():
            dialog = QDialog(self)
            dialog.setWindowTitle("Starforge QGIS operator guide")
            dialog.resize(880, 650)
            layout = QVBoxLayout(dialog)
            content = QPlainTextEdit(path.read_text(encoding="utf-8"))
            content.setReadOnly(True)
            layout.addWidget(content)
            close = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
            close.rejected.connect(dialog.reject)
            layout.addWidget(close)
            dialog.exec()


class StarforgeStacPlugin:
    def __init__(self, iface):
        self.iface = iface
        self.action = None
        self.dock = None

    def initGui(self):
        self.action = QAction("Starforge STAC Receiving", self.iface.mainWindow())
        self.action.triggered.connect(self.show)
        self.iface.addPluginToMenu("Starforge STAC", self.action)
        self.iface.addToolBarIcon(self.action)

    def show(self):
        if self.dock is None:
            self.dock = ReceivingDock(self.iface)
            self.iface.addDockWidget(Qt.DockWidgetArea.RightDockWidgetArea, self.dock)
        self.dock.show()
        self.dock.raise_()

    def unload(self):
        if self.dock:
            self.iface.removeDockWidget(self.dock)
            self.dock.deleteLater()
            self.dock = None
        if self.action:
            self.iface.removePluginMenu("Starforge STAC", self.action)
            self.iface.removeToolBarIcon(self.action)
            self.action.deleteLater()
            self.action = None
