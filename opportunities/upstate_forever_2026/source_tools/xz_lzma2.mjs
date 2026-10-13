// Pure JavaScript LZMA2 source recovery; adapter Copyright TokenJunkieLabs.
// Decoder bodies derived from xz-compat@1.2.11, MIT; see vendor/xz-compat/LICENSE.
// Full unchanged upstream modules and their hashes accompany this source.
export function createLzma2Decoder({maxDictionaryBytes=67108864,maxOutputBytes=134217728}={}) {
  if(!Number.isSafeInteger(maxDictionaryBytes)||maxDictionaryBytes<4096||maxDictionaryBytes>0x7fffffff||!Number.isSafeInteger(maxOutputBytes)||maxOutputBytes<0||maxOutputBytes>0x7fffffff)throw Error("Invalid LZMA2 resource limits");
  class Bytes extends Uint8Array {
    static isBuffer(v){return v instanceof Uint8Array;}
    static concat(xs){let n=xs.reduce((a,x)=>a+x.length,0);if(n>maxOutputBytes)throw Error("LZMA2 output limit");const o=new Bytes(n);let p=0;for(const x of xs){o.set(x,p);p+=x.length;}return o;}
    copy(target,start=0,a=0,b=this.length){const v=this.subarray(a,b);target.set(v.subarray(0,Math.max(0,target.length-start)),start);return Math.min(v.length,target.length-start);}
  }
  const Buffer=Bytes;
  const allocBufferUnsafe=n=>{if(!Number.isSafeInteger(n)||n<0||n>Math.max(maxOutputBytes,maxDictionaryBytes))throw Error("LZMA2 allocation limit");return new Bytes(n);};
  const bufferFrom=v=>new Bytes(v),bufferConcat=Bytes.concat,canAllocateBufferSize=n=>Number.isSafeInteger(n)&&n>=0&&n<=maxOutputBytes;
  const types=(()=>{

/**
 * LZMA Types and Constants
 *
 * Shared types, constants, and state transition functions for LZMA decoding.
 * Based on the LZMA SDK specification.
 */ // LZMA State Machine Constants
const kNumRepDistances = 4;
const kNumStates = 12;
// Position slot constants
const kNumPosSlotBits = 6;
const kDicLogSizeMin = 0;
const kNumLenToPosStatesBits = 2;
const kNumLenToPosStates = 1 << kNumLenToPosStatesBits; // 4
// Match length constants
const kMatchMinLen = 2;
const kNumLowLenBits = 3;
const kNumMidLenBits = 3;
const kNumHighLenBits = 8;
const kNumLowLenSymbols = 1 << kNumLowLenBits; // 8
const kNumMidLenSymbols = 1 << kNumMidLenBits; // 8
const kNumLenSymbols = kNumLowLenSymbols + kNumMidLenSymbols + (1 << kNumHighLenBits); // 272
const kMatchMaxLen = kMatchMinLen + kNumLenSymbols - 1; // 273
// Alignment constants
const kNumAlignBits = 4;
const kAlignTableSize = 1 << kNumAlignBits; // 16
const kAlignMask = kAlignTableSize - 1; // 15
// Position model constants
const kStartPosModelIndex = 4;
const kEndPosModelIndex = 14;
const kNumPosModels = kEndPosModelIndex - kStartPosModelIndex; // 10
const kNumFullDistances = 1 << (kEndPosModelIndex >>> 1); // 128
// Literal/pos state constants
const kNumLitPosStatesBitsEncodingMax = 4;
const kNumLitContextBitsMax = 8;
const kNumPosStatesBitsMax = 4;
const kNumPosStatesMax = 1 << kNumPosStatesBitsMax; // 16
const kNumPosStatesBitsEncodingMax = 4;
const kNumPosStatesEncodingMax = 1 << kNumPosStatesBitsEncodingMax; // 16
// Range coder probability constants
const kNumBitModelTotalBits = 11;
const kBitModelTotal = 1 << kNumBitModelTotalBits; // 2048
const kNumMoveBits = 5;
const kProbInitValue = kBitModelTotal >>> 1; // 1024
/**
 * State transition: after literal byte
 */ function stateUpdateChar(state) {
    if (state < 4) return 0;
    if (state < 10) return state - 3;
    return state - 6;
}
/**
 * State transition: after match
 */ function stateUpdateMatch(state) {
    return state < 7 ? 7 : 10;
}
/**
 * State transition: after rep (repeated match)
 */ function stateUpdateRep(state) {
    return state < 7 ? 8 : 11;
}
/**
 * State transition: after short rep
 */ function stateUpdateShortRep(state) {
    return state < 7 ? 9 : 11;
}
/**
 * Check if state indicates previous symbol was a character (literal)
 */ function stateIsCharState(state) {
    return state < 7;
}
/**
 * Get length-to-position state index
 */ function getLenToPosState(len) {
    len -= kMatchMinLen;
    return len < kNumLenToPosStates ? len : kNumLenToPosStates - 1;
}
/**
 * Initialize probability array with default values
 * @param probs - Array to initialize (or null to create new)
 * @param count - Number of probabilities
 * @returns Initialized probability array
 */ function initBitModels(probs, count) {
    if (probs === null) {
        if (count === undefined) {
            throw new Error('count required when probs is null');
        }
        probs = new Uint16Array(count);
    }
    for(let i = 0; i < probs.length; i++){
        probs[i] = kProbInitValue;
    }
    return probs;
}
/**
 * Parse LZMA properties from a 5-byte buffer
 */ function parseProperties(properties) {
    if (properties.length < 5) {
        throw new Error('LZMA properties must be at least 5 bytes');
    }
    const d = properties[0] & 0xff;
    const lc = d % 9;
    const remainder = ~~(d / 9);
    const lp = remainder % 5;
    const pb = ~~(remainder / 5);
    if (lc > kNumLitContextBitsMax || lp > 4 || pb > kNumPosStatesBitsMax) {
        throw new Error('Invalid LZMA properties');
    }
    let dictionarySize = 0;
    for(let i = 0; i < 4; i++){
        dictionarySize |= (properties[1 + i] & 0xff) << i * 8;
    }
    return {
        lc,
        lp,
        pb,
        dictionarySize
    };
}
/**
 * LZMA2 control byte meanings
 */ const LZMA2_CONTROL = {
    END: 0x00,
    UNCOMPRESSED_RESET_DIC: 0x01,
    UNCOMPRESSED: 0x02,
    LZMA_RESET_STATE_NEW_PROP: 0xe0
};
/**
 * Check if LZMA2 control byte indicates reset state (new properties)
 */ function lzma2NeedsNewProps(control) {
    return control >= 0xe0;
}
/**
 * Check if LZMA2 control byte indicates reset probabilities
 */ function lzma2NeedsResetProbs(control) {
    return control >= 0xa0;
}
/**
 * Check if LZMA2 control byte indicates uncompressed chunk
 */ function lzma2IsUncompressed(control) {
    return control < 0x80;
}
/**
 * Parse LZMA2 dictionary size from property byte
 */ function parseLzma2DictionarySize(prop) {
    if (prop > 40) {
        throw new Error('Invalid LZMA2 dictionary size property');
    }
    if (prop === 40) {
        return 0xffffffff;
    }
    const base = 2 | prop & 1;
    const exp = (prop >>> 1) + 11;
    return base << exp;
}

return {kNumRepDistances,kNumStates,kNumPosSlotBits,kDicLogSizeMin,kNumLenToPosStatesBits,kNumLenToPosStates,kMatchMinLen,kNumLowLenBits,kNumMidLenBits,kNumHighLenBits,kNumLowLenSymbols,kNumMidLenSymbols,kNumLenSymbols,kMatchMaxLen,kNumAlignBits,kAlignTableSize,kAlignMask,kStartPosModelIndex,kEndPosModelIndex,kNumPosModels,kNumFullDistances,kNumLitPosStatesBitsEncodingMax,kNumLitContextBitsMax,kNumPosStatesBitsMax,kNumPosStatesMax,kNumPosStatesBitsEncodingMax,kNumPosStatesEncodingMax,kNumBitModelTotalBits,kBitModelTotal,kNumMoveBits,kProbInitValue,stateUpdateChar,stateUpdateMatch,stateUpdateRep,stateUpdateShortRep,stateIsCharState,getLenToPosState,initBitModels,parseProperties,LZMA2_CONTROL,lzma2NeedsNewProps,lzma2NeedsResetProbs,lzma2IsUncompressed,parseLzma2DictionarySize};
})();
  const ranges=(()=>{

/**
 * Synchronous Range Decoder for LZMA
 *
 * Decodes arithmetic-coded bits from a buffer.
 * All operations are synchronous - for streaming use the async version.
 */ /**
 * Range decoder for synchronous buffer-based LZMA decoding
 */ class RangeDecoder {
    /**
   * Set input buffer and initialize decoder state
   */ setInput(input, offset = 0) {
        this.pos = offset;
        // One-time binding for byte access (avoids repeated Buffer.isBuffer checks)
        this.getByte = (o)=>{
            if (!Number.isSafeInteger(o) || o < 0 || o >= input.length) throw new Error('LZMA: Truncated range-coded chunk');
            return Buffer.isBuffer(input) ? input[o] : input.readByte(o);
        };
        if (this.getByte(offset) !== 0) throw new Error('LZMA: Invalid range initializer');
        this.init();
    }
    /**
   * Initialize range decoder (reads first 5 bytes)
   */ init() {
        this.code = 0;
        this.range = -1; // 0xFFFFFFFF as signed int
        // First byte is ignored (should be 0)
        this.pos++;
        // Read 4 bytes into code
        for(let i = 0; i < 4; i++){
            this.code = this.code << 8 | this.getByte(this.pos++);
        }
    }
    /**
   * Get current position in input buffer
   */ getPosition() {
        return this.pos;
    }
    /**
   * Normalize range if needed (read more bytes)
   */ normalize() {
        if ((this.range & 0xff000000) === 0) {
            this.code = this.code << 8 | this.getByte(this.pos++);
            this.range <<= 8;
        }
    }
    /**
   * Decode a single bit using probability model
   * @param probs - Probability array
   * @param index - Index into probability array
   * @returns Decoded bit (0 or 1)
   */ decodeBit(probs, index) {
        const prob = probs[index];
        const newBound = (this.range >>> 11) * prob;
        if ((this.code ^ 0x80000000) < (newBound ^ 0x80000000)) {
            this.range = newBound;
            probs[index] += 2048 - prob >>> 5;
            this.normalize();
            return 0;
        }
        this.range -= newBound;
        this.code -= newBound;
        probs[index] -= prob >>> 5;
        this.normalize();
        return 1;
    }
    /**
   * Decode direct bits (not probability-based)
   * @param numTotalBits - Number of bits to decode
   * @returns Decoded value
   */ decodeDirectBits(numTotalBits) {
        let result = 0;
        for(let i = numTotalBits; i > 0; i--){
            this.range >>>= 1;
            const t = this.code - this.range >>> 31;
            this.code -= this.range & t - 1;
            result = result << 1 | 1 - t;
            this.normalize();
        }
        return result;
    }
    constructor(){
        this.pos = 0;
        this.code = 0;
        this.range = 0;
        this.getByte = ()=>0;
    }
}
/**
 * Bit tree decoder for multi-bit symbols
 */ class BitTreeDecoder {
    /**
   * Initialize probability models
   */ init() {
        for(let i = 0; i < this.models.length; i++){
            this.models[i] = 1024; // kProbInitValue
        }
    }
    /**
   * Decode a symbol (forward bit order)
   */ decode(rangeDecoder) {
        let m = 1;
        for(let i = this.numBitLevels; i > 0; i--){
            m = m << 1 | rangeDecoder.decodeBit(this.models, m);
        }
        return m - (1 << this.numBitLevels);
    }
    /**
   * Decode a symbol (reverse bit order)
   */ reverseDecode(rangeDecoder) {
        let m = 1;
        let symbol = 0;
        for(let i = 0; i < this.numBitLevels; i++){
            const bit = rangeDecoder.decodeBit(this.models, m);
            m = m << 1 | bit;
            symbol |= bit << i;
        }
        return symbol;
    }
    constructor(numBitLevels){
        this.numBitLevels = numBitLevels;
        this.models = new Uint16Array(1 << numBitLevels);
        this.init();
    }
}
/**
 * Static reverse decode from external probability array
 */ function reverseDecodeFromArray(models, startIndex, rangeDecoder, numBitLevels) {
    let m = 1;
    let symbol = 0;
    for(let i = 0; i < numBitLevels; i++){
        const bit = rangeDecoder.decodeBit(models, startIndex + m);
        m = m << 1 | bit;
        symbol |= bit << i;
    }
    return symbol;
}

return {RangeDecoder,BitTreeDecoder,reverseDecodeFromArray};
})();
  const chunks=(()=>{

/**
 * LZMA2 Chunk Parser
 *
 * Shared parsing logic for LZMA2 chunk headers.
 * Used by both synchronous and streaming decoders.
 *
 * LZMA2 control byte ranges:
 * 0x00         = End of stream
 * 0x01         = Uncompressed chunk, dictionary reset
 * 0x02         = Uncompressed chunk, no dictionary reset
 * 0x80-0x9F    = LZMA chunk, no reset (solid mode)
 * 0xA0-0xBF    = LZMA chunk, reset state (probabilities)
 * 0xC0-0xDF    = LZMA chunk, reset state + new properties
 * 0xE0-0xFF    = LZMA chunk, reset dictionary + state + new properties
 */ /**
 * Read a byte from BufferLike at offset
 */ function readByte(input, offset) {
    return Buffer.isBuffer(input) ? input[offset] : input.readByte(offset);
}
/**
 * Get length of BufferLike
 */ function getLength(input) {
    return Buffer.isBuffer(input) ? input.length : input.length;
}
/**
 * Parse an LZMA2 chunk header
 *
 * @param input - Input buffer or BufferList
 * @param offset - Offset to start parsing
 * @returns Parsed chunk info or number of bytes needed
 */ function parseLzma2ChunkHeader(input, offset) {
    const len = getLength(input);
    if (offset >= len) {
        return {
            success: false,
            needBytes: 1
        };
    }
    const control = readByte(input, offset);
    // End of stream
    if (control === 0x00) {
        return {
            success: true,
            chunk: {
                type: 'end',
                headerSize: 1,
                dictReset: false,
                stateReset: false,
                newProps: null,
                uncompSize: 0,
                compSize: 0
            }
        };
    }
    // Uncompressed chunk
    if (control === 0x01 || control === 0x02) {
        // Need 3 bytes: control + 2 size bytes
        if (offset + 3 > len) {
            return {
                success: false,
                needBytes: 3 - (len - offset)
            };
        }
        const uncompSize = (readByte(input, offset + 1) << 8 | readByte(input, offset + 2)) + 1;
        return {
            success: true,
            chunk: {
                type: 'uncompressed',
                headerSize: 3,
                dictReset: control === 0x01,
                stateReset: false,
                newProps: null,
                uncompSize,
                compSize: 0
            }
        };
    }
    // LZMA compressed chunk
    if (control >= 0x80) {
        const hasNewProps = control >= 0xc0;
        const minHeaderSize = hasNewProps ? 6 : 5; // control + 2 uncomp + 2 comp + (1 props)
        if (offset + minHeaderSize > len) {
            return {
                success: false,
                needBytes: minHeaderSize - (len - offset)
            };
        }
        // Parse sizes
        const uncompHigh = control & 0x1f;
        const uncompSize = (uncompHigh << 16 | readByte(input, offset + 1) << 8 | readByte(input, offset + 2)) + 1;
        const compSize = (readByte(input, offset + 3) << 8 | readByte(input, offset + 4)) + 1;
        // Parse properties if present
        let newProps = null;
        if (hasNewProps) {
            const propsByte = readByte(input, offset + 5);
            const lc = propsByte % 9;
            const remainder = ~~(propsByte / 9);
            const lp = remainder % 5;
            const pb = ~~(remainder / 5);
            newProps = {
                lc,
                lp,
                pb
            };
        }
        return {
            success: true,
            chunk: {
                type: 'lzma',
                headerSize: minHeaderSize,
                dictReset: control >= 0xe0,
                stateReset: control >= 0xa0,
                newProps,
                uncompSize,
                compSize
            }
        };
    }
    // Invalid control byte
    throw new Error(`Invalid LZMA2 control byte: 0x${control.toString(16)}`);
}
/**
 * Check if we have enough data for the complete chunk (header + data)
 */ function hasCompleteChunk(input, offset) {
    const result = parseLzma2ChunkHeader(input, offset);
    if (result.success === false) {
        return {
            success: false,
            needBytes: result.needBytes
        };
    }
    const { chunk } = result;
    const dataSize = chunk.type === 'uncompressed' ? chunk.uncompSize : chunk.compSize;
    const totalSize = chunk.headerSize + dataSize;
    const len = getLength(input);
    if (offset + totalSize > len) {
        return {
            success: false,
            needBytes: totalSize - (len - offset)
        };
    }
    return {
        success: true,
        chunk,
        totalSize
    };
}

return {parseLzma2ChunkHeader,hasCompleteChunk};
})();
  const lzma=(()=>{
const {kNumRepDistances,kNumStates,kNumPosSlotBits,kDicLogSizeMin,kNumLenToPosStatesBits,kNumLenToPosStates,kMatchMinLen,kNumLowLenBits,kNumMidLenBits,kNumHighLenBits,kNumLowLenSymbols,kNumMidLenSymbols,kNumLenSymbols,kMatchMaxLen,kNumAlignBits,kAlignTableSize,kAlignMask,kStartPosModelIndex,kEndPosModelIndex,kNumPosModels,kNumFullDistances,kNumLitPosStatesBitsEncodingMax,kNumLitContextBitsMax,kNumPosStatesBitsMax,kNumPosStatesMax,kNumPosStatesBitsEncodingMax,kNumPosStatesEncodingMax,kNumBitModelTotalBits,kBitModelTotal,kNumMoveBits,kProbInitValue,stateUpdateChar,stateUpdateMatch,stateUpdateRep,stateUpdateShortRep,stateIsCharState,getLenToPosState,initBitModels,parseProperties,LZMA2_CONTROL,lzma2NeedsNewProps,lzma2NeedsResetProbs,lzma2IsUncompressed,parseLzma2DictionarySize}=types;
const {RangeDecoder,BitTreeDecoder,reverseDecodeFromArray}=ranges;
/**
 * Synchronous LZMA1 Decoder
 *
 * Decodes LZMA1 compressed data from a buffer.
 * All operations are synchronous.
 */ 


/**
 * Length decoder for match/rep lengths
 */ let LenDecoder = class LenDecoder {
    create(numPosStates) {
        for(; this.numPosStates < numPosStates; this.numPosStates++){
            this.lowCoder[this.numPosStates] = new BitTreeDecoder(3);
            this.midCoder[this.numPosStates] = new BitTreeDecoder(3);
        }
    }
    init() {
        initBitModels(this.choice);
        for(let i = this.numPosStates - 1; i >= 0; i--){
            this.lowCoder[i].init();
            this.midCoder[i].init();
        }
        this.highCoder.init();
    }
    decode(rangeDecoder, posState) {
        if (rangeDecoder.decodeBit(this.choice, 0) === 0) {
            return this.lowCoder[posState].decode(rangeDecoder);
        }
        if (rangeDecoder.decodeBit(this.choice, 1) === 0) {
            return 8 + this.midCoder[posState].decode(rangeDecoder);
        }
        return 16 + this.highCoder.decode(rangeDecoder);
    }
    constructor(){
        this.choice = initBitModels(null, 2);
        this.lowCoder = [];
        this.midCoder = [];
        this.highCoder = new BitTreeDecoder(8);
        this.numPosStates = 0;
    }
};
/**
 * Single literal decoder (decodes one byte)
 */ let LiteralDecoder2 = class LiteralDecoder2 {
    init() {
        initBitModels(this.decoders);
    }
    decodeNormal(rangeDecoder) {
        let symbol = 1;
        do {
            symbol = symbol << 1 | rangeDecoder.decodeBit(this.decoders, symbol);
        }while (symbol < 0x100)
        return symbol & 0xff;
    }
    decodeWithMatchByte(rangeDecoder, matchByte) {
        let symbol = 1;
        do {
            const matchBit = matchByte >> 7 & 1;
            matchByte <<= 1;
            const bit = rangeDecoder.decodeBit(this.decoders, (1 + matchBit << 8) + symbol);
            symbol = symbol << 1 | bit;
            if (matchBit !== bit) {
                while(symbol < 0x100){
                    symbol = symbol << 1 | rangeDecoder.decodeBit(this.decoders, symbol);
                }
                break;
            }
        }while (symbol < 0x100)
        return symbol & 0xff;
    }
    constructor(){
        this.decoders = initBitModels(null, 0x300);
    }
};
/**
 * Literal decoder (array of single decoders)
 */ let LiteralDecoder = class LiteralDecoder {
    create(numPosBits, numPrevBits) {
        if (this.coders.length > 0 && this.numPrevBits === numPrevBits && this.numPosBits === numPosBits) {
            return;
        }
        this.numPosBits = numPosBits;
        this.posMask = (1 << numPosBits) - 1;
        this.numPrevBits = numPrevBits;
        this.coders = [];
    }
    init() {
        for(let i = 0; i < this.coders.length; i++){
            if (this.coders[i]) {
                var _this_coders_i;
                (_this_coders_i = this.coders[i]) === null || _this_coders_i === void 0 ? void 0 : _this_coders_i.init();
            }
        }
    }
    getDecoder(pos, prevByte) {
        const index = ((pos & this.posMask) << this.numPrevBits) + ((prevByte & 0xff) >>> 8 - this.numPrevBits);
        let decoder = this.coders[index];
        if (!decoder) {
            decoder = new LiteralDecoder2();
            this.coders[index] = decoder;
        }
        return decoder;
    }
    constructor(){
        this.numPosBits = 0;
        this.numPrevBits = 0;
        this.posMask = 0;
        this.coders = [];
    }
};
/**
 * Output window (sliding dictionary)
 */ let OutWindow = class OutWindow {
    create(windowSize) {
        if (!this.buffer || this.windowSize !== windowSize) {
            this.buffer = allocBufferUnsafe(windowSize);
        }
        this.windowSize = windowSize;
        this.pos = 0;
        this.streamPos = 0;
    }
    init(solid) {
        if (!solid) {
            this.pos = 0;
            this.streamPos = 0;
        }
    }
    putByte(b) {
        this.buffer[this.pos++] = b;
        if (this.pos >= this.windowSize) {
            if (this.sink) {
                this.flush();
                this.pos = 0;
                this.streamPos = 0; // Reset streamPos after wrap to track new data from pos 0
            } else {
                this.pos = 0;
            }
        }
    }
    flush() {
        const size = this.pos - this.streamPos;
        if (size > 0 && this.sink) {
            // Use bufferFrom to create a COPY, not a view - the buffer is reused after wrapping
            const chunk = bufferFrom(this.buffer.slice(this.streamPos, this.streamPos + size));
            this.sink.write(chunk);
            this.streamPos = this.pos;
        }
    }
    getByte(distance) {
        let pos = this.pos - distance - 1;
        if (pos < 0) {
            pos += this.windowSize;
        }
        return this.buffer[pos];
    }
    copyBlock(distance, len) {
        let pos = this.pos - distance - 1;
        if (pos < 0) {
            pos += this.windowSize;
        }
        for(let i = 0; i < len; i++){
            if (pos >= this.windowSize) {
                pos = 0;
            }
            this.putByte(this.buffer[pos++]);
        }
    }
    /**
   * Copy decoded data to output buffer
   */ copyTo(output, outputOffset, count) {
        const srcPos = this.pos - count;
        if (srcPos < 0) {
            // Wrap around case - data spans end and beginning of buffer
            const firstPart = -srcPos;
            this.buffer.copy(output, outputOffset, this.windowSize + srcPos, this.windowSize);
            this.buffer.copy(output, outputOffset + firstPart, 0, count - firstPart);
        } else {
            this.buffer.copy(output, outputOffset, srcPos, srcPos + count);
        }
    }
    constructor(sink){
        this.buffer = allocBufferUnsafe(0); // Replaced by create() before use
        this.windowSize = 0;
        this.pos = 0;
        this.sink = sink;
        this.streamPos = 0;
    }
};
/**
 * Synchronous LZMA1 decoder
 */ class LzmaDecoder {
    /**
   * Set dictionary size
   */ setDictionarySize(dictionarySize) {
        if (dictionarySize < 0) return false;
        if (this.dictionarySize !== dictionarySize) {
            this.dictionarySize = dictionarySize;
            this.dictionarySizeCheck = Math.max(dictionarySize, 1);
            this.outWindow.create(Math.max(this.dictionarySizeCheck, 1 << 12));
        }
        return true;
    }
    /**
   * Set lc, lp, pb properties
   */ setLcLpPb(lc, lp, pb) {
        if (lc > kNumLitContextBitsMax || lp > 4 || pb > kNumPosStatesBitsMax) {
            return false;
        }
        const numPosStates = 1 << pb;
        this.literalDecoder.create(lp, lc);
        this.lenDecoder.create(numPosStates);
        this.repLenDecoder.create(numPosStates);
        this.posStateMask = numPosStates - 1;
        return true;
    }
    /**
   * Set decoder properties from 5-byte buffer
   */ setDecoderProperties(properties) {
        const props = parseProperties(properties);
        if (!this.setLcLpPb(props.lc, props.lp, props.pb)) return false;
        return this.setDictionarySize(props.dictionarySize);
    }
    /**
   * Initialize probability tables
   */ initProbabilities() {
        initBitModels(this.isMatchDecoders);
        initBitModels(this.isRepDecoders);
        initBitModels(this.isRepG0Decoders);
        initBitModels(this.isRepG1Decoders);
        initBitModels(this.isRepG2Decoders);
        initBitModels(this.isRep0LongDecoders);
        initBitModels(this.posDecoders);
        this.literalDecoder.init();
        for(let i = kNumLenToPosStates - 1; i >= 0; i--){
            this.posSlotDecoder[i].init();
        }
        this.lenDecoder.init();
        this.repLenDecoder.init();
        this.posAlignDecoder.init();
    }
    /**
   * Reset probabilities only (for LZMA2 state reset)
   */ resetProbabilities() {
        this.initProbabilities();
        this.state = 0;
        this.rep0 = 0;
        this.rep1 = 0;
        this.rep2 = 0;
        this.rep3 = 0;
    }
    /**
   * Reset dictionary position (for LZMA2 dictionary reset)
   */ resetDictionary() {
        this.outWindow.init(false);
        this.totalPos = 0;
    }
    /**
   * Feed uncompressed data into the dictionary (for LZMA2 uncompressed chunks)
   * This updates the sliding window so subsequent LZMA chunks can reference this data.
   */ feedUncompressed(data) {
        for(let i = 0; i < data.length; i++){
            this.outWindow.putByte(data[i]);
        }
        this.totalPos += data.length;
        if (data.length > 0) {
            this.prevByte = data[data.length - 1];
        }
    }
    /**
   * Flush any remaining data in the OutWindow to the sink
   */ flushOutWindow() {
        this.outWindow.flush();
    }
    /**
   * Decode LZMA data with streaming output (no buffer accumulation)
   * @param input - Compressed input buffer or BufferList
   * @param inputOffset - Offset into input buffer
   * @param outSize - Expected output size
   * @param solid - If true, preserve state from previous decode
   * @returns Number of bytes written to sink
   */ decodeWithSink(input, inputOffset, outSize, solid = false) {
        this.rangeDecoder.setInput(input, inputOffset);
        if (!solid) {
            this.outWindow.init(false);
            this.initProbabilities();
            this.state = 0;
            this.rep0 = 0;
            this.rep1 = 0;
            this.rep2 = 0;
            this.rep3 = 0;
            this.prevByte = 0;
            this.totalPos = 0;
        } else {
            this.outWindow.init(true);
        }
        let outPos = 0;
        let cumPos = this.totalPos;
        while(outPos < outSize){
            const posState = cumPos & this.posStateMask;
            if (this.rangeDecoder.decodeBit(this.isMatchDecoders, (this.state << kNumPosStatesBitsMax) + posState) === 0) {
                // Literal
                const decoder2 = this.literalDecoder.getDecoder(cumPos, this.prevByte);
                if (!stateIsCharState(this.state)) {
                    this.prevByte = decoder2.decodeWithMatchByte(this.rangeDecoder, this.outWindow.getByte(this.rep0));
                } else {
                    this.prevByte = decoder2.decodeNormal(this.rangeDecoder);
                }
                this.outWindow.putByte(this.prevByte);
                outPos++;
                this.state = stateUpdateChar(this.state);
                cumPos++;
            } else {
                // Match or rep
                let len;
                if (this.rangeDecoder.decodeBit(this.isRepDecoders, this.state) === 1) {
                    // Rep match
                    len = 0;
                    if (this.rangeDecoder.decodeBit(this.isRepG0Decoders, this.state) === 0) {
                        if (this.rangeDecoder.decodeBit(this.isRep0LongDecoders, (this.state << kNumPosStatesBitsMax) + posState) === 0) {
                            this.state = stateUpdateShortRep(this.state);
                            len = 1;
                        }
                    } else {
                        let distance;
                        if (this.rangeDecoder.decodeBit(this.isRepG1Decoders, this.state) === 0) {
                            distance = this.rep1;
                        } else {
                            if (this.rangeDecoder.decodeBit(this.isRepG2Decoders, this.state) === 0) {
                                distance = this.rep2;
                            } else {
                                distance = this.rep3;
                                this.rep3 = this.rep2;
                            }
                            this.rep2 = this.rep1;
                        }
                        this.rep1 = this.rep0;
                        this.rep0 = distance;
                    }
                    if (len === 0) {
                        len = kMatchMinLen + this.repLenDecoder.decode(this.rangeDecoder, posState);
                        this.state = stateUpdateRep(this.state);
                    }
                } else {
                    // Normal match
                    this.rep3 = this.rep2;
                    this.rep2 = this.rep1;
                    this.rep1 = this.rep0;
                    len = kMatchMinLen + this.lenDecoder.decode(this.rangeDecoder, posState);
                    this.state = stateUpdateMatch(this.state);
                    const posSlot = this.posSlotDecoder[getLenToPosState(len)].decode(this.rangeDecoder);
                    if (posSlot >= kStartPosModelIndex) {
                        const numDirectBits = (posSlot >> 1) - 1;
                        this.rep0 = (2 | posSlot & 1) << numDirectBits;
                        if (posSlot < kEndPosModelIndex) {
                            this.rep0 += reverseDecodeFromArray(this.posDecoders, this.rep0 - posSlot - 1, this.rangeDecoder, numDirectBits);
                        } else {
                            this.rep0 += this.rangeDecoder.decodeDirectBits(numDirectBits - kNumAlignBits) << kNumAlignBits;
                            this.rep0 += this.posAlignDecoder.reverseDecode(this.rangeDecoder);
                            if (this.rep0 < 0) {
                                if (this.rep0 === -1) break;
                                throw new Error('LZMA: Invalid distance');
                            }
                        }
                    } else {
                        this.rep0 = posSlot;
                    }
                }
                if (this.rep0 >= cumPos || this.rep0 >= this.dictionarySizeCheck) {
                    throw new Error('LZMA: Invalid distance');
                }
                // Copy match bytes
                for(let i = 0; i < len; i++){
                    const b = this.outWindow.getByte(this.rep0);
                    this.outWindow.putByte(b);
                    outPos++;
                }
                cumPos += len;
                this.prevByte = this.outWindow.getByte(0);
            }
        }
        this.totalPos = cumPos;
        return outPos;
    }
    /**
   * Decode LZMA data directly into caller's buffer (zero-copy)
   * @param input - Compressed input buffer or BufferList
   * @param inputOffset - Offset into input buffer
   * @param outSize - Expected output size
   * @param output - Pre-allocated output buffer to write to
   * @param outputOffset - Offset in output buffer to start writing
   * @param solid - If true, preserve state from previous decode
   * @returns Number of bytes written
   */ decodeToBuffer(input, inputOffset, outSize, output, outputOffset, solid = false) {
        this.rangeDecoder.setInput(input, inputOffset);
        if (!solid) {
            this.outWindow.init(false);
            this.initProbabilities();
            this.state = 0;
            this.rep0 = 0;
            this.rep1 = 0;
            this.rep2 = 0;
            this.rep3 = 0;
            this.prevByte = 0;
            this.totalPos = 0;
        } else {
            // Solid mode: preserve dictionary state but reinitialize range decoder
            this.outWindow.init(true);
        }
        let outPos = outputOffset;
        const outEnd = outputOffset + outSize;
        let cumPos = this.totalPos;
        while(outPos < outEnd){
            const posState = cumPos & this.posStateMask;
            if (this.rangeDecoder.decodeBit(this.isMatchDecoders, (this.state << kNumPosStatesBitsMax) + posState) === 0) {
                // Literal
                const decoder2 = this.literalDecoder.getDecoder(cumPos, this.prevByte);
                if (!stateIsCharState(this.state)) {
                    this.prevByte = decoder2.decodeWithMatchByte(this.rangeDecoder, this.outWindow.getByte(this.rep0));
                } else {
                    this.prevByte = decoder2.decodeNormal(this.rangeDecoder);
                }
                this.outWindow.putByte(this.prevByte);
                output[outPos++] = this.prevByte;
                this.state = stateUpdateChar(this.state);
                cumPos++;
            } else {
                // Match or rep
                let len;
                if (this.rangeDecoder.decodeBit(this.isRepDecoders, this.state) === 1) {
                    // Rep match
                    len = 0;
                    if (this.rangeDecoder.decodeBit(this.isRepG0Decoders, this.state) === 0) {
                        if (this.rangeDecoder.decodeBit(this.isRep0LongDecoders, (this.state << kNumPosStatesBitsMax) + posState) === 0) {
                            this.state = stateUpdateShortRep(this.state);
                            len = 1;
                        }
                    } else {
                        let distance;
                        if (this.rangeDecoder.decodeBit(this.isRepG1Decoders, this.state) === 0) {
                            distance = this.rep1;
                        } else {
                            if (this.rangeDecoder.decodeBit(this.isRepG2Decoders, this.state) === 0) {
                                distance = this.rep2;
                            } else {
                                distance = this.rep3;
                                this.rep3 = this.rep2;
                            }
                            this.rep2 = this.rep1;
                        }
                        this.rep1 = this.rep0;
                        this.rep0 = distance;
                    }
                    if (len === 0) {
                        len = kMatchMinLen + this.repLenDecoder.decode(this.rangeDecoder, posState);
                        this.state = stateUpdateRep(this.state);
                    }
                } else {
                    // Normal match
                    this.rep3 = this.rep2;
                    this.rep2 = this.rep1;
                    this.rep1 = this.rep0;
                    len = kMatchMinLen + this.lenDecoder.decode(this.rangeDecoder, posState);
                    this.state = stateUpdateMatch(this.state);
                    const posSlot = this.posSlotDecoder[getLenToPosState(len)].decode(this.rangeDecoder);
                    if (posSlot >= kStartPosModelIndex) {
                        const numDirectBits = (posSlot >> 1) - 1;
                        this.rep0 = (2 | posSlot & 1) << numDirectBits;
                        if (posSlot < kEndPosModelIndex) {
                            this.rep0 += reverseDecodeFromArray(this.posDecoders, this.rep0 - posSlot - 1, this.rangeDecoder, numDirectBits);
                        } else {
                            this.rep0 += this.rangeDecoder.decodeDirectBits(numDirectBits - kNumAlignBits) << kNumAlignBits;
                            this.rep0 += this.posAlignDecoder.reverseDecode(this.rangeDecoder);
                            if (this.rep0 < 0) {
                                if (this.rep0 === -1) break; // End marker
                                throw new Error('LZMA: Invalid distance');
                            }
                        }
                    } else {
                        this.rep0 = posSlot;
                    }
                }
                if (this.rep0 >= cumPos || this.rep0 >= this.dictionarySizeCheck) {
                    throw new Error('LZMA: Invalid distance');
                }
                // Copy match bytes
                for(let i = 0; i < len; i++){
                    const b = this.outWindow.getByte(this.rep0);
                    this.outWindow.putByte(b);
                    output[outPos++] = b;
                }
                cumPos += len;
                this.prevByte = this.outWindow.getByte(0);
            }
        }
        this.totalPos = cumPos;
        return outPos - outputOffset;
    }
    /**
   * Decode LZMA data
   * @param input - Compressed input buffer or BufferList
   * @param inputOffset - Offset into input buffer
   * @param outSize - Expected output size
   * @param solid - If true, preserve state from previous decode
   * @returns Decompressed data
   */ decode(input, inputOffset, outSize, solid = false) {
        const output = allocBufferUnsafe(outSize);
        this.decodeToBuffer(input, inputOffset, outSize, output, 0, solid);
        return output;
    }
    constructor(outputSink){
        this.outWindow = new OutWindow(outputSink);
        this.rangeDecoder = new RangeDecoder();
        this.isMatchDecoders = initBitModels(null, kNumStates << kNumPosStatesBitsMax);
        this.isRepDecoders = initBitModels(null, kNumStates);
        this.isRepG0Decoders = initBitModels(null, kNumStates);
        this.isRepG1Decoders = initBitModels(null, kNumStates);
        this.isRepG2Decoders = initBitModels(null, kNumStates);
        this.isRep0LongDecoders = initBitModels(null, kNumStates << kNumPosStatesBitsMax);
        this.posSlotDecoder = [];
        this.posDecoders = initBitModels(null, kNumFullDistances - kEndPosModelIndex);
        this.posAlignDecoder = new BitTreeDecoder(kNumAlignBits);
        this.lenDecoder = new LenDecoder();
        this.repLenDecoder = new LenDecoder();
        this.literalDecoder = new LiteralDecoder();
        for(let i = 0; i < kNumLenToPosStates; i++){
            this.posSlotDecoder[i] = new BitTreeDecoder(kNumPosSlotBits);
        }
        this.dictionarySize = -1;
        this.dictionarySizeCheck = -1;
        this.posStateMask = 0;
        this.state = 0;
        this.rep0 = 0;
        this.rep1 = 0;
        this.rep2 = 0;
        this.rep3 = 0;
        this.prevByte = 0;
        this.totalPos = 0;
    }
}
/**
 * Decode LZMA1 data synchronously
 *
 * Note: LZMA1 is a low-level format. Native bindings (lzma-native) expect
 * self-describing data (like XZ), but here we accept raw LZMA with properties
 * specified separately. Pure JS implementation is used for LZMA1.
 *
 * @param input - Compressed data (without 5-byte properties header) or BufferList
 * @param properties - 5-byte LZMA properties
 * @param outSize - Expected output size
 * @param outputSink - Optional output sink with write callback for streaming (returns bytes written)
 * @returns Decompressed data (or bytes written if outputSink provided)
 */ function decodeLzma(input, properties, outSize, outputSink) {
    const decoder = new LzmaDecoder(outputSink);
    decoder.setDecoderProperties(properties);
    if (outputSink) {
        // Zero-copy mode: write to sink during decode
        const bytesWritten = decoder.decodeWithSink(input, 0, outSize, false);
        decoder.flushOutWindow();
        return bytesWritten;
    }
    // Buffering mode: pre-allocated buffer, direct writes (zero-copy)
    return decoder.decode(input, 0, outSize, false);
}

return {LzmaDecoder,decodeLzma};
})();
  const lzma2=(()=>{
const {kNumRepDistances,kNumStates,kNumPosSlotBits,kDicLogSizeMin,kNumLenToPosStatesBits,kNumLenToPosStates,kMatchMinLen,kNumLowLenBits,kNumMidLenBits,kNumHighLenBits,kNumLowLenSymbols,kNumMidLenSymbols,kNumLenSymbols,kMatchMaxLen,kNumAlignBits,kAlignTableSize,kAlignMask,kStartPosModelIndex,kEndPosModelIndex,kNumPosModels,kNumFullDistances,kNumLitPosStatesBitsEncodingMax,kNumLitContextBitsMax,kNumPosStatesBitsMax,kNumPosStatesMax,kNumPosStatesBitsEncodingMax,kNumPosStatesEncodingMax,kNumBitModelTotalBits,kBitModelTotal,kNumMoveBits,kProbInitValue,stateUpdateChar,stateUpdateMatch,stateUpdateRep,stateUpdateShortRep,stateIsCharState,getLenToPosState,initBitModels,parseProperties,LZMA2_CONTROL,lzma2NeedsNewProps,lzma2NeedsResetProbs,lzma2IsUncompressed,parseLzma2DictionarySize}=types;
const {parseLzma2ChunkHeader,hasCompleteChunk}=chunks;
const {LzmaDecoder,decodeLzma}=lzma;
/**
 * Synchronous LZMA2 Decoder
 *
 * LZMA2 is a container format that wraps LZMA chunks with framing.
 * Decodes LZMA2 data from a buffer or BufferList.
 */ 



/**
 * Read multiple bytes from BufferLike into a Buffer
 */ function readBytes(input, offset, length) {
    if (Buffer.isBuffer(input)) {
        return input.slice(offset, offset + length);
    }
    // For BufferList, create a new Buffer with the data
    const buf = bufferFrom(new Array(length));
    for(let i = 0; i < length; i++){
        buf[i] = input.readByte(offset + i);
    }
    return buf;
}
/**
 * Synchronous LZMA2 decoder
 */ class Lzma2Decoder {
    /**
   * Reset the dictionary (for stream boundaries)
   */ resetDictionary() {
        this.lzmaDecoder.resetDictionary();
    }
    /**
   * Reset all probability models (for stream boundaries)
   */ resetProbabilities() {
        this.lzmaDecoder.resetProbabilities();
    }
    /**
   * Set LZMA properties
   */ setLcLpPb(lc, lp, pb) {
        return this.lzmaDecoder.setLcLpPb(lc, lp, pb);
    }
    /**
   * Feed uncompressed data to the dictionary (for subsequent LZMA chunks)
   */ feedUncompressed(data) {
        this.lzmaDecoder.feedUncompressed(data);
    }
    /**
   * Decode raw LZMA data (used internally for LZMA2 chunks)
   * @param input - LZMA compressed data
   * @param offset - Input offset
   * @param outSize - Expected output size
   * @param solid - Use solid mode
   * @returns Decompressed data
   */ decodeLzmaData(input, offset, outSize, solid = false) {
        return this.lzmaDecoder.decode(input, offset, outSize, solid);
    }
    /**
   * Decode LZMA2 data with streaming output
   * @param input - LZMA2 compressed data (Buffer or BufferList)
   * @returns Total number of bytes written to sink
   */ decodeWithSink(input) {
        let totalBytes = 0;
        let offset = 0;
        while(true){
            const result = parseLzma2ChunkHeader(input, offset);
            if (!result.success) {
                throw new Error('Truncated LZMA2 chunk header');
            }
            const chunk = result.chunk;
            if (chunk.type === 'end') {
                break;
            }
            // The first chunk of a stream must reset the dictionary
            if (offset === 0 && !chunk.dictReset) {
                throw new Error('First LZMA2 chunk must reset the dictionary');
            }
            // Handle dictionary reset
            if (chunk.dictReset) {
                this.lzmaDecoder.resetDictionary();
            }
            // Handle state reset
            if (chunk.stateReset) {
                this.lzmaDecoder.resetProbabilities();
            }
            // Apply new properties if present
            if (chunk.newProps) {
                const { lc, lp, pb } = chunk.newProps;
                this.lzmaDecoder.setLcLpPb(lc, lp, pb);
            }
            const dataOffset = offset + chunk.headerSize;
            const useSolid = !chunk.stateReset || chunk.stateReset && !chunk.dictReset;
            if (chunk.type === 'uncompressed') {
                // Read uncompressed data directly
                const uncompData = readBytes(input, dataOffset, chunk.uncompSize);
                // Feed uncompressed data to dictionary so subsequent LZMA chunks can reference it
                this.lzmaDecoder.feedUncompressed(uncompData);
                totalBytes += uncompData.length;
                offset = dataOffset + chunk.uncompSize;
            } else {
                // LZMA compressed chunk - decode directly from BufferLike
                totalBytes += this.lzmaDecoder.decodeWithSink(input, dataOffset, chunk.uncompSize, useSolid);
                offset = dataOffset + chunk.compSize;
            }
        }
        // Flush any remaining data in the OutWindow
        this.lzmaDecoder.flushOutWindow();
        return totalBytes;
    }
    /**
   * Decode LZMA2 data
   * @param input - LZMA2 compressed data (Buffer or BufferList)
   * @param unpackSize - Expected output size (optional, for pre-allocation)
   * @returns Decompressed data
   */ decode(input, unpackSize) {
        // Pre-allocate output buffer if size is known and safe for this Node version
        let outputBuffer = null;
        let outputPos = 0;
        const outputChunks = [];
        // Use canAllocateBufferSize to dynamically check if pre-allocation is safe
        const canPreAllocate = unpackSize && unpackSize > 0 && canAllocateBufferSize(unpackSize);
        if (canPreAllocate) {
            outputBuffer = allocBufferUnsafe(unpackSize);
        }
        let offset = 0;
        // Parse and decode LZMA2 chunks one at a time
        while(true){
            const result = parseLzma2ChunkHeader(input, offset);
            if (!result.success) {
                throw new Error('Truncated LZMA2 chunk header');
            }
            const chunk = result.chunk;
            if (chunk.type === 'end') {
                break;
            }
            // The first chunk of a stream must reset the dictionary
            if (offset === 0 && !chunk.dictReset) {
                throw new Error('First LZMA2 chunk must reset the dictionary');
            }
            const dataOffset = offset + chunk.headerSize;
            // Handle dictionary reset
            if (chunk.dictReset) {
                this.lzmaDecoder.resetDictionary();
            }
            // Handle state reset
            if (chunk.stateReset) {
                this.lzmaDecoder.resetProbabilities();
            }
            // Apply new properties if present
            if (chunk.newProps) {
                const { lc, lp, pb } = chunk.newProps;
                this.lzmaDecoder.setLcLpPb(lc, lp, pb);
            }
            // Determine solid mode
            const useSolid = !chunk.stateReset || chunk.stateReset && !chunk.dictReset;
            if (chunk.type === 'uncompressed') {
                // Read uncompressed data
                const uncompData = readBytes(input, dataOffset, chunk.uncompSize);
                // Copy to output
                if (outputBuffer) {
                    uncompData.copy(outputBuffer, outputPos);
                    outputPos += uncompData.length;
                } else {
                    outputChunks.push(uncompData);
                }
                // Feed uncompressed data to dictionary so subsequent LZMA chunks can reference it
                this.lzmaDecoder.feedUncompressed(uncompData);
                offset = dataOffset + chunk.uncompSize;
            } else {
                // LZMA compressed chunk - decode directly from BufferLike
                if (outputBuffer) {
                    // Zero-copy: decode directly into caller's buffer
                    // Bound the range reader to this declared compressed chunk.
                    const chunkData = input.subarray(dataOffset, dataOffset + chunk.compSize);
                    const bytesWritten = this.lzmaDecoder.decodeToBuffer(chunkData, 0, chunk.uncompSize, outputBuffer, outputPos, useSolid);
                    if (bytesWritten !== chunk.uncompSize || this.lzmaDecoder.rangeDecoder.getPosition() !== chunk.compSize || (this.lzmaDecoder.rangeDecoder.code >>> 0) !== 0) throw new Error('LZMA2: Compressed chunk size or range state mismatch');
                    outputPos += bytesWritten;
                } else {
                    // No pre-allocation: decode to new buffer and collect chunks
                    const chunkData = readBytes(input, dataOffset, chunk.compSize);
                    const decoded = this.lzmaDecoder.decode(chunkData, 0, chunk.uncompSize, useSolid);
                    outputChunks.push(decoded);
                }
                offset = dataOffset + chunk.compSize;
            }
        }
        // Return pre-allocated buffer or concatenated chunks
        if (outputBuffer) {
            return outputPos < outputBuffer.length ? outputBuffer.slice(0, outputPos) : outputBuffer;
        }
        // Use bufferConcat which handles large buffers safely via pairwise combination
        return bufferConcat(outputChunks);
    }
    constructor(properties, outputSink){
        if (!properties || properties.length < 1) {
            throw new Error('LZMA2 requires properties byte');
        }
        this.dictionarySize = parseLzma2DictionarySize(properties[0]);
        this.lzmaDecoder = new LzmaDecoder(outputSink);
        this.lzmaDecoder.setDictionarySize(this.dictionarySize);
    }
}
/**
 * Decode LZMA2 data synchronously
 * @param input - LZMA2 compressed data (Buffer or BufferList)
 * @param properties - 1-byte properties (dictionary size)
 * @param unpackSize - Expected output size (optional, autodetects if not provided)
 * @param outputSink - Optional output sink with write callback for streaming (returns bytes written)
 * @returns Decompressed data (or bytes written if outputSink provided)
 */ function decodeLzma2(input, properties, unpackSize, outputSink) {
    // For very large outputs on old Node versions, we cannot return a single Buffer
    // Use streaming mode internally to handle large outputs on modern Node
    if (!outputSink && unpackSize && unpackSize > 0 && !canAllocateBufferSize(unpackSize)) {
        // Large output - use streaming mode with internal chunking
        const chunks = [];
        const sink = {
            write (buffer) {
                chunks.push(buffer);
            }
        };
        const decoder = new Lzma2Decoder(properties, sink);
        decoder.decodeWithSink(input);
        // Combine chunks at the end - use bufferConcat for safe combination
        return bufferConcat(chunks);
    }
    const decoder = new Lzma2Decoder(properties, outputSink);
    if (outputSink) {
        // Zero-copy mode: write to sink during decode
        return decoder.decodeWithSink(input);
    }
    // Buffering mode: returns Buffer (zero-copy)
    return decoder.decode(input, unpackSize);
}

return {Lzma2Decoder,decodeLzma2};
})();
return function decodeLzma2(input,property,expectedBytes) {
if(!(input instanceof Uint8Array)||!Number.isInteger(property)||property<0||property>40||!Number.isSafeInteger(expectedBytes)||expectedBytes<0||expectedBytes>maxOutputBytes)throw Error("Invalid LZMA2 input or output size");
const dictionary=property===40?0xffffffff:(2|(property&1))*Math.pow(2,(property>>>1)+11);
if(dictionary>maxDictionaryBytes)throw Error("LZMA2 dictionary exceeds maxDictionaryBytes");
let cursor=0,decoded=0,ended=false;
while(cursor<input.length){const control=input[cursor++];if(control===0){ended=true;break;}let unpacked,packed,header;
if(control===1||control===2){if(cursor+2>input.length)throw Error("Truncated LZMA2 chunk");unpacked=(input[cursor]*256+input[cursor+1])+1;packed=unpacked;header=2;}
else if(control>=128){header=control>=192?5:4;if(cursor+header>input.length)throw Error("Truncated LZMA2 chunk");unpacked=(control&31)*65536+input[cursor]*256+input[cursor+1]+1;packed=input[cursor+2]*256+input[cursor+3]+1;}
else throw Error("Unsupported LZMA2 control");
if(control>=128&&(packed<5||input[cursor+header]!==0))throw Error("Invalid LZMA2 range initializer");
decoded+=unpacked;if(decoded>expectedBytes)throw Error("LZMA2 chunk output exceeds declared size");cursor+=header+packed;if(cursor>input.length)throw Error("Truncated LZMA2 chunk payload");}
if(!ended||cursor!==input.length||decoded!==expectedBytes)throw Error("LZMA2 chunk inventory mismatch");
const out=lzma2.decodeLzma2(new Bytes(input),new Bytes([property]),expectedBytes);
if(!(out instanceof Uint8Array)||out.length!==expectedBytes)throw Error("LZMA2 decoded size mismatch");return out;
};
}
