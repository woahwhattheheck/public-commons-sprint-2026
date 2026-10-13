/**
 * Supplier feed review domain.
 * Complete recovery implementation of the retained 70CB consumer contract.
 * Source editions, mapping, exact arithmetic, decisions and exports are portable ESM.
 * The original Commons SHA-256 implementation is included with its upstream license.
 */
const HASH = (() => {
  const module = {exports: {}};
  const exports = module.exports;
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

  return module.exports;
})();


export class ReportError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ReportError'; this.code = code; this.details = details; }
}
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const need = (condition, code, message, details) => { if (!condition) throw new ReportError(code, message, details); };
const trustedEditions = new WeakSet(), trustedReports = new WeakSet();
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function validUnicode(value) {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++index);
      need(low >= 0xdc00 && low <= 0xdfff,'INVALID_UNICODE','Text contains an unpaired UTF-16 surrogate.');
    } else need(unit < 0xdc00 || unit > 0xdfff,'INVALID_UNICODE','Text contains an unpaired UTF-16 surrogate.');
  }
  return value;
}
function text(value, name, required = true) {
  need(typeof value === 'string' && (!required || value.trim().length > 0), 'INVALID_INPUT', name + ' must be ' + (required ? 'nonempty ' : '') + 'text.');
  validUnicode(value);
  return value;
}
function id(value, name) {
  text(value, name);
  need(!/[\u0000-\u001f\u007f]/.test(value), 'INVALID_INPUT', name + ' cannot contain control characters.');
  return value;
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function instant(value, name) {
  text(value, name);
  need(validDate(value.slice(0, 10)) &&
    (/^\d{4}-\d{2}-\d{2}$/.test(value) ||
     /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)) &&
    Number.isFinite(Date.parse(value)), 'INVALID_DATE', name + ' must be a valid ISO date or timestamp.');
  return value;
}
export function canonicalJSON(value) {
  const seen = new Set();
  function encode(v) {
    if (v === null) return 'null';
    if (typeof v === 'string') { validUnicode(v); return JSON.stringify(v); }
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') { need(Number.isFinite(v), 'INVALID_JSON', 'JSON numbers must be finite.'); return JSON.stringify(v); }
    need(Array.isArray(v) || plain(v), 'INVALID_JSON', 'Use only complete JSON values.');
    need(!seen.has(v), 'INVALID_JSON', 'JSON data cannot contain cycles.');
    seen.add(v);
    let out;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) need(own(v, i), 'INVALID_JSON', 'JSON arrays cannot have missing entries.');
      out = '[' + v.map(encode).join(',') + ']';
    } else out = '{' + Object.keys(v).sort().map(k => encode(k) + ':' + encode(v[k])).join(',') + '}';
    seen.delete(v);
    return out;
  }
  return encode(value);
}
const clone = value => JSON.parse(canonicalJSON(value));
export function sha256(value) { return HASH.sha256Utf8(text(value, 'Hash input', false)).sha256; }
const digest = value => sha256(canonicalJSON(value));
const issue = (code, message, field) => field === undefined ? {code, message} : {code, field, message};

export function parseCSV(csv, {delimiter = ','} = {}) {
  text(csv, 'CSV input', false);
  need(typeof delimiter === 'string' && delimiter.length === 1 && !/["\r\n\u0000-\u001f]/.test(delimiter),
    'INVALID_CSV_DIALECT', 'The CSV delimiter must be one non-control character other than a quote.');
  const input = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  need(input.length > 0, 'CSV_EMPTY', 'The CSV must include a header.');
  const records = [];
  let row = [], field = '', mode = 'start', line = 1, startLine = 1, touched = false;
  function finishField() { row.push(field); field = ''; mode = 'start'; }
  function finishRow() { finishField(); records.push({cells: row, lineNumber: startLine}); row = []; touched = false; }
  for (let i = 0; i < input.length; i++) {
    const c = input[i], newline = c === '\r' || c === '\n', crlf = c === '\r' && input[i + 1] === '\n';
    if (mode === 'quoted') {
      if (c === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; } else mode = 'closed';
      } else if (newline) { field += crlf ? '\r\n' : c; line++; if (crlf) i++; }
      else field += c;
      touched = true;
      continue;
    }
    if (mode === 'closed') need(c === delimiter || newline, 'CSV_QUOTE', 'Only a delimiter or newline may follow a closing quote.', {line});
    if (newline) {
      finishRow(); line++; if (crlf) i++; startLine = line;
    } else if (c === delimiter) {
      finishField(); touched = true;
    } else if (c === '"') {
      need(mode === 'start', 'CSV_QUOTE', 'A quoted field must start with its opening quote.', {line});
      mode = 'quoted'; touched = true;
    } else {
      need(mode !== 'closed', 'CSV_QUOTE', 'Unexpected content after a closing quote.', {line});
      field += c; mode = 'unquoted'; touched = true;
    }
  }
  need(mode !== 'quoted', 'CSV_UNCLOSED_QUOTE', 'The CSV has an unterminated quoted field.', {line: startLine});
  if (touched || row.length || field.length || mode === 'closed') finishRow();
  need(records.length > 0, 'CSV_EMPTY', 'The CSV must include a header.');
  const columns = records.shift().cells;
  need(columns.every(c => c.length > 0) && new Set(columns).size === columns.length, 'CSV_HEADERS', 'CSV headers must be nonempty and unique.');
  const rows = records.map((record, index) => {
    need(record.cells.length === columns.length, 'CSV_WIDTH', 'CSV row width differs from the header.',
      {rowNumber: index + 2, lineNumber: record.lineNumber, expected: columns.length, actual: record.cells.length});
    return {rowNumber: index + 2, lineNumber: record.lineNumber,
      raw: Object.fromEntries(columns.map((column, i) => [column, record.cells[i]]))};
  });
  return {columns, rows};
}


