/** Exact strip reader for the retained native Annual NLCD GeoTIFF edition. */
function readNativeClassTiff(bytes, inflate) {
  if(!(bytes instanceof Uint8Array)||bytes.length<16)throw Error("Expected original TIFF bytes");
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const check=(offset,size)=>{if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||offset+size>bytes.length)throw Error("TIFF byte range exceeds the original file");};
  if(bytes[0]!==73||bytes[1]!==73||view.getUint16(2,true)!==42)throw Error("Expected retained little-endian classic TIFF");
  const at=view.getUint32(4,true);check(at,2);
  const count=view.getUint16(at,true);check(at+2,count*12+4);
  if(view.getUint32(at+2+count*12,true)!==0)throw Error("Select a single original image directory");
  const tags=new Map(),sizes={1:1,2:1,3:2,4:4,12:8};
  for(let i=0;i<count;i++){
    const p=at+2+i*12,tag=view.getUint16(p,true),type=view.getUint16(p+2,true),n=view.getUint32(p+4,true);
    if(tags.has(tag))throw Error("Repeated TIFF tag "+tag);
    const width=sizes[type];
    if(!width)continue;
    const length=n*width,offset=length<=4?p+8:view.getUint32(p+8,true);check(offset,length);
    let values;
    if(type===2)values=Array.from(bytes.subarray(offset,offset+length),x=>String.fromCharCode(x)).join("").replace(/\0+$/,"");
    else values=Array.from({length:n},(_,j)=>type===1?bytes[offset+j]:type===3?view.getUint16(offset+j*2,true):type===4?view.getUint32(offset+j*4,true):view.getFloat64(offset+j*8,true));
    tags.set(tag,values);
  }
  const values=tag=>{if(!tags.has(tag))throw Error("Missing original TIFF tag "+tag);return tags.get(tag);};
  const one=(tag,fallback)=>tags.has(tag)?values(tag)[0]:fallback;
  const width=one(256),height=one(257),rows=one(278);
  if(![width,height,rows].every(x=>Number.isInteger(x)&&x>0))throw Error("Invalid original raster dimensions");
  if(one(258)!==8||one(277)!==1||one(339,1)!==1||one(262)!==1||one(284,1)!==1||one(317,1)!==1)
    throw Error("Expected native unsigned-byte classes without a predictor");
  if(![8,32946].includes(one(259)))throw Error("Expected original Deflate strips");
  if(tags.has(322)||tags.has(324)||tags.has(34264))throw Error("Select the retained native strip GeoTIFF");
  const scale=values(33550),tie=values(33922),keys=values(34735);
  if(scale.length!==3||tie.length!==6||!(scale[0]>0&&scale[1]>0)||keys.length!==4+4*keys[3])
    throw Error("Original north-up GeoTIFF georeference is incomplete");
  const keyMap=new Map();
  for(let i=4;i<keys.length;i+=4)if(keys[i+1]===0&&keys[i+2]===1)keyMap.set(keys[i],keys[i+3]);
  if(keyMap.get(3072)!==5070||keyMap.get(1025)!==1||keyMap.get(3076)!==9001)
    throw Error("Expected EPSG:5070 metres and PixelIsArea");
  const affine=[scale[0],0,tie[3]-tie[0]*scale[0],0,-scale[1],tie[4]+tie[1]*scale[1]];
  if(!affine.every(Number.isFinite))throw Error("Nonfinite original affine");
  const offsets=values(273),lengths=values(279),expected=Math.ceil(height/rows);
  if(offsets.length!==expected||lengths.length!==expected)throw Error("Incomplete original row strips");
  offsets.forEach((offset,i)=>check(offset,lengths[i]));
  const nodata=Number(values(42113));
  if(!Number.isInteger(nodata)||nodata<0||nodata>255)throw Error("Expected explicit uint8 NoData");
  let cachedIndex=-1,cached;
  function readRow(row){
    if(!Number.isInteger(row)||row<0||row>=height)throw Error("Native row index is outside raster");
    const index=Math.floor(row/rows);
    if(index!==cachedIndex){
      cached=inflate(bytes.subarray(offsets[index],offsets[index]+lengths[index]));
      const expectedBytes=Math.min(rows,height-index*rows)*width;
      if(!(cached instanceof Uint8Array)||cached.length!==expectedBytes)throw Error("Decoded strip length differs: "+index);
      cachedIndex=index;
    }
    const begin=(row-index*rows)*width;
    return cached.subarray(begin,begin+width);
  }
  return {grid:{width,height,affine},epsg:5070,nodata,readRow,
    source_layout:{strips:expected,rows_per_strip:rows,compression:one(259)}};
}
export {readNativeClassTiff};
