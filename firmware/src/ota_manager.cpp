#include "ota_manager.h"

#include <Update.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <mbedtls/base64.h>

namespace {

OtaState      g_state    = OTA_IDLE;
uint32_t      g_total    = 0;
uint32_t      g_received = 0;
String        g_via      = "";
String        g_error    = "";
uint32_t      g_lastData = 0;
uint32_t      g_rebootAt = 0;
OtaProgressCb g_cb       = nullptr;

uint32_t g_lastNotifyAt  = 0;
uint32_t g_lastNotifyPct = 255;

// 디코드 버퍼: 한 줄(MAX_LINE_LEN) 안에 담긴 base64 를 풀 수 있는 크기
uint8_t g_decodeBuf[(MAX_LINE_LEN * 3) / 4 + 8];

void fail(const String& why) {
  g_error = why;
  g_state = OTA_FAILED;
  if (Update.isRunning()) Update.abort();
}

void notifyProgress(bool force) {
  if (!g_cb) return;
  uint32_t now = millis();
  uint8_t pct = ota::percent();
  // 이벤트가 전송 대역을 잡아먹지 않도록 1% 또는 300ms 단위로만 알린다
  if (!force && pct == g_lastNotifyPct && now - g_lastNotifyAt < 300) return;
  g_lastNotifyPct = pct;
  g_lastNotifyAt = now;
  g_cb(g_received, g_total);
}

}  // namespace

namespace ota {

void begin() {
  g_state = OTA_IDLE;
}

void onProgress(OtaProgressCb cb) { g_cb = cb; }

OtaState    state()       { return g_state; }
uint32_t    received()    { return g_received; }
uint32_t    total()       { return g_total; }
const char* via()         { return g_via.c_str(); }
const char* lastError()   { return g_error.c_str(); }
bool        isReceiving() { return g_state == OTA_RECEIVING; }

uint8_t percent() {
  if (g_total == 0) return 0;
  uint64_t p = (uint64_t)g_received * 100 / g_total;
  return (uint8_t)(p > 100 ? 100 : p);
}

bool start(uint32_t size, const String& md5, const char* channel, String& err) {
  if (g_state == OTA_RECEIVING) {
    err = "이미 OTA 가 진행 중입니다(" + g_via + "). 먼저 취소하세요.";
    return false;
  }
  if (size == 0) { err = "이미지 크기가 0 입니다"; return false; }

  // 반대편 OTA 파티션이 있는지, 들어갈 만한 크기인지 먼저 확인한다
  const esp_partition_t* next = esp_ota_get_next_update_partition(nullptr);
  if (!next) {
    err = "OTA 파티션이 없습니다. 현재 파티션 테이블로는 OTA 를 쓸 수 없으니 "
          "USB 전체 플래시를 사용하세요.";
    return false;
  }
  if (size > next->size) {
    err = "이미지가 OTA 파티션보다 큽니다(" + String(size) + " > " + String((uint32_t)next->size) + ")";
    return false;
  }

  if (!Update.begin(size, U_FLASH)) {
    err = String("OTA 를 시작하지 못했습니다: ") + Update.errorString();
    return false;
  }

  // MD5 는 생략할 수 있지만(빈 문자열), 준 값이 이상하면 조용히 검증을 끄지 않고
  // 실패시킨다. 검증이 없는 줄 모르고 구우면 손상된 이미지를 그대로 받게 된다.
  if (md5.length() > 0) {
    bool valid = (md5.length() == 32);
    for (size_t i = 0; valid && i < md5.length(); i++) {
      char c = md5[i];
      valid = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    }
    if (!valid || !Update.setMD5(md5.c_str())) {
      Update.abort();
      err = "MD5 는 16진수 32자여야 합니다(검증을 건너뛰려면 비워 두세요)";
      return false;
    }
  }

  g_total    = size;
  g_received = 0;
  g_via      = channel ? channel : "?";
  g_error    = "";
  g_state    = OTA_RECEIVING;
  g_lastData = millis();
  g_lastNotifyPct = 255;
  notifyProgress(true);
  return true;
}

bool write(const uint8_t* data, size_t len, String& err) {
  if (g_state != OTA_RECEIVING) { err = "OTA 가 시작되지 않았습니다"; return false; }
  if (len == 0) return true;

  if (g_received + len > g_total) {
    fail("보낸 바이트가 선언한 크기를 넘었습니다");
    err = g_error;
    return false;
  }

  size_t written = Update.write((uint8_t*)data, len);
  if (written != len) {
    fail(String("플래시 쓰기 실패: ") + Update.errorString());
    err = g_error;
    return false;
  }

  g_received += written;
  g_lastData = millis();
  notifyProgress(false);
  return true;
}

bool writeBase64(const char* b64, size_t len, String& err) {
  if (g_state != OTA_RECEIVING) { err = "OTA 가 시작되지 않았습니다"; return false; }

  size_t olen = 0;
  int rc = mbedtls_base64_decode(g_decodeBuf, sizeof(g_decodeBuf), &olen,
                                 (const unsigned char*)b64, len);
  if (rc != 0) {
    fail("base64 조각을 해석하지 못했습니다");
    err = g_error;
    return false;
  }
  return write(g_decodeBuf, olen, err);
}

bool finish(String& err) {
  if (g_state != OTA_RECEIVING) { err = "OTA 가 진행 중이 아닙니다"; return false; }

  if (g_received != g_total) {
    fail("받은 크기가 맞지 않습니다(" + String(g_received) + "/" + String(g_total) + ")");
    err = g_error;
    return false;
  }

  if (!Update.end(true)) {                 // true = 끝까지 받았는지 확인 + MD5 검증
    fail(String("검증 실패: ") + Update.errorString());
    err = g_error;
    return false;
  }

  g_state = OTA_SUCCESS;
  notifyProgress(true);
  g_rebootAt = millis() + 800;             // 응답이 나갈 시간을 준 뒤 재부팅
  return true;
}

void cancel(const char* reason) {
  if (g_state == OTA_RECEIVING) {
    Update.abort();
    g_error = reason ? reason : "취소되었습니다";
    g_state = OTA_FAILED;
    notifyProgress(true);
  }
  g_rebootAt = 0;
}

void loop() {
  if (g_rebootAt && (int32_t)(millis() - g_rebootAt) >= 0) {
    ESP.restart();
  }

  // 업로드가 중간에 끊기면 플래시를 붙잡고 있지 않도록 정리한다
  if (g_state == OTA_RECEIVING && millis() - g_lastData > OTA_TIMEOUT_MS) {
    cancel("전송이 끊겼습니다(시간 초과)");
  }
}

}  // namespace ota
