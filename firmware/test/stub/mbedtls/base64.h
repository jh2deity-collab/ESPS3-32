// mbedtls_base64_decode 의 최소 구현 (호스트 테스트용)
#pragma once
#include <cstddef>
#include <cstring>

inline int mbedtls_base64_decode(unsigned char* dst, size_t dlen, size_t* olen,
                                 const unsigned char* src, size_t slen) {
  static const char* T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  int8_t rev[256];
  memset(rev, -1, sizeof(rev));
  for (int i = 0; i < 64; i++) rev[(unsigned char)T[i]] = (int8_t)i;

  size_t out = 0;
  uint32_t acc = 0;
  int bits = 0;
  for (size_t i = 0; i < slen; i++) {
    unsigned char c = src[i];
    if (c == '=' || c == '\n' || c == '\r') continue;
    int8_t v = rev[c];
    if (v < 0) return -1;                      // MBEDTLS_ERR_BASE64_INVALID_CHARACTER
    acc = (acc << 6) | (uint32_t)v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (out >= dlen) return -2;              // MBEDTLS_ERR_BASE64_BUFFER_TOO_SMALL
      dst[out++] = (unsigned char)((acc >> bits) & 0xFF);
    }
  }
  *olen = out;
  return 0;
}
