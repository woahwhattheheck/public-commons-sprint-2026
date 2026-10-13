"""Native read-only HDF5 engine. Run in the workbench's bounded child process."""
from __future__ import annotations
import base64, csv, itertools, json, math, os, sys
from pathlib import Path
from core import InputError, encode, parse, fingerprint, integer, only, MAX_ELEMENTS, MAX_OUTPUT, immutable
os.environ.setdefault("HDF5_PLUGIN_PRELOAD", "::")
if "HDF5_WORKBENCH_PARENT_PID" in os.environ:
    import ctypes, resource, signal
    parent=int(os.environ["HDF5_WORKBENCH_PARENT_PID"])
    ctypes.CDLL(None).prctl(1,signal.SIGTERM)
    if os.getppid()!=parent: raise SystemExit(125)
    resource.setrlimit(resource.RLIMIT_CPU,(120,125))
    resource.setrlimit(resource.RLIMIT_FSIZE,(MAX_OUTPUT+1048576,MAX_OUTPUT+1048576))
    resource.setrlimit(resource.RLIMIT_AS,(1536*1024*1024,1536*1024*1024))
try:
    import h5py
    import numpy as np
except ImportError as exc:
    print(json.dumps({"error":"HDF5_RUNTIME_REQUIRED","message":"Configure a Python interpreter with h5py and NumPy installed."}))
    raise SystemExit(3) from exc

ENGINE = "stellar-forge.hdf5-engine.v1"
def shape(value): return None if value is None else [str(int(n)) for n in value]
def address(obj): return str(h5py.h5o.get_info(obj.id).addr)
def path_value(value):
    if not isinstance(value, str) or not value.startswith("/") or "\0" in value or "//" in value or (value != "/" and value.endswith("/")):
        raise InputError("Use an exact absolute HDF5 path")
    return value

def hard_object(file, path):
    path_value(path)
    current = file["/"]
    if path == "/": return current
    for part in path[1:].split("/"):
        if not isinstance(current, h5py.Group): raise InputError("An intermediate HDF5 object is not a group")
        link = current.get(part, getlink=True)
        if link is None: raise InputError("HDF5 path does not exist")
        if not isinstance(link, h5py.HardLink):
            raise InputError("Select the retained hard-link object; soft and external targets are inventoried without dereferencing", "HDF5_LINK_SELECTION_REQUIRED", 409)
        current = current[part]
    return current

def dtype_info(dtype, depth=0):
    if depth > 10: raise InputError("Datatype nesting exceeds the metadata limit")
    dtype = np.dtype(dtype)
    result = {"numpy":dtype.str,"kind":dtype.kind,"itemBytes":str(dtype.itemsize),"byteOrder":dtype.byteorder}
    string = h5py.check_string_dtype(dtype)
    if string: result["string"] = {"encoding":string.encoding,"lengthBytes":None if string.length is None else str(string.length)}
    enum = h5py.check_enum_dtype(dtype)
    if enum is not None: result["enum"] = {name:str(int(value)) for name,value in enum.items()}
    ref = h5py.check_ref_dtype(dtype)
    if ref is not None: result["reference"] = "region" if issubclass(ref,h5py.RegionReference) else "object"
    vlen = h5py.check_vlen_dtype(dtype)
    if vlen is not None and not string: result["variableLength"] = dtype_info(vlen, depth+1)
    if h5py.check_opaque_dtype(dtype): result["opaque"] = True
    if dtype.subdtype:
        base, sizes = dtype.subdtype
        result["array"] = {"shape":shape(sizes),"base":dtype_info(base,depth+1)}
    if dtype.names:
        result["fields"] = [{"name":name,"offsetBytes":str(dtype.fields[name][1]),
                             "dtype":dtype_info(dtype.fields[name][0],depth+1)} for name in dtype.names]
    return result

