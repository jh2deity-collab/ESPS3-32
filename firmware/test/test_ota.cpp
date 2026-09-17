// ---------------------------------------------------------------------------
//  OTA 상태 기계 호스트 테스트
//  장치에 올라가는 ota_manager.cpp 를 그대로 컴파일해서,
//  크기 검증 · base64 경로 · 실패 처리 · 타임아웃 · 재부팅 예약을 확인한다.
// ---------------------------------------------------------------------------
#include "stub/Arduino.h"
#include "stub/Update.h"
#include "stub/esp_ota_ops.h"
#include "../src/ota_manager.h"

#include <cstdio>
#include <string>
#include <vector>

static int g_pass = 0, g_fail = 0;
static void check(const char* name, bool cond, const char* extra = "") {
  if (cond) { g_pass++; printf("  [OK] %s\n", name); }
  else      { g_fail++; printf("  [!!] %s %s\n", name, extra); }
}

static uint32_t g_lastProgress = 0, g_progressCalls = 0;
static void onProgress(uint32_t received, uint32_t /*total*/) {
  g_lastProgress = received;
  g_progressCalls++;
}

static std::string b64encode(const std::vector<uint8_t>& in) {
  static const char* T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  for (size_t i = 0; i < in.size(); i += 3) {
    uint32_t v = in[i] << 16;
    if (i + 1 < in.size()) v |= in[i + 1] << 8;
    if (i + 2 < in.size()) v |= in[i + 2];
    out += T[(v >> 18) & 63];
    out += T[(v >> 12) & 63];
    out += (i + 1 < in.size()) ? T[(v >> 6) & 63] : '=';
    out += (i + 2 < in.size()) ? T[v & 63] : '=';
  }
  return out;
}

static std::vector<uint8_t> makeImage(size_t n) {
  std::vector<uint8_t> v(n);
  for (size_t i = 0; i < n; i++) v[i] = (uint8_t)((i * 31 + 7) & 0xFF);
  return v;
}

static void resetAll() {
  Update.reset();
  Update.setCapacity(0x330000);
  g_fakeHasOtaPartition = true;
  g_fakeRestarted = false;
  ota::cancel(nullptr);
  ota::begin();
  g_progressCalls = 0;
}

