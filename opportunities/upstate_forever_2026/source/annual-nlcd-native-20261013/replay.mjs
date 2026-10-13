#!/usr/bin/env node
/** Reassemble the retained native class cells from exact original PNG files. */
import {readFileSync, readdirSync, mkdirSync, openSync, writeFileSync, closeSync,
        fsyncSync, linkSync, unlinkSync, existsSync} from "node:fs";
import {resolve, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash, randomUUID} from "node:crypto";
import {inflateSync, deflateSync} from "node:zlib";
import {decodePng, categoricalRed} from "./decode_png.mjs";
import {assembleNativeTiles, validateTilePlan} from "./write_geotiff.mjs";

const sha256=body=>createHash("sha256").update(body).digest("hex");
function retained(path, body) {
  mkdirSync(dirname(path), {recursive:true});
  if (existsSync(path)) {
    if (!readFileSync(path).equals(Buffer.from(body))) throw Error("Existing output differs: "+path);
    return;
  }
  const temporary=path+"."+randomUUID()+".partial",fd=openSync(temporary,"wx");
  try {
    try { writeFileSync(fd,body); fsyncSync(fd); } finally { closeSync(fd); }
    try { linkSync(temporary,path); }
    catch (error) {
      if(error.code!=="EEXIST"||!readFileSync(path).equals(Buffer.from(body)))throw error;
    }
  } finally { if(existsSync(temporary))unlinkSync(temporary); }
}
function pngFiles(root) {
  const paths=[];
  for(const entry of readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const path=join(root,entry.name);
    if(entry.isDirectory())paths.push(...pngFiles(path));
    else if(entry.isFile()&&entry.name.toLowerCase().endsWith(".png"))paths.push(path);
  }
  return paths;
}
function descriptionFromHeader(specification) {
  const body=Buffer.from(specification.header.base64,"base64");
  if(body.length!==specification.header.bytes||sha256(body)!==specification.header.sha256)
    throw Error("Retained source TIFF header differs");
  const ifd=body.readUInt32LE(4),count=body.readUInt16LE(ifd);
  for(let i=0;i<count;i++){
    const at=ifd+2+12*i;
    if(body.readUInt16LE(at)!==270)continue;
    const n=body.readUInt32LE(at+4),start=n<=4?at+8:body.readUInt32LE(at+8);
    if(body.readUInt16LE(at+2)!==2||!n||start+n>body.length||body[start+n-1]!==0)
      throw Error("Retained source TIFF description differs");
    return body.subarray(start,start+n-1).toString("ascii");
  }
  throw Error("Retained source description is absent");
}
export function replay({pngRoot,output,packageRoot=dirname(fileURLToPath(import.meta.url))}) {
  const specification=JSON.parse(readFileSync(join(packageRoot,"receiving.json"),"utf8"));
  const planBytes=readFileSync(join(packageRoot,"source","plan.json"));
  const expected=specification.source_entry.companions.find(item=>item.path==="plan.json");
  if(!expected||planBytes.length!==expected.bytes||sha256(planBytes)!==expected.sha256)
    throw Error("Retained original plan bytes differ");
  const plan=JSON.parse(planBytes),tiles=validateTilePlan(plan);
  if(JSON.stringify(plan.grid)!==JSON.stringify(specification.grid)||plan.time!==specification.source_time)
    throw Error("Selected native source grid or year differs");
  output=resolve(output);pngRoot=resolve(pngRoot);
  if(output===resolve(packageRoot,"source"))throw Error("Choose a separate replay output directory");
  const wanted=new Set(tiles.map(tile=>tile.png_sha256)),paths=new Map();
  for(const path of pngFiles(pngRoot)){
    const hash=sha256(readFileSync(path));
    if(wanted.has(hash)&&!paths.has(hash))paths.set(hash,path);
  }
  const missing=tiles.filter(tile=>!paths.has(tile.png_sha256)).map(tile=>tile.tile);
  if(missing.length)throw Error("Original PNG files are missing for tiles: "+missing.join(", "));
  const result=assembleNativeTiles({
    plan,inflate:inflateSync,deflate:body=>deflateSync(body,{level:6}),sha256,
    description:descriptionFromHeader(specification),
    readTile(tile){
      const png=readFileSync(paths.get(tile.png_sha256));
      const decoded=categoricalRed(decodePng(png,inflateSync),tile);
      const pixels=Uint8Array.from(decoded.values,value=>value===decoded.nodata?250:value);
      return {png,pixels};
    }
  });
  // Different zlib releases can encode the same original cells differently.
  // Require every decoded strip to match the retained corrected source edition.
  if(result.validation.strips.length!==specification.strips.length)
    throw Error("Replayed strip inventory differs from the corrected source");
  for(let i=0;i<specification.strips.length;i++){
    const original=specification.strips[i],actual=result.validation.strips[i];
    if(actual.row!==original.row||actual.height!==original.height||
       actual.pixel_bytes!==original.pixel_bytes||actual.pixel_sha256!==original.pixel_sha256)
      throw Error("Replay differs from original corrected cells in strip "+i);
  }
  const receipt={
    ...result.validation,
    original_source_id:specification.source_entry.id,
    original_raster:specification.raster,
    source_time:specification.source_time,
    plan:{bytes:planBytes.length,sha256:sha256(planBytes)},
    encoding:{node:process.versions.node,zlib:process.versions.zlib,level:6},
    original_pixels_equal:true,
    original_encoding_equal:result.validation.sha256===specification.raster.sha256,
    png_sources:tiles.map(tile=>({tile:tile.tile,path:paths.get(tile.png_sha256),sha256:tile.png_sha256}))
  };
  retained(join(output,"replay.tif"),result.raster);
  retained(join(output,"replay.json"),Buffer.from(JSON.stringify(receipt,null,2)+"\n"));
  return receipt;
}
function main() {
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){
    const key={"--png-root":"pngRoot","--output":"output"}[args[i]];
    if(!key||!args[i+1]||args[i+1].startsWith("--")||options[key])throw Error("Usage: node replay.mjs --png-root ORIGINAL_PNG_DIRECTORY --output SEPARATE_REPLAY_DIRECTORY");
    options[key]=args[++i];
  }
  if(!options.pngRoot||!options.output)throw Error("Select the original PNG directory and separate replay output");
  const result=replay(options);
  process.stdout.write(JSON.stringify({state:"complete",tiles:result.tiles.length,cells:result.cells,
    original_pixels_equal:result.original_pixels_equal,original_encoding_equal:result.original_encoding_equal,
    sha256:result.sha256,output:resolve(options.output)})+"\n");
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