function sourceRows(columns, inputRows) {
  need(Array.isArray(columns) && columns.length > 0 && columns.every(c => typeof c === 'string' && c.length > 0) &&
    new Set(columns).size === columns.length, 'INVALID_COLUMNS', 'Columns must be a nonempty array of unique names.');
  columns.forEach(c => text(c, 'Column name'));
  need(Array.isArray(inputRows), 'INVALID_ROWS', 'Structured source rows must be an array.');
  const used = new Set();
  return inputRows.map((entry, index) => {
    const described = plain(entry) && own(entry, 'raw') && plain(entry.raw) && own(entry, 'rowNumber');
    const source = described ? entry.raw : entry;
    let raw;
    if (Array.isArray(source)) {
      need(source.length === columns.length, 'ROW_WIDTH', 'A structured row differs from the column count.', {index});
      raw = Object.fromEntries(columns.map((c, i) => [c, clone(source[i])]));
    } else {
      need(plain(source), 'INVALID_ROW', 'A structured row must be an object or array.', {index});
      need(Object.keys(source).length === columns.length && columns.every(c => own(source, c)),
        'ROW_COLUMNS', 'Every structured row must contain exactly the original columns.', {index});
      raw = Object.fromEntries(columns.map(c => [c, clone(source[c])]));
    }
    const rowNumber = described ? entry.rowNumber : index + 2;
    const lineNumber = described && own(entry, 'lineNumber') ? entry.lineNumber : index + 2;
    need(Number.isSafeInteger(rowNumber) && rowNumber >= 1 && !used.has(rowNumber),
      'ROW_NUMBER', 'Source row numbers must be unique positive safe integers.', {index, rowNumber});
    need(Number.isSafeInteger(lineNumber) && lineNumber >= 1, 'ROW_NUMBER', 'Source line numbers must be positive safe integers.', {index});
    used.add(rowNumber);
    return {rowNumber, lineNumber, raw};
  });
}

export function createEdition({id: editionId, sourceId, capturedAt, csv, columns, rows, source = {}, delimiter = ','} = {}) {
  id(editionId, 'Edition ID'); id(sourceId, 'Source ID'); instant(capturedAt, 'Captured-at value');
  need(plain(source), 'INVALID_SOURCE_METADATA', 'Source metadata must be a JSON object.');
  need(csv === undefined || typeof csv === 'string', 'INVALID_CSV', 'CSV source must be a string.');
  need(csv === undefined || (columns === undefined && rows === undefined), 'AMBIGUOUS_SOURCE', 'Provide either CSV or structured columns and rows.');
  let parsed;
  if (csv !== undefined) parsed = parseCSV(csv, {delimiter});
  else {
    need(delimiter === ',', 'INVALID_CSV_DIALECT', 'Structured editions retain the default comma export dialect.');
    parsed = {columns: clone(columns), rows: sourceRows(columns, rows)};
  }
  const body = {
    schemaVersion: 1, id: editionId, sourceId, capturedAt, source: clone(source), delimiter,
    columns: parsed.columns, rows: parsed.rows, rawCSV: csv === undefined ? null : csv,
    sourceDigest: csv === undefined ? digest({columns: parsed.columns, rows: parsed.rows}) : sha256(csv)
  };
  const edition = freeze({...body, digest: digest(body)});
  trustedEditions.add(edition);
  return edition;
}
function checkedEdition(value) {
  if (trustedEditions.has(value)) return value;
  need(plain(value) && value.schemaVersion === 1, 'INVALID_EDITION', 'An edition must use schema version 1.');
  const rebuilt = createEdition({
    id: value.id, sourceId: value.sourceId, capturedAt: value.capturedAt, source: value.source,
    delimiter: value.delimiter,
    ...(value.rawCSV === null ? {columns: value.columns, rows: value.rows} : {csv: value.rawCSV})
  });
  need(canonicalJSON(rebuilt) === canonicalJSON(value), 'EDITION_INTEGRITY', 'Edition source, identity, or digest differs from its retained content.');
  return rebuilt;
}