def reference(value, file):
    kind = "region" if isinstance(value,h5py.RegionReference) else "object"
    if not value: return {"type":"reference","kind":kind,"null":True}
    target = file[value]
    result = {"type":"reference","kind":kind,"target":target.name,"objectAddress":address(target),"fileLocal":True}
    if kind == "region":
        space = h5py.h5r.get_region(value,file.id)
        try:
            count = int(space.get_select_npoints()); code = space.get_select_type()
            selection = {"points":str(count),"selectionType":int(code)}
            if count > MAX_ELEMENTS: raise InputError("Reference region exceeds the exact selection limit")
            if code == h5py.h5s.SEL_HYPERSLABS:
                blocks = space.get_select_hyper_blocklist()
                if len(blocks) > MAX_ELEMENTS: raise InputError("Reference block list exceeds the exact selection limit")
                selection["blocks"] = [[[str(int(n)) for n in point] for point in block] for block in blocks]
            elif code == h5py.h5s.SEL_POINTS:
                selection["coordinates"] = [[str(int(n)) for n in point] for point in space.get_select_elem_pointlist()]
            elif code == h5py.h5s.SEL_ALL: selection["shape"] = shape(target.shape)
            result["selection"] = selection
        finally: space.close()
    return result

def typed(value, dtype, file, depth=0):
    if depth > 12: raise InputError("Value nesting exceeds the exact serialization limit")
    dtype = np.dtype(dtype)
    ref = h5py.check_ref_dtype(dtype)
    if ref is not None: return reference(value,file)
    if dtype.names:
        return {"type":"compound","fields":[{"name":name,"value":typed(value[name],dtype.fields[name][0],file,depth+1)} for name in dtype.names]}
    if dtype.subdtype:
        base, dimensions = dtype.subdtype; array = np.asarray(value)
        if array.size > MAX_ELEMENTS: raise InputError("Array member exceeds the element limit")
        return {"type":"array","shape":shape(dimensions),"values":[typed(array[index],base,file,depth+1) for index in np.ndindex(dimensions)]}
    string = h5py.check_string_dtype(dtype)
    if string:
        if string.length is not None: data = np.asarray(value,dtype=dtype).tobytes()
        elif isinstance(value,str): data = value.encode("utf-8",errors="surrogateescape")
        else: data = bytes(value)
        return {"type":"bytes","base64":base64.b64encode(data).decode(),"encoding":string.encoding,
                "fixedLengthBytes":None if string.length is None else str(string.length)}
    vlen = h5py.check_vlen_dtype(dtype)
    if vlen is not None:
        array=np.asarray(value)
        if array.size > MAX_ELEMENTS: raise InputError("Variable-length value exceeds the element limit")
        return {"type":"array","shape":[str(len(array))],"values":[typed(array[index],vlen,file,depth+1) for index in range(len(array))]}
    if dtype.kind in "iu": return {"type":"integer","decimal":str(int(value)),"signed":dtype.kind=="i","bits":str(dtype.itemsize*8)}
    if dtype.kind == "b": return {"type":"boolean","value":bool(value)}
    if dtype.kind == "f":
        scalar=np.asarray(value,dtype=dtype)
        text=np.format_float_scientific(scalar,unique=True,trim="k") if np.isfinite(scalar) else ("nan" if np.isnan(scalar) else ("-inf" if scalar < 0 else "inf"))
        return {"type":"float","decimal":str(text),"bitsBase64":base64.b64encode(scalar.tobytes()).decode(),"dtype":dtype.str}
    if dtype.kind == "c":
        base=np.empty((),dtype=dtype).real.dtype
        return {"type":"complex","real":typed(value.real,base,file,depth+1),"imaginary":typed(value.imag,base,file,depth+1)}
    if dtype.kind in "SV":
        return {"type":"bytes","base64":base64.b64encode(np.asarray(value,dtype=dtype).tobytes()).decode(),"opaque":dtype.kind=="V"}
    if dtype.kind == "U": return {"type":"unicode","value":str(value),"dtype":dtype.str}
    raise InputError("This native HDF5 datatype is inventoried but cannot be projected by this engine", "HDF5_DATATYPE_UNSUPPORTED", 422)

