// Original WBD records become station context without changing observations or geometry.
export function parseCsv(text) {
  const rows=[]; let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"' && text[i+1]==='"'){cell+='"';i++;}
      else if(ch==='"')quoted=false;
      else cell+=ch;
    } else if(ch==='"')quoted=true;
    else if(ch===','){row.push(cell);cell="";}
    else if(ch==='\n'||ch==='\r'){
      if(ch==='\r'&&text[i+1]==='\n')i++;
      row.push(cell);if(row.some(value=>value!==""))rows.push(row);
      row=[];cell="";
    } else cell+=ch;
  }
  if(quoted)throw Error("Incomplete original CSV quotation");
  if(row.length||cell){row.push(cell);rows.push(row);}
  if(!rows.length)throw Error("Choose the original populated WBD table");
  const fields=rows.shift();
  if(new Set(fields).size!==fields.length)throw Error("Repeated original WBD field");
  return rows.map(row=>{
    if(row.length!==fields.length)throw Error("Original WBD row width differs");
    return Object.fromEntries(fields.map((field,index)=>[field,row[index]]));
  });
}
export function buildStationContext(rows, sourceSha256) {
  if(!/^[0-9a-f]{64}$/.test(sourceSha256))throw Error("Retain the original polygon table hash");
  const identities=new Set();
  return rows.map((original,index)=>{
    if(!original.point_id||!original.entity_id)throw Error("Original WBD identity missing");
    const identity=JSON.stringify([original.point_id,original.response_feature_index]);
    if(identities.has(identity))throw Error("Repeated original WBD point/polygon row");
    identities.add(identity);
    let station=original.entity_id;
    if(original.point_kind==="npdes_outfall"){
      const match=/^(SC\d{7}):([^:]+)$/.exec(station);
      if(!match)throw Error("Original permit/outfall identity differs");
      station=match[1];
    } else if(!["assessment_station","usgs_gauge","study_station"].includes(original.point_kind))
      throw Error("Unrecognized original observation location kind");
    if(original.point_kind==="usgs_gauge"&&!/^USGS-\d+$/.test(station))
      throw Error("Preserve the original USGS station prefix");
    if("station_id" in original||"context_record_id" in original||"context_kind" in original)
      throw Error("Original context field would be overwritten");
    return {station_id:station,context_record_id:sourceSha256+":"+(index+1),
      context_kind:"original_point_wbd_polygon_match",...original};
  });
}
