# SPDX-License-Identifier: MIT
"""PostGIS controls inside the maintained QGIS operator dock."""
from __future__ import annotations
import copy
import json
from pathlib import Path

from qgis.PyQt.QtWidgets import (QWidget,QVBoxLayout,QHBoxLayout,QFormLayout,QLabel,
    QLineEdit,QComboBox,QCheckBox,QDialog,QDialogButtonBox,QDoubleSpinBox,
    QPlainTextEdit,QFileDialog,QMessageBox)
from qgis.gui import QgsAuthConfigSelect
from qgis.core import QgsProject
from ..model import require,file_digest
from .source import connection_profile,SSL_MODES
from .native import refresh_project

class ConnectionFields:
    def __init__(self,parent,form,roles):
        self.service=QLineEdit(); self.service.setPlaceholderText("An existing pg_service.conf service name")
        self.auth=QgsAuthConfigSelect(parent,"postgres")
        self.role=QComboBox()
        for name in roles:self.role.addItem(name,name)
        self.ssl=QComboBox()
        for name in ("verify-full","verify-ca","require","prefer","allow","disable"):self.ssl.addItem(name,name)
        self.edit=QCheckBox("Enable the original native editing tools when this role has write privileges")
        form.addRow("Local PostgreSQL service",self.service)
        form.addRow("Local QGIS authentication",self.auth)
        form.addRow("Actual selected role",self.role)
        form.addRow("SSL mode",self.ssl)
        form.addRow(self.edit)

    def set(self,value):
        self.service.setText(value.get("service",""));self.auth.setConfigId(value.get("authConfigId",""))
        self.role.setCurrentIndex(self.role.findData(value.get("role")))
        self.ssl.setCurrentIndex(self.ssl.findData(value.get("sslMode","verify-full")))
        self.edit.setChecked(value.get("allowEditing",False))

    def value(self,source):
        return connection_profile({"profileId":source.manifest["database"]["profileId"],
            "service":self.service.text().strip(),"authConfigId":self.auth.configId() or "",
            "role":self.role.currentData(),"sslMode":self.ssl.currentData(),
            "allowEditing":self.edit.isChecked()},source.manifest)

class DatabaseLayerDialog(QDialog):
    def __init__(self,source,row,parent):
        super().__init__(parent);self.source=source;self.original=copy.deepcopy(row)
        self.setWindowTitle("Retained PostGIS layer and local connection")
        self.resize(680,560);layout=QVBoxLayout(self);form=QFormLayout();layout.addLayout(form)
        accepted=source.layers[row["postgis"]["layerId"]]
        detail=QLabel(accepted["schema"]+"."+accepted["relation"]+" · "+accepted["geometryType"]+
            " · SRID "+str(accepted["srid"])+"\nReceipt revision "+str(source.manifest["revision"])+
            " · "+source.manifest["editionId"]);detail.setWordWrap(True);layout.addWidget(detail)
        self.label=QLineEdit(row["label"]);form.addRow("Layer label",self.label)
        self.connection=ConnectionFields(self,form,[r["name"] for r in accepted["roles"]])
        self.connection.set(row["postgis"]["connection"])
        self.subset=QPlainTextEdit(row.get("vectorSubsetString",""));self.subset.setMaximumHeight(120)
        form.addRow("Native subset expression",self.subset)
        self.opacity=QDoubleSpinBox();self.opacity.setRange(0,1);self.opacity.setSingleStep(0.05)
        self.opacity.setValue(row["opacity"]);form.addRow("Opacity",self.opacity)
        self.visible=QCheckBox("Visible");self.visible.setChecked(row["visible"]);form.addRow(self.visible)
        note=QLabel("The geometry keeps its accepted database CRS. Use the map CRS for display. "
            "The local authentication manager retains credentials; only its reference is saved here.")
        note.setWordWrap(True);layout.addWidget(note)
        buttons=QDialogButtonBox(QDialogButtonBox.StandardButton.Ok|QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self.accept);buttons.rejected.connect(self.reject);layout.addWidget(buttons)

    def definition(self):
        row=copy.deepcopy(self.original);row["label"]=self.label.text().strip()
        row["postgis"]["connection"]=self.connection.value(self.source)
        row["vectorSubsetString"]=self.subset.toPlainText()
        row["opacity"]=self.opacity.value();row["visible"]=self.visible.isChecked()
        return row

