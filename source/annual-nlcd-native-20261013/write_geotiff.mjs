function writeGeoTiff({width,height,transform,strips,description,inflate}) {
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>0xffffffff)throw Error("Invalid native raster dimensions");
 if(!Array.isArray(transform)||transform.length!==6||!transform.every(Number.isFinite)||transform[1]||transform[3]||transform[0]<=0||transform[4]>=0)throw Error("Expected native north-up metric grid");
 if(typeof inflate!=="function")throw Error("Supply the original zlib inflater so every serialized strip is checked");
 if(!Array.isArray(strips))throw Error("Select all original compressed strips");
 const utf=s=>Uint8Array.from([...s].map(x=>x.charCodeAt(0)));
 const field=(tag,type,values)=>{if(type===2)values=utf(values+"\0");const size={2:1,3:2,4:4,12:8}[type],data=new Uint8Array(values.length*size),view=new DataView(data.buffer);for(let i=0;i<values.length;i++){if(type===2)data[i]=values[i];else if(type===3)view.setUint16(i*size,values[i],true);else if(type===4)view.setUint32(i*size,values[i],true);else view.setFloat64(i*size,values[i],true);}return {tag,type,count:values.length,data};};
 const rowsPerStrip=1024;
 if(strips.length!==Math.ceil(height/rowsPerStrip))throw Error('Incomplete strips');
 const allowed=new Set([11,12,21,22,23,24,31,41,42,43,52,71,81,82,90,95,250]);
 for(let row=0;row<strips.length;row++){
  const source=strips[row];
  if(!(source instanceof Uint8Array)||!source.length)throw Error("Missing compressed strip "+row);
  const pixels=inflate(source),cells=width*Math.min(rowsPerStrip,height-row*rowsPerStrip);
  if(!(pixels instanceof Uint8Array)||pixels.length!==cells)throw Error("Decoded strip does not cover its original cells: "+row);
  for(const value of pixels)if(!allowed.has(value))throw Error("Unexpected native class in strip "+row+": "+value);
 }
 const tags=[field(256,4,[width]),field(257,4,[height]),field(258,3,[8]),field(259,3,[8]),field(262,3,[1]),field(270,2,description),field(273,4,strips.map(()=>0)),field(277,3,[1]),field(278,4,[rowsPerStrip]),field(279,4,strips.map(x=>x.length)),field(284,3,[1]),field(305,2,"Upper Savannah native class source receiver 2026-10-13"),field(339,3,[1]),field(33550,12,[transform[0],-transform[4],0]),field(33922,12,[0,0,0,transform[2],transform[5],0]),field(34735,3,[1,1,0,5,1024,0,1,1,1025,0,1,1,2048,0,1,4269,3072,0,1,5070,3076,0,1,9001]),field(42113,2,"250")].sort((a,b)=>a.tag-b.tag);
 let offset=8+2+tags.length*12+4;for(const t of tags)if(t.data.length>4){offset=(offset+7)&~7;t.offset=offset;offset+=t.data.length;}offset=(offset+7)&~7;const stripOffsets=[];for(const strip of strips){stripOffsets.push(offset);offset+=strip.length;}
 const offTag=tags.find(t=>t.tag===273);offTag.data=field(273,4,stripOffsets).data;
 const bytes=new Uint8Array(offset),view=new DataView(bytes.buffer);bytes[0]=73;bytes[1]=73;view.setUint16(2,42,true);view.setUint32(4,8,true);view.setUint16(8,tags.length,true);for(let i=0;i<tags.length;i++){const t=tags[i],at=10+i*12;view.setUint16(at,t.tag,true);view.setUint16(at+2,t.type,true);view.setUint32(at+4,t.count,true);if(t.data.length<=4)bytes.set(t.data,at+8);else{view.setUint32(at+8,t.offset,true);bytes.set(t.data,t.offset);}}for(let i=0;i<strips.length;i++)bytes.set(strips[i],stripOffsets[i]);return bytes;
}

