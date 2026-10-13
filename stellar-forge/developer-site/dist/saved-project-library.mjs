// MIT. Complete shared-draft inventory, receiving and selective recovery.
import {listDrafts,loadDraft,saveDraft,projectDraftRecords,commitDraftRecords} from './drafts.mjs';

export const MAX_ARCHIVE_BYTES=256*1024*1024;
export const MAX_RECORDS=5000;
const ARCHIVE='stellar-forge.saved-project-archive.v1';
const BODY='stellar-forge.saved-project-archive-body.v1';
const JOURNAL='stellar-forge.saved-project-receipt.v1';
const WORK='stellar-forge.saved-project-working.v1';
const PREFIX='draft-library-journal:';
const WORK_PREFIX='draft-library-working:';
const SCOPE='The original shared Stellar Forge drafts store. Separate companion-reader and Source Desk stores are outside this archive.';
const enc=new TextEncoder();
// Reuse the retained upstream implementation on TextEncoder's actual bytes.
// It is synchronous so a record can be hashed within the original IDB cursor
// without letting the transaction auto-commit during an asynchronous digest.
const savedRecordDigest=(()=>{
  const module={exports:{}};
/**
 * Strict UTF-8 SHA-256 for retained complete text, with no runtime imports.
 *
 * Bundled upstream: emn178/js-sha256 1.0.0, build/sha256.cjs
 * Commit: 9a54fb31d4594762987e1b5d175265f6bac921de
 * Upstream blob: e3a08633357cb7ca248e14751f9270d95fbbbdf2
 * The upstream source between the markers is unchanged.
 *
 * Upstream license:
 * Copyright (c) 2014-2026 Chen, Yi-Cyuan
 * 
 * MIT License
 * 
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 * 
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// BEGIN UNCHANGED UPSTREAM SOURCE
/**
 * [js-sha256]{@link https://github.com/emn178/js-sha256}
 *
 * @version 1.0.0
 * @author Chen, Yi-Cyuan [emn178@gmail.com]
 * @copyright Chen, Yi-Cyuan 2014-2026
 * @license MIT
 */
'use strict';

var INPUT_ERROR = 'input is invalid type';
var FINALIZE_ERROR = 'finalize already called';

var ARRAY_BUFFER = typeof ArrayBuffer !== 'undefined';

var formatMessage = function (message) {
  var type = typeof message;
  if (type === 'string') {
    return [message, true];
  }
  if (Array.isArray(message)) {
    return [message, false];
  }
  if (ARRAY_BUFFER && message) {
    if (message.constructor === ArrayBuffer) {
      return [new Uint8Array(message), false];
    } else if (ArrayBuffer.isView(message)) {
      return [message, false];
    }
  }
  throw new Error(INPUT_ERROR);
};

var HEX_CHARS = '0123456789abcdef'.split('');
var EXTRA = [-2147483648, 8388608, 32768, 128];
var SHIFT = [24, 16, 8, 0];
var K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
var OUTPUT_TYPES = ['hex', 'array', 'digest', 'arrayBuffer'];

var blocks = [];

var createOutputMethod = function (outputType, is224) {
  return function (message) {
    return new Sha256(is224, true).update(message)[outputType]();
  };
};

var createMethod = function (is224) {
  var method = createOutputMethod('hex', is224);
  method.create = function () {
    return new Sha256(is224);
  };
  method.update = function (message) {
    return method.create().update(message);
  };
  for (var i = 0; i < OUTPUT_TYPES.length; ++i) {
    var type = OUTPUT_TYPES[i];
    method[type] = createOutputMethod(type, is224);
  }
  return method;
};

var createHmacOutputMethod = function (outputType, is224) {
  return function (key, message) {
    return new HmacSha256(key, is224, true).update(message)[outputType]();
  };
};

var createHmacMethod = function (is224) {
  var method = createHmacOutputMethod('hex', is224);
  method.create = function (key) {
    return new HmacSha256(key, is224);
  };
  method.update = function (key, message) {
    return method.create(key).update(message);
  };
  for (var i = 0; i < OUTPUT_TYPES.length; ++i) {
    var type = OUTPUT_TYPES[i];
    method[type] = createHmacOutputMethod(type, is224);
  }
  return method;
};

function Sha256(is224, sharedMemory) {
  if (sharedMemory) {
    blocks[0] = blocks[16] = blocks[1] = blocks[2] = blocks[3] =
      blocks[4] = blocks[5] = blocks[6] = blocks[7] =
      blocks[8] = blocks[9] = blocks[10] = blocks[11] =
      blocks[12] = blocks[13] = blocks[14] = blocks[15] = 0;
    this.blocks = blocks;
  } else {
    this.blocks = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }

  if (is224) {
    this.h0 = 0xc1059ed8;
    this.h1 = 0x367cd507;
    this.h2 = 0x3070dd17;
    this.h3 = 0xf70e5939;
    this.h4 = 0xffc00b31;
    this.h5 = 0x68581511;
    this.h6 = 0x64f98fa7;
    this.h7 = 0xbefa4fa4;
  } else { // 256
    this.h0 = 0x6a09e667;
    this.h1 = 0xbb67ae85;
    this.h2 = 0x3c6ef372;
    this.h3 = 0xa54ff53a;
    this.h4 = 0x510e527f;
    this.h5 = 0x9b05688c;
    this.h6 = 0x1f83d9ab;
    this.h7 = 0x5be0cd19;
  }

  this.block = this.start = this.bytes = this.hBytes = 0;
  this.finalized = this.hashed = false;
  this.first = true;
  this.is224 = is224;
}

Sha256.prototype.update = function (message) {
  if (this.finalized) {
    throw new Error(FINALIZE_ERROR);
  }
  var result = formatMessage(message);
  message = result[0];
  var isString = result[1];
  var code, index = 0, i, length = message.length, blocks = this.blocks;
  while (index < length) {
    if (this.hashed) {
      this.hashed = false;
      blocks[0] = this.block;
      this.block = blocks[16] = blocks[1] = blocks[2] = blocks[3] =
        blocks[4] = blocks[5] = blocks[6] = blocks[7] =
        blocks[8] = blocks[9] = blocks[10] = blocks[11] =
        blocks[12] = blocks[13] = blocks[14] = blocks[15] = 0;
    }

    if (isString) {
      for (i = this.start; index < length && i < 64; ++index) {
        code = message.charCodeAt(index);
        if (code < 0x80) {
          blocks[i >>> 2] |= code << SHIFT[i++ & 3];
        } else if (code < 0x800) {
          blocks[i >>> 2] |= (0xc0 | (code >>> 6)) << SHIFT[i++ & 3];
          blocks[i >>> 2] |= (0x80 | (code & 0x3f)) << SHIFT[i++ & 3];
        } else if (code < 0xd800 || code >= 0xe000) {
          blocks[i >>> 2] |= (0xe0 | (code >>> 12)) << SHIFT[i++ & 3];
          blocks[i >>> 2] |= (0x80 | ((code >>> 6) & 0x3f)) << SHIFT[i++ & 3];
          blocks[i >>> 2] |= (0x80 | (code & 0x3f)) << SHIFT[i++ & 3];
        } else {
          code = 0x10000 + (((code & 0x3ff) << 10) | (message.charCodeAt(++index) & 0x3ff));
          blocks[i >>> 2] |= (0xf0 | (code >>> 18)) << SHIFT[i++ & 3];
          blocks[i >>> 2] |= (0x80 | ((code >>> 12) & 0x3f)) << SHIFT[i++ & 3];
          blocks[i >>> 2] |= (0x80 | ((code >>> 6) & 0x3f)) << SHIFT[i++ & 3];
          blocks[i >>> 2] |= (0x80 | (code & 0x3f)) << SHIFT[i++ & 3];
        }
      }
    } else {
      for (i = this.start; index < length && i < 64; ++index) {
        blocks[i >>> 2] |= message[index] << SHIFT[i++ & 3];
      }
    }

    this.lastByteIndex = i;
    this.bytes += i - this.start;
    if (i >= 64) {
      this.block = blocks[16];
      this.start = i - 64;
      this.hash();
      this.hashed = true;
    } else {
      this.start = i;
    }
  }
  if (this.bytes > 4294967295) {
    this.hBytes += this.bytes / 4294967296 << 0;
    this.bytes = this.bytes % 4294967296;
  }
  return this;
};

Sha256.prototype.finalize = function () {
  if (this.finalized) {
    return;
  }
  this.finalized = true;
  var blocks = this.blocks, i = this.lastByteIndex;
  blocks[16] = this.block;
  blocks[i >>> 2] |= EXTRA[i & 3];
  this.block = blocks[16];
  if (i >= 56) {
    if (!this.hashed) {
      this.hash();
    }
    blocks[0] = this.block;
    blocks[16] = blocks[1] = blocks[2] = blocks[3] =
      blocks[4] = blocks[5] = blocks[6] = blocks[7] =
      blocks[8] = blocks[9] = blocks[10] = blocks[11] =
      blocks[12] = blocks[13] = blocks[14] = blocks[15] = 0;
  }
  blocks[14] = this.hBytes << 3 | this.bytes >>> 29;
  blocks[15] = this.bytes << 3;
  this.hash();
};

Sha256.prototype.hash = function () {
  var a = this.h0, b = this.h1, c = this.h2, d = this.h3, e = this.h4, f = this.h5, g = this.h6,
    h = this.h7, blocks = this.blocks, j, s0, s1, maj, t1, t2, ch, ab, da, cd, bc;

  for (j = 16; j < 64; ++j) {
    // rightrotate
    t1 = blocks[j - 15];
    s0 = ((t1 >>> 7) | (t1 << 25)) ^ ((t1 >>> 18) | (t1 << 14)) ^ (t1 >>> 3);
    t1 = blocks[j - 2];
    s1 = ((t1 >>> 17) | (t1 << 15)) ^ ((t1 >>> 19) | (t1 << 13)) ^ (t1 >>> 10);
    blocks[j] = blocks[j - 16] + s0 + blocks[j - 7] + s1 << 0;
  }

  bc = b & c;
  for (j = 0; j < 64; j += 4) {
    if (this.first) {
      if (this.is224) {
        ab = 300032;
        t1 = blocks[0] - 1413257819;
        h = t1 - 150054599 << 0;
        d = t1 + 24177077 << 0;
      } else {
        ab = 704751109;
        t1 = blocks[0] - 210244248;
        h = t1 - 1521486534 << 0;
        d = t1 + 143694565 << 0;
      }
      this.first = false;
    } else {
      s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      ab = a & b;
      maj = ab ^ (a & c) ^ bc;
      ch = (e & f) ^ (~e & g);
      t1 = h + s1 + ch + K[j] + blocks[j];
      t2 = s0 + maj;
      h = d + t1 << 0;
      d = t1 + t2 << 0;
    }
    s0 = ((d >>> 2) | (d << 30)) ^ ((d >>> 13) | (d << 19)) ^ ((d >>> 22) | (d << 10));
    s1 = ((h >>> 6) | (h << 26)) ^ ((h >>> 11) | (h << 21)) ^ ((h >>> 25) | (h << 7));
    da = d & a;
    maj = da ^ (d & b) ^ ab;
    ch = (h & e) ^ (~h & f);
    t1 = g + s1 + ch + K[j + 1] + blocks[j + 1];
    t2 = s0 + maj;
    g = c + t1 << 0;
    c = t1 + t2 << 0;
    s0 = ((c >>> 2) | (c << 30)) ^ ((c >>> 13) | (c << 19)) ^ ((c >>> 22) | (c << 10));
    s1 = ((g >>> 6) | (g << 26)) ^ ((g >>> 11) | (g << 21)) ^ ((g >>> 25) | (g << 7));
    cd = c & d;
    maj = cd ^ (c & a) ^ da;
    ch = (g & h) ^ (~g & e);
    t1 = f + s1 + ch + K[j + 2] + blocks[j + 2];
    t2 = s0 + maj;
    f = b + t1 << 0;
    b = t1 + t2 << 0;
    s0 = ((b >>> 2) | (b << 30)) ^ ((b >>> 13) | (b << 19)) ^ ((b >>> 22) | (b << 10));
    s1 = ((f >>> 6) | (f << 26)) ^ ((f >>> 11) | (f << 21)) ^ ((f >>> 25) | (f << 7));
    bc = b & c;
    maj = bc ^ (b & d) ^ cd;
    ch = (f & g) ^ (~f & h);
    t1 = e + s1 + ch + K[j + 3] + blocks[j + 3];
    t2 = s0 + maj;
    e = a + t1 << 0;
    a = t1 + t2 << 0;
    this.chromeBugWorkAround = true;
  }

  this.h0 = this.h0 + a << 0;
  this.h1 = this.h1 + b << 0;
  this.h2 = this.h2 + c << 0;
  this.h3 = this.h3 + d << 0;
  this.h4 = this.h4 + e << 0;
  this.h5 = this.h5 + f << 0;
  this.h6 = this.h6 + g << 0;
  this.h7 = this.h7 + h << 0;
};

Sha256.prototype.hex = function () {
  this.finalize();

  var h0 = this.h0, h1 = this.h1, h2 = this.h2, h3 = this.h3, h4 = this.h4, h5 = this.h5,
    h6 = this.h6, h7 = this.h7;

  var hex = HEX_CHARS[(h0 >>> 28) & 0x0F] + HEX_CHARS[(h0 >>> 24) & 0x0F] +
    HEX_CHARS[(h0 >>> 20) & 0x0F] + HEX_CHARS[(h0 >>> 16) & 0x0F] +
    HEX_CHARS[(h0 >>> 12) & 0x0F] + HEX_CHARS[(h0 >>> 8) & 0x0F] +
    HEX_CHARS[(h0 >>> 4) & 0x0F] + HEX_CHARS[h0 & 0x0F] +
    HEX_CHARS[(h1 >>> 28) & 0x0F] + HEX_CHARS[(h1 >>> 24) & 0x0F] +
    HEX_CHARS[(h1 >>> 20) & 0x0F] + HEX_CHARS[(h1 >>> 16) & 0x0F] +
    HEX_CHARS[(h1 >>> 12) & 0x0F] + HEX_CHARS[(h1 >>> 8) & 0x0F] +
    HEX_CHARS[(h1 >>> 4) & 0x0F] + HEX_CHARS[h1 & 0x0F] +
    HEX_CHARS[(h2 >>> 28) & 0x0F] + HEX_CHARS[(h2 >>> 24) & 0x0F] +
    HEX_CHARS[(h2 >>> 20) & 0x0F] + HEX_CHARS[(h2 >>> 16) & 0x0F] +
    HEX_CHARS[(h2 >>> 12) & 0x0F] + HEX_CHARS[(h2 >>> 8) & 0x0F] +
    HEX_CHARS[(h2 >>> 4) & 0x0F] + HEX_CHARS[h2 & 0x0F] +
    HEX_CHARS[(h3 >>> 28) & 0x0F] + HEX_CHARS[(h3 >>> 24) & 0x0F] +
    HEX_CHARS[(h3 >>> 20) & 0x0F] + HEX_CHARS[(h3 >>> 16) & 0x0F] +
    HEX_CHARS[(h3 >>> 12) & 0x0F] + HEX_CHARS[(h3 >>> 8) & 0x0F] +
    HEX_CHARS[(h3 >>> 4) & 0x0F] + HEX_CHARS[h3 & 0x0F] +
    HEX_CHARS[(h4 >>> 28) & 0x0F] + HEX_CHARS[(h4 >>> 24) & 0x0F] +
    HEX_CHARS[(h4 >>> 20) & 0x0F] + HEX_CHARS[(h4 >>> 16) & 0x0F] +
    HEX_CHARS[(h4 >>> 12) & 0x0F] + HEX_CHARS[(h4 >>> 8) & 0x0F] +
    HEX_CHARS[(h4 >>> 4) & 0x0F] + HEX_CHARS[h4 & 0x0F] +
    HEX_CHARS[(h5 >>> 28) & 0x0F] + HEX_CHARS[(h5 >>> 24) & 0x0F] +
    HEX_CHARS[(h5 >>> 20) & 0x0F] + HEX_CHARS[(h5 >>> 16) & 0x0F] +
    HEX_CHARS[(h5 >>> 12) & 0x0F] + HEX_CHARS[(h5 >>> 8) & 0x0F] +
    HEX_CHARS[(h5 >>> 4) & 0x0F] + HEX_CHARS[h5 & 0x0F] +
    HEX_CHARS[(h6 >>> 28) & 0x0F] + HEX_CHARS[(h6 >>> 24) & 0x0F] +
    HEX_CHARS[(h6 >>> 20) & 0x0F] + HEX_CHARS[(h6 >>> 16) & 0x0F] +
    HEX_CHARS[(h6 >>> 12) & 0x0F] + HEX_CHARS[(h6 >>> 8) & 0x0F] +
    HEX_CHARS[(h6 >>> 4) & 0x0F] + HEX_CHARS[h6 & 0x0F];
  if (!this.is224) {
    hex += HEX_CHARS[(h7 >>> 28) & 0x0F] + HEX_CHARS[(h7 >>> 24) & 0x0F] +
      HEX_CHARS[(h7 >>> 20) & 0x0F] + HEX_CHARS[(h7 >>> 16) & 0x0F] +
      HEX_CHARS[(h7 >>> 12) & 0x0F] + HEX_CHARS[(h7 >>> 8) & 0x0F] +
      HEX_CHARS[(h7 >>> 4) & 0x0F] + HEX_CHARS[h7 & 0x0F];
  }
  return hex;
};

Sha256.prototype.toString = Sha256.prototype.hex;

Sha256.prototype.digest = function () {
  this.finalize();

  var h0 = this.h0, h1 = this.h1, h2 = this.h2, h3 = this.h3, h4 = this.h4, h5 = this.h5,
    h6 = this.h6, h7 = this.h7;

  var arr = [
    (h0 >>> 24) & 0xFF, (h0 >>> 16) & 0xFF, (h0 >>> 8) & 0xFF, h0 & 0xFF,
    (h1 >>> 24) & 0xFF, (h1 >>> 16) & 0xFF, (h1 >>> 8) & 0xFF, h1 & 0xFF,
    (h2 >>> 24) & 0xFF, (h2 >>> 16) & 0xFF, (h2 >>> 8) & 0xFF, h2 & 0xFF,
    (h3 >>> 24) & 0xFF, (h3 >>> 16) & 0xFF, (h3 >>> 8) & 0xFF, h3 & 0xFF,
    (h4 >>> 24) & 0xFF, (h4 >>> 16) & 0xFF, (h4 >>> 8) & 0xFF, h4 & 0xFF,
    (h5 >>> 24) & 0xFF, (h5 >>> 16) & 0xFF, (h5 >>> 8) & 0xFF, h5 & 0xFF,
    (h6 >>> 24) & 0xFF, (h6 >>> 16) & 0xFF, (h6 >>> 8) & 0xFF, h6 & 0xFF
  ];
  if (!this.is224) {
    arr.push((h7 >>> 24) & 0xFF, (h7 >>> 16) & 0xFF, (h7 >>> 8) & 0xFF, h7 & 0xFF);
  }
  return arr;
};

Sha256.prototype.array = Sha256.prototype.digest;

Sha256.prototype.arrayBuffer = function () {
  this.finalize();

  var buffer = new ArrayBuffer(this.is224 ? 28 : 32);
  var dataView = new DataView(buffer);
  dataView.setUint32(0, this.h0);
  dataView.setUint32(4, this.h1);
  dataView.setUint32(8, this.h2);
  dataView.setUint32(12, this.h3);
  dataView.setUint32(16, this.h4);
  dataView.setUint32(20, this.h5);
  dataView.setUint32(24, this.h6);
  if (!this.is224) {
    dataView.setUint32(28, this.h7);
  }
  return buffer;
};

function HmacSha256(key, is224, sharedMemory) {
  var i, result = formatMessage(key);
  key = result[0];
  if (result[1]) {
    var bytes = [], length = key.length, index = 0, code;
    for (i = 0; i < length; ++i) {
      code = key.charCodeAt(i);
      if (code < 0x80) {
        bytes[index++] = code;
      } else if (code < 0x800) {
        bytes[index++] = (0xc0 | (code >>> 6));
        bytes[index++] = (0x80 | (code & 0x3f));
      } else if (code < 0xd800 || code >= 0xe000) {
        bytes[index++] = (0xe0 | (code >>> 12));
        bytes[index++] = (0x80 | ((code >>> 6) & 0x3f));
        bytes[index++] = (0x80 | (code & 0x3f));
      } else {
        code = 0x10000 + (((code & 0x3ff) << 10) | (key.charCodeAt(++i) & 0x3ff));
        bytes[index++] = (0xf0 | (code >>> 18));
        bytes[index++] = (0x80 | ((code >>> 12) & 0x3f));
        bytes[index++] = (0x80 | ((code >>> 6) & 0x3f));
        bytes[index++] = (0x80 | (code & 0x3f));
      }
    }
    key = bytes;
  }

  if (key.length > 64) {
    key = (new Sha256(is224, true)).update(key).array();
  }

  var oKeyPad = [], iKeyPad = [];
  for (i = 0; i < 64; ++i) {
    var b = key[i] || 0;
    oKeyPad[i] = 0x5c ^ b;
    iKeyPad[i] = 0x36 ^ b;
  }

  Sha256.call(this, is224, sharedMemory);

  this.update(iKeyPad);
  this.oKeyPad = oKeyPad;
  this.inner = true;
  this.sharedMemory = sharedMemory;
}
HmacSha256.prototype = new Sha256();

HmacSha256.prototype.finalize = function () {
  Sha256.prototype.finalize.call(this);
  if (this.inner) {
    this.inner = false;
    var innerHash = this.array();
    Sha256.call(this, this.is224, this.sharedMemory);
    this.update(this.oKeyPad);
    this.update(innerHash);
    Sha256.prototype.finalize.call(this);
  }
};

var sha256 = createMethod();
var sha224 = createMethod(true);
sha256.sha256 = sha256;
sha256.sha224 = sha224;
sha256.hmac = createHmacMethod();
sha224.hmac = createHmacMethod(true);

module.exports = sha256;
// END UNCHANGED UPSTREAM SOURCE

const connectedSha256Upstream = module.exports;

/**
 * Hash a complete well-formed UTF-16 string as its exact UTF-8 content bytes.
 * No normalization, byte-order mark insertion, newline conversion or I/O.
 * @returns {{bytes: number, sha256: string}}
 */
function sha256Utf8(value) {
  if (typeof value !== 'string') throw new TypeError('sha256Utf8 requires a string');
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) throw new TypeError('Unpaired UTF-16 surrogate');
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  // A separate hasher owns its working state for each invocation.
  const sha256 = connectedSha256Upstream.create().update(value).hex();
  return {bytes, sha256};
}

/** Hash exact binary source bytes with the same maintained upstream implementation. */
function sha256Bytes(value) {
  if (!(value instanceof Uint8Array)) throw new TypeError('sha256Bytes requires a Uint8Array');
  return {bytes: value.byteLength,
    sha256: connectedSha256Upstream.create().update(value).hex()};
}

module.exports = {sha256Utf8, sha256Bytes};

  return module.exports.sha256Bytes;
})();

