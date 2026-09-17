// ---------------------------------------------------------------------------
//  MD5 (RFC 1321)
//
//  두 곳에서 쓴다.
//   1) USB 전체 플래시: 기록한 뒤 칩이 계산한 해시와 맞춰 본다(esptool 검증).
//   2) OTA: 장치의 Update.setMD5() 에 넘겨 전송 중 손상 여부를 잡는다.
//
//  파일이 수 MB 라 한 번에 들고 있지 않도록 증분(update/digest) 방식으로 둔다.
//  브라우저의 crypto.subtle 은 MD5 를 지원하지 않기 때문에 직접 구현한다.
//  (무결성 확인용이며 보안 용도가 아니다)
// ---------------------------------------------------------------------------

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(abs(sin(i+1)) * 2^32)
const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
}

const rotl = (x, c) => (x << c) | (x >>> (32 - c));

export class Md5 {
  constructor() {
    this.h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
    this.block = new Uint8Array(64);
    this.blockView = new DataView(this.block.buffer);
    this.blockLen = 0;
    this.totalLen = 0;
    this.M = new Uint32Array(16);
  }

  update(bytes) {
    let offset = 0;
    this.totalLen += bytes.length;

    // 이전에 남은 조각을 먼저 채운다
    if (this.blockLen > 0) {
      const need = 64 - this.blockLen;
      const take = Math.min(need, bytes.length);
      this.block.set(bytes.subarray(0, take), this.blockLen);
      this.blockLen += take;
      offset = take;
      if (this.blockLen === 64) {
        this._transform(this.block, 0);
        this.blockLen = 0;
      }
    }

    // 64바이트 단위로 바로 처리
    while (offset + 64 <= bytes.length) {
      this._transform(bytes, offset);
      offset += 64;
    }

    // 나머지는 다음 update 를 위해 보관
    if (offset < bytes.length) {
      this.block.set(bytes.subarray(offset), 0);
      this.blockLen = bytes.length - offset;
    }
    return this;
  }

  digest() {
    const bitLen = this.totalLen * 8;
    // 0x80 을 붙이고 길이 8바이트를 담을 자리를 남겨 64의 배수로 패딩
    const padLen = this.blockLen < 56 ? 56 - this.blockLen : 120 - this.blockLen;
    const tail = new Uint8Array(padLen + 8);
    tail[0] = 0x80;
    const tv = new DataView(tail.buffer);
    // 길이는 64비트 리틀엔디언. 2^53 을 넘는 파일은 다루지 않는다.
    tv.setUint32(padLen, bitLen >>> 0, true);
    tv.setUint32(padLen + 4, Math.floor(bitLen / 4294967296) >>> 0, true);
    this.update(tail);

    const out = new Uint8Array(16);
    const ov = new DataView(out.buffer);
    for (let i = 0; i < 4; i++) ov.setUint32(i * 4, this.h[i], true);
    return out;
  }

  hex() {
    return [...this.digest()].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  _transform(bytes, offset) {
    const M = this.M;
    // 입력 정렬이 어긋날 수 있으므로 바이트에서 직접 리틀엔디언으로 조립한다
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      M[i] = bytes[j] | (bytes[j + 1] << 8) | (bytes[j + 2] << 16) | (bytes[j + 3] << 24);
    }

    let a = this.h[0], b = this.h[1], c = this.h[2], d = this.h[3];

    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16)      { f = (b & c) | (~b & d);        g = i; }
      else if (i < 32) { f = (d & b) | (~d & c);        g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ d;                 g = (3 * i + 5) & 15; }
      else             { f = c ^ (b | ~d);              g = (7 * i) & 15; }

      const tmp = d;
      d = c;
      c = b;
      b = (b + rotl((a + f + K[i] + M[g]) | 0, S[i])) | 0;
      a = tmp;
    }

    this.h[0] = (this.h[0] + a) | 0;
    this.h[1] = (this.h[1] + b) | 0;
    this.h[2] = (this.h[2] + c) | 0;
    this.h[3] = (this.h[3] + d) | 0;
  }
}

/** 한 번에 해시 - Uint8Array 를 받아 소문자 16진수 문자열을 돌려준다 */
export function md5Hex(bytes) {
  return new Md5().update(bytes).hex();
}