function validateTilePlan(plan) {
 const grid=plan?.grid,{width,height}=grid?.window||{},size=grid?.tile_size;
 const integer=x=>Number.isSafeInteger(x)&&x>=0,hash=x=>typeof x==="string"&&/^[0-9a-f]{64}$/.test(x);
 if(size!==1024||grid.crs!=="EPSG:5070"||!integer(width)||!integer(height)||!width||!height||!Array.isArray(plan.tiles))throw Error("Invalid original tile grid");
 const tiles=[...plan.tiles].sort((a,b)=>a.row-b.row||a.col-b.col);
 if(tiles.length!==Math.ceil(width/size)*Math.ceil(height/size)||tiles.length!==grid.tiles)throw Error("Original tile inventory is incomplete");
 const classes=new Set([11,12,21,22,23,24,31,41,42,43,52,71,81,82,90,95]),ids=new Set(),counts={};let index=0;
 for(let row=0;row<height;row+=size)for(let col=0;col<width;col+=size){
  const tile=tiles[index++],w=Math.min(size,width-col),h=Math.min(size,height-row),cells=w*h;
  if(!integer(tile.tile)||ids.has(tile.tile)||tile.row!==row||tile.col!==col||tile.width!==w||tile.height!==h||
     tile.native_column!==grid.window.col+col||tile.native_row!==grid.window.row+row)throw Error("Original tile location or dimensions differ");
  ids.add(tile.tile);
  if(tile.pixel_bytes!==cells||!hash(tile.pixel_sha256)||!hash(tile.png_sha256)||!integer(tile.png_bytes)||!tile.png_bytes)
   throw Error("Original tile has an empty or incomplete declared payload: "+tile.tile);
  let total=0;
  if(!tile.class_counts||typeof tile.class_counts!=="object")throw Error("Missing original tile class counts");
  for(const [key,count] of Object.entries(tile.class_counts)){
   if(String(Number(key))!==key||!classes.has(Number(key))||!integer(count)||!count)throw Error("Invalid original tile class count");
   total+=count;counts[key]=(counts[key]||0)+count;
  }
  if(!integer(tile.nodata_cells)||total+tile.nodata_cells!==cells)throw Error("Original tile counts do not fill its native cells: "+tile.tile);
  if(tile.nodata_cells)counts[250]=(counts[250]||0)+tile.nodata_cells;
 }
 if(!plan.class_counts||Object.keys(counts).sort().join(",")!==Object.keys(plan.class_counts).sort().join(",")||
    Object.keys(counts).some(k=>counts[k]!==plan.class_counts[k])||Object.values(counts).reduce((a,b)=>a+b,0)!==width*height)throw Error("Original tile totals differ from complete grid");
 return tiles;
}