def attributes(obj, offset=0, limit=50):
    names=list(itertools.islice(iter(obj.attrs),offset,offset+limit))
    result=[]
    for name in names:
        attr=obj.attrs.get_id(name)
        try: result.append({"name":name,"shape":shape(attr.shape),"dtype":dtype_info(attr.dtype)})
        finally: attr.close()
    return {"items":result,"total":str(len(obj.attrs)),"next":str(offset+len(names)) if offset+len(names)<len(obj.attrs) else None}

def dependencies(dataset):
    result=[]
    for name,offset,size in dataset.external or []:
        result.append({"kind":"external-storage","filename":os.fsdecode(name),"offsetBytes":str(offset),"sizeBytes":str(size)})
    if dataset.is_virtual:
        for mapping in dataset.virtual_sources():
            result.append({"kind":"virtual-source","filename":os.fsdecode(mapping.file_name),"dataset":os.fsdecode(mapping.dset_name),
                           "selectedPoints":str(mapping.vspace.get_select_npoints())})
            mapping.vspace.close(); mapping.src_space.close()
    return result

def describe(obj, offset=0, limit=50):
    result={"path":obj.name,"objectAddress":address(obj),"kind":"group" if isinstance(obj,h5py.Group) else "dataset",
            "attributes":attributes(obj),"engine":{"schema":ENGINE,"h5py":h5py.__version__,"hdf5":h5py.version.hdf5_version,"numpy":np.__version__}}
    if isinstance(obj,h5py.Group):
        items=[]
        for name in itertools.islice(iter(obj),offset,offset+limit):
            link=obj.get(name,getlink=True); path=obj.name.rstrip("/")+"/"+name
            if isinstance(link,h5py.SoftLink): entry={"name":name,"path":path,"link":"soft","target":link.path}
            elif isinstance(link,h5py.ExternalLink): entry={"name":name,"path":path,"link":"external","filename":link.filename,"target":link.path}
            else:
                target=obj[name]
                entry={"name":name,"path":path,"link":"hard","objectAddress":address(target),
                       "kind":"group" if isinstance(target,h5py.Group) else "dataset"}
                if isinstance(target,h5py.Dataset): entry.update(shape=shape(target.shape),dtype=dtype_info(target.dtype))
            items.append(entry)
        result["links"]={"items":items,"total":str(len(obj)),"next":str(offset+len(items)) if offset+len(items)<len(obj) else None}
    else:
        result.update(shape=shape(obj.shape),maxShape=[None if n is None else str(n) for n in obj.maxshape] if obj.maxshape is not None else None,
                      dtype=dtype_info(obj.dtype),chunks=shape(obj.chunks),compression=obj.compression,compressionOptions=obj.compression_opts,
                      shuffle=bool(obj.shuffle),fletcher32=bool(obj.fletcher32),scaleOffset=obj.scaleoffset,storageBytes=str(obj.id.get_storage_size()),
                      dependencies=dependencies(obj))
        axes=[]
        for number,axis in enumerate(obj.dims):
            scales=[]
            for label,scale in axis.items():
                scales.append({"label":label,"path":scale.name,"objectAddress":address(scale),"shape":shape(scale.shape)})
            axes.append({"axis":str(number),"label":axis.label,"scales":scales})
        result["dimensions"]=axes
        result["valueAccess"]="dependency-selection-required" if result["dependencies"] else "selected-file"
    return result

