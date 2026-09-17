// ---------------------------------------------------------------------------
//  펌웨어 로직 호스트 테스트
//  장치에 올라가는 io_manager.cpp / app_logic.cpp 를 그대로 컴파일해서,
//  강제 입력 우선순위 · 펄스 만료 · 감시 이벤트 · 앱 로직 반응을 검증한다.
//
//    cd firmware/test && make test
// ---------------------------------------------------------------------------
#include "stub/Arduino.h"
#include "../src/io_manager.h"
#include "../src/app_logic.h"

#include <cstdio>
#include <vector>

static int g_pass = 0, g_fail = 0;

static void check(const char* name, bool cond, const char* extra = "") {
  if (cond) { g_pass++; printf("  [OK] %s\n", name); }
  else      { g_fail++; printf("  [!!] %s %s\n", name, extra); }
}

// 감시 이벤트 수집
struct Ev { uint8_t pin; int value; bool forced; };
static std::vector<Ev> g_events;
static void onChange(uint8_t pin, int value, bool forced) {
  g_events.push_back({pin, value, forced});
}

// 폴링 간격보다 확실히 크게 시간을 진행시키고 io::loop() 를 돌린다
static void tick(uint32_t ms = 60) {
  fakeAdvance(ms);
  io::loop();
  applogic::loop();
}