function assembleNativeTiles({plan,readTile,inflate,deflate,sha256,description}) {
 // readTile returns original PNG bytes and its normalized uint8 class pixels.
 // Both arrays are checked after any cache/persistence boundary, before copying.
 const grid=plan.grid,{width,height}=grid.window,tileSize=grid.tile_size;
 if(tileSize!==1024||grid.crs!=="EPSG:5070"||!Array.isArray(plan.tiles))throw Error("Select the retained native tile grid");
 if(![readTile,inflate,deflate,sha256].every(x=>typeof x==="function"))throw Error("Supply original tile, zlib and SHA256 functions");
 const integer=(x)=>Number.isSafeInteger(x)&&x>=0;
 if(!integer(width)||!integer(height)||!width||!height)throw Error("Invalid original grid dimensions");
 const tiles=validateTilePlan(plan);
 const classes=new Set([11,12,21,22,23,24,31,41,42,43,52,71,81,82,90,95]);
 const sameCounts=(a,b)=>Object.keys(a).sort().join(",")===Object.keys(b).sort().join(",")&&Object.keys(a).every(k=>a[k]===b[k]);
 const validHash=(x)=>typeof x==="string"&&/^[0-9a-f]{64}$/.test(x);
 const strips=[],tileChecks=[],stripChecks=[],counts={},identities=new Set();let index=0;
 for(let row=0;row<height;row+=tileSize){
  const stripHeight=Math.min(tileSize,height-row),pixels=new Uint8Array(width*stripHeight);
  let copied=0;
  for(let col=0;col<width;col+=tileSize){
   const tile=tiles[index++],w=Math.min(tileSize,width-col),cells=w*stripHeight;
   if(!integer(tile.tile)||identities.has(tile.tile)||tile.row!==row||tile.col!==col||tile.width!==w||tile.height!==stripHeight||
      tile.native_column!==grid.window.col+col||tile.native_row!==grid.window.row+row)throw Error("Original tile location or dimensions differ");
   identities.add(tile.tile);
   if(tile.pixel_bytes!==cells||!validHash(tile.pixel_sha256)||!validHash(tile.png_sha256)||!integer(tile.png_bytes)||!tile.png_bytes)
    throw Error("Original tile has an empty or incomplete declared payload: "+tile.tile);
   const original=readTile(tile),png=original?.png,values=original?.pixels;
   if(!(png instanceof Uint8Array)||png.length!==tile.png_bytes||sha256(png)!==tile.png_sha256)throw Error("Original PNG bytes differ: "+tile.tile);
   if(!(values instanceof Uint8Array)||values.length!==cells||sha256(values)!==tile.pixel_sha256)throw Error("Original decoded tile is empty, incomplete or changed: "+tile.tile);
   const histogram={};let nodata=0;
   for(const code of values){
    if(code===250)nodata++;else{
     if(!classes.has(code))throw Error("Unexpected original class: "+code);
     histogram[code]=(histogram[code]||0)+1;
    }
    counts[code]=(counts[code]||0)+1;
   }
   if(!sameCounts(histogram,tile.class_counts)||nodata!==tile.nodata_cells)throw Error("Original tile histogram differs: "+tile.tile);
   for(let y=0;y<stripHeight;y++){
    const line=values.subarray(y*w,(y+1)*w);
    if(line.length!==w)throw Error("Incomplete original tile row: "+tile.tile);
    pixels.set(line,y*width+col);
   }
   copied+=values.length;
   tileChecks.push({tile:tile.tile,cells,png_sha256:tile.png_sha256,pixel_sha256:tile.pixel_sha256});
  }
  if(copied!==pixels.length)throw Error("Original tile cells do not fill the complete strip");
  const compressed=deflate(pixels);
  if(!(compressed instanceof Uint8Array)||!compressed.length)throw Error("Compression returned an empty strip");
  const replay=inflate(compressed);
  if(!(replay instanceof Uint8Array)||replay.length!==pixels.length||sha256(replay)!==sha256(pixels))throw Error("Serialized strip pixels differ from original tiles");
  strips.push(compressed);
  stripChecks.push({row:row/tileSize,height:stripHeight,bytes:compressed.length,sha256:sha256(compressed),pixel_bytes:pixels.length,pixel_sha256:sha256(pixels)});
 }
 if(!sameCounts(counts,plan.class_counts)||Object.values(counts).reduce((a,b)=>a+b,0)!==width*height)throw Error("Full original tile histogram differs");
 const raster=writeGeoTiff({width,height,transform:grid.transform,strips,description,inflate});
 // Check bytes read from the final serialization, not just the pre-write buffers.
 const view=new DataView(raster.buffer,raster.byteOffset,raster.byteLength),ifd=view.getUint32(4,true),n=view.getUint16(ifd,true);
 const tagValues=(tag)=>{for(let i=0;i<n;i++){const at=ifd+2+i*12;if(view.getUint16(at,true)===tag){const count=view.getUint32(at+4,true),start=count===1?at+8:view.getUint32(at+8,true);return Array.from({length:count},(_,j)=>view.getUint32(start+j*4,true));}}throw Error("Missing serialized TIFF tag "+tag);};
 const offsets=tagValues(273),lengths=tagValues(279);
 if(offsets.length!==strips.length||lengths.length!==strips.length)throw Error("Serialized TIFF strip inventory changed");
 for(let i=0;i<strips.length;i++){
  const original=stripChecks[i],encoded=raster.subarray(offsets[i],offsets[i]+lengths[i]);
  if(encoded.length!==original.bytes||sha256(encoded)!==original.sha256)throw Error("Serialized TIFF strip changed");
  const pixels=inflate(encoded);
  if(pixels.length!==original.pixel_bytes||sha256(pixels)!==original.pixel_sha256)throw Error("Final TIFF pixels differ from original tiles");
 }
 return {raster,validation:{schema:"upstate.native-tile-assembly/v1",width,height,cells:width*height,
  tiles:tileChecks,strips:stripChecks,class_counts:counts,bytes:raster.length,sha256:sha256(raster)}};
}

export {writeGeoTiff, assembleNativeTiles, validateTilePlan};