def normalize(dataset, body):
    only(body,["dataset","axes","fields"])
    if not isinstance(dataset,h5py.Dataset): raise InputError("Select an HDF5 dataset")
    fields=body.get("fields")
    if fields is not None:
        if not isinstance(fields,list) or not fields or len(fields)>64 or len(set(fields))!=len(fields) or not dataset.dtype.names or any(n not in dataset.dtype.names for n in fields):
            raise InputError("Select unique original compound field names in the required order")
        for name in fields:
            if dataset.dtype.fields[name][0].names: raise InputError("Nested compound projections are not supported by h5py", "HDF5_DATATYPE_UNSUPPORTED",422)
    axes=body.get("axes")
    if dataset.shape is None:
        if axes not in (None,[]): raise InputError("A null dataset has no slice")
        return {"dataset":body["dataset"],"axes":None,"fields":fields,"shape":None,"elements":"0"}
    if axes is None: axes=[{} for _ in dataset.shape]
    if not isinstance(axes,list) or len(axes)!=len(dataset.shape): raise InputError("Declare one axis selection per dataset dimension")
    result=[]; sizes=[]
    for size,axis in zip(dataset.shape,axes):
        only(axis,["start","count","stride","block"])
        start=integer(axis.get("start",0)); block=integer(axis.get("block",1),1)
        stride=integer(axis.get("stride",block),block)
        default=0 if start>=size else max(0,1+(size-start-block)//stride)
        count=integer(axis.get("count",default))
        if start>size or count and start+(count-1)*stride+block>size: raise InputError("Selection exceeds its original dataset dimension")
        result.append({"start":str(start),"count":str(count),"stride":str(stride),"block":str(block)})
        sizes.append(count*block)
    count=math.prod(sizes)
    if count>MAX_ELEMENTS: raise InputError("Selection exceeds 100,000 elements; save a smaller hyperslab", "HDF5_SELECTION_TOO_LARGE",413)
    return {"dataset":body["dataset"],"axes":result,"fields":fields,"shape":shape(sizes),"elements":str(count)}

def extract(file,dataset,selection,target):
    if dependencies(dataset): raise InputError("This dataset depends on unselected virtual or raw external sources; values were not read", "HDF5_DEPENDENCIES_UNBOUND",409)
    selected=normalize(dataset,{k:selection[k] for k in ("dataset","axes","fields")})
    if selected != selection: raise InputError("Saved selection no longer matches native metadata", "HDF5_SELECTION_CHANGED",409)
    dtype=dataset.dtype
    if selection["fields"] is not None:
        dtype=np.dtype([(name,dataset.dtype.fields[name][0]) for name in selection["fields"]])
    shape_out=selection["shape"]; elements=int(selection["elements"])
    if elements*max(dtype.itemsize,1)>MAX_OUTPUT: raise InputError("Native fixed-size allocation exceeds 64 MiB", "HDF5_SELECTION_TOO_LARGE",413)
    getter=dataset.fields(selection["fields"]) if selection["fields"] else dataset
    if shape_out is None: values=None
    elif not dataset.shape: values=getter[()]
    elif not elements: values=None
    else:
        slices=tuple(h5py.MultiBlockSlice(start=int(a["start"]),count=int(a["count"]),stride=int(a["stride"]),block=int(a["block"])) for a in selection["axes"])
        values=getter[slices]
    target=Path(target)
    result_file=target/"values.jsonl"; csv_file=target/"dataset.csv"
    total=0; max_query_row_bytes=0
    with result_file.open("xb") as rows, csv_file.open("x",encoding="utf-8",newline="") as csv_out:
        os.chmod(result_file,0o600); os.chmod(csv_file,0o600)
        writer=csv.writer(csv_out,lineterminator="\n"); writer.writerow(["row","coordinates","value"])
        if values is not None:
            for index in np.ndindex(tuple(int(n) for n in shape_out)):
                coordinate=[]
                for output_index,axis in zip(index,selection["axes"]):
                    block=int(axis["block"])
                    coordinate.append(str(int(axis["start"])+(output_index//block)*int(axis["stride"])+(output_index%block)))
                value=typed(values if not dataset.shape else values[index],dtype,file)
                record={"row":str(total),"coordinates":coordinate,"value":value}
                encoded=encode(record)
                if len(encoded)>1024*1024: raise InputError("One typed element exceeds the 1 MiB result-cell limit", "HDF5_VALUE_TOO_LARGE",413)
                projected={"row":str(total),"coordinates":json.dumps(coordinate,separators=(",",":")),
                           "value":json.dumps(value,ensure_ascii=True,separators=(",",":"),allow_nan=False)}
                max_query_row_bytes=max(max_query_row_bytes,len(encode(projected))-1)
                rows.write(encoded); writer.writerow([projected["row"],projected["coordinates"],projected["value"]])
                total+=1
                if rows.tell()>MAX_OUTPUT or csv_out.tell()>MAX_OUTPUT: raise InputError("Serialized selection exceeds 64 MiB", "HDF5_RESULT_TOO_LARGE",413)
        rows.flush(); os.fsync(rows.fileno()); csv_out.flush(); os.fsync(csv_out.fileno())
    metadata={"schema":ENGINE,"selection":selection,"dtype":dtype_info(dtype),"shape":shape_out,"rows":str(total),
              "order":"C-index-order","coordinates":"original-zero-based-decimal-strings","encoding":"typed-json-v1",
              "sourceDatatype":dtype_info(dataset.dtype),"objectAddress":address(dataset),
              "datasetProjection":{"maxRowJsonBytes":str(max_query_row_bytes),"maximumPublishRowJsonBytes":str(768*1024)}}
    immutable(target/"array.json",encode(metadata))
    config={"schema":"stellar-forge.csv-dataset.v1","file":"dataset.csv","name":"HDF5 array selection",
            "columns":{"row":"string","coordinates":"string","value":"string"},"filters":["row","coordinates"],"ranges":[],"sorts":[],
            "maxBytes":MAX_OUTPUT,"maxRows":MAX_ELEMENTS,"maxCellChars":1048576,"defaultLimit":25,"maxLimit":250,"maxPageBytes":900*1024}
    immutable(target/"dataset.json",encode(config))
    return metadata

def main():
    request=parse(sys.stdin.buffer.read(1024*1024+1))
    with h5py.File(request["source"],"r") as file:
        action=request["action"]; payload=request.get("payload",{})
        obj=hard_object(file,payload.get("path",payload.get("dataset","/")))
        if action=="inspect": result=describe(obj,integer(payload.get("offset",0)),integer(payload.get("limit",50),1,200))
        elif action=="attributes": result=attributes(obj,integer(payload.get("offset",0)),integer(payload.get("limit",50),1,200))
        elif action=="attribute":
            name=payload["name"]
            if name not in obj.attrs: raise InputError("Attribute does not exist")
            attr=obj.attrs.get_id(name)
            try:
                if math.prod(attr.shape or ())>MAX_ELEMENTS: raise InputError("Attribute exceeds the exact value limit")
                value=obj.attrs[name]
                result={"path":obj.name,"name":name,"dtype":dtype_info(attr.dtype),"shape":shape(attr.shape),
                        "values":[] if attr.shape is None else [typed(value if not attr.shape else value[index],attr.dtype,file)
                                                              for index in np.ndindex(attr.shape)]}
            finally: attr.close()
        elif action=="normalize": result=normalize(obj,payload)
        elif action=="extract": result=extract(file,obj,payload,request["target"])
        else: raise InputError("Unknown native HDF5 operation")
    data=encode({"result":result})
    if len(data)>16*1024*1024: raise InputError("Metadata exceeds the selected response limit")
    sys.stdout.buffer.write(data); sys.stdout.buffer.flush()
if __name__=="__main__":
    try: main()
    except Exception as exc:
        sys.stdout.buffer.write(encode({"error":getattr(exc,"code","HDF5_NATIVE_ERROR"),"status":getattr(exc,"status",422),
                                       "message":str(exc)[:2000]}))
        raise SystemExit(1)
