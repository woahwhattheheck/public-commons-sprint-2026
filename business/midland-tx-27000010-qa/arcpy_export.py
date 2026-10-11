#!/usr/bin/env python3
"""Local ArcGIS Pro adapter. Run only inside an authorized ArcGIS/ArcPy environment.
Exports real ESRI field descriptions and attributes to explicit JSON/NDJSON, with
NO geometry copied into the neutral review artifact. GIS geometry must be audited
separately in source ESRI environment; this is not the complete City acceptance.
"""
import arcpy
import json
import pathlib
import sys


def main():
    if len(sys.argv) != 3:
        raise SystemExit('usage: python arcpy_export.py /path/to/work.gdb/IMP_SURFACE_PARCELS /private/output-prefix')
    source = sys.argv[1]
    prefix = pathlib.Path(sys.argv[2]).resolve()
    if prefix.with_suffix('.json').exists() or prefix.with_suffix('.ndjson').exists():
        raise SystemExit('Refusing to overwrite existing evidence')
    desc = arcpy.Describe(source)
    fields = list(arcpy.ListFields(source))
    meta = {
        'feature_class': desc.baseName,
        'geometry': desc.shapeType,
        'horizontal_crs': desc.spatialReference.name,
        'vertical_crs': getattr(desc.spatialReference, 'verticalName', '') or '',
        'fields': [{'name': f.name, 'type': f.type, 'length': f.length,
                    'nullable': bool(f.isNullable), 'precision': f.precision,
                    'scale': f.scale} for f in fields],
        'source_kind': 'ArcPy Described ORIGINAL geodatabase; row attributes only'
    }
    with prefix.with_suffix('.json').open('x', encoding='utf-8') as out:
        out.write(json.dumps(meta, indent=2) + '\n')
    attr_fields = [f.name for f in fields if f.type not in ('Geometry', 'OID')]
    count = 0
    with prefix.with_suffix('.ndjson').open('x', encoding='utf-8') as out:
        with arcpy.da.SearchCursor(source, attr_fields) as cursor:
            for row in cursor:
                obj = {k: v.isoformat() if hasattr(v, 'isoformat') else v
                       for k, v in zip(attr_fields, row)}
                out.write(json.dumps(obj, ensure_ascii=False, default=str) + '\n')
                count += 1
    print(json.dumps({'feature_class': desc.baseName, 'rows': count,
                      'metadata': str(prefix.with_suffix('.json')),
                      'attributes': str(prefix.with_suffix('.ndjson'))}))


if __name__ == '__main__':
    main()
