"""Open, render, save and independently reopen a complete package in actual QGIS.

Run with QGIS Python: QT_QPA_PLATFORM=offscreen /usr/bin/python3
    tools/model/gis_project_native.py ORIGINAL_DIRECTORY NEW_RECEIVING_DIRECTORY
The sender stays unchanged. This command carries every dataset with the project.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import time

if __package__:
    from . import gis_project as gis
else:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import gis_project as gis


def run(directory, output):
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    from qgis.core import (QgsApplication, QgsProject, QgsMapSettings,
                           QgsMapRendererParallelJob, QgsRectangle, Qgis)
    from qgis.PyQt.QtCore import QSize
    from qgis.PyQt.QtGui import QColor
    directory, output = Path(directory).resolve(strict=True), Path(output).resolve()
    before = gis.verify(directory, native=False)
    if output.exists() or output.is_relative_to(directory):
        raise FileExistsError("Choose a new receiving directory outside the sender")
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(directory, output, copy_function=shutil.copyfile)
    app = QgsApplication([], False)
    app.initQgis()
    started = time.monotonic()
    try:
        project = QgsProject()
        if not project.read(str(output / "project.qgs")):
            raise ValueError("QGIS could not open the editable project")
        manifest = gis.load(output / "project.json")
        expected = {row["key"]: row for row in manifest["layers"]}
        loaded = project.mapLayers()
        if set(loaded) != set(expected):
            raise ValueError("Native QGIS layer identities differ")
        rows = []
        for key, layer in loaded.items():
            if not layer.isValid():
                raise ValueError("Native QGIS layer failed: " + layer.name())
            item = {"id": key, "name": layer.name(), "provider": layer.providerType(),
                    "crs": layer.crs().authid(), "valid": True}
            if expected[key]["data"]["kind"] == "vector":
                item["feature_count"] = layer.featureCount()
                if item["feature_count"] != expected[key]["data"]["feature_count"]:
                    raise ValueError("Native QGIS feature population differs")
            else:
                item.update(width=layer.width(), height=layer.height())
                if (item["width"], item["height"]) != (expected[key]["data"]["width"], expected[key]["data"]["height"]):
                    raise ValueError("Native QGIS raster dimensions differ")
            rows.append(item)
        settings = QgsMapSettings()
        settings.setDestinationCrs(project.crs())
        settings.setBackgroundColor(QColor("white"))
        settings.setOutputSize(QSize(1400, 950))
        settings.setLayers([node.layer() for node in project.layerTreeRoot().findLayers() if node.isVisible()])
        settings.setExtent(QgsRectangle(*manifest["extent"]))
        job = QgsMapRendererParallelJob(settings)
        job.start()
        job.waitForFinished()
        errors = [{"layer_id": item.layerID, "message": item.message} for item in job.errors()]
        if errors:
            raise ValueError("Native QGIS rendering: " + json.dumps(errors))
        if not job.renderedImage().save(str(output / "qgis-native.png")):
            raise OSError("Could not save the native rendering")
        project.setFilePathStorage(Qgis.FilePathType.Relative)
        native_file = output / "project.qgz"
        if not project.write(str(native_file)):
            raise OSError("Native QGIS save failed")
        check = QgsProject()
        if not check.read(str(native_file)) or set(check.mapLayers()) != set(expected):
            raise ValueError("The native saved project did not reopen")
        if any(not layer.isValid() for layer in check.mapLayers().values()):
            raise ValueError("A layer did not reopen from the native saved edition")
        import zipfile
        with zipfile.ZipFile(native_file) as archive:
            qgs = [n for n in archive.namelist() if n.endswith(".qgs")]
            if len(qgs) != 1:
                raise ValueError("Expected one native project XML")
            (output / "project.qgs").write_bytes(archive.read(qgs[0]))
        result = {"schema": "upstate.gis-native-receiving/v1", "version": Qgis.QGIS_VERSION,
                  "layer_count": len(rows), "layers": rows, "render_errors": errors,
                  "native_save_reopened": True, "seconds": round(time.monotonic()-started, 6)}
        gis.save(output / "native-receiving.json", result)
        manifest["native_qgis"] = {"status": "opened, rendered, saved and reopened", **result}
        gis.save(output / "project.json", manifest)
        # HTML does not depend on QGIS Python's Fiona/Rasterio installation.
        gis.catalogue(output, manifest)
        gis.inventory(output)
        gis.verify(output, native=False)
        if gis.verify(directory, native=False) != before:
            raise ValueError("Sender changed during native receiving")
        return {**result, "directory": str(output), "sender_unchanged": True}
    except Exception:
        # A failed native receive remains available for diagnosis, with no success record.
        raise
    finally:
        project = None
        app.exitQgis()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory")
    parser.add_argument("output")
    args = parser.parse_args()
    print(json.dumps(run(args.directory, args.output), indent=2))


if __name__ == "__main__":
    main()
