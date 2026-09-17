#pragma once
#include <Arduino.h>
#include "config.h"

// ---------------------------------------------------------------------------
//  I/O 매니저
//
//  이 펌웨어의 핵심 아이디어:
//    - 모든 핀 접근은 io_read()/io_write() 를 통과한다.
//    - "강제 입력(force)" 이 걸린 핀은 물리 레벨과 무관하게 주입된 값을 돌려준다.
//      => 배선을 바꾸지 않고도 앱 로직(app_logic.cpp)을 테스트할 수 있다.
//    - "강제 출력" 은 실제 GPIO 를 구동한다(디지털/PWM).
// ---------------------------------------------------------------------------

enum IoMode : uint8_t {
  IO_DISABLED = 0,
  IO_INPUT,
  IO_INPUT_PULLUP,
  IO_INPUT_PULLDOWN,
  IO_OUTPUT,
  IO_PWM,
  IO_ADC,
};

struct PinInfo {
  uint8_t  mode        = IO_DISABLED;
  bool     outValue    = false;   // 디지털 출력 상태
  uint16_t pwmDuty     = 0;
  uint32_t pwmFreq     = 5000;
  uint8_t  pwmRes      = 10;      // bit
  int8_t   ledcCh      = -1;
  bool     forced      = false;   // 강제 입력(가상 입력) 적용 여부
  int      forcedValue = 0;       // 디지털 0/1 또는 ADC raw
  int      lastValue   = -1;      // 변화 감지용 마지막 논리값
  bool     watch       = false;   // 변화 이벤트 스트리밍 대상
};

// 이벤트 콜백: 감시 중인 핀 값이 변할 때 호출된다.
typedef void (*PinChangeCb)(uint8_t pin, int value, bool forced);

namespace io {

void begin();

// --- 핀 메타데이터 ---------------------------------------------------------
bool        isValidPin(uint8_t pin);     // 물리적으로 존재하는 GPIO 인가
bool        isReservedPin(uint8_t pin);  // Flash/PSRAM 등 건드리면 안 되는 핀
bool        isAdcCapable(uint8_t pin);
const char* modeName(uint8_t mode);
bool        parseMode(const char* s, uint8_t& out);

// --- 설정 ------------------------------------------------------------------
bool configure(uint8_t pin, uint8_t mode, String& err);
bool configurePwm(uint8_t pin, uint32_t freq, uint8_t resolution, String& err);
void resetAll();

// --- 읽기/쓰기 (강제값 우선) ------------------------------------------------
int  read(uint8_t pin);                  // 디지털 논리값 (강제값이 있으면 그것)
int  readRaw(uint8_t pin);               // 물리 레벨 (강제값 무시)
int  readAdc(uint8_t pin);               // ADC raw (강제값이 있으면 그것)
int  readAdcRaw(uint8_t pin);
bool write(uint8_t pin, int value, String& err);
bool toggle(uint8_t pin, String& err);
bool writePwm(uint8_t pin, uint16_t duty, String& err);

// --- 강제 입력(가상 입력) ---------------------------------------------------
bool force(uint8_t pin, int value, String& err);
bool clearForce(uint8_t pin, String& err);
void clearAllForces();
bool isForced(uint8_t pin);

// --- 펄스(비동기, loop 에서 종료 처리) --------------------------------------
bool pulse(uint8_t pin, int value, uint32_t ms, String& err);
bool forcePulse(uint8_t pin, int value, uint32_t ms, String& err);

// --- 감시 ------------------------------------------------------------------
bool setWatch(uint8_t pin, bool on, String& err);
void setWatchInterval(uint32_t ms);
uint32_t watchInterval();
void onPinChange(PinChangeCb cb);

// --- 상태 조회 --------------------------------------------------------------
const PinInfo& info(uint8_t pin);
int  logicalValue(uint8_t pin);          // 현재 모드에 맞는 대표값

void loop();                             // 폴링 + 펄스 만료 처리

}  // namespace io
