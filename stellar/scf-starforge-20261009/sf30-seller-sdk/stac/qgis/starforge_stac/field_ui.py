# SPDX-License-Identifier: MIT
"""Native field commissioning, collection and office receiving in the original dock."""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import uuid

from qgis.PyQt.QtCore import Qt, QUrl
from qgis.PyQt.QtGui import QDesktopServices
from qgis.PyQt.QtWidgets import (QWidget, QDialog, QVBoxLayout, QHBoxLayout, QFormLayout,
    QLabel, QLineEdit, QPlainTextEdit, QPushButton, QComboBox, QCheckBox, QTableWidget,
    QTableWidgetItem, QDialogButtonBox, QFileDialog, QMessageBox, QInputDialog, QTabWidget,
    QAbstractItemView, QHeaderView, QSplitter, QGroupBox)
from qgis.core import QgsApplication

from .model import require, member, file_digest, value_sha, read_json
from .field import (SCHEMA, NATIVE_ACTIONS, configuration, campaign_for, round_for,
                    returned_inventory, copy_device_package, review_page, field_command)
from .field_bridge import run_native
from .plugin import table, fill, selected, DetailDialog, pretty, short, button

ROLE = Qt.ItemDataRole.UserRole
WIDGETS = ("text", "multiline", "choice", "range", "date", "attachment", "image")
RUNTIME_KEY = "starforge_stac/field_native_runtime"

def _note(text):
    label = QLabel(text)
    label.setWordWrap(True)
    label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
    return label

def _select(combo, value):
    index = combo.findData(value)
    if index >= 0:
        combo.setCurrentIndex(index)

def _buttons(dialog, layout, title="Save"):
    buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel)
    buttons.button(QDialogButtonBox.StandardButton.Save).setText(title)
    buttons.accepted.connect(dialog.accept)
    buttons.rejected.connect(dialog.reject)
    layout.addWidget(buttons)
    return buttons

def _dialog_error(dialog, callback):
    try:
        return callback()
    except Exception as exc:
        QMessageBox.warning(dialog, "Review field configuration", str(exc))
        return None

def _checked(value=False):
    widget = QCheckBox()
    widget.setChecked(value)
    return widget

