#pragma once
#include <Arduino.h>

// ---------------------------------------------------------------------------
//  테스트 대상 애플리케이션 로직 (DUT: Device Under Test)
//
//  여기 있는 코드는 "실제 제품 동작" 을 흉내 낸 예시다. 중요한 점은
//  물리 핀을 digitalRead() 로 직접 읽지 않고 io::read() 를 쓴다는 것이며,
//  덕분에 웹 프로그램에서 강제 입력을 주입하면 배선 없이도 이 로직이
//  실제로 반응한다. 자신의 제품 로직으로 갈아 끼우면 그대로 테스트 하네스가 된다.
//
//  예시 동작:
//    - 버튼(입력)을 20ms 디바운스로 읽는다
//    - 버튼이 눌리면 릴레이(출력)를 토글한다
//    - 릴레이가 켜져 있으면 상태 LED 를 켜고, 꺼져 있으면 1초 주기로 깜빡인다
//    - 센서(ADC) 값이 임계치를 넘으면 경보 출력을 올린다
// ---------------------------------------------------------------------------

struct AppLogicConfig {
  int8_t   buttonPin  = 0;     // -1 이면 사용 안 함
  int8_t   relayPin   = -1;
  int8_t   ledPin     = 48;
  int8_t   sensorPin  = -1;    // ADC
  int8_t   alarmPin   = -1;
  bool     buttonActiveLow = true;
  uint16_t debounceMs = 20;
  uint16_t alarmThreshold = 3000;   // ADC raw
  bool     enabled    = false;
};

namespace applogic {
void begin();
void loop();
AppLogicConfig& config();
bool applyConfig(const AppLogicConfig& cfg, String& err);

// 현재 내부 상태 (웹 UI 표시용)
bool relayState();
bool alarmState();
uint32_t pressCount();
}  // namespace applogic