int main() {
  String err;

  printf("\n[1] 핀 유효성\n");
  check("GPIO22~25 는 존재하지 않음",
        !io::isValidPin(22) && !io::isValidPin(23) && !io::isValidPin(24) && !io::isValidPin(25));
  check("GPIO26~32 는 예약(Flash/PSRAM)",
        io::isReservedPin(26) && io::isReservedPin(32) && !io::isReservedPin(33));
  check("ADC 가능 핀은 1~20", io::isAdcCapable(1) && io::isAdcCapable(20) && !io::isAdcCapable(21));
  check("예약 핀 설정은 거부", !io::configure(30, IO_OUTPUT, err));
  check("거부 사유가 채워짐", err.length() > 0, err.c_str());

  io::begin();
  io::onPinChange(onChange);

  printf("\n[2] 출력 제어\n");
  check("출력 모드 설정", io::configure(48, IO_OUTPUT, err));
  check("HIGH 쓰기", io::write(48, 1, err) && io::read(48) == 1);
  check("실제 GPIO 도 HIGH", g_fakeGpio[48].level == 1);
  check("토글 -> LOW", io::toggle(48, err) && io::read(48) == 0);

  printf("\n[3] PWM\n");
  check("PWM 모드 설정", io::configure(47, IO_PWM, err), err.c_str());
  check("duty 반영", io::writePwm(47, 512, err) && io::info(47).pwmDuty == 512);
  check("duty 상한 클램프", io::writePwm(47, 99999, err) && io::info(47).pwmDuty == 1023);
  check("LEDC 채널 배정됨", io::info(47).ledcCh >= 0);
  check("LEDC 하드웨어에 전달", g_ledcDuty[io::info(47).ledcCh] == 1023);
  io::configure(47, IO_DISABLED, err);
  check("모드 해제 시 채널 반납", io::info(47).ledcCh < 0);

  printf("\n[4] 강제 입력이 물리 레벨을 이긴다\n");
  io::configure(4, IO_INPUT_PULLUP, err);
  check("풀업 아이들 = 1", io::read(4) == 1);
  fakeSetLevel(4, 0);
  check("물리 레벨 0 반영", io::read(4) == 0);
  check("강제 입력 1 주입", io::force(4, 1, err));
  check("물리는 0 이지만 읽으면 1", io::read(4) == 1 && io::readRaw(4) == 0);
  check("isForced 참", io::isForced(4));
  io::clearForce(4, err);
  check("해제하면 다시 물리값", io::read(4) == 0 && !io::isForced(4));
  fakeSetLevel(4, 1);

  printf("\n[5] ADC 강제 입력\n");
  io::configure(6, IO_ADC, err);
  fakeSetAnalog(6, 1200);
  check("물리 ADC 값", io::readAdc(6) == 1200);
  io::force(6, 3500, err);
  check("강제 ADC 값 우선", io::readAdc(6) == 3500 && io::readAdcRaw(6) == 1200);
  io::clearForce(6, err);

  printf("\n[6] 펄스 자동 복귀\n");
  io::write(48, 0, err);
  check("펄스 시작 시 HIGH", io::pulse(48, 1, 100, err) && io::read(48) == 1);
  tick(50);
  check("만료 전에는 유지", io::read(48) == 1);
  tick(80);
  check("만료 후 원래 값으로 복귀", io::read(48) == 0);

  io::force(4, 1, err);
  check("강제 펄스 중 주입값", io::forcePulse(4, 0, 100, err) && io::read(4) == 0);
  tick(130);
  check("강제 펄스 만료 후 이전 강제값 복원", io::isForced(4) && io::read(4) == 1);
  io::clearForce(4, err);

  printf("\n[7] 감시 이벤트\n");
  g_events.clear();
  io::setWatchInterval(10);
  io::setWatch(4, true, err);
  tick();
  check("감시 시작 시 최초 1회 보고", g_events.size() == 1 && g_events[0].pin == 4);
  g_events.clear();
  tick();
  check("값이 그대로면 이벤트 없음", g_events.empty());
  io::force(4, 0, err);
  tick();
  check("강제 입력 변화가 이벤트로", g_events.size() == 1 && g_events[0].value == 0 && g_events[0].forced);
  io::clearForce(4, err);

  g_events.clear();
  io::setWatch(6, true, err);
  tick();
  g_events.clear();
  fakeSetAnalog(6, 1210);
  tick();
  check("ADC 미세 변화(<32)는 무시", g_events.empty());
  fakeSetAnalog(6, 1500);
  tick();
  check("ADC 유의미한 변화는 보고", g_events.size() == 1 && g_events[0].value == 1500);
  io::setWatch(6, false, err);
  io::setWatch(4, false, err);

  printf("\n[8] 앱 로직 - 강제 입력만으로 동작 검증\n");
  AppLogicConfig cfg;
  cfg.enabled = true;
  cfg.buttonPin = 4;
  cfg.relayPin = 5;
  cfg.ledPin = 48;
  cfg.sensorPin = 6;
  cfg.alarmPin = 7;
  cfg.buttonActiveLow = true;
  cfg.debounceMs = 20;
  cfg.alarmThreshold = 3000;
  check("앱 로직 설정 적용", applogic::applyConfig(cfg, err), err.c_str());
  applogic::reset();

  io::force(4, 1, err);          // 눌리지 않은 상태로 고정
  tick(); tick();
  check("초기 릴레이 OFF", !applogic::relayState());

  io::force(4, 0, err);          // 누름
  tick(); tick();
  io::force(4, 1, err);          // 뗌
  tick(); tick();
  check("주입 1회 -> 릴레이 ON", applogic::relayState());
  check("릴레이 출력 핀 HIGH", io::read(5) == 1);
  check("누름 횟수 1", applogic::pressCount() == 1);

  io::force(4, 0, err);
  tick(); tick();
  io::force(4, 1, err);
  tick(); tick();
  check("주입 2회 -> 릴레이 OFF", !applogic::relayState() && io::read(5) == 0);

  printf("\n[9] 디바운스\n");
  applogic::reset();
  uint32_t before = applogic::pressCount();
  for (int i = 0; i < 6; i++) {    // 5ms 간격 채터링 - 디바운스(20ms)보다 짧다
    io::force(4, i % 2 ? 1 : 0, err);
    fakeAdvance(5);
    applogic::loop();
  }
  io::force(4, 1, err);
  tick(); tick();
  check("채터링은 한 번도 세지 않음", applogic::pressCount() == before,
        (String("presses=") + String((int)applogic::pressCount())).c_str());

  printf("\n[10] ADC 임계 경보\n");
  applogic::reset();
  io::force(6, 1000, err);
  tick();
  check("임계 미만이면 경보 없음", !applogic::alarmState() && io::read(7) == 0);
  io::force(6, 3500, err);
  tick();
  check("임계 초과 -> 경보 ON", applogic::alarmState() && io::read(7) == 1);
  io::force(6, 500, err);
  tick();
  check("값이 내려가면 경보 해제", !applogic::alarmState() && io::read(7) == 0);

  printf("\n[11] 전체 해제 / 초기화\n");
  io::force(4, 0, err);
  io::force(6, 100, err);
  io::clearAllForces();
  check("clearAllForces", !io::isForced(4) && !io::isForced(6));
  io::resetAll();
  check("resetAll 후 모드 초기화", io::info(48).mode == IO_DISABLED && io::info(4).mode == IO_DISABLED);

  printf("\n%s: %d 통과, %d 실패\n\n", g_fail ? "실패 있음" : "전체 통과", g_pass, g_fail);
  return g_fail ? 1 : 0;
}