class RuntimeDialog(QDialog):
    def __init__(self, profile, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Installed native QGIS and QFieldSync")
        self.resize(700, 430)
        layout = QVBoxLayout(self)
        layout.addWidget(_note("Use the Python environment supplied with the installed QGIS 3.40 or later and its installed QFieldSync/libqfieldsync. Native field operations run in one separate process so the map open in QGIS stays available."))
        form = QFormLayout()
        layout.addLayout(form)
        command = profile.get("native_command") or [""]
        self.executable = QLineEdit(command[0])
        line = QHBoxLayout()
        line.addWidget(self.executable)
        button("Browse", self.choose_executable, line)
        form.addRow("QGIS Python or wrapper", line)
        self.arguments = QLineEdit(json.dumps(command[1:]))
        form.addRow("Wrapper arguments (JSON array)", self.arguments)
        self.library = QLineEdit(profile.get("qfieldsync_path", ""))
        line = QHBoxLayout()
        line.addWidget(self.library)
        button("Browse", self.choose_library, line)
        form.addRow("Installed QFieldSync folder", line)
        self.prefix = QLineEdit(profile.get("prefix_path", QgsApplication.prefixPath()))
        form.addRow("QGIS prefix", self.prefix)
        layout.addWidget(_note("On an OSGeo4W installation, select its configured QGIS Python wrapper. On Linux, select the Python executable that imports the installed qgis package. The normal project inspection checks this exact runtime before commissioning."))
        _buttons(self, layout)
        self.value = None

    def choose_executable(self):
        name, _ = QFileDialog.getOpenFileName(self, "Select installed QGIS Python or wrapper")
        if name:
            self.executable.setText(name)

    def choose_library(self):
        name = QFileDialog.getExistingDirectory(self, "Select installed QFieldSync/libqfieldsync directory")
        if name:
            self.library.setText(name)

    def accept(self):
        def collect():
            args = json.loads(self.arguments.text() or "[]")
            require(isinstance(args, list) and all(isinstance(x, str) and "\0" not in x for x in args),
                    "FIELD_NATIVE_COMMAND", "Wrapper arguments must be a JSON array of strings.")
            path = Path(self.executable.text()).expanduser()
            require(path.is_absolute() and path.is_file(), "FIELD_NATIVE_COMMAND", "Select the installed native executable.")
            library = self.library.text().strip()
            require(not library or Path(library).expanduser().is_dir(), "FIELD_QFIELDSYNC_SOURCE",
                    "Select the existing QFieldSync directory, or use the environment's installed import path.")
            return {"native_command": [str(path), *args], "qfieldsync_path": library,
                    "prefix_path": self.prefix.text().strip()}
        value = _dialog_error(self, collect)
        if value is not None:
            self.value = value
            super().accept()

class DeviceDialog(QDialog):
    def __init__(self, value=None, parent=None):
        super().__init__(parent)
        value = value or {"id": "device-" + uuid.uuid4().hex[:12]}
        self.identifier = value["id"]
        self.setWindowTitle("Field device profile")
        self.resize(550, 380)
        layout = QVBoxLayout(self)
        form = QFormLayout()
        layout.addLayout(form)
        self.label = QLineEdit(value.get("label", ""))
        self.platform = QLineEdit(value.get("platform", ""))
        self.instructions = QPlainTextEdit(value.get("operatorInstructions", ""))
        form.addRow("Name", self.label)
        form.addRow("Device or operating system", self.platform)
        form.addRow("Collection and transfer instructions", self.instructions)
        layout.addWidget(_note("Each field export is assigned to one profile. Return and accept that export before the next collection round. Account credentials do not belong in these instructions."))
        _buttons(self, layout)
        self.value = None

    def accept(self):
        def collect():
            require(self.label.text().strip(), "FIELD_PROFILE", "Name the actual field device profile.")
            return {"id": self.identifier, "label": self.label.text().strip(), "platform": self.platform.text().strip(),
                    "operatorInstructions": self.instructions.toPlainText().strip()}
        value = _dialog_error(self, collect)
        if value is not None:
            self.value = value
            super().accept()

class FormFieldDialog(QDialog):
    def __init__(self, field, parent=None):
        super().__init__(parent)
        self.original = copy.deepcopy(field)
        self.value = None
        self.setWindowTitle("Native field form: " + field["name"])
        self.resize(620, 630)
        layout = QVBoxLayout(self)
        form = QFormLayout()
        layout.addLayout(form)
        self.name = QLineEdit(field["name"])
        self.name.setReadOnly("addType" not in field)
        self.label = QLineEdit(field.get("label", field["name"]))
        self.group = QLineEdit(field.get("group", "Details"))
        self.widget = QComboBox()
        for name in WIDGETS:
            self.widget.addItem(name.capitalize(), name)
        _select(self.widget, field.get("widget", "text"))
        self.required = _checked(field.get("required", False))
        self.editable = _checked(field.get("editable", False))
        self.kind = QComboBox()
        for name in ("text", "integer", "real", "date", "datetime", "boolean"):
            self.kind.addItem(name, name)
        _select(self.kind, field.get("addType", "text"))
        self.kind.setEnabled("addType" in field)
        form.addRow("Native field name", self.name)
        form.addRow("Label", self.label)
        form.addRow("Form group", self.group)
        form.addRow("Widget", self.widget)
        form.addRow("Required", self.required)
        form.addRow("Field operator may edit", self.editable)
        form.addRow("New field type", self.kind)
        self.choices_group = QGroupBox("Allowed values")
        choices_layout = QVBoxLayout(self.choices_group)
        self.choices = QTableWidget(0, 2)
        self.choices.setHorizontalHeaderLabels(["Visible label", "Stored value (JSON scalar)"])
        self.choices.horizontalHeader().setStretchLastSection(True)
        choices_layout.addWidget(self.choices)
        controls = QHBoxLayout()
        choices_layout.addLayout(controls)
        button("Add choice", lambda: self.add_choice("", ""), controls)
        button("Remove selected", self.remove_choice, controls)
        for row in field.get("choices", []):
            self.add_choice(row["label"], json.dumps(row["value"], ensure_ascii=False))
        layout.addWidget(self.choices_group)
        self.range_group = QGroupBox("Numeric range")
        range_form = QFormLayout(self.range_group)
        self.minimum = QLineEdit(str(field.get("min", 0)))
        self.maximum = QLineEdit(str(field.get("max", 100)))
        self.step = QLineEdit(str(field.get("step", 1)))
        for title, editor in (("Minimum", self.minimum), ("Maximum", self.maximum), ("Step", self.step)):
            range_form.addRow(title, editor)
        layout.addWidget(self.range_group)
        self.widget.currentIndexChanged.connect(self.widget_changed)
        self.widget_changed()
        _buttons(self, layout)

    def widget_changed(self):
        self.choices_group.setVisible(self.widget.currentData() == "choice")
        self.range_group.setVisible(self.widget.currentData() == "range")

    def add_choice(self, label, value):
        index = self.choices.rowCount()
        self.choices.insertRow(index)
        self.choices.setItem(index, 0, QTableWidgetItem(label))
        self.choices.setItem(index, 1, QTableWidgetItem(value))

    def remove_choice(self):
        rows = sorted({x.row() for x in self.choices.selectedIndexes()}, reverse=True)
        for row in rows:
            self.choices.removeRow(row)

    def accept(self):
        def collect():
            row = {"name": self.name.text().strip(), "label": self.label.text().strip(),
                   "group": self.group.text().strip(), "widget": self.widget.currentData(),
                   "required": self.required.isChecked(), "editable": self.editable.isChecked()}
            require(row["name"] and row["label"] and row["group"], "FIELD_FORM", "Enter the field name, label and form group.")
            if "addType" in self.original:
                row["addType"] = self.kind.currentData()
            if row["widget"] == "choice":
                values = []
                for i in range(self.choices.rowCount()):
                    label = self.choices.item(i, 0).text() if self.choices.item(i, 0) else ""
                    encoded = self.choices.item(i, 1).text() if self.choices.item(i, 1) else ""
                    value = json.loads(encoded)
                    require(label.strip() and isinstance(value, (str, int, float, bool)),
                            "FIELD_CHOICES", "Each choice needs a label and a JSON string, number or boolean.")
                    values.append({"label": label.strip(), "value": value})
                require(values, "FIELD_CHOICES", "Add the actual allowed values.")
                row["choices"] = values
            if row["widget"] == "range":
                row.update({"min": float(self.minimum.text()), "max": float(self.maximum.text()), "step": float(self.step.text())})
                require(row["min"] <= row["max"] and row["step"] > 0, "FIELD_RANGE", "Use an ordered range and positive step.")
            return row
        value = _dialog_error(self, collect)
        if value is not None:
            self.value = value
            super().accept()

def layer_default(meta):
    names = {f["name"] for f in meta.get("fields", [])}
    identity = "_sf_field_id"
    while identity in names:
        identity += "_"
    fields = [{"name": f["name"], "label": f["name"], "group": "Source attributes",
               "widget": "text", "required": False, "editable": False} for f in meta.get("fields", [])]
    fields.insert(0, {"name": identity, "label": "Field record ID", "group": "Record",
                     "widget": "text", "required": True, "addType": "text", "editable": False})
    return {"layerId": meta["layerId"], "identityField": identity, "editableFields": [],
            "allowAdd": False, "allowDelete": False, "allowGeometry": False,
            "formTitle": meta["label"], "fields": fields}

class LayerFormDialog(QDialog):
    def __init__(self, meta, value, parent=None):
        super().__init__(parent)
        self.meta, self.original, self.value = meta, copy.deepcopy(value), None
        self.fields = copy.deepcopy(value["fields"])
        editable = set(value["editableFields"])
        for row in self.fields:
            row["editable"] = row.get("editable", row["name"] in editable)
        self.setWindowTitle("Configure field layer: " + meta["label"])
        self.resize(820, 680)
        layout = QVBoxLayout(self)
        form = QFormLayout()
        layout.addLayout(form)
        self.title = QLineEdit(value.get("formTitle") or meta["label"])
        self.identity = QComboBox()
        self.add = _checked(value["allowAdd"])
        self.delete = _checked(value["allowDelete"])
        self.geometry = _checked(value["allowGeometry"])
        form.addRow("Form title", self.title)
        form.addRow("Stable record identity", self.identity)
        controls = QHBoxLayout()
        controls.addWidget(QLabel("Allow"))
        for label, widget in (("New records", self.add), ("Delete records", self.delete), ("Geometry edits", self.geometry)):
            controls.addWidget(widget)
            controls.addWidget(QLabel(label))
        form.addRow("Collection permissions", controls)
        layout.addWidget(_note("Original attributes and feature IDs stay bound to the retained source. A new text identity receives technical UUIDs; an existing identity must be unique and nonempty. Identity values remain read-only."))
        self.rows = table(["Field", "Label", "Group", "Widget", "Editable", "Required", "Origin"])
        layout.addWidget(self.rows)
        controls = QHBoxLayout()
        layout.addLayout(controls)
        button("Edit selected field", self.edit_field, controls)
        button("Add inspection field", self.add_field, controls)
        button("Remove added field", self.remove_field, controls)
        button("Move up", lambda: self.move(-1), controls)
        button("Move down", lambda: self.move(1), controls)
        self.rows.itemDoubleClicked.connect(lambda *_: self.edit_field())
        _buttons(self, layout, "Use layer configuration")
        self.redraw(value["identityField"])

    def redraw(self, identity=None):
        identity = identity or self.identity.currentData()
        self.identity.clear()
        for row in self.fields:
            self.identity.addItem(row["name"] + (" (new text UUID)" if row.get("addType") == "text" else ""), row["name"])
        _select(self.identity, identity)
        fill(self.rows, [([r["name"], r["label"], r["group"], r["widget"], "Yes" if r.get("editable") else "No",
                          "Yes" if r["required"] else "No", "New " + r["addType"] if r.get("addType") else "Original"], i)
                         for i, r in enumerate(self.fields)])

    def index(self):
        rows = selected(self.rows)
        require(len(rows) == 1, "FIELD_FORM_SELECTION", "Select one form field.")
        return rows[0]

    def edit_field(self):
        def work():
            index = self.index()
            dialog = FormFieldDialog(self.fields[index], self)
            if dialog.exec() == QDialog.DialogCode.Accepted:
                old_name = self.fields[index]["name"]
                self.fields[index] = dialog.value
                self.redraw(dialog.value["name"] if self.identity.currentData() == old_name else None)
        _dialog_error(self, work)

    def add_field(self):
        field = {"name": "", "label": "", "group": "Inspection", "widget": "text",
                 "required": False, "addType": "text", "editable": True}
        dialog = FormFieldDialog(field, self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            self.fields.append(dialog.value)
            self.redraw()

    def remove_field(self):
        def work():
            index = self.index()
            require("addType" in self.fields[index], "FIELD_SOURCE_FIELD", "Original source fields remain available.")
            require(self.fields[index]["name"] != self.identity.currentData(), "FIELD_IDENTITY", "Choose another stable identity before removing this field.")
            self.fields.pop(index)
            self.redraw()
        _dialog_error(self, work)

    def move(self, direction):
        def work():
            index = self.index()
            next_index = index + direction
            if 0 <= next_index < len(self.fields):
                self.fields[index], self.fields[next_index] = self.fields[next_index], self.fields[index]
                self.redraw()
                self.rows.selectRow(next_index)
        _dialog_error(self, work)

    def accept(self):
        def collect():
            identity = self.identity.currentData()
            require(identity, "FIELD_IDENTITY", "Choose the stable record identity.")
            require(len({r["name"] for r in self.fields}) == len(self.fields), "FIELD_FORM", "Give each form field a distinct native name.")
            row = {**copy.deepcopy(self.original), "formTitle": self.title.text().strip(), "identityField": identity,
                   "allowAdd": self.add.isChecked(), "allowDelete": self.delete.isChecked(),
                   "allowGeometry": self.geometry.isChecked(),
                   "editableFields": [f["name"] for f in self.fields if f.get("editable") and f["name"] != identity],
                   "fields": [{k: v for k, v in f.items() if k != "editable"} for f in self.fields]}
            for f in row["fields"]:
                if f["name"] == identity:
                    f["required"] = True
            return row
        value = _dialog_error(self, collect)
        if value is not None:
            self.value = value
            super().accept()

class RelationDialog(QDialog):
    def __init__(self, layers, parent=None):
        super().__init__(parent)
        self.layers, self.value = layers, None
        self.setWindowTitle("Native parent and child relation")
        self.resize(620, 430)
        layout = QVBoxLayout(self)
        form = QFormLayout()
        layout.addLayout(form)
        self.name = QLineEdit()
        self.parent_layer, self.child_layer = QComboBox(), QComboBox()
        self.parent_field, self.child_field = QComboBox(), QComboBox()
        for row in layers:
            self.parent_layer.addItem(row["label"], row["layerId"])
            self.child_layer.addItem(row["label"], row["layerId"])
        for title, widget in (("Relation name", self.name), ("Parent layer", self.parent_layer),
                              ("Parent key", self.parent_field), ("Child inspection table/layer", self.child_layer),
                              ("Child foreign key", self.child_field)):
            form.addRow(title, widget)
        self.parent_layer.currentIndexChanged.connect(lambda *_: self.populate(self.parent_layer, self.parent_field))
        self.child_layer.currentIndexChanged.connect(lambda *_: self.populate(self.child_layer, self.child_field))
        self.populate(self.parent_layer, self.parent_field)
        self.populate(self.child_layer, self.child_field)
        layout.addWidget(_note("Choose the actual matching source keys. Existing native relations, including composite keys, can be selected directly on the Relations page."))
        _buttons(self, layout)
    def populate(self, combo, target):
        target.clear()
        row = next((r for r in self.layers if r["layerId"] == combo.currentData()), None)
        for f in row.get("fields", []) if row else []:
            target.addItem(f["name"], f["name"])
    def accept(self):
        def collect():
            require(self.name.text().strip() and self.parent_field.currentData() and self.child_field.currentData(),
                    "FIELD_RELATION", "Choose the relation name and both native keys.")
            return {"id": "field-relation-" + uuid.uuid4().hex, "name": self.name.text().strip(),
                    "parentLayerId": self.parent_layer.currentData(), "childLayerId": self.child_layer.currentData(),
                    "fieldPairs": [{"parentField": self.parent_field.currentData(), "childField": self.child_field.currentData()}]}
        value = _dialog_error(self, collect)
        if value is not None:
            self.value = value
            super().accept()

class CommissionDialog(QDialog):
    def __init__(self, inspection, parent=None):
        super().__init__(parent)
        self.inspection, self.value = inspection, None
        self.configs = {r["layerId"]: layer_default(r) for r in inspection["layers"] if r["kind"] == "vector"}
        self.profiles = []
        self.relations = copy.deepcopy(inspection.get("relations", []))
        self.setWindowTitle("Commission native field project")
        self.resize(960, 760)
        layout = QVBoxLayout(self)
        layout.addWidget(_note("Configure this exact saved map for field collection. Editable data is copied into a retained office edition; the original source and saved map remain available in the same workspace."))
        self.tabs = QTabWidget()
        layout.addWidget(self.tabs)
        overview = QWidget()
        form = QFormLayout(overview)
        self.title = QLineEdit(inspection.get("title") or "")
        self.instructions = QPlainTextEdit()
        self.attachment_instructions = QPlainTextEdit()
        self.instructions.setPlaceholderText("Collection purpose, actual edit rules, transfer and office review instructions")
        self.attachment_instructions.setPlaceholderText("Agreed attachment contents, usage/consent and retention instructions")
        form.addRow("Field project title", self.title)
        form.addRow("Original saved map", _note(inspection["projectId"]))
        form.addRow("Field instructions", self.instructions)
        form.addRow("Attachment instructions", self.attachment_instructions)
        self.tabs.addTab(overview, "Project")
        layers = QWidget()
        layer_layout = QVBoxLayout(layers)
        self.layers = QTableWidget(0, 5)
        self.layers.setHorizontalHeaderLabels(["Native layer", "Kind", "Features", "Field role", "Form"])
        self.layers.horizontalHeader().setStretchLastSection(True)
        self.roles = {}
        for index, row in enumerate(inspection["layers"]):
            self.layers.insertRow(index)
            for col, text in enumerate((row["label"], row["kind"], row.get("featureCount", ""))):
                item = QTableWidgetItem(str(text))
                item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
                self.layers.setItem(index, col, item)
            role = QComboBox()
            role.addItem("Exclude", "exclude")
            role.addItem("Reference only", "reference")
            if row["kind"] == "vector":
                role.addItem("Editable feature layer / table", "editable")
            role.setCurrentIndex(1)
            self.roles[row["layerId"]] = role
            self.layers.setCellWidget(index, 3, role)
            edit = QPushButton("Configure fields")
            edit.setEnabled(row["kind"] == "vector")
            edit.clicked.connect(lambda _=False, selected=row: self.edit_layer(selected))
            self.layers.setCellWidget(index, 4, edit)
        layer_layout.addWidget(self.layers)
        layer_layout.addWidget(_note("Select editable feature layers and any existing related inspection tables. References are carried as read-only native copies. New inspection fields, native form widgets and attachment capture are configured per editable layer."))
        self.tabs.addTab(layers, "Layers and forms")
        devices = QWidget()
        device_layout = QVBoxLayout(devices)
        self.devices = table(["Profile", "Device", "Instructions"])
        device_layout.addWidget(self.devices)
        controls = QHBoxLayout()
        device_layout.addLayout(controls)
        button("Add device profile", self.add_device, controls)
        button("Edit profile", self.edit_device, controls)
        button("Remove profile", self.remove_device, controls)
        self.tabs.addTab(devices, "Devices")
        relations = QWidget()
        relations_layout = QVBoxLayout(relations)
        self.relation_rows = QTableWidget(0, 5)
        self.relation_rows.setHorizontalHeaderLabels(["Use", "Relation", "Parent", "Child", "Key pairs"])
        self.relation_rows.horizontalHeader().setStretchLastSection(True)
        relations_layout.addWidget(self.relation_rows)
        controls = QHBoxLayout()
        relations_layout.addLayout(controls)
        button("Add relation", self.add_relation, controls)
        button("Remove selected relation", self.remove_relation, controls)
        relations_layout.addWidget(_note("The checked native relations are included in the field forms. Both layers and every key pair must be selected. Related child tables use their original source records and identifiers."))
        self.tabs.addTab(relations, "Relations")
        self.relation_enabled = {}
        self.draw_relations()
        _buttons(self, layout, "Commission selected project")

    def edit_layer(self, row):
        dialog = LayerFormDialog(row, self.configs[row["layerId"]], self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            self.configs[row["layerId"]] = dialog.value
            _select(self.roles[row["layerId"]], "editable")

    def draw_devices(self):
        fill(self.devices, [([r["label"], r["platform"], r["operatorInstructions"]], i) for i, r in enumerate(self.profiles)])

    def add_device(self):
        dialog = DeviceDialog(parent=self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            self.profiles.append(dialog.value)
            self.draw_devices()

    def edit_device(self):
        rows = selected(self.devices)
        if len(rows) == 1:
            dialog = DeviceDialog(self.profiles[rows[0]], self)
            if dialog.exec() == QDialog.DialogCode.Accepted:
                self.profiles[rows[0]] = dialog.value
                self.draw_devices()

    def remove_device(self):
        rows = selected(self.devices)
        if len(rows) == 1:
            self.profiles.pop(rows[0])
            self.draw_devices()

    def draw_relations(self):
        previous = {key: widget.isChecked() for key, widget in self.relation_enabled.items()}
        self.relation_enabled = {}
        names = {r["layerId"]: r["label"] for r in self.inspection["layers"]}
        self.relation_rows.setRowCount(len(self.relations))
        for i, row in enumerate(self.relations):
            check = _checked(previous.get(row["id"], True))
            self.relation_enabled[row["id"]] = check
            self.relation_rows.setCellWidget(i, 0, check)
            values = [row["name"], names.get(row["parentLayerId"], row["parentLayerId"]),
                      names.get(row["childLayerId"], row["childLayerId"]),
                      "; ".join(p["parentField"] + " ← " + p["childField"] for p in row["fieldPairs"])]
            for j, value in enumerate(values, 1):
                item = QTableWidgetItem(value)
                item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
                self.relation_rows.setItem(i, j, item)

    def add_relation(self):
        layers = []
        for row in self.inspection["layers"]:
            if row["kind"] == "vector":
                combined = copy.deepcopy(row)
                combined["fields"] = [{"name": r["name"]} for r in self.configs[row["layerId"]]["fields"]]
                layers.append(combined)
        dialog = RelationDialog(layers, self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            self.relations.append(dialog.value)
            self.draw_relations()

    def remove_relation(self):
        selected_rows = sorted({x.row() for x in self.relation_rows.selectedIndexes()}, reverse=True)
        for index in selected_rows:
            self.relations.pop(index)
        self.draw_relations()

    def accept(self):
        def collect():
            selected_layers = [copy.deepcopy(self.configs[key]) for key, role in self.roles.items() if role.currentData() == "editable"]
            references = [key for key, role in self.roles.items() if role.currentData() == "reference"]
            selected_ids = {r["layerId"] for r in selected_layers} | set(references)
            relations = [copy.deepcopy(r) for r in self.relations if self.relation_enabled[r["id"]].isChecked()]
            require(all(r["parentLayerId"] in selected_ids and r["childLayerId"] in selected_ids for r in relations),
                    "FIELD_RELATION_LAYER", "Select both layers of each checked relation, or uncheck that relation.")
            return configuration({"schema": SCHEMA, "projectId": self.inspection["projectId"], "title": self.title.text(),
                "instructions": self.instructions.toPlainText(), "attachmentInstructions": self.attachment_instructions.toPlainText(),
                "profiles": self.profiles, "layers": selected_layers, "referenceLayerIds": references, "relations": relations})
        value = _dialog_error(self, collect)
        if value is not None:
            self.value = value
            super().accept()

class ChangeDialog(QDialog):
    def __init__(self, workspace, returned, row, parent=None):
        super().__init__(parent)
        self.workspace, self.returned, self.row = workspace, returned, row
        self.setWindowTitle("Returned " + row["kind"] + ": " + str(row.get("identity", "")))
        self.resize(860, 650)
        layout = QVBoxLayout(self)
        layout.addWidget(_note("\n".join(row.get("issues", [])) or "No configured edit-rule issue was found for this change."))
        self.values = table(["Field", "Office edition", "Returned field value"])
        rows = row.get("fields", [])
        if not rows:
            before, after = (row.get("before") or {}).get("attributes", {}), (row.get("after") or {}).get("attributes", {})
            rows = [{"field": key, "before": before.get(key), "after": after.get(key)}
                    for key in sorted(set(before) | set(after))]
        if row.get("field"):
            rows = rows + [{"field": row["field"], "before": row.get("beforeFile"), "after": row.get("afterFile") or row.get("attachment")}]
        fill(self.values, [([r["field"], pretty(r.get("before")), pretty(r.get("after"))], r) for r in rows])
        layout.addWidget(self.values)
        before_geometry, after_geometry = (row.get("before") or {}).get("geometry"), (row.get("after") or {}).get("geometry")
        if before_geometry != after_geometry:
            layout.addWidget(_note("Geometry changed. Original and returned geometry are retained in the complete native change record."))
        controls = QHBoxLayout()
        layout.addLayout(controls)
        if row.get("attachment"):
            button("Open retained attachment", self.open_attachment, controls)
        button("Complete native change record", lambda: DetailDialog("Retained native change", row, self).exec(), controls)
        close = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        close.rejected.connect(self.reject)
        layout.addWidget(close)

    def open_attachment(self):
        def work():
            relative = self.row["attachment"]
            require(isinstance(relative, str) and relative.startswith("attachments/"), "FIELD_ATTACHMENT", "Select an actual retained attachment.")
            root = member(self.workspace.root, self.returned["deviceRoot"], existing=False)
            path = member(root, relative)
            expected = self.row.get("afterFile")
            if expected:
                file_digest(path, expected=expected)
            else:
                file_digest(path)
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))
        _dialog_error(self, work)

class ReturnReviewDialog(QDialog):
    def __init__(self, workspace, campaign, round_row, returned, parent=None):
        super().__init__(parent)
        self.workspace, self.campaign, self.round, self.returned = workspace, campaign, round_row, returned
        self.offset, self.value = 0, None
        self.setWindowTitle("Office review · field round " + str(round_row["number"]))
        self.resize(1040, 760)
        layout = QVBoxLayout(self)
        summary = returned["summary"]
        layout.addWidget(_note("Returned " + returned["at"] + " · " +
            ", ".join(str(summary.get(k, 0)) + " " + k for k in ("added", "changed", "deleted", "attachmentChanges", "issues")) +
            "\nReview the saved field records and attachments. Acceptance runs the original native synchronization into a new office edition."))
        filters = QHBoxLayout()
        layout.addLayout(filters)
        self.layer_filter, self.kind_filter = QComboBox(), QComboBox()
        self.layer_filter.addItem("All layers", "")
        for row in campaign["configuration"]["layers"]:
            self.layer_filter.addItem(row.get("formTitle") or row["layerId"], row["layerId"])
        for title, kind in (("All changes", ""), ("Problems", "problems"), ("New records", "added"),
                            ("Changed records", "changed"), ("Deleted records", "deleted"),
                            ("Attachment changes", "attachment")):
            self.kind_filter.addItem(title, kind)
        filters.addWidget(self.layer_filter)
        filters.addWidget(self.kind_filter)
        self.rows = table(["Layer", "Change", "Record ID", "Fields", "Issues"])
        layout.addWidget(self.rows)
        controls = QHBoxLayout()
        layout.addLayout(controls)
        button("Inspect selected change", self.inspect, controls)
        self.previous = button("Previous", lambda: self.move(-1), controls)
        self.next = button("Next", lambda: self.move(1), controls)
        self.page_label = QLabel()
        controls.addWidget(self.page_label)
        self.rows.itemDoubleClicked.connect(lambda *_: self.inspect())
        self.layer_filter.currentIndexChanged.connect(self.reset)
        self.kind_filter.currentIndexChanged.connect(self.reset)
        self.note = QPlainTextEdit()
        self.note.setPlaceholderText("Office receiving decision, actual reviewed changes and handover notes")
        self.note.setMaximumHeight(130)
        layout.addWidget(self.note)
        controls = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        self.accept_button = QPushButton("Accept this return into office")
        controls.addButton(self.accept_button, QDialogButtonBox.ButtonRole.AcceptRole)
        controls.rejected.connect(self.reject)
        self.accept_button.clicked.connect(self.accept_return)
        self.accept_button.setEnabled(returned["ready"] and round_row["status"] == "returned")
        layout.addWidget(controls)
        if not returned["ready"]:
            layout.addWidget(_note("This return contains edit-rule or file problems. Correct the actual device copy and receive it as another retained return before acceptance."))
        elif round_row["status"] != "returned":
            layout.addWidget(_note("This export is already closed or accepted. Its original return remains readable."))
        self.load()

    def reset(self, *_):
        self.offset = 0
        _dialog_error(self, self.load)

    def load(self):
        page = review_page(self.workspace, self.round["id"], self.returned["id"], offset=self.offset,
                           layer_id=self.layer_filter.currentData(), kind=self.kind_filter.currentData())
        self.page = page
        names = {r["layerId"]: r.get("formTitle") or r["layerId"] for r in self.campaign["configuration"]["layers"]}
        fill(self.rows, [([names.get(r["layerId"], "Package"), r["kind"], r.get("identity", ""),
                          ", ".join(x["field"] for x in r.get("fields", [])) or r.get("field", ""),
                          "; ".join(r.get("issues", []))], r) for r in page["items"]])
        self.previous.setEnabled(self.offset > 0)
        self.next.setEnabled(page["hasMore"])
        self.page_label.setText(str(self.offset + (1 if page["items"] else 0)) + "–" +
                                str(self.offset + len(page["items"])) + " of " + str(page["total"]))

    def move(self, direction):
        self.offset = max(0, self.offset + direction * self.page["limit"])
        _dialog_error(self, self.load)

    def inspect(self):
        rows = selected(self.rows)
        if len(rows) == 1:
            ChangeDialog(self.workspace, self.returned, rows[0], self).exec()

    def accept_return(self):
        def work():
            require(self.returned["ready"] and self.round["status"] == "returned", "FIELD_RETURN_NOT_READY", "Select an open return without unresolved issues.")
            note = self.note.toPlainText().strip()
            require(note, "FIELD_ACCEPTANCE_NOTE", "Record the actual office receiving decision.")
            self.value = {"roundId": self.round["id"], "returnId": self.returned["id"],
                          "reviewSha256": self.returned["review"]["sha256"], "note": note}
            super(ReturnReviewDialog, self).accept()
        _dialog_error(self, work)

class FieldPanel(QWidget):
    def __init__(self, dock):
        super().__init__(dock)
        self.dock, self.state = dock, None
        self.setObjectName("StarforgeFieldPanel")
        layout = QVBoxLayout(self)
        layout.addWidget(_note("Commission a saved native map, transfer one complete QField export, and review its actual returned records before office synchronization. A new collection round always receives a new native export."))
        setup = QHBoxLayout()
        layout.addLayout(setup)
        self.project_choice = QComboBox()
        self.project_choice.setMinimumWidth(220)
        setup.addWidget(self.project_choice)
        button("Commission field project", self.commission, setup)
        button("Native runtime", self.configure_runtime, setup)
        button("Field guide", self.guide, setup)
        self.runtime_label = _note("")
        layout.addWidget(self.runtime_label)
        form = QFormLayout()
        layout.addLayout(form)
        self.campaign_choice, self.profile_choice = QComboBox(), QComboBox()
        form.addRow("Field project", self.campaign_choice)
        form.addRow("Next export device", self.profile_choice)
        self.description = _note("No field project is commissioned in this workspace.")
        layout.addWidget(self.description)
        actions = QHBoxLayout()
        layout.addLayout(actions)
        self.export_button = button("Create next native export", self.export_round, actions)
        button("Project instructions and forms", self.campaign_details, actions)
        button("Add project note", self.add_note, actions)
        self.rounds = table(["Round", "Status", "Device", "Exported", "Returns", "Office acceptance"])
        layout.addWidget(self.rounds)
        actions = QHBoxLayout()
        layout.addLayout(actions)
        self.copy_button = button("Copy package to device folder", self.copy_package, actions)
        self.receive_button = button("Receive saved device folder", self.receive_return, actions)
        self.close_button = button("Close unused export", self.close_round, actions)
        self.returns = table(["Received", "Analyst", "Added", "Changed", "Deleted", "Attachments", "Issues", "State"])
        layout.addWidget(self.returns)
        actions = QHBoxLayout()
        layout.addLayout(actions)
        button("Review selected return", self.review_return, actions)
        button("Open accepted office map", self.open_accepted, actions)
        button("Export complete workspace", dock.export_archive, actions)
        self.campaign_choice.currentIndexChanged.connect(self.select_campaign)
        self.rounds.itemSelectionChanged.connect(self.select_round)
        self.returns.itemDoubleClicked.connect(lambda *_: self.review_return())
        self._draw_runtime()

    def runtime(self):
        raw = self.dock.settings.value(RUNTIME_KEY, "")
        try:
            value = json.loads(raw) if raw else {}
        except (TypeError, ValueError):
            value = {}
        return value if isinstance(value, dict) else {}

    def _draw_runtime(self):
        profile = self.runtime()
        command = profile.get("native_command")
        self.runtime_label.setText("Native field runtime: " + str(command[0]) if command else "Select the installed native QGIS Python and QFieldSync environment before commissioning.")

    def configure_runtime(self):
        dialog = RuntimeDialog(self.runtime(), self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            def work():
                self.dock.settings.setValue(RUNTIME_KEY, json.dumps(dialog.value, ensure_ascii=False))
                self.dock.flush_settings()
                self._draw_runtime()
            self.dock.run("Save native field runtime", work)

    def native(self, workspace, action, payload, **common):
        profile = self.runtime()
        require(profile.get("native_command"), "FIELD_RUNTIME_REQUIRED", "Select the installed QGIS Python in Native runtime.")
        return run_native(workspace, action, payload, progress=self.dock.progress, **profile, **common)

    def execute(self, workspace, action, payload, **common):
        if action in NATIVE_ACTIONS:
            return self.native(workspace, action, payload, **common)
        return field_command(workspace, action, payload, progress=self.dock.progress, **common)

    def refresh(self, state):
        self.state = state
        selected_project, selected_campaign = self.project_choice.currentData(), self.campaign_choice.currentData()
        self.project_choice.blockSignals(True)
        self.project_choice.clear()
        for row in state["projects"]:
            self.project_choice.addItem(row.get("at", "") + " · " + row["id"], row["id"])
        _select(self.project_choice, selected_project)
        self.project_choice.blockSignals(False)
        self.campaign_choice.blockSignals(True)
        self.campaign_choice.clear()
        for row in state.get("fieldCampaigns", []):
            self.campaign_choice.addItem(row["title"] + " · " + short(row["id"]), row["id"])
        _select(self.campaign_choice, selected_campaign)
        self.campaign_choice.blockSignals(False)
        self.select_campaign()
        self._draw_runtime()

    def campaign(self):
        require(self.state is not None, "WORKSPACE_REQUIRED", "Open the original GIS workspace.")
        return campaign_for(self.state, self.campaign_choice.currentData())

    def round(self):
        rows = selected(self.rounds)
        require(len(rows) == 1, "FIELD_ROUND", "Select one native field export.")
        return round_for(self.state, rows[0]["id"])[1]

    def select_campaign(self, *_):
        if self.state is None or not self.campaign_choice.currentData():
            fill(self.rounds, [])
            fill(self.returns, [])
            self.profile_choice.clear()
            self.description.setText("No field project is commissioned in this workspace.")
            self.export_button.setEnabled(False)
            self.select_round()
            return
        campaign = self.campaign()
        old_profile = self.profile_choice.currentData()
        self.profile_choice.clear()
        for row in campaign["configuration"]["profiles"]:
            self.profile_choice.addItem(row["label"], row["id"])
        _select(self.profile_choice, old_profile)
        config = campaign["configuration"]
        self.description.setText(config["instructions"] or campaign["title"])
        selected_rows = selected(self.rounds)
        prior = selected_rows[0]["id"] if len(selected_rows) == 1 else None
        self.rounds.blockSignals(True)
        fill(self.rounds, [([r["number"], r["status"], r["profile"]["label"], r["at"], len(r["returns"]),
                            r.get("acceptedAt") or r.get("closedAt") or ""], r) for r in reversed(campaign["rounds"])])
        target = next((i for i in range(self.rounds.rowCount()) if self.rounds.item(i, 0).data(ROLE)["id"] == prior), 0)
        if self.rounds.rowCount():
            self.rounds.selectRow(target)
        self.rounds.blockSignals(False)
        self.export_button.setEnabled(not any(r["status"] in ("exported", "returned") for r in campaign["rounds"]))
        self.select_round()

    def select_round(self):
        rows = selected(self.rounds)
        row = rows[0] if len(rows) == 1 else None
        active = row is not None and row["status"] in ("exported", "returned")
        self.copy_button.setEnabled(active)
        self.receive_button.setEnabled(active)
        self.close_button.setEnabled(active)
        fill(self.returns, [([r["at"], r["actor"], r["summary"].get("added", 0), r["summary"].get("changed", 0),
                             r["summary"].get("deleted", 0), r["summary"].get("attachmentChanges", 0),
                             r["summary"].get("issues", 0), "Ready for office review" if r["ready"] else "Corrections required"], r)
                            for r in reversed(row["returns"])] if row else [])
        if self.returns.rowCount():
            self.returns.selectRow(0)

    def commission(self):
        def work():
            workspace = self.dock.need_workspace()
            project_id = self.project_choice.currentData()
            require(project_id, "FIELD_PROJECT", "Save or select an original native map first.")
            inspection = self.native(workspace, "field.inspect", {"projectId": project_id})
            dialog = CommissionDialog(inspection, self)
            if dialog.exec() == QDialog.DialogCode.Accepted:
                result = self.dock.mutate("field.commission", {"configuration": dialog.value})
                campaign = result.get("details", {}).get("campaign") or result.get("campaign")
                if campaign:
                    _select(self.campaign_choice, campaign["id"])
                return result
        self.dock.run("Commission complete native field project", work)

    def export_round(self):
        def work():
            campaign = self.campaign()
            profile = self.profile_choice.currentData()
            require(profile, "FIELD_PROFILE", "Select the actual device profile.")
            return self.dock.mutate("field.export", {"campaignId": campaign["id"], "profileId": profile})
        self.dock.run("Create original QFieldSync export", work)

    def copy_package(self):
        def work():
            row = self.round()
            parent = QFileDialog.getExistingDirectory(self, "Choose device-transfer parent directory")
            if not parent:
                return
            name, ok = QInputDialog.getText(self, "New device package folder", "New directory name",
                                            text="field-round-" + str(row["number"]))
            if not ok or not name:
                return
            require(Path(name).name == name and name not in (".", ".."), "FIELD_DEVICE_DIRECTORY", "Enter one new directory name.")
            result = copy_device_package(self.dock.workspace, row["id"], Path(parent) / name, progress=self.dock.progress)
            DetailDialog("Complete device package copied", result, self).exec()
            return result
        self.dock.run("Copy complete field project to device folder", work)

    def receive_return(self):
        def work():
            row = self.round()
            directory = QFileDialog.getExistingDirectory(self, "Select fully saved returned device project")
            if not directory:
                return
            inventory = returned_inventory(directory, progress=self.dock.progress)
            message = ("Receive " + str(inventory["fileCount"]) + " saved files (" + str(inventory["totalBytes"]) +
                       " bytes) into round " + str(row["number"]) + "?\n\nClose QField before transferring. "
                       "The complete return is retained for office review before any synchronization.")
            if QMessageBox.question(self, "Receive complete device folder", message,
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No) != QMessageBox.StandardButton.Yes:
                return
            return self.dock.mutate("field.receive", {"roundId": row["id"], "directory": directory,
                                                       "expectedFilesSha256": inventory["filesSha256"]})
        self.dock.run("Receive and compare actual field edits", work)

    def review_return(self):
        def work():
            row = self.round()
            rows = selected(self.returns)
            require(len(rows) == 1, "FIELD_RETURN", "Select one retained device return.")
            returned = next(x for x in row["returns"] if x["id"] == rows[0]["id"])
            dialog = ReturnReviewDialog(self.dock.workspace, self.campaign(), row, returned, self)
            if dialog.exec() == QDialog.DialogCode.Accepted and dialog.value:
                return self.dock.mutate("field.accept", dialog.value)
        self.dock.run("Review and accept field return", work)

    def close_round(self):
        def work():
            row = self.round()
            note, ok = QInputDialog.getMultiLineText(self, "Close this field export", "Reason for closing without office synchronization")
            if ok:
                return self.dock.mutate("field.close", {"roundId": row["id"], "note": note})
        self.dock.run("Close original field export", work)

    def add_note(self):
        def work():
            campaign = self.campaign()
            note, ok = QInputDialog.getMultiLineText(self, "Field project note", "Operational decision or handover note")
            if ok:
                return self.dock.mutate("field.note", {"campaignId": campaign["id"], "note": note})
        self.dock.run("Save field project note", work)

    def campaign_details(self):
        self.dock.run("Read field instructions and forms",
                      lambda: DetailDialog("Commissioned field project", self.campaign(), self).exec())

    def open_accepted(self):
        def work():
            row = self.round()
            require(row.get("acceptedProjectId"), "FIELD_PROJECT", "Select a round with an accepted office edition.")
            project_id = row["acceptedProjectId"]
            readback = self.native(self.dock.workspace, "field.reopen", {"projectId": project_id})
            require(readback.get("valid"), "FIELD_PROJECT", "The retained accepted native map did not reopen.")
            self.dock.iface.addProject(readback["path"])
            return readback
        self.dock.run("Open accepted native office edition", work)

    def guide(self):
        path = Path(__file__).resolve().parent / "FIELD_OPERATIONS.md"
        if not path.is_file():
            path = path.parent.parent / "FIELD_OPERATIONS.md"
        self.dock.run("Open field operator guide", lambda: QDesktopServices.openUrl(QUrl.fromLocalFile(str(path))))