int main() {
  String err;
  ota::onProgress(onProgress);

  printf("\n[1] 시작 조건\n");
  resetAll();
  check("초기 상태는 idle", ota::state() == OTA_IDLE);
  check("크기 0 은 거부", !ota::start(0, "", "usb", err));
  g_fakeHasOtaPartition = false;
  check("OTA 파티션이 없으면 거부", !ota::start(1000, "", "usb", err));
  check("안내에 전체 플래시가 언급됨", std::string(err.c_str()).find("USB 전체 플래시") != std::string::npos, err.c_str());
  g_fakeHasOtaPartition = true;
  check("파티션보다 크면 거부", !ota::start(0x400000, "", "usb", err), err.c_str());
  check("길이가 틀린 MD5 는 거부", !ota::start(1000, "zz", "usb", err), err.c_str());
  check("16진수가 아닌 MD5 는 거부",
        !ota::start(1000, "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", "usb", err), err.c_str());
  check("거부 후에도 상태는 idle", ota::state() == OTA_IDLE);
  check("대문자 MD5 는 허용", ota::start(1000, "0123456789ABCDEF0123456789ABCDEF", "usb", err), err.c_str());
  ota::cancel(nullptr);
  check("빈 MD5 는 검증 생략으로 허용", ota::start(1000, "", "usb", err), err.c_str());
  ota::cancel(nullptr);

  printf("\n[2] 정상 업로드 (바이너리 경로)\n");
  resetAll();
  auto img = makeImage(5000);
  check("시작", ota::start(img.size(), "0123456789abcdef0123456789abcdef", "wifi", err), err.c_str());
  check("상태 receiving", ota::state() == OTA_RECEIVING);
  check("채널 기록", std::string(ota::via()) == "wifi", ota::via());
  check("MD5 가 Update 로 전달됨", Update.md5() == "0123456789abcdef0123456789abcdef", Update.md5().c_str());

  for (size_t off = 0; off < img.size(); off += 1024) {
    size_t n = std::min<size_t>(1024, img.size() - off);
    if (!ota::write(img.data() + off, n, err)) { check("쓰기 실패", false, err.c_str()); break; }
  }
  check("받은 바이트 = 전체", ota::received() == img.size());
  check("진행률 100%", ota::percent() == 100);
  check("진행 콜백이 불렸다", g_progressCalls > 0);
  check("마무리 성공", ota::finish(err), err.c_str());
  check("상태 success", ota::state() == OTA_SUCCESS);
  check("플래시 내용이 원본과 동일",
        Update.data().size() == img.size() &&
        memcmp(Update.data().data(), img.data(), img.size()) == 0);

  printf("\n[3] 완료 후 재부팅 예약\n");
  check("아직 재부팅하지 않음", !g_fakeRestarted);
  fakeAdvance(300);
  ota::loop();
  check("300ms 뒤에도 유지", !g_fakeRestarted);
  fakeAdvance(700);
  ota::loop();
  check("예약 시간이 지나면 재부팅", g_fakeRestarted);

  printf("\n[4] base64 경로 (USB/BLE)\n");
  resetAll();
  auto img2 = makeImage(3001);          // 3의 배수가 아니라 패딩이 생긴다
  check("시작", ota::start(img2.size(), "", "ble", err), err.c_str());
  for (size_t off = 0; off < img2.size(); off += 900) {
    size_t n = std::min<size_t>(900, img2.size() - off);
    std::vector<uint8_t> chunk(img2.begin() + off, img2.begin() + off + n);
    std::string enc = b64encode(chunk);
    if (!ota::writeBase64(enc.c_str(), enc.size(), err)) { check("base64 쓰기", false, err.c_str()); break; }
  }
  check("디코드 후 크기 일치", ota::received() == img2.size());
  check("마무리", ota::finish(err), err.c_str());
  check("바이트가 정확히 복원됨",
        Update.data().size() == img2.size() &&
        memcmp(Update.data().data(), img2.data(), img2.size()) == 0);
  check("잘못된 base64 는 거부", ({
    resetAll();
    ota::start(100, "", "usb", err);
    bool ok = ota::writeBase64("!!!not base64!!!", 16, err);
    !ok && ota::state() == OTA_FAILED;
  }));

  printf("\n[5] 크기 초과 / 부족\n");
  resetAll();
  ota::start(100, "", "usb", err);
  auto tooBig = makeImage(200);
  check("선언보다 많이 보내면 실패", !ota::write(tooBig.data(), 200, err), err.c_str());
  check("상태 failed", ota::state() == OTA_FAILED);

  resetAll();
  ota::start(100, "", "usb", err);
  auto part = makeImage(50);
  ota::write(part.data(), 50, err);
  check("덜 보내고 끝내면 실패", !ota::finish(err), err.c_str());

  printf("\n[6] 검증 실패 처리\n");
  resetAll();
  Update.failEndWith(true);            // MD5 불일치를 흉내 낸다
  auto img3 = makeImage(512);
  ota::start(img3.size(), "", "usb", err);
  ota::write(img3.data(), img3.size(), err);
  check("검증 실패 시 finish 는 실패", !ota::finish(err), err.c_str());
  check("오류 메시지에 사유 포함", std::string(ota::lastError()).find("검증 실패") != std::string::npos,
        ota::lastError());
  check("실패 후 재부팅 예약 없음", ({ fakeAdvance(2000); ota::loop(); !g_fakeRestarted; }));

  printf("\n[7] 중복 시작 / 취소 / 타임아웃\n");
  resetAll();
  ota::start(1000, "", "usb", err);
  check("진행 중 재시작은 거부", !ota::start(1000, "", "wifi", err), err.c_str());
  ota::cancel("사용자가 취소했습니다");
  check("취소하면 failed", ota::state() == OTA_FAILED);
  check("취소 후 다시 시작 가능", ota::start(1000, "", "wifi", err), err.c_str());

  resetAll();
  ota::start(1000, "", "usb", err);
  auto some = makeImage(100);
  ota::write(some.data(), 100, err);
  fakeAdvance(OTA_TIMEOUT_MS + 100);
  ota::loop();
  check("데이터가 끊기면 타임아웃 중단", ota::state() == OTA_FAILED);
  check("타임아웃 메시지", std::string(ota::lastError()).find("시간 초과") != std::string::npos,
        ota::lastError());
  check("시작 전 쓰기는 거부", ({ resetAll(); !ota::write(some.data(), 10, err); }));

  printf("\n%s: %d 통과, %d 실패\n\n", g_fail ? "실패 있음" : "전체 통과", g_pass, g_fail);
  return g_fail ? 1 : 0;
}