class PostgisPane(QWidget):
    def __init__(self,dock):
        super().__init__(dock);self.dock=dock;self.source=None;self.last_source=None
        from ..plugin import button,table
        layout=QVBoxLayout(self)
        note=QLabel("Receive an accepted PostGIS edition through the original QGIS workspace. "
            "Select a local service and actual role, verify the native relations, then keep ordinary map/style/history controls.")
        note.setWordWrap(True);layout.addWidget(note)
        controls=QHBoxLayout();layout.addLayout(controls)
        button("Import PostGIS receipt",dock.import_source,controls)
        button("View original receipt",self.receipt,controls)
        self.sources=QComboBox();layout.addWidget(self.sources)
        self.summary=QLabel();self.summary.setWordWrap(True);layout.addWidget(self.summary)
        form=QFormLayout();layout.addLayout(form)
        self.connection=ConnectionFields(self,form,[])
        self.relations=table(["Layer","Stable relation","Geometry / SRID","Accepted rows","Roles"],multiple=True)
        layout.addWidget(self.relations)
        actions=QHBoxLayout();layout.addLayout(actions)
        button("Verify selected native relations",self.check,actions)
        button("Retain selected relations",self.add,actions)
        button("Refresh current database layers",self.refresh_native,actions)
        successor=QHBoxLayout();layout.addLayout(successor)
        button("Use this connection for reviewed successor choices",self.apply_successor,successor)
        self.checks=table(["Observed","Analyst","Receipt","Relations","Original request"])
        layout.addWidget(self.checks)
        detail=QHBoxLayout();layout.addLayout(detail)
        button("Read saved native verification",self.check_detail,detail)
        button("Use selected layer connection",self.load_map_connection,detail)
        self.sources.currentIndexChanged.connect(self.source_changed)
        self.relations.itemDoubleClicked.connect(lambda *_:self.layer_detail())
        self.checks.itemDoubleClicked.connect(lambda *_:self.check_detail())

    def current(self):
        require(self.source is not None,"POSTGIS_SOURCE_REQUIRED","Import and select an accepted PostGIS receiving source.")
        return self.source

    def refresh(self):
        from ..plugin import fill,source_label
        state=self.dock.state
        if state is None:return
        old=self.sources.currentData();active=state["activeSourceId"]
        self.sources.blockSignals(True);self.sources.clear()
        for row in state["sources"]:
            if row["source"].get("sourceKind")=="postgis":
                self.sources.addItem(source_label(row)+" · "+row["id"][:12],row["id"])
        index=self.sources.findData(old)
        if index<0:index=self.sources.findData(active)
        self.sources.setCurrentIndex(max(0,index) if self.sources.count() else -1)
        self.sources.blockSignals(False);self.source_changed()
        fill(self.checks,[([r["at"],r["actor"],r["sourceId"],len(r["layers"]),r["id"]],r)
                          for r in reversed(state.get("postgisChecks",[]))])

    def source_changed(self,*_):
        from ..plugin import fill
        sid=self.sources.currentData()
        self.source=self.dock.workspace.source(sid) if sid and self.dock.workspace else None
        if not self.source:
            self.summary.setText("No accepted PostGIS receipt in this workspace.");fill(self.relations,[]);return
        receipt=self.source.manifest
        self.summary.setText(receipt["projectId"]+" · database "+receipt["database"]["name"]+
            " · schema "+receipt["database"]["schema"]+" · revision "+str(receipt["revision"])+
            "\n"+receipt["editionId"]+" · connection profile "+receipt["database"]["profileId"])
        old=self.connection.role.currentData();names=sorted({r["name"] for l in self.source.layers.values() for r in l["roles"]})
        self.connection.role.clear()
        for name in names:self.connection.role.addItem(name,name)
        if old in names:self.connection.role.setCurrentIndex(self.connection.role.findData(old))
        if self.last_source!=sid:
            saved=next((l for l in self.dock.state["layers"] if l["sourceId"]==sid and l.get("postgis")),None)
            if saved:self.connection.set(saved["postgis"]["connection"])
        self.last_source=sid
        fill(self.relations,[([l["title"],l["schema"]+"."+l["relation"],
            l["geometryType"]+" / "+str(l["srid"]),l["rowCount"],
            "; ".join(r["name"]+": "+", ".join(r["permissions"]) for r in l["roles"])],l)
            for l in self.source.layers.values()])

    def selected_ids(self):
        from ..plugin import selected
        ids=[x["id"] for x in selected(self.relations)]
        require(ids,"POSTGIS_RELATION_SELECTION","Select one or more accepted relations.")
        return ids

    def receipt(self):
        from ..plugin import DetailDialog
        self.dock.run("Read accepted PostGIS receipt",lambda:DetailDialog("Original PostGIS receiving",
            self.current().native_inventory(),self).exec())

    def layer_detail(self):
        from ..plugin import DetailDialog
        self.dock.run("Read accepted relation",lambda:DetailDialog("Original typed relation",
            self.dock.selected_one(self.relations,"accepted relation"),self).exec())

    def check(self):
        def work():
            source=self.current();profile=self.connection.value(source)
            self.dock.mutate("postgis-check",{"sourceId":source.id,"layerIds":self.selected_ids(),"connection":profile})
        self.dock.run("Verify native database relations and feature keys",work)

    def add(self):
        def work():
            source=self.current();profile=self.connection.value(source);ids=self.selected_ids()
            definitions=copy.deepcopy(self.dock.state["layers"])
            existing={x["id"] for x in definitions}
            for identifier in ids:
                row=source.layer_definition(identifier,profile)
                require(row["id"] not in existing,"POSTGIS_LAYER_ALREADY_SELECTED",
                    "This logical database layer already has a map selection. Edit its connection or review a successor receipt.")
                definitions.append(row);existing.add(row["id"])
            self.dock.mutate("postgis-layers",{"layers":definitions})
        self.dock.run("Bind accepted database layers",work)

    def apply_successor(self):
        def work():
            from ..plugin import USER_ROLE
            comparison=self.dock.comparison
            require(comparison and comparison["rightSourceId"]==self.current().id and
                    self.dock.left.currentData()==comparison["leftSourceId"] and
                    self.dock.right.currentData()==comparison["rightSourceId"],
                    "POSTGIS_SUCCESSOR_SELECTION", "Compare the original and successor editions in Review, then select that exact successor here.")
            profile=self.connection.value(self.current())
            decisions=[]
            for index in range(self.dock.review.rowCount()):
                row=self.dock.review.item(index,0).data(USER_ROLE)
                choice=self.dock.review.cellWidget(index,3).currentData()
                require(choice in ("keep","update","remove"),"COMPLETE_REVIEW_REQUIRED","Choose every original layer decision in Review.")
                item={"layerId":row["id"],"decision":choice}
                if choice=="update" and row.get("postgis"):item["connection"]=copy.deepcopy(profile)
                decisions.append(item)
            self.dock.mutate("review",{"left":comparison["leftSourceId"],"right":comparison["rightSourceId"],
                "decisions":decisions,"note":self.dock.review_note.text().strip()})
            self.dock.comparison=None
            from ..plugin import fill
            fill(self.dock.review,[])
            self.dock.review_summary.setText("Reviewed database choices are retained. Verify the successor and apply the selected layers to QGIS.")
        self.dock.run("Apply explicit successor connection and retained style choices",work)

    def refresh_native(self):
        def work():
            from ..plugin import DetailDialog
            result=refresh_project(self.dock.need_workspace(),QgsProject.instance(),progress=self.dock.progress)
            self.dock.iface.mapCanvas().refresh()
            DetailDialog("Actual native database refresh",result,self).exec()
        self.dock.run("Refresh original database layers",work)

    def check_detail(self):
        from ..plugin import DetailDialog
        self.dock.run("Read native receiving result",lambda:DetailDialog("Retained native PostGIS verification",
            self.dock.selected_one(self.checks,"saved verification"),self).exec())

    def load_map_connection(self):
        def work():
            row=self.dock.selected_one(self.dock.layers,"retained map layer")
            require(row.get("postgis") and row["sourceId"]==self.current().id,
                    "POSTGIS_SELECTED_SOURCE","Select a PostGIS map layer bound to this exact receipt.")
            self.connection.set(row["postgis"]["connection"])
        self.dock.run("Load retained connection references",work)

def edit_layer(dock,row):
    source=dock.workspace.source(row["sourceId"])
    dialog=DatabaseLayerDialog(source,row,dock)
    if dialog.exec()!=QDialog.DialogCode.Accepted:return None
    return dialog.definition()

def comparison_label(definition,comparison):
    if not definition.get("postgis"):return None
    identifier=definition["postgis"]["layerId"]
    item=next((x for x in comparison.get("databaseLayers",[]) if x["id"]==identifier),{})
    return identifier,str(item.get("status","UNAVAILABLE"))+" · "+(
        "same typed columns; retain style" if item.get("sameColumnContract") else "inspect column migration")
