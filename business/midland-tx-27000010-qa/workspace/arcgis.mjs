// MIT. Compare an ORIGINAL ArcGIS REST export to a selected RFP feature class.
// Native field names are preserved; UTC date epochs are rendered losslessly as ISO.
// The untouched values and geometry stay in the
// retained original response; this adapter does not replace an ArcGIS load.
import {Readable} from 'node:stream';
import {CLASSES,fault,digest} from './contract.mjs';
import {readObject} from './files.mjs';
const TYPES={esriFieldTypeOID:'OID',esriFieldTypeGeometry:'Geometry',esriFieldTypeString:'String',
  esriFieldTypeInteger:'Integer',esriFieldTypeSmallInteger:'SmallInteger',esriFieldTypeDouble:'Double',
  esriFieldTypeSingle:'Single',esriFieldTypeDate:'Date',esriFieldTypeGlobalID:'GlobalID',esriFieldTypeGUID:'GUID'};
const GEOMETRY={esriGeometryPolygon:'Polygon',esriGeometryPolyline:'Polyline',esriGeometryPoint:'Point',
  esriGeometryMultipoint:'Multipoint',esriGeometryMultiPatch:'Multipatch'};
export function compileArcgisExport(layer,response,{targetClass,layerSha,responseSha,sourceRef=''}={}){
  if(!CLASSES.includes(targetClass)||!layer||!Array.isArray(layer.fields)||!Array.isArray(response?.features))
    throw fault(422,'Choose an original ArcGIS layer metadata file, feature response and target RFP class.');
  if(response.error||layer.error)throw fault(422,'The ArcGIS source contains a provider error.');
  if(response.features.length>100000)throw fault(422,'Use the original streaming ArcPy exporter for larger batches.');
  const spatial=response.spatialReference??layer.extent?.spatialReference??layer.sourceSpatialReference??{};
  const unknownDates=layer.datesInUnknownTimezone===true||String(layer.dateFieldsTimeReference?.timeZone).toLowerCase()==='unknown';
  const fields=layer.fields.map(field=>({name:field.name,type:TYPES[field.type]??field.type,
    ...(typeof field.nullable==='boolean'?{nullable:field.nullable}:{}),...(field.length!==undefined?{length:field.length}:{}),
    ...(field.precision!==undefined?{precision:field.precision}:{}),...(field.scale!==undefined?{scale:field.scale}:{})}));
  const geometryName=layer.geometryField?.name;
  if(geometryName&&!fields.some(field=>field.type==='Geometry'))fields.push({name:geometryName,type:'Geometry',
    ...(typeof layer.geometryField.nullable==='boolean'?{nullable:layer.geometryField.nullable}:{})});
  const metadata={feature_class:targetClass,source_feature_class:layer.name??'',geometry:GEOMETRY[layer.geometryType]??layer.geometryType,
    horizontal_crs:spatial.wkt??['ArcGIS WKID '+String(spatial.wkid??'unreported'),spatial.latestWkid?'latest WKID '+spatial.latestWkid:''].filter(Boolean).join(' / '),
    vertical_crs:spatial.vcsWkid?'ArcGIS VCS WKID '+spatial.vcsWkid:'',fields,
    source_kind:'Original ArcGIS REST layer and feature response; explicit comparison to target RFP schema; attributes only',
    original_layer_sha256:layerSha,original_response_sha256:responseSha,original_source_ref:sourceRef,
    original_spatial_reference:spatial,returned_features:response.features.length,exceeded_transfer_limit:response.exceededTransferLimit===true,
    original_geometry_field_name:geometryName??null,
    date_encoding:unknownDates?'UNKNOWN_TIMEZONE_UNCHANGED':'UTC_EPOCH_MILLISECONDS_TO_ISO',
    geometry_custody:'Unmodified geometry remains in the retained original ArcGIS response.'};
  const rows=response.features.map((feature,index)=>{
    if(!feature||!feature.attributes||typeof feature.attributes!=='object'||Array.isArray(feature.attributes))
      throw fault(422,'ArcGIS feature '+(index+1)+' lacks original attributes.');
    const attributes={...feature.attributes};
    if(!unknownDates){
      for(const field of layer.fields){
        const value=attributes[field.name];
        if(field.type==='esriFieldTypeDate'&&Number.isSafeInteger(value)&&Number.isFinite(new Date(value).valueOf()))
          attributes[field.name]=new Date(value).toISOString();
      }
    }
    return JSON.stringify(attributes);
  });
  return {metadata,rows:rows.length?rows.join('\n')+'\n':'',returned_features:rows.length};
}
export async function importArcgisSource(workspace,projectId,input){
  const layer=workspace.getUpload(projectId,input.layer_upload),response=workspace.getUpload(projectId,input.response_upload);
  let layerValue,responseValue;
  try{
    layerValue=JSON.parse((await readObject(workspace.root,layer.sha256,32*1024*1024)).toString('utf8'));
    responseValue=JSON.parse((await readObject(workspace.root,response.sha256,32*1024*1024)).toString('utf8'));
  }catch(e){if(e.status)throw e;throw fault(422,'ArcGIS exports must contain valid JSON.');}
  if(responseValue.exceededTransferLimit===true&&!input.sample)
    throw fault(422,'The original response reports a transfer limit; retain it as a sample or supply complete original exports.');
  const compiled=compileArcgisExport(layerValue,responseValue,{targetClass:input.target_class,layerSha:layer.sha256,
    responseSha:response.sha256,sourceRef:input.source_ref||''});
  const metadata=await workspace.upload(projectId,'arcgis-target-metadata.json',Readable.from(Buffer.from(JSON.stringify(compiled.metadata,null,2)+'\n')));
  const rows=await workspace.upload(projectId,'arcgis-original-attributes.ndjson',Readable.from(Buffer.from(compiled.rows)));
  return workspace.addSource(projectId,{...input,metadata_upload:metadata.id,rows_upload:rows.id,
    native_artifacts:[{upload_id:layer.id,label:input.label+' · original ArcGIS layer metadata'},
      {upload_id:response.id,label:input.label+' · original ArcGIS features and geometry'}]});
}
