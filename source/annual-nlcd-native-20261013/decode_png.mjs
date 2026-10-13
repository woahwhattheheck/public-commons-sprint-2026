function decodePng(bytes, inflate) {
  const be32=(p)=>(bytes[p]*16777216+bytes[p+1]*65536+bytes[p+2]*256+bytes[p+3])>>>0;
  const crc=(array)=>{let n=0xffffffff;for(const b of array){n^=b;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;};
  const sig=[137,80,78,71,13,10,26,10];
  if(!sig.every((v,i)=>bytes[i]===v))throw Error("Response is not original PNG");
  let p=8,header=null,palette=null,alpha=null,end=false,segments=[],chunks=[];
  while(p<bytes.length){
    const n=be32(p);if(p+12+n>bytes.length)throw Error("Truncated PNG chunk");
    const name=String.fromCharCode(...bytes.slice(p+4,p+8));
    if(crc(bytes.slice(p+4,p+8+n))!==be32(p+8+n))throw Error("PNG CRC differs: "+name);
    const data=bytes.slice(p+8,p+8+n);chunks.push({type:name,bytes:n});
    if(name==="IHDR"){
      if(header||n!==13)throw Error("Unexpected PNG header");
      header={width:be32(p+8),height:be32(p+12),depth:data[8],type:data[9],compression:data[10],filter:data[11],interlace:data[12]};
    }else if(name==="PLTE")palette=data;
    else if(name==="tRNS")alpha=data;
    else if(name==="IDAT")segments.push(data);
    else if(name==="IEND"){end=true;p+=12+n;break;}
    else if(name[0]===name[0].toUpperCase())throw Error("Unknown critical PNG chunk: "+name);
    p+=12+n;
  }
  if(!header||!end||p!==bytes.length||header.compression||header.filter||header.interlace)throw Error("Unsupported PNG framing");
  const {width,height,depth,type}=header;
  const channels={0:1,2:3,3:1,4:2,6:4}[type];
  if(!channels||![1,2,4,8].includes(depth)||((type!==0&&type!==3)&&depth!==8))throw Error("Unsupported PNG class encoding");
  if(width<1||height<1||width*height>16777216)throw Error("Unexpected PNG dimensions");
  const packed=new Uint8Array(segments.reduce((s,v)=>s+v.length,0));let offset=0;
  for(const segment of segments){packed.set(segment,offset);offset+=segment.length;}
  const raw=inflate(packed),stride=Math.ceil(width*channels*depth/8),bpp=Math.max(1,Math.ceil(channels*depth/8));
  if(raw.length!==(stride+1)*height)throw Error("PNG scanline length differs");
  const decoded=new Uint8Array(stride*height);
  const paeth=(a,b,c)=>{const n=a+b-c,da=Math.abs(n-a),db=Math.abs(n-b),dc=Math.abs(n-c);return da<=db&&da<=dc?a:db<=dc?b:c;};
  for(let row=0;row<height;row++){
    const kind=raw[row*(stride+1)];if(kind>4)throw Error("Unknown PNG filter");
    for(let col=0;col<stride;col++){
      const i=row*stride+col,a=col>=bpp?decoded[i-bpp]:0,b=row?decoded[i-stride]:0,c=row&&col>=bpp?decoded[i-stride-bpp]:0;
      decoded[i]=(raw[row*(stride+1)+col+1]+(kind===0?0:kind===1?a:kind===2?b:kind===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;
    }
  }
  const rgba=new Uint8Array(width*height*4);
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){
    const q=(row*width+col)*4;
    if(type===3||type===0){
      const bit=col*depth,n=(decoded[row*stride+(bit>>3)]>>(8-depth-(bit&7)))&((1<<depth)-1);
      if(type===3){
        if(!palette||3*n+2>=palette.length)throw Error("Missing PNG palette entry");
        rgba[q]=palette[3*n];rgba[q+1]=palette[3*n+1];rgba[q+2]=palette[3*n+2];rgba[q+3]=alpha&&n<alpha.length?alpha[n]:255;
      }else{
        const v=n*255/((1<<depth)-1);rgba[q]=rgba[q+1]=rgba[q+2]=v;rgba[q+3]=alpha&&n===((alpha[0]<<8)|alpha[1])?0:255;
      }
    }else{
      const i=row*stride+col*channels;
      if(type===2||type===6){
        rgba[q]=decoded[i];rgba[q+1]=decoded[i+1];rgba[q+2]=decoded[i+2];
        rgba[q+3]=type===6?decoded[i+3]:alpha&&decoded[i]===((alpha[0]<<8)|alpha[1])&&decoded[i+1]===((alpha[2]<<8)|alpha[3])&&decoded[i+2]===((alpha[4]<<8)|alpha[5])?0:255;
      }else{rgba[q]=rgba[q+1]=rgba[q+2]=decoded[i];rgba[q+3]=decoded[i+1];}
    }
  }
  return {header,chunks,rgba};
}
function categoricalRed(decoded, expected) {
  if(decoded.header.width!==expected.width||decoded.header.height!==expected.height)throw Error("Provider image dimensions differ from selected native cells");
  const values=new Uint16Array(expected.width*expected.height),hist={};
  for(let n=0;n<values.length;n++){
    const [r,g,b,a]=decoded.rgba.slice(n*4,n*4+4);
    if(a===0){values[n]=65535;continue;}
    if(a!==255||g!==0||b!==0)throw Error("Image does not preserve the selected red identity palette");
    values[n]=r;hist[r]=(hist[r]||0)+1;
  }
  return {values,hist,nodata:65535,width:expected.width,height:expected.height};
}
export {decodePng,categoricalRed};