const clone=value=>structuredClone(value);
const need=(test,message)=>{if(!test)throw new Error(message);};
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const now=()=>new Date().toISOString();
const text=value=>JSON.stringify(value)+'\n';
const utf8=value=>enc.encode(value);
const cleanName=value=>(String(value||'saved-projects').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-|-$/g,'').slice(0,100)||'saved-projects');
async function sha(value){need(globalThis.crypto?.subtle,'Open this desk through HTTPS or the original loopback host.');return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?utf8(value):value)),x=>x.toString(16).padStart(2,'0')).join('');}
const key=(value,label='record ID')=>{need(typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\u0000-\u001f]/.test(value),'Use the complete original '+label+'.');return value;};
const iso=value=>{need(typeof value==='string'&&Number.isFinite(Date.parse(value)),'The original timestamp is invalid.');return value;};
const isJournal=r=>r?.id?.startsWith(PREFIX)&&r?.input?.schema===JOURNAL;
const isWork=r=>r?.id?.startsWith(WORK_PREFIX)&&r?.input?.schema===WORK;
const ordinary=r=>!isJournal(r)&&!isWork(r);
function recordShape(r){need(r&&typeof r==='object'&&!Array.isArray(r),'A complete saved record is required.');key(r.id);need(Number.isSafeInteger(r.revision)&&r.revision>=1,'The original saved revision is invalid.');need(typeof r.name==='string'&&typeof r.updatedAt==='string'&&own(r,'input'),'The complete original saved metadata and input are required.');iso(r.updatedAt);return r;}
const binaryTypes={Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,DataView};
if(typeof BigInt64Array!=='undefined')binaryTypes.BigInt64Array=BigInt64Array;
if(typeof BigUint64Array!=='undefined')binaryTypes.BigUint64Array=BigUint64Array;
function base64(bytes){let result='';for(let offset=0;offset<bytes.length;offset+=24576)result+=btoa(String.fromCharCode(...bytes.subarray(offset,offset+24576)));return result;}
function unbase64(value){need(typeof value==='string'&&value.length%4===0&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'The retained binary value is invalid.');const raw=atob(value);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
// The tagged representation preserves unfinished undefined values, exact special
// numbers, sparse arrays and managed binary values rather than JSON-normalizing them.
function pack(value){
  const nodes=[],seen=new Map();
  function visit(v,depth=0){
    need(depth<=128&&nodes.length<=4000000,'This record exceeds the complete structured-value bound.');
    if(v===null)return ['null'];if(v===undefined)return ['undefined'];
    if(typeof v==='string')return ['string',v];if(typeof v==='boolean')return ['boolean',v];
    if(typeof v==='number')return ['number',Number.isNaN(v)?'NaN':v===Infinity?'Infinity':v===-Infinity?'-Infinity':Object.is(v,-0)?'-0':String(v)];
    if(typeof v==='bigint')return ['bigint',String(v)];
    need(v&&typeof v==='object','This saved value requires its original application export.');
    if(seen.has(v))return ['ref',seen.get(v)];
    const id=nodes.length;seen.set(v,id);nodes.push(null);let node;
    if(Array.isArray(v)){
      need(Object.keys(v).every(k=>/^(0|[1-9]\d*)$/.test(k)&&Number(k)<v.length),'An array has additional properties which need its original application export.');
      const entries=[];for(let i=0;i<v.length;i++)if(own(v,i))entries.push([i,visit(v[i],depth+1)]);
      node=['array',v.length,entries];
    }else if(v instanceof Date)node=['date',Number.isNaN(v.getTime())?'invalid':v.toISOString()];
    else if(v instanceof ArrayBuffer)node=['buffer',base64(new Uint8Array(v))];
    else if(ArrayBuffer.isView(v)){const name=v.constructor.name;need(own(binaryTypes,name),'Unsupported saved binary view.');node=['view',name,visit(v.buffer,depth+1),v.byteOffset,v.byteLength];}
    else{need(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null,'This structured value requires its original application export.');need(Object.getOwnPropertySymbols(v).length===0,'Symbol properties require their original application export.');node=['object',Object.entries(v).map(([k,child])=>[k,visit(child,depth+1)])];}
    nodes[id]=node;return ['ref',id];
  }
  const root=visit(value);return ['graph',root,nodes];
}
function unpack(value){
  need(Array.isArray(value)&&value.length===3&&value[0]==='graph'&&Array.isArray(value[2])&&value[2].length<=4000000,'Invalid complete structured graph.');
  const nodes=value[2],objects=new Array(nodes.length);
  const size=(v,n)=>need(Array.isArray(v)&&v.length===n,'Invalid structured-value fields.');
  function scalar(v){
    need(Array.isArray(v),'Invalid structured value.');const t=v[0];
    if(t==='ref'){size(v,2);need(Number.isSafeInteger(v[1])&&v[1]>=0&&v[1]<objects.length&&objects[v[1]]!==undefined,'Invalid original object reference.');return objects[v[1]];}
    if(t==='null'||t==='undefined'){size(v,1);return t==='null'?null:undefined;}
    if(t==='string'||t==='boolean'){size(v,2);need(typeof v[1]===t,'Invalid original scalar.');return v[1];}
    if(t==='number'){size(v,2);need(typeof v[1]==='string','Invalid original number.');const n=v[1]==='NaN'?NaN:v[1]==='Infinity'?Infinity:v[1]==='-Infinity'?-Infinity:Number(v[1]);need(['NaN','Infinity','-Infinity','-0'].includes(v[1])||Number.isFinite(n)&&String(n)===v[1],'Invalid original number spelling.');return n;}
    need(t==='bigint','Unsupported original scalar.');size(v,2);need(typeof v[1]==='string'&&/^-?(0|[1-9]\d*)$/.test(v[1]),'Invalid original integer.');return BigInt(v[1]);
  }
  for(let i=0;i<nodes.length;i++){
    const n=nodes[i];need(Array.isArray(n),'Invalid original graph node.');
    if(n[0]==='object'){size(n,2);need(Array.isArray(n[1]),'Invalid object fields.');objects[i]={};}
    else if(n[0]==='array'){size(n,3);need(Number.isSafeInteger(n[1])&&n[1]>=0&&n[1]<=4000000&&Array.isArray(n[2]),'Invalid original array.');objects[i]=new Array(n[1]);}
    else if(n[0]==='date'){size(n,2);const d=n[1]==='invalid'?new Date(NaN):new Date(n[1]);need(n[1]==='invalid'||Number.isFinite(d.getTime())&&d.toISOString()===n[1],'Invalid original date.');objects[i]=d;}
    else if(n[0]==='buffer'){size(n,2);objects[i]=unbase64(n[1]).buffer;}
    else need(n[0]==='view','Unsupported original graph node.');
  }
  for(let i=0;i<nodes.length;i++)if(nodes[i][0]==='view'){
    const n=nodes[i];size(n,5);need(own(binaryTypes,n[1]),'Unsupported saved binary view.');const buffer=scalar(n[2]);need(buffer instanceof ArrayBuffer&&Number.isSafeInteger(n[3])&&Number.isSafeInteger(n[4])&&n[3]>=0&&n[4]>=0&&n[3]+n[4]<=buffer.byteLength,'Invalid original binary bounds.');
    try{const Constructor=binaryTypes[n[1]];objects[i]=n[1]==='DataView'?new DataView(buffer,n[3],n[4]):new Constructor(buffer,n[3],n[4]/Constructor.BYTES_PER_ELEMENT);need(objects[i].byteLength===n[4],'Invalid original binary length.');}catch{throw new Error('Invalid saved binary view alignment.');}
  }
  for(let i=0;i<nodes.length;i++){
    const n=nodes[i],used=new Set();
    if(n[0]==='object')for(const entry of n[1]){size(entry,2);need(typeof entry[0]==='string'&&!used.has(entry[0]),'Duplicate original object field.');used.add(entry[0]);Object.defineProperty(objects[i],entry[0],{value:scalar(entry[1]),enumerable:true,writable:true,configurable:true});}
    if(n[0]==='array')for(const entry of n[2]){size(entry,2);need(Number.isSafeInteger(entry[0])&&entry[0]>=0&&entry[0]<n[1]&&!used.has(entry[0]),'Invalid original array index.');used.add(entry[0]);objects[i][entry[0]]=scalar(entry[1]);}
  }
  return scalar(value[1]);
}
function pinSnapshot(record){
  recordShape(record);
  need(globalThis.crypto?.subtle,'Open this desk through HTTPS or the original loopback host.');
  const value=pack(record),raw=utf8(JSON.stringify(value));
  need(raw.byteLength<=MAX_ARCHIVE_BYTES,'One saved record exceeds the complete archive limit.');
  const digest=savedRecordDigest(raw);
  return {id:record.id,bytes:digest.bytes,sha256:digest.sha256,value};
}
async function pin(record){return pinSnapshot(record);}
async function unpin(row){need(row&&typeof row==='object'&&typeof row.sha256==='string'&&/^[a-f0-9]{64}$/.test(row.sha256),'The original record digest is absent.');const raw=JSON.stringify(row.value);need(utf8(raw).length===row.bytes&&await sha(raw)===row.sha256,'A complete original saved record changed.');const r=recordShape(unpack(row.value));need(r.id===row.id,'The original record identity changed.');return r;}
function typeOf(r){
  const s=r.input?.schema;
  if(s==='stellar-forge.grant-submission-draft.v1')return ['submission','SCF submission',{label:'Open submission',href:'./grant-submission.html?draft='+encodeURIComponent(r.id)}];
  if(s==='stellar-forge.grant-review-round.v1')return ['review','Submission review',{label:'Open recorded review',href:'./grant-review-round.html?review='+encodeURIComponent(r.id)}];
  if(s==='stellar-forge.grant-review-working-copy.v1')return ['review-working','Review working copy',{label:'Open independent working copy',href:'./grant-review-round.html?working='+encodeURIComponent(r.id)}];
  if(r.id.startsWith('cocart-'))return ['cocart','CoCart setup',{label:'Open CoCart setup',href:'./cocart.html?draft='+encodeURIComponent(r.id)}];
  if(Array.isArray(r.input?.resources)&&typeof r.input?.folder==='string'&&!String(s||'').startsWith('stellar-forge.grant-'))return ['merchant','Merchant setup',{label:'Open merchant setup',href:'./index.html?draft='+encodeURIComponent(r.id)+'#merchant-setup'}];
  return ['other','Other retained project',null];
}
function snapshotSummary(r,p){const [kind,kindLabel,workflow]=typeOf(r);return {id:r.id,revision:r.revision,name:r.name,updatedAt:r.updatedAt,kind,kindLabel,bytes:p.bytes,sha256:p.sha256,workflow};}
async function summary(r,p=null){return snapshotSummary(r,p||await pin(r));}
async function pinnedSnapshot(ids){
  const rows=await projectDraftRecords(r=>{
    const pinned=pinSnapshot(r);
    return {id:r.id,pin:pinned,summary:snapshotSummary(r,pinned),ordinary:ordinary(r)};
  },{ids});
  return new Map(rows.map(row=>[row.id,row]));
}
function receiptSummary(r){const v=r.input.receipt;return {id:r.id,requestId:v.requestId,kind:v.kind,at:v.at,label:v.label,archiveId:v.archiveId??null,records:(v.restored?.length||0)+(v.replaced?.length||0)+(v.kept?.length||0)+(v.removed?.length||0)};}
function workSummary(r){return {id:r.id,revision:r.revision,name:r.name,updatedAt:r.updatedAt};}
function sorted(rows){return [...rows].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));}
export async function readLibrary(){
  const rows=await projectDraftRecords(r=>ordinary(r)?{group:'records',value:snapshotSummary(r,pinSnapshot(r))}:
    isJournal(r)?{group:'receipts',value:receiptSummary(r),updatedAt:r.updatedAt,id:r.id}:
    {group:'working',value:workSummary(r)});
  return {scope:SCOPE,records:sorted(rows.filter(r=>r.group==='records').map(r=>r.value)),
    receipts:sorted(rows.filter(r=>r.group==='receipts')).map(r=>r.value),
    working:sorted(rows.filter(r=>r.group==='working').map(r=>r.value))};
}
async function download(value,filename){const raw=typeof value==='string'?value:text(value),bytes=utf8(raw).length;need(bytes<=MAX_ARCHIVE_BYTES,'The complete selected download exceeds 256 MiB; choose fewer projects without changing their contents.');return {text:raw,filename,bytes,sha256:await sha(raw)};}
function archiveShape(body){need(body?.schema===BODY&&typeof body.label==='string'&&typeof body.scope==='string','Unsupported complete saved-project archive.');iso(body.createdAt);for(const name of ['projects','history','working'])need(Array.isArray(body[name]),'The complete '+name+' inventory is absent.');const rows=[...body.projects,...body.history,...body.working];need(rows.length>0&&rows.length<=MAX_RECORDS&&new Set(rows.map(r=>r.id)).size===rows.length,'The complete inventory exceeds its limit or repeats an ID.');return rows;}
async function archiveView(raw){
  need(typeof raw==='string'&&utf8(raw).length<=MAX_ARCHIVE_BYTES,'Choose a complete saved-project archive within 256 MiB.');
  let env;try{env=JSON.parse(raw);}catch{throw new Error('The retained original file is not complete JSON. Its raw text can still be saved or downloaded.');}
  need(env?.schema===ARCHIVE&&typeof env.sha256==='string','Unsupported saved-project archive.');
  archiveShape(env.body);const bodyHash=await sha(JSON.stringify(env.body));
  need(bodyHash===env.sha256&&env.id==='saved-projects-'+bodyHash,'The complete archive identity does not match its original content.');
  const groups={};
  for(const name of ['projects','history','working']){
    groups[name]=[];
    for(const row of env.body[name]){
      const r=await unpin(row);
      need(name==='projects'?ordinary(r):name==='history'?isJournal(r):isWork(r),'A retained record is in the wrong archive group.');
      groups[name].push(name==='projects'?snapshotSummary(r,row):name==='history'?receiptSummary(r):workSummary(r));
    }
  }
  return {id:env.id,label:env.body.label,createdAt:env.body.createdAt,records:groups.projects,history:groups.history,working:groups.working,sha256:await sha(raw),bytes:utf8(raw).length,_text:raw};
}
export async function exportProjects({ids,label='Saved Stellar Forge projects',includeHistory=true,includeWorking=true}={}){
  need(Array.isArray(ids)&&new Set(ids).size===ids.length,'Select distinct complete saved projects.');
  need(typeof includeHistory==='boolean'&&typeof includeWorking==='boolean','Choose explicit complete history and working-copy options.');
  const wanted=new Set(ids.map(id=>key(id)));let captured=0,selectedBytes=0;
  const rows=await projectDraftRecords(r=>{
    const group=ordinary(r)&&wanted.has(r.id)?'projects':includeHistory&&isJournal(r)?'history':includeWorking&&isWork(r)?'working':null;
    if(!group)return undefined;
    need(++captured<=MAX_RECORDS,'Choose 1–5,000 complete project, history and working records for this archive.');
    const pinned=pinSnapshot(r);selectedBytes+=pinned.bytes;
    need(selectedBytes<=MAX_ARCHIVE_BYTES,'The complete selected download exceeds 256 MiB; choose fewer projects without changing their contents.');
    return {group,pin:pinned};
  },{ids:includeHistory||includeWorking?null:ids});
  const byId=new Map(rows.filter(r=>r.group==='projects').map(r=>[r.pin.id,r.pin]));
  const selected=ids.map(id=>{const row=byId.get(id);need(row,'A selected project changed or is no longer available. Refresh the original inventory.');return row;});
  const histories=rows.filter(r=>r.group==='history').map(r=>r.pin),working=rows.filter(r=>r.group==='working').map(r=>r.pin);
  const count=selected.length+histories.length+working.length;need(count>0&&count<=MAX_RECORDS,'Choose 1–5,000 complete project, history and working records for this archive.');
  const body={schema:BODY,label:String(label),createdAt:now(),scope:SCOPE,projects:selected,history:histories,working};
  const digest=await sha(JSON.stringify(body)),id='saved-projects-'+digest;
  const file=await download({schema:ARCHIVE,id,sha256:digest,body},cleanName(label)+'.saved-projects.json');
  return {...file,archiveId:id,summary:{label:body.label,createdAt:body.createdAt,records:body.projects.length,receipts:body.history.length,working:body.working.length}};
}
export const openArchive=archiveView;
async function selectedArchive(value){need(value&&typeof value._text==='string','Use the complete verified original archive.');const checked=await archiveView(value._text);need(value.id===checked.id&&value.sha256===checked.sha256,'The selected archive changed.');return checked;}
async function reviewHash(value){const copy=clone(value);delete copy.reviewSha256;return sha(JSON.stringify(copy));}
async function validateReview(review,kind){need(review?.kind===kind&&await reviewHash(review)===review.reviewSha256,'The retained original comparison changed. Prepare an explicit new comparison.');return review;}
export async function reviewReceiving(archive){
  const a=await selectedArchive(archive),body=JSON.parse(a._text).body,current=await pinnedSnapshot(body.projects.map(r=>r.id)),rows=[],expected=[];
  for(let i=0;i<body.projects.length;i++){
    const original=body.projects[i],existing=current.get(original.id)||null,p=existing?.pin||null;
    need(!existing||existing.ordinary,'An existing library journal reserves this project identity.');
    const status=!existing?'NEW':p.sha256===original.sha256?'IDENTICAL':'CONFLICT';
    rows.push({id:original.id,incoming:a.records[i],current:existing?.summary||null,status,defaultChoice:status==='NEW'?'restore':'keep',allowed:status==='NEW'?['restore','keep']:status==='CONFLICT'?['replace','keep']:['keep']});
    expected.push({id:original.id,record:p});
  }
  const review={kind:'receive',archiveId:a.id,archiveSha256:a.sha256,rows,_expected:expected};
  review.reviewSha256=await reviewHash(review);return review;
}
function requestId(value){key(value,'receiving request ID');need(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value),'Use a stable original receiving request ID.');return value;}
async function currentFor(ids){
  const rows=await projectDraftRecords(r=>snapshotSummary(r,pinSnapshot(r)),{ids}),map=new Map(rows.map(r=>[r.id,r]));
  return ids.map(id=>map.get(id)||{id,absent:true});
}
function storedReceiptShape(r){need(isJournal(r)&&r.input.receipt?.id===r.id,'The original receiving receipt is absent or inconsistent.');return r.input;}
async function completed(id,requestHash){
  const row=await loadDraft(id);if(!row)return null;const value=storedReceiptShape(row);
  need(value.requestHash===requestHash,'This original receiving request already selected different input or decisions.');
  return {receipt:clone(value.receipt),replayed:true,current:await currentFor(value.projectIds)};
}
function newRecord(id,input,at,revision=1){return {id,revision,name:String(input.folder||'Saved project'),resources:Array.isArray(input.resources)?input.resources.length:0,updatedAt:at,input:clone(input)};}
function journalRecord(id,input,at){return newRecord(id,input,at);}
export async function commitReceiving({archive,review,choices,requestId:rid,label='Received saved projects'}){
  rid=requestId(rid);const a=await selectedArchive(archive);await validateReview(review,'receive');
  need(review.archiveId===a.id&&review.archiveSha256===a.sha256,'The comparison belongs to another original archive.');
  need(choices&&typeof choices==='object'&&!Array.isArray(choices)&&Object.keys(choices).length===review.rows.length,'Retain one explicit choice for every incoming project.');
  for(const row of review.rows)need(own(choices,row.id)&&row.allowed.includes(choices[row.id]),'Choose a supported receiving action for '+row.incoming.name+'.');
  const request={kind:'receive',requestId:rid,archiveId:a.id,archiveSha256:a.sha256,reviewSha256:review.reviewSha256,choices:clone(choices),label:String(label)};
  const requestHash=await sha(JSON.stringify(request)),id=PREFIX+rid;
  const replay=await completed(id,requestHash);if(replay)return replay;
  const body=JSON.parse(a._text).body,incoming=new Map(body.projects.map(r=>[r.id,r])),before=[],after=[],expected=[],puts=[],at=now();
  const receipt={id,requestId:rid,kind:'receive',at,label:String(label),archiveId:a.id,archiveSha256:a.sha256,restored:[],replaced:[],kept:[]};
  for(const row of review.rows){
    const old=review._expected.find(x=>x.id===row.id);need(old,'The original comparison inventory is incomplete.');
    const original=old.record?await unpin(old.record):null;expected.push({id:row.id,record:original});
    const choice=choices[row.id];if(choice==='keep'){receipt.kept.push({id:row.id});continue;}
    const selected=await unpin(incoming.get(row.id));before.push({id:row.id,record:old.record});
    const next=choice==='restore'?selected:{...selected,revision:original.revision+1,updatedAt:at};
    puts.push(next);after.push({id:row.id,record:await pin(next)});
    receipt[choice==='restore'?'restored':'replaced'].push({id:row.id,revision:next.revision});
  }
  const value={schema:JOURNAL,folder:'Saved-project receiving — '+String(label),requestHash,request,receipt,projectIds:review.rows.map(r=>r.id),archiveText:a._text,before,after};
  const outcome=await commitDraftRecords({receiptId:id,requestHash,expected,puts,removals:[],receiptRecord:journalRecord(id,value,at)});
  return {receipt:clone(outcome.record.input.receipt),replayed:outcome.replayed,current:await currentFor(value.projectIds)};
}
export async function readReceipt(id){
  key(id);const row=await loadDraft(id),value=storedReceiptShape(row);
  let passive={history:[],working:[]};if(value.archiveText){const a=await archiveView(value.archiveText);passive={history:a.history,working:a.working};}
  return {receipt:clone(value.receipt),current:await currentFor(value.projectIds),passive};
}
export async function exportReceipt(id){const row=await loadDraft(key(id));storedReceiptShape(row);return download({schema:'stellar-forge.saved-project-receipt-export.v1',record:await pin(row)},cleanName(row.name)+'.receipt.json');}
export async function reviewUndo(receiptId){
  const saved=await loadDraft(key(receiptId)),value=storedReceiptShape(saved);
  need(value.receipt.kind==='receive','Select an original receiving receipt for selective restoration.');
  const originals=new Map(value.before.map(x=>[x.id,x.record])),current=await pinnedSnapshot(value.after.map(r=>r.id)),rows=[],expected=[];
  for(const applied of value.after){
    const oldPin=originals.get(applied.id)||null,old=oldPin?await unpin(oldPin):null;
    const received=await unpin(applied.record),actual=current.get(applied.id)||null,actualPin=actual?.pin||null;
    const status=!actual?'ABSENT':actualPin.sha256===applied.record.sha256?'UNCHANGED':'STAFF_CHANGED';
    rows.push({id:applied.id,status,canRestore:status==='UNCHANGED',before:old?await summary(old,oldPin):null,current:actual?.summary||null,after:await summary(received,applied.record)});
    expected.push({id:applied.id,record:actualPin,before:oldPin,accepted:applied.record});
  }
  const review={kind:'undo',receiptId,receiptSha256:(await pin(saved)).sha256,rows,_expected:expected};review.reviewSha256=await reviewHash(review);return review;
}
export async function commitUndo({review,ids,requestId:rid,label='Selective restoration'}){
  rid=requestId(rid);await validateReview(review,'undo');need(Array.isArray(ids)&&new Set(ids).size===ids.length,'Select distinct original received projects to restore.');
  const known=new Map(review.rows.map(r=>[r.id,r]));for(const id of ids)need(known.has(id),'The selected restoration is not in this original receipt.');
  const request={kind:'undo',requestId:rid,receiptId:review.receiptId,reviewSha256:review.reviewSha256,ids:[...ids],label:String(label)};
  const requestHash=await sha(JSON.stringify(request)),id=PREFIX+rid,replay=await completed(id,requestHash);if(replay)return replay;
  const original=await loadDraft(review.receiptId);storedReceiptShape(original);need((await pin(original)).sha256===review.receiptSha256,'The original receiving receipt changed.');
  const puts=[],removals=[],expected=[{id:original.id,record:original}],before=[],after=[],at=now();
  const receipt={id,requestId:rid,kind:'undo',at,label:String(label),archiveId:original.input.receipt.archiveId,originalReceiptId:original.id,restored:[],replaced:[],kept:[],removed:[],skipped:[]};
  for(const row of review.rows){
    const e=review._expected.find(x=>x.id===row.id);need(e,'The retained restoration comparison is incomplete.');
    if(!ids.includes(row.id)||!row.canRestore){receipt.skipped.push({id:row.id,reason:!row.canRestore?row.status:'NOT_SELECTED'});continue;}
    need(e.record&&e.accepted.sha256===e.record.sha256,'Only unchanged received values can be restored.');
    const actual=await unpin(e.record);expected.push({id:row.id,record:actual});before.push({id:row.id,record:e.record});
    if(e.before){const previous=await unpin(e.before),next={...previous,revision:actual.revision+1,updatedAt:at};puts.push(next);after.push({id:row.id,record:await pin(next)});receipt.restored.push({id:row.id,revision:next.revision});}
    else{removals.push(row.id);after.push({id:row.id,record:null});receipt.removed.push({id:row.id});}
  }
  const value={schema:JOURNAL,folder:'Saved-project restoration — '+String(label),requestHash,request,receipt,projectIds:review.rows.map(r=>r.id),archiveText:null,before,after,originalReceipt:await pin(original)};
  const outcome=await commitDraftRecords({receiptId:id,requestHash,expected,puts,removals,receiptRecord:journalRecord(id,value,at)});
  return {receipt:clone(outcome.record.input.receipt),replayed:outcome.replayed,current:await currentFor(value.projectIds)};
}
export async function saveWorking({id=null,revision=0,value}){
  need(value&&typeof value==='object'&&!Array.isArray(value),'Retain the complete unfinished desk input.');
  const raw=JSON.stringify(pack(value));need(utf8(raw).length<=MAX_ARCHIVE_BYTES*2+1048576,'This complete working copy exceeds the local retention limit. Keep its original file and export the decisions.');
  const selected=id===null?WORK_PREFIX+crypto.randomUUID():key(id);need(selected.startsWith(WORK_PREFIX),'Choose a saved library working copy.');
  const label=String(value.label||value.filename||'Unfinished receiving').slice(0,1000);
  const result=await saveDraft({id:selected,revision,input:{schema:WORK,folder:'Saved-project work — '+label,value:clone(value)}});
  return workSummary(result);
}
export async function loadWorking(id){const r=await loadDraft(key(id));need(isWork(r),'The complete unfinished library copy is absent.');return {id:r.id,revision:r.revision,value:clone(r.input.value)};}
export async function recoverWorking(receiptId,sourceWorkingId){
  const r=await loadDraft(key(receiptId)),value=storedReceiptShape(r);need(value.archiveText,'This receipt has no incoming working copies.');
  const a=await archiveView(value.archiveText),body=JSON.parse(a._text).body,selected=body.working.find(x=>x.id===sourceWorkingId);need(selected,'The exact passive working copy is absent.');
  const original=await unpin(selected);need(isWork(original),'The retained working copy has the wrong source kind.');
  const recovered=clone(original.input.value);
  // Preserve every original field in provenance; target-bound requests remain
  // passive and cannot become a request against this recipient's current store.
  recovered.importedWorkingOriginal={schema:'stellar-forge.passive-working-source.v1',record:clone(selected),receiptId};
  recovered.review=null;recovered.requestId=null;recovered.pending=null;recovered.completedReceipt=null;
  recovered.needsComparison=true;recovered.mode='receive';recovered.receiptId=null;recovered.undoReview=null;recovered.undoIds=[];
  recovered.label=String(recovered.label||original.name)+' — received copy';
  const saved=await saveWorking({id:null,revision:0,value:recovered});
  return loadWorking(saved.id);
}
export async function downloadProject(id){
  const row=await loadDraft(key(id));need(row&&ordinary(row),'The complete selected project is absent.');
  return download({schema:'stellar-forge.saved-project-record.v1',record:await pin(row)},cleanName(row.name)+'.saved-record.json');
}
