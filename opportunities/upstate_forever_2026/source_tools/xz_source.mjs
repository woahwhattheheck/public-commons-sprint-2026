// XZ source-bank container adapter. Copyright TokenJunkieLabs.
// Specification: https://tukaani.org/xz/xz-file-format.txt
import {createLzma2Decoder} from "./xz_lzma2.mjs";
export function createXzSourceDecoder(codec,{maxInputBytes=67108864,maxOutputBytes=134217728,maxDictionaryBytes=67108864,maxBlocks=10000}={}) {
  if(!codec||typeof codec.crc32!=="function"||typeof codec.sha256!=="function")throw Error("XZ requires the existing archive codec");
  for(const [key,n]of Object.entries({maxInputBytes,maxOutputBytes,maxDictionaryBytes,maxBlocks}))if(!Number.isSafeInteger(n)||n<1||n>0x7fffffff)throw Error("Invalid XZ limit "+key);
  const decodeLzma2=createLzma2Decoder({maxOutputBytes,maxDictionaryBytes});
  const fail=s=>{throw Error("xz_source: "+s);};
  const u32=(a,p)=>{if(p<0||p+4>a.length)fail("truncated integer");return(a[p]|a[p+1]<<8|a[p+2]<<16|a[p+3]<<24)>>>0;};
  const eq=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  const hexBytes=s=>Uint8Array.from(s.match(/../g).map(x=>parseInt(x,16)));
  let crc64Table;
  function crc64(a){if(!crc64Table){crc64Table=[];for(let i=0;i<256;i++){let n=BigInt(i);for(let j=0;j<8;j++)n=(n&1n)?(n>>1n)^0xC96C5795D7870F42n:n>>1n;crc64Table.push(n);}}let n=0xffffffffffffffffn;for(const v of a)n=crc64Table[Number((n^BigInt(v))&255n)]^(n>>8n);n^=0xffffffffffffffffn;return Uint8Array.from({length:8},(_,i)=>Number((n>>BigInt(i*8))&255n));}
  function checkCrc(a,start,end,crcAt){if(codec.crc32(a.subarray(start,end))!==u32(a,crcAt))fail("metadata CRC32 mismatch");}
  function vli(a,pos,end){let value=0,multiplier=1,count=0,byte;do{if(pos>=end||count>=8)fail("invalid variable-length integer");byte=a[pos++];if(count&&byte===0)fail("noncanonical variable-length integer");value+=(byte&127)*multiplier;count++;if(!Number.isSafeInteger(value))fail("integer exceeds exact JavaScript range");multiplier*=128;}while(byte&128);return{value,next:pos};}
  return function decodeXZ(input,{expectedSha256,expectedOutputSha256}={}){
    if(!(input instanceof Uint8Array))fail("input must be Uint8Array");const a=input;
    if(a.length>maxInputBytes||a.length<32||a.length%4)fail("input size or alignment");
    if(expectedSha256&&codec.sha256(a)!==String(expectedSha256).toLowerCase())fail("input SHA256 mismatch");
    if(!eq(a.subarray(0,6),Uint8Array.from([253,55,122,88,90,0])))fail("invalid stream magic");
    if(a[6]!==0||![0,1,4,10].includes(a[7]))fail("unsupported stream flags/check");checkCrc(a,6,8,8);
    const checkType=a[7],checkSize=({0:0,1:4,4:8,10:32})[checkType];let end=a.length;
    while(end>0&&a[end-1]===0)end--;if((a.length-end)%4||end<32||a[end-2]!==89||a[end-1]!==90)fail("invalid footer/padding");
    const footer=end-12;checkCrc(a,footer+4,footer+10,footer);
    if(a[footer+8]!==a[6]||a[footer+9]!==a[7])fail("stream flags disagree");
    const indexSize=(u32(a,footer+4)+1)*4,indexStart=footer-indexSize;
    if(indexStart<12||indexSize<8||a[indexStart]!==0)fail("invalid index position");checkCrc(a,indexStart,footer-4,footer-4);
    let p=indexStart+1;const count=vli(a,p,footer-4);p=count.next;if(count.value>maxBlocks)fail("block count limit");const records=[];let outputBytes=0;
    for(let i=0;i<count.value;i++){const unpadded=vli(a,p,footer-4);p=unpadded.next;const expanded=vli(a,p,footer-4);p=expanded.next;outputBytes+=expanded.value;if(outputBytes>maxOutputBytes)fail("expanded size exceeds maxOutputBytes");records.push({unpadded:unpadded.value,bytes:expanded.value});}
    if(footer-4-p>3)fail("excess index padding");for(;p<footer-4;p++)if(a[p]!==0)fail("nonzero index padding");
    let blockStart=12,outputPos=0;const output=new Uint8Array(outputBytes),blocks=[];
    for(const record of records){if(blockStart>=indexStart||a[blockStart]===0)fail("missing block");const headerSize=(a[blockStart]+1)*4,headerEnd=blockStart+headerSize;
      if(headerSize<8||headerEnd>indexStart||record.unpadded<headerSize+checkSize+1)fail("invalid block size");checkCrc(a,blockStart,headerEnd-4,headerEnd-4);
      const flags=a[blockStart+1];if(flags&63)fail("only one LZMA2 filter is supported");let h=blockStart+2;let declaredCompressed,declaredExpanded;
      if(flags&64){const n=vli(a,h,headerEnd-4);h=n.next;declaredCompressed=n.value;}if(flags&128){const n=vli(a,h,headerEnd-4);h=n.next;declaredExpanded=n.value;}
      const filter=vli(a,h,headerEnd-4);h=filter.next;const propertySize=vli(a,h,headerEnd-4);h=propertySize.next;
      if(filter.value!==33||propertySize.value!==1||h>=headerEnd-4)fail("only plain LZMA2 is supported");const property=a[h++];for(;h<headerEnd-4;h++)if(a[h]!==0)fail("nonzero block header padding");
      const compressedSize=record.unpadded-headerSize-checkSize,paddedSize=Math.ceil(record.unpadded/4)*4,blockEnd=blockStart+paddedSize,dataEnd=headerEnd+compressedSize,checkStart=blockEnd-checkSize;
      if(blockEnd>indexStart||dataEnd>checkStart)fail("block overlaps index");if(declaredCompressed!==undefined&&declaredCompressed!==compressedSize)fail("compressed size mismatch");if(declaredExpanded!==undefined&&declaredExpanded!==record.bytes)fail("expanded size mismatch");
      for(let j=dataEnd;j<checkStart;j++)if(a[j]!==0)fail("nonzero block padding");
      const decoded=decodeLzma2(a.subarray(headerEnd,dataEnd),property,record.bytes);let expected;
      if(checkType===1){const n=codec.crc32(decoded);expected=Uint8Array.from([n&255,n>>>8&255,n>>>16&255,n>>>24]);}
      if(checkType===4)expected=crc64(decoded);if(checkType===10)expected=hexBytes(codec.sha256(decoded));
      if(expected&&!eq(expected,a.subarray(checkStart,blockEnd)))fail("block data check mismatch");output.set(decoded,outputPos);blocks.push({offset:blockStart,compressedBytes:compressedSize,outputOffset:outputPos,outputBytes:decoded.length,dictionaryProperty:property});outputPos+=decoded.length;blockStart=blockEnd;
    }
    if(blockStart!==indexStart)fail("unaccounted stream data or concatenated stream");const sha256=codec.sha256(output);if(expectedOutputSha256&&sha256!==String(expectedOutputSha256).toLowerCase())fail("output SHA256 mismatch");
    return{data:output,format:"xz",checkType,blocks,bytes:output.length,sha256,inputBytes:a.length,inputSha256:codec.sha256(a)};
  };
}