const decimalGrammar = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
function decimal(value, integer = false) {
  need(typeof value === 'string' && value.length <= 4096 &&
    (integer ? /^[+-]?\d+$/.test(value) : decimalGrammar.test(value)),
    integer ? 'INVALID_INTEGER' : 'INVALID_DECIMAL',
    integer ? 'Use an integer string without separators or an exponent.' : 'Use a decimal string without separators, currency symbols, or an exponent.');
  let s = value, sign = 1n;
  if (s[0] === '-' || s[0] === '+') { if (s[0] === '-') sign = -1n; s = s.slice(1); }
  const pieces = s.split('.'), fraction = pieces[1] || '';
  let coefficient = BigInt((pieces[0] || '0') + fraction) * sign, scale = fraction.length;
  while (scale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
  return {coefficient, scale};
}
function decimalText(value) {
  let digits = (value.coefficient < 0n ? -value.coefficient : value.coefficient).toString();
  if (value.scale) {
    digits = digits.padStart(value.scale + 1, '0');
    digits = digits.slice(0, -value.scale) + '.' + digits.slice(-value.scale);
  }
  return (value.coefficient < 0n ? '-' : '') + digits;
}
function scaled(value, scale) { return value.coefficient * 10n ** BigInt(scale - value.scale); }
function compareDecimal(a, b) {
  const scale = Math.max(a.scale, b.scale), left = scaled(a, scale), right = scaled(b, scale);
  return left < right ? -1 : left > right ? 1 : 0;
}
function subtractDecimal(after, before) {
  const scale = Math.max(after.scale, before.scale);
  let coefficient = scaled(after, scale) - scaled(before, scale), nextScale = scale;
  while (nextScale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; nextScale--; }
  return {coefficient, scale: nextScale};
}
function numericConstraint(value, name, integer = false) {
  try { return decimalText(decimal(value, integer)); }
  catch (error) { throw new ReportError('INVALID_RULE', name + ': ' + error.message); }
}
function normalizeRules(input, baseline, candidate) {
  need(plain(input) && Array.isArray(input.fields) && input.fields.length > 0, 'INVALID_RULE', 'Rules must include canonical fields.');
  need(Array.isArray(input.keyFields) && input.keyFields.length > 0 && new Set(input.keyFields).size === input.keyFields.length,
    'INVALID_RULE', 'Rules must include unique canonical keyFields.');
  const supported = new Set(['name','label','type','baseline','candidate','required','trim','case','nullValues','aliases','allowedValues','tolerance','min','max','contextFields']);
  const fields = input.fields.map((raw, index) => {
    need(plain(raw), 'INVALID_RULE', 'Each field must be an object.', {index});
    for (const name of Object.keys(raw)) need(supported.has(name), 'INVALID_RULE', 'Unknown field option: ' + name, {index});
    const name = id(raw.name, 'Canonical field name');
    const type = raw.type || 'text';
    need(['text','decimal','integer','date','boolean'].includes(type), 'INVALID_RULE', 'Unsupported field type.', {field:name});
    const field = {name, label: raw.label === undefined ? name : text(raw.label, 'Field label'), type};
    for (const side of ['baseline','candidate']) {
      need(own(raw, side), 'INVALID_RULE', 'Each field needs an explicit mapping on both sides.', {field:name, side});
      const mapping = raw[side];
      if (mapping === null) field[side] = null;
      else if (typeof mapping === 'string') {
        need((side === 'baseline' ? baseline : candidate).columns.includes(mapping),
          'MAPPING_COLUMN', 'Mapped column is absent from its source.', {field:name, side, column:mapping});
        field[side] = mapping;
      } else {
        need(plain(mapping) && Object.keys(mapping).length === 1 && own(mapping,'constant') &&
          (mapping.constant === null || typeof mapping.constant === 'string'),
          'INVALID_RULE', 'A mapping must be a column name, a string/null constant, or null.', {field:name, side});
        field[side] = clone(mapping);
      }
    }
    for (const flag of ['required','trim']) {
      need(raw[flag] === undefined || typeof raw[flag] === 'boolean', 'INVALID_RULE', flag + ' must be boolean.', {field:name});
      field[flag] = raw[flag] === true;
    }
    field.case = raw.case || 'preserve';
    need(['preserve','upper','lower'].includes(field.case), 'INVALID_RULE', 'Field case must be preserve, upper, or lower.', {field:name});
    if (raw.nullValues !== undefined) {
      need(Array.isArray(raw.nullValues) && raw.nullValues.every(v => v === null || typeof v === 'string'),
        'INVALID_RULE', 'nullValues must contain only strings or null.', {field:name});
      field.nullValues = clone(raw.nullValues);
    }
    if (raw.aliases !== undefined) {
      need(plain(raw.aliases) && Object.values(raw.aliases).every(v => v === null || typeof v === 'string'),
        'INVALID_RULE', 'aliases must map exact normalized source strings to strings or null.', {field:name});
      field.aliases = clone(raw.aliases);
    }
    if (raw.allowedValues !== undefined) {
      need(Array.isArray(raw.allowedValues) && raw.allowedValues.length > 0 && raw.allowedValues.every(v => v === null || typeof v === 'string'),
        'INVALID_RULE', 'allowedValues must be a nonempty array of canonical strings or null.', {field:name});
      field.allowedValues = clone(raw.allowedValues);
    }
    for (const option of ['tolerance','min','max']) if (raw[option] !== undefined) {
      need(type === 'decimal' || type === 'integer', 'INVALID_RULE', option + ' is only valid for numeric fields.', {field:name});
      field[option] = numericConstraint(raw[option], name + '.' + option, type === 'integer' && option !== 'tolerance');
    }
    if (field.tolerance !== undefined) need(compareDecimal(decimal(field.tolerance), decimal('0')) >= 0,
      'INVALID_RULE', 'Tolerance cannot be negative.', {field:name});
    if (field.min !== undefined && field.max !== undefined) need(compareDecimal(decimal(field.min), decimal(field.max)) <= 0,
      'INVALID_RULE', 'A numeric minimum cannot exceed its maximum.', {field:name});
    if (raw.contextFields !== undefined) {
      need((type === 'decimal' || type === 'integer') && Array.isArray(raw.contextFields) &&
        raw.contextFields.every(v => typeof v === 'string') && new Set(raw.contextFields).size === raw.contextFields.length,
        'INVALID_RULE', 'Numeric contextFields must be unique canonical names.', {field:name});
      field.contextFields = clone(raw.contextFields);
    }
    return field;
  });
  need(new Set(fields.map(f => f.name)).size === fields.length, 'INVALID_RULE', 'Canonical field names must be unique.');
  const names = new Set(fields.map(f => f.name));
  for (const key of input.keyFields) need(typeof key === 'string' && names.has(key), 'INVALID_RULE', 'Every key field must be configured.', {field:key});
  for (const field of fields) {
    for (const context of field.contextFields || []) need(names.has(context) && context !== field.name,
      'INVALID_RULE', 'A numeric context must name another canonical field.', {field:field.name, context});
    if (field.allowedValues) for (const value of field.allowedValues) {
      const result = convertValue(value, {...field, required:false, allowedValues:undefined, aliases:undefined}, true);
      need(result.issues.length === 0 && result.value === value, 'INVALID_RULE', 'allowedValues must use the canonical field representation.', {field:field.name,value});
    }
  }
  const supportedRules = new Set(['keyFields','fields']);
  for (const name of Object.keys(input)) need(supportedRules.has(name), 'INVALID_RULE', 'Unknown rule option: ' + name);
  return {keyFields:clone(input.keyFields), fields};
}
function convertValue(input, field, canonical = false) {
  const problems = [];
  let value = input;
  if (value !== null && typeof value !== 'string') {
    if (typeof value === 'boolean') value = String(value);
    else if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
    else return {value:null, issues:[issue('SOURCE_VALUE_TYPE', 'Source value must be text, null, a boolean, or a safe integer; import exact numeric source tokens as strings.', field.name)]};
  }
  if (!canonical && value !== null) {
    if (field.trim) value = value.trim();
    if (field.case === 'upper') value = value.toUpperCase();
    if (field.case === 'lower') value = value.toLowerCase();
    if (field.nullValues && field.nullValues.includes(value)) value = null;
    else if (field.aliases && own(field.aliases,value)) value = field.aliases[value];
  }
  if (value === null) {
    if (field.required) problems.push(issue('REQUIRED_VALUE', 'A required canonical value is missing.', field.name));
  } else {
    if (field.required && value.trim().length === 0) problems.push(issue('REQUIRED_VALUE', 'A required canonical value is empty.', field.name));
    try {
      if (field.type === 'decimal' || field.type === 'integer') {
        const parsed = decimal(value, field.type === 'integer');
        value = decimalText(parsed);
        if (field.min !== undefined && compareDecimal(parsed,decimal(field.min)) < 0) problems.push(issue('MINIMUM', 'Value is below the configured minimum.', field.name));
        if (field.max !== undefined && compareDecimal(parsed,decimal(field.max)) > 0) problems.push(issue('MAXIMUM', 'Value exceeds the configured maximum.', field.name));
      } else if (field.type === 'date') need(validDate(value), 'INVALID_DATE', 'Use a valid date in YYYY-MM-DD format.');
      else if (field.type === 'boolean') need(value === 'true' || value === 'false', 'INVALID_BOOLEAN', 'Use true or false, or configure explicit aliases.');
    } catch (error) {
      if (!(error instanceof ReportError)) throw error;
      problems.push(issue(error.code,error.message,field.name));
    }
  }
  if (field.allowedValues && !field.allowedValues.includes(value)) problems.push(issue('ALLOWED_VALUE', 'Value is outside the configured allowedValues.', field.name));
  return {value, issues:problems};
}
function mappedRows(edition, side, rules) {
  return edition.rows.map(source => {
    const entries = [], issues = [];
    for (const field of rules.fields) {
      const mapping = field[side];
      const input = mapping === null ? null : typeof mapping === 'string' ? source.raw[mapping] : mapping.constant;
      const result = convertValue(input, field);
      entries.push([field.name,result.value]); issues.push(...result.issues);
    }
    const values = Object.fromEntries(entries);
    for (const name of rules.keyFields) if (values[name] === null || values[name].trim().length === 0)
      issues.push(issue('MISSING_KEY', 'A key field must contain a nonempty canonical value.', name));
    return {rowNumber:source.rowNumber,lineNumber:source.lineNumber,raw:source.raw,values,issues};
  });
}


function rowKey(row, rules) {
  if (row.issues.some(problem => rules.keyFields.includes(problem.field))) return null;
  const values = rules.keyFields.map(name => row.values[name]);
  return values.some(value => value === null || value.trim().length === 0) ? null : values;
}
function basisDifference(field, before, after) {
  const names = field.contextFields || [];
  const missing = names.filter(name => before[name] === null || after[name] === null || before[name] === '' || after[name] === '');
  if (missing.length) return 'Missing price/comparison basis: ' + missing.join(', ') + '.';
  const different = names.filter(name => before[name] !== after[name]);
  return different.length ? 'Different price/comparison basis: ' + different.join(', ') + '.' : null;
}
function differences(before, after, rules) {
  const results = [];
  for (const field of rules.fields) {
    const left = before.values[field.name], right = after.values[field.name];
    const numeric = field.type === 'decimal' || field.type === 'integer';
    const basis = numeric ? basisDifference(field, before.values, after.values) : null;
    let equal = left === right, delta, deltaReason;
    if (numeric) {
      if (basis) deltaReason = basis;
      else if (left === null || right === null) deltaReason = 'A comparable numeric value is missing.';
      else if (before.issues.some(p => p.field === field.name) || after.issues.some(p => p.field === field.name))
        deltaReason = 'A numeric value requires correction.';
      else {
        const difference = subtractDecimal(decimal(right),decimal(left));
        delta = decimalText(difference);
        if (field.tolerance !== undefined) {
          const absolute = {...difference,coefficient:difference.coefficient < 0n ? -difference.coefficient : difference.coefficient};
          equal = compareDecimal(absolute,decimal(field.tolerance)) <= 0;
        }
      }
    }
    if (!equal || (basis && (field.contextFields || []).some(name => before.values[name] !== after.values[name]))) {
      const item = {field:field.name,label:field.label,before:left,after:right};
      if (delta !== undefined) item.delta = delta;
      if (deltaReason !== undefined) item.deltaReason = deltaReason;
      results.push(item);
    }
  }
  return results;
}
function sourceSelection(item, decision) {
  if (decision) {
    if (decision.action === 'exclude') return null;
    if (decision.action === 'replace') return {values:decision.values,side:'replacement',rowNumber:null};
    const side = decision.action === 'use_candidate' ? 'candidate' : decision.action === 'keep_baseline' ? 'baseline' : decision.side;
    const row = decision.action === 'choose_source' ? item[side].find(r => r.rowNumber === decision.rowNumber) : item[side][0];
    return row ? {values:row.values,side,rowNumber:row.rowNumber} : null;
  }
  if (item.kind === 'unchanged' && item.candidate.length === 1) {
    const row = item.candidate[0]; return {values:row.values,side:'candidate',rowNumber:row.rowNumber};
  }
  return null;
}
function refreshed(report) {
  const summary = {baselineRows:report.baseline.rows.length,candidateRows:report.candidate.rows.length,totalItems:report.items.length,
    addition:0,removal:0,change:0,unchanged:0,exception:0,reviewRequired:0,resolved:0,pending:0,blocking:0};
  const accepted = new Map(), blockingIssues = [];
  for (const item of report.items) {
    summary[item.kind]++;
    if (item.kind !== 'unchanged') {
      summary.reviewRequired++;
      if (own(report.decisions,item.id)) summary.resolved++; else summary.pending++;
    }
    const selected = sourceSelection(item,report.decisions[item.id]);
    if (selected) {
      const key = report.rules.keyFields.map(name => selected.values[name]), encoded = canonicalJSON(key);
      if (!accepted.has(encoded)) accepted.set(encoded,{key,itemIds:[]});
      accepted.get(encoded).itemIds.push(item.id);
    }
  }
  for (const group of accepted.values()) if (group.itemIds.length > 1) blockingIssues.push({
    code:'DUPLICATE_ACCEPTED_KEY',message:'Multiple accepted rows would have the same canonical key.',key:group.key,itemIds:group.itemIds
  });
  summary.blocking = blockingIssues.length;
  return {...report,summary,blockingIssues,status:summary.pending === 0 && summary.blocking === 0 ? 'reviewed' : 'review_required'};
}
function trustedReport(report) { freeze(report); trustedReports.add(report); return report; }
export function reconcile({requestId,baseline,candidate,rules,predecessor} = {}) {
  id(requestId,'Request ID');
  baseline = checkedEdition(baseline); candidate = checkedEdition(candidate);
  const normalized = normalizeRules(rules,baseline,candidate);
  if (predecessor !== undefined) {
    need(plain(predecessor) && Object.keys(predecessor).every(k => ['comparisonId','revision'].includes(k)),
      'INVALID_PREDECESSOR','A predecessor contains comparisonId and revision.');
    id(predecessor.comparisonId,'Predecessor comparison ID');
    need(Number.isSafeInteger(predecessor.revision) && predecessor.revision >= 0,'INVALID_PREDECESSOR','Predecessor revision must be a nonnegative safe integer.');
    predecessor = clone(predecessor);
  }
  const identity = {requestId,baselineDigest:baseline.digest,candidateDigest:candidate.digest,rules:normalized};
  if (predecessor !== undefined) identity.predecessor = predecessor;
  const comparisonId = 'cmp_' + digest(identity);
  const groups = new Map();
  for (const [side,edition] of [['baseline',baseline],['candidate',candidate]]) {
    for (const row of mappedRows(edition,side,normalized)) {
      const key = rowKey(row,normalized);
      const groupId = key === null ? canonicalJSON(['invalid',side,row.rowNumber]) : canonicalJSON(['key',key]);
      if (!groups.has(groupId)) groups.set(groupId,{groupId,key,baseline:[],candidate:[]});
      groups.get(groupId)[side].push(row);
    }
  }
  const items = [];
  for (const group of groups.values()) {
    const issues = [];
    for (const side of ['baseline','candidate']) {
      if (group[side].length > 1) issues.push(issue('DUPLICATE_SOURCE_KEY','The '+side+' has multiple rows for this canonical key.'));
      for (const row of group[side]) for (const problem of row.issues)
        issues.push({...problem,message:side+' row '+row.rowNumber+': '+problem.message});
    }
    const unique = [...new Map(issues.map(problem => [canonicalJSON(problem),problem])).values()];
    const diffs = group.baseline.length === 1 && group.candidate.length === 1
      ? differences(group.baseline[0],group.candidate[0],normalized) : [];
    const kind = unique.length || group.key === null ? 'exception' :
      group.baseline.length === 0 ? 'addition' : group.candidate.length === 0 ? 'removal' :
      diffs.length ? 'change' : 'unchanged';
    items.push({id:'item_'+digest({comparisonId,groupId:group.groupId}),kind,key:group.key,issues:unique,differences:diffs,
      baseline:group.baseline,candidate:group.candidate});
  }
  const report = {schemaVersion:1,comparisonId,requestId,revision:0,baseline,candidate,rules:normalized,
    items,decisions:{},history:[]};
  if (predecessor !== undefined) report.predecessor = predecessor;
  return trustedReport(refreshed(report));
}
function checkedReport(value) {
  if (trustedReports.has(value)) return value;
  return restoreReport(value);
}
function decisionInput(item, input, rules) {
  need(plain(input),'INVALID_DECISION','Each decision must be an object.');
  const supported = new Set(['itemId','action','values','side','rowNumber','reason']);
  for (const key of Object.keys(input)) need(supported.has(key),'INVALID_DECISION','Unknown decision option: '+key);
  const action = input.action;
  need(['use_candidate','keep_baseline','exclude','replace','choose_source'].includes(action),'INVALID_DECISION','Unsupported decision action.');
  const result = {itemId:item.id,action,reason:text(input.reason,'Decision reason')};
  if (action === 'replace') {
    need(plain(input.values) && Object.keys(input.values).length === rules.fields.length &&
      rules.fields.every(field => own(input.values,field.name)), 'INVALID_REPLACEMENT','A replacement must provide every canonical field and no extra fields.');
    const entries = [], issues = [];
    for (const field of rules.fields) {
      const value = input.values[field.name];
      need(value === null || typeof value === 'string','INVALID_REPLACEMENT','Replacement values must be canonical strings or null.',{field:field.name});
      const converted = convertValue(value,field,true);
      if (converted.value !== value) issues.push(issue('NONCANONICAL_REPLACEMENT','Replacement values must use their canonical representation.',field.name));
      issues.push(...converted.issues); entries.push([field.name,converted.value]);
    }
    const values = Object.fromEntries(entries);
    for (const key of rules.keyFields) if (values[key] === null || values[key].trim().length === 0)
      issues.push(issue('MISSING_KEY','A replacement key must be nonempty.',key));
    need(issues.length === 0,'INVALID_REPLACEMENT','Replacement values do not satisfy the configured fields.',{issues});
    result.values = values;
  } else if (action === 'choose_source') {
    need(input.side === 'baseline' || input.side === 'candidate','INVALID_DECISION','Choose-source side must be baseline or candidate.');
    need(Number.isSafeInteger(input.rowNumber),'INVALID_DECISION','Choose-source rowNumber must be a safe integer.');
    const row = item[input.side].find(value => value.rowNumber === input.rowNumber);
    need(row,'SOURCE_SELECTION','The selected original row does not belong to this item.');
    need(row.issues.length === 0,'SOURCE_SELECTION','The selected row still has validation issues.',{issues:row.issues});
    result.side = input.side; result.rowNumber = input.rowNumber;
  } else if (action === 'use_candidate' || action === 'keep_baseline') {
    const side = action === 'use_candidate' ? 'candidate' : 'baseline';
    need(item[side].length === 1,'SOURCE_SELECTION','This action requires exactly one '+side+' row. Use Choose source for a duplicate key.');
    need(item[side][0].issues.length === 0,'SOURCE_SELECTION','The selected row still has validation issues.',{issues:item[side][0].issues});
  }
  if (action !== 'replace') need(input.values === undefined,'INVALID_DECISION','Only a replacement decision accepts values.');
  if (action !== 'choose_source') need(input.side === undefined && input.rowNumber === undefined,'INVALID_DECISION','Only Choose source accepts side and rowNumber.');
  return result;
}
function applyDecisions(report, inputs, context, restoring = false) {
  need(Array.isArray(inputs) && inputs.length > 0,'INVALID_DECISION','Provide a nonempty array of decisions.');
  need(plain(context),'INVALID_DECISION_CONTEXT','Decision context is required.');
  const reviewer = id(context.reviewer,'Reviewer');
  need(Number.isSafeInteger(context.expectedRevision) && context.expectedRevision === report.revision,
    'REVISION_CONFLICT','The workspace revision changed; reload it before deciding.',{expectedRevision:context.expectedRevision,actualRevision:report.revision});
  const at = instant(context.at === undefined ? new Date().toISOString() : context.at,'Decision timestamp');
  const index = new Map(report.items.map(item => [item.id,item])), seen = new Set();
  const prepared = inputs.map(input => {
    need(plain(input) && typeof input.itemId === 'string' && index.has(input.itemId),'UNKNOWN_ITEM','The decision item does not belong to this comparison.');
    need(!seen.has(input.itemId),'DUPLICATE_BATCH_ITEM','A batch may decide each item only once.');
    seen.add(input.itemId);
    return decisionInput(index.get(input.itemId),input,report.rules);
  });
  let revision = report.revision;
  const decisions = {...report.decisions}, history = [...report.history];
  for (const input of prepared) {
    const previousDecision = own(decisions,input.itemId) ? decisions[input.itemId] : null;
    const beforeRevision = revision++;
    const decision = {...input,reviewer,at,revision};
    decisions[input.itemId] = decision;
    history.push({revision,beforeRevision,itemId:input.itemId,reviewer,at,input:clone(input),previousDecision});
  }
  return trustedReport(refreshed({...report,revision,decisions,history}));
}
export function decide(report, decision, context) { return applyDecisions(checkedReport(report),[decision],context); }
export function decideMany(report, decisions, context) { return applyDecisions(checkedReport(report),decisions,context); }

export function finalize(input) {
  const report = checkedReport(input);
  need(report.summary.pending === 0,'REVIEW_PENDING','Every changed, added, removed, or exceptional item needs a recorded decision.',{pending:report.summary.pending});
  need(report.blockingIssues.length === 0,'OUTPUT_CONFLICT','Accepted output has conflicting keys. Revise the conflicting decisions.',{issues:report.blockingIssues});
  const columns = report.rules.fields.map(field => field.name), rows = [], provenance = [];
  for (const item of report.items) {
    const decision = report.decisions[item.id] || null, selected = sourceSelection(item,decision);
    if (!selected) continue;
    rows.push(clone(selected.values));
    provenance.push({itemId:item.id,key:report.rules.keyFields.map(name => selected.values[name]),side:selected.side,
      rowNumber:selected.rowNumber,decision:decision ? clone(decision) : null});
  }
  const result = {status:'reviewed',requestId:report.requestId,comparisonId:report.comparisonId,revision:report.revision,
    columns,rows,provenance,summary:clone(report.summary),baselineEditionId:report.baseline.id,candidateEditionId:report.candidate.id};
  return freeze({...result,resultDigest:digest(result)});
}
function restoreReport(value) {
  need(plain(value) && value.schemaVersion === 1 && Array.isArray(value.history),'INVALID_WORKSPACE','The saved report must use schema version 1 and contain decision history.');
  const baseline = checkedEdition(value.baseline), candidate = checkedEdition(value.candidate);
  const initial = reconcile({requestId:value.requestId,baseline,candidate,rules:value.rules,
    ...(value.predecessor === undefined ? {} : {predecessor:value.predecessor})});
  const index = new Map(initial.items.map(item => [item.id,item]));
  const decisions = {}, history = [];
  let revision = 0;
  for (const event of value.history) {
    need(plain(event) && event.beforeRevision === revision && event.revision === revision + 1 &&
      plain(event.input) && event.itemId === event.input.itemId && index.has(event.itemId),
      'HISTORY_INTEGRITY','Decision history revisions and original item IDs must form a complete ordered chain.');
    const reviewer = id(event.reviewer,'Historical reviewer');
    const at = instant(event.at,'Historical decision timestamp');
    const input = decisionInput(index.get(event.itemId),event.input,initial.rules);
    const previousDecision = own(decisions,input.itemId) ? decisions[input.itemId] : null;
    const beforeRevision = revision++;
    const expectedEvent = {revision,beforeRevision,itemId:input.itemId,reviewer,at,input:clone(input),previousDecision};
    need(canonicalJSON(expectedEvent) === canonicalJSON(event),
      'HISTORY_INTEGRITY','A saved decision event differs from its reconstructed event.');
    decisions[input.itemId] = {...input,reviewer,at,revision};
    history.push(expectedEvent);
  }
  const report = trustedReport(refreshed({...initial,revision,decisions,history}));
  need(canonicalJSON(report) === canonicalJSON(value),'WORKSPACE_INTEGRITY','Saved derived data differs from the original sources, rules, or decision history.');
  return report;
}
export function serializeWorkspace(value) {
  const report = checkedReport(value), payload = clone(report);
  return canonicalJSON({format:'conapi-supplier-report',version:1,checksum:digest(payload),payload}) + '\n';
}
export function reopenWorkspace(value) {
  text(value,'Saved workspace');
  let envelope;
  try { envelope = JSON.parse(value); } catch { throw new ReportError('INVALID_WORKSPACE','Saved workspace must be valid JSON.'); }
  need(plain(envelope) && envelope.format === 'conapi-supplier-report' && envelope.version === 1 &&
    Object.keys(envelope).length === 4 && own(envelope,'checksum') && own(envelope,'payload'),
    'INVALID_WORKSPACE','Unsupported supplier workspace format.');
  need(typeof envelope.checksum === 'string' && /^[a-f0-9]{64}$/.test(envelope.checksum) &&
    envelope.checksum === digest(envelope.payload),'WORKSPACE_CHECKSUM','Saved workspace checksum does not match its payload.');
  return restoreReport(envelope.payload);
}


function csvCell(value) {
  const string = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(string) ? '"' + string.replace(/"/g,'""') + '"' : string;
}
function csvTable(columns,rows) {
  return [columns.map(csvCell).join(','),...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\r\n') + '\r\n';
}
export function exportCSV(input,{kind = 'changes'} = {}) {
  const report = checkedReport(input);
  need(kind === 'changes' || kind === 'accepted','INVALID_EXPORT','CSV kind must be changes or accepted.');
  if (kind === 'accepted') { const result = finalize(report); return csvTable(result.columns,result.rows); }
  const columns = ['request_id','comparison_id','revision','item_id','kind','key','field','label','before','after','delta','delta_reason',
    'baseline_rows','candidate_rows','issues','decision','reviewer','reason','decided_at'];
  const rows = [];
  for (const item of report.items) {
    if (item.kind === 'unchanged' && !own(report.decisions,item.id)) continue;
    const decision = report.decisions[item.id];
    for (const difference of item.differences.length ? item.differences : [null]) {
      rows.push({
        request_id:report.requestId,comparison_id:report.comparisonId,revision:report.revision,item_id:item.id,kind:item.kind,
        key:canonicalJSON(item.key),field:difference?.field || '',label:difference?.label || '',
        before:difference ? (difference.before === null ? 'null' : difference.before) : '',
        after:difference ? (difference.after === null ? 'null' : difference.after) : '',
        delta:difference?.delta ?? '',delta_reason:difference?.deltaReason || '',
        baseline_rows:canonicalJSON(item.baseline.map(row => ({rowNumber:row.rowNumber,raw:row.raw,values:row.values,issues:row.issues}))),
        candidate_rows:canonicalJSON(item.candidate.map(row => ({rowNumber:row.rowNumber,raw:row.raw,values:row.values,issues:row.issues}))),
        issues:canonicalJSON(item.issues),decision:decision?.action || '',reviewer:decision?.reviewer || '',
        reason:decision?.reason || '',decided_at:decision?.at || ''
      });
    }
  }
  return csvTable(columns,rows);
}
const escapeHTML = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function show(value) {
  return value === null || value === undefined ? '<span class="null">null</span>' :
    '<span class="value">'+escapeHTML(typeof value === 'object' ? canonicalJSON(value) : value)+'</span>';
}
function htmlTable(columns,rows,labels = {}) {
  if (!rows.length) return '<p class="empty">No rows.</p>';
  return '<div class="table-wrap"><table><thead><tr>'+columns.map(column => '<th scope="col">'+escapeHTML(labels[column] || column)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row => '<tr>'+columns.map(column => '<td>'+show(row[column])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function sourceHTML(edition,side) {
  const rows = edition.rows.map(row => ({source_row:row.rowNumber,source_line:row.lineNumber,...row.raw}));
  const columns = ['source_row','source_line',...edition.columns];
  const reserved = edition.columns.includes('source_row') || edition.columns.includes('source_line');
  const content = reserved ? edition.rows.map(row => '<details><summary>Source row '+row.rowNumber+' · line '+row.lineNumber+'</summary><pre>'+
    escapeHTML(canonicalJSON(row.raw))+'</pre></details>').join('') : htmlTable(columns,rows);
  return '<section><h2>'+escapeHTML(side)+' source</h2><dl><dt>Edition</dt><dd>'+escapeHTML(edition.id)+'</dd><dt>Source</dt><dd>'+
    escapeHTML(edition.sourceId)+'</dd><dt>Captured</dt><dd>'+escapeHTML(edition.capturedAt)+'</dd><dt>Source SHA-256</dt><dd class="hash">'+
    escapeHTML(edition.sourceDigest)+'</dd><dt>Edition SHA-256</dt><dd class="hash">'+escapeHTML(edition.digest)+'</dd></dl>'+
    '<details><summary>Source metadata and import dialect</summary><pre>'+escapeHTML(canonicalJSON({source:edition.source,delimiter:edition.delimiter}))+'</pre></details>'+
    content+'</section>';
}
export function exportHTML(input) {
  const report = checkedReport(input);
  const headline = report.status === 'reviewed' ? 'Review complete' : 'Review required';
  const labels = {baselineRows:'Baseline rows',candidateRows:'Candidate rows',totalItems:'Compared keys',addition:'Additions',removal:'Removals',
    change:'Changes',unchanged:'Unchanged',exception:'Exceptions',reviewRequired:'Items requiring review',resolved:'Decisions recorded',pending:'Pending decisions',blocking:'Output conflicts'};
  const summary = Object.entries(report.summary).map(([key,value]) => '<div><dt>'+escapeHTML(labels[key] || key)+'</dt><dd>'+value+'</dd></div>').join('');
  const itemSections = report.items.map(item => {
    const decision = report.decisions[item.id];
    const issueContent = item.issues.length ? '<h4>Source exceptions</h4>'+htmlTable(['code','field','message'],item.issues) : '';
    const changes = item.differences.length ? '<h4>Field comparison</h4>'+htmlTable(['label','before','after','delta','deltaReason'],item.differences,
      {label:'Field',before:'Baseline',after:'Candidate',delta:'Exact delta',deltaReason:'Delta basis'}) : '';
    const rowTables = ['baseline','candidate'].map(side => {
      if (!item[side].length) return '<h4>'+side+'</h4><p class="empty">No source row.</p>';
      return '<h4>'+side+'</h4>'+item[side].map(row => '<details><summary>Original row '+row.rowNumber+
        (row.issues.length ? ' · '+row.issues.length+' validation issue'+(row.issues.length === 1 ? '' : 's') : '')+
        '</summary><h5>Canonical values</h5>'+htmlTable(report.rules.fields.map(field => field.name),[row.values])+
        '<h5>Original values</h5>'+htmlTable(Object.keys(row.raw),[row.raw])+
        (row.issues.length ? htmlTable(['code','field','message'],row.issues) : '')+'</details>').join('');
    }).join('');
    const decisionContent = decision ? '<h4>Recorded decision</h4><dl><dt>Action</dt><dd>'+escapeHTML(decision.action)+
      '</dd><dt>Reviewer</dt><dd>'+escapeHTML(decision.reviewer)+'</dd><dt>Reason</dt><dd>'+escapeHTML(decision.reason)+
      '</dd><dt>Time</dt><dd>'+escapeHTML(decision.at)+'</dd><dt>Revision</dt><dd>'+decision.revision+'</dd></dl>'+
      (decision.values ? htmlTable(report.rules.fields.map(field => field.name),[decision.values]) : '')+
      (decision.side ? '<p>Selected '+escapeHTML(decision.side)+' row '+decision.rowNumber+'.</p>' : '') :
      '<p>'+(item.kind === 'unchanged' ? 'Canonical values agree under the configured comparison rules; the candidate row is accepted.' : 'A reviewer decision is pending.')+'</p>';
    return '<article id="'+escapeHTML(item.id)+'"><h3>'+escapeHTML(item.kind)+' · '+escapeHTML(canonicalJSON(item.key))+'</h3>'+
      '<p class="hash">'+escapeHTML(item.id)+'</p>'+issueContent+changes+decisionContent+rowTables+'</article>';
  }).join('');
  const accepted = report.status === 'reviewed' ? (() => {
    const result = finalize(report);
    return '<section><h2>Accepted canonical output</h2><p>'+result.rows.length+' rows · '+result.columns.length+
      ' configured columns. Nulls are retained in the workspace and SQLite export; CSV represents them as empty cells.</p>'+
      '<p class="hash">Result SHA-256: '+result.resultDigest+'</p>'+htmlTable(result.columns,result.rows)+'</section>';
  })() : '<section><h2>Accepted canonical output</h2><p>Complete the '+report.summary.pending+' pending decision'+(report.summary.pending === 1 ? '' : 's')+
    ' and resolve '+report.summary.blocking+' output conflict'+(report.summary.blocking === 1 ? '' : 's')+' to generate the accepted output.</p></section>';
  const history = report.history.map(event => ({revision:event.revision,item:event.itemId,action:event.input.action,reviewer:event.reviewer,
    reason:event.input.reason,at:event.at,previous:event.previousDecision}));
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Supplier feed review · '+escapeHTML(report.requestId)+'</title><style>'+
    '*,*::before,*::after{box-sizing:border-box}html{background:#eceeef;color:#1d2024;font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'+
    'body{margin:0}main{max-width:1440px;margin:auto;padding:28px}header,section{background:#fff;border:1px solid #b8bdc3;margin-bottom:20px;padding:24px}'+
    'h1{font-size:28px;margin:0 0 8px}h2{font-size:22px;margin:0 0 16px}h3{font-size:18px;margin:0 0 12px}h4{font-size:15px;margin:18px 0 8px}h5{font-size:14px;margin:12px 0 6px}'+
    'p{margin:8px 0 14px}dl{display:grid;grid-template-columns:minmax(110px,180px) minmax(0,1fr);gap:6px 16px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}'+
    '.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}.summary div{border:1px solid #ccd0d4;padding:12px}.summary dd{font-size:22px;margin-top:4px}'+
    '.table-wrap{overflow:auto;margin:10px 0 18px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #c6cbd0;padding:8px 10px;text-align:left;vertical-align:top;min-width:100px;max-width:420px;overflow-wrap:anywhere}'+
    'th{background:#f1f2f3;font-weight:600}article{border-top:2px solid #b8bdc3;padding:20px 0}article:first-of-type{border-top:0}details{border:1px solid #c6cbd0;padding:10px 12px;margin:10px 0}summary{cursor:pointer;font-weight:600}'+
    'pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.hash{font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}'+
    '.null,.empty{color:#62676d}.value{white-space:pre-wrap}.status{display:inline-block;border:1px solid #636a72;padding:4px 10px;font-weight:600}'+
    '@media(max-width:700px){main{padding:10px}header,section{padding:16px}dl{grid-template-columns:1fr}dd{margin-bottom:6px}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}}'+
    '@media print{html{background:#fff}main{max-width:none;padding:0}header,section{border:0;padding:12px 0}.table-wrap{overflow:visible}article{break-inside:avoid}details{break-inside:avoid}th,td{font-size:9px;min-width:0}summary{cursor:default}}'+
    '</style></head><body><main><header><h1>Supplier feed review</h1><p class="status">'+headline+'</p><dl><dt>Request</dt><dd>'+
    escapeHTML(report.requestId)+'</dd><dt>Comparison</dt><dd class="hash">'+escapeHTML(report.comparisonId)+'</dd><dt>Revision</dt><dd>'+
    report.revision+'</dd></dl><p>Compare original supplier sources under explicit field mappings. Every exception, change, addition, and removal retains its source rows and recorded review decision.</p></header>'+
    '<section><h2>Comparison summary</h2><dl class="summary">'+summary+'</dl>'+
    (report.blockingIssues.length ? '<h3>Output conflicts</h3>'+htmlTable(['code','key','itemIds','message'],report.blockingIssues) : '')+'</section>'+
    '<section><h2>Mapping and comparison rules</h2><p>Key fields: '+report.rules.keyFields.map(escapeHTML).join(', ')+
    '. Decimal deltas use exact arithmetic and require the configured currency, unit, and price basis to agree.</p>'+
    htmlTable(['name','label','type','baseline','candidate','required','trim','case','nullValues','aliases','allowedValues','min','max','tolerance','contextFields'],report.rules.fields)+
    '<details><summary>Complete rules JSON</summary><pre>'+escapeHTML(canonicalJSON(report.rules))+'</pre></details>'+
    (report.predecessor ? '<p>Recompared from '+escapeHTML(report.predecessor.comparisonId)+' revision '+report.predecessor.revision+'.</p>' : '')+'</section>'+
    accepted+'<section><h2>Review items</h2>'+itemSections+'</section>'+
    sourceHTML(report.baseline,'Baseline')+sourceHTML(report.candidate,'Candidate')+
    '<section><h2>Decision history</h2>'+htmlTable(['revision','item','action','reviewer','reason','at','previous'],history)+
    '<details><summary>Complete history JSON</summary><pre>'+escapeHTML(canonicalJSON(report.history))+'</pre></details></section>'+
    '<footer><p>Produced from the retained source editions and explicit rules for '+escapeHTML(report.requestId)+'.</p></footer></main></body></html>';
}
function utf8Hex(value) {
  const bytes = [];
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6),0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12),0x80 | ((code >> 6) & 63),0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18),0x80 | ((code >> 12) & 63),0x80 | ((code >> 6) & 63),0x80 | (code & 63));
  }
  return bytes.map(byte => byte.toString(16).padStart(2,'0')).join('');
}
function sqlString(value) {
  if (value === null) return 'NULL';
  return value.includes('\0') ? "CAST(X'"+utf8Hex(value)+"' AS TEXT)" : "'"+value.replace(/'/g,"''")+"'";
}
const sqlIdentifier = value => '"'+value.replace(/"/g,'""')+'"';
export function exportSQL(input,{tableName = 'supplier_feed_accepted'} = {}) {
  const result = finalize(input);
  need(typeof tableName === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(tableName),
    'INVALID_TABLE_NAME','Use a SQLite table name of 1–63 ASCII letters, digits, or underscores, starting with a letter or underscore.');
  const sqlNames = result.columns.map(column => column.replace(/[A-Z]/g, letter => letter.toLowerCase()));
  need(new Set(sqlNames).size === result.columns.length,
    'SQL_COLUMN_COLLISION','SQLite column identifiers must be unique without ASCII case differences. Rename the conflicting canonical columns before exporting SQL.');
  const table = sqlIdentifier(tableName), lineage = sqlIdentifier(tableName+'__lineage'), metadata = sqlIdentifier(tableName+'__metadata');
  const columnList = result.columns.map(sqlIdentifier).join(', ');
  const statements = [
    '-- Supplier accepted snapshot. Run with a SQLite executor that stops and rolls back on error.',
    '-- Existing tables with these names cause an error. Choose unused names for a new snapshot.',
    '-- Request: '+result.requestId,
    '-- Comparison: '+result.comparisonId+' / revision '+result.revision,
    'BEGIN IMMEDIATE;',
    'CREATE TABLE '+table+' ('+result.columns.map(column => sqlIdentifier(column)+' TEXT').join(', ')+');',
    'CREATE TABLE '+lineage+' (output_row INTEGER PRIMARY KEY, item_id TEXT NOT NULL, canonical_key TEXT NOT NULL, source_side TEXT NOT NULL, source_row INTEGER, decision_json TEXT);',
    'CREATE TABLE '+metadata+' (name TEXT PRIMARY KEY, value TEXT NOT NULL);'
  ];
  for (let index = 0; index < result.rows.length; index++) {
    const row = result.rows[index], origin = result.provenance[index];
    statements.push('INSERT INTO '+table+' ('+columnList+') VALUES ('+result.columns.map(column => sqlString(row[column])).join(', ')+');');
    statements.push('INSERT INTO '+lineage+' (output_row,item_id,canonical_key,source_side,source_row,decision_json) VALUES ('+
      (index+1)+','+sqlString(origin.itemId)+','+sqlString(canonicalJSON(origin.key))+','+sqlString(origin.side)+','+
      (origin.rowNumber === null ? 'NULL' : origin.rowNumber)+','+sqlString(origin.decision === null ? null : canonicalJSON(origin.decision))+');');
  }
  for (const [name,value] of Object.entries({format:'conapi-supplier-accepted',version:'1',requestId:result.requestId,
    comparisonId:result.comparisonId,revision:String(result.revision),resultDigest:result.resultDigest,
    baselineEditionId:result.baselineEditionId,candidateEditionId:result.candidateEditionId,columns:canonicalJSON(result.columns),
    summary:canonicalJSON(result.summary)})) {
    statements.push('INSERT INTO '+metadata+' (name,value) VALUES ('+sqlString(name)+','+sqlString(value)+');');
  }
  statements.push('COMMIT;','');
  return statements.join('\n');
}
