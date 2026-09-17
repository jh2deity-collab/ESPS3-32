// ---------------------------------------------------------------------------
//  호스트(PC)에서 펌웨어 로직을 그대로 컴파일해 돌리기 위한 최소 Arduino 스텁.
//  실제 장치 없이 io_manager / app_logic 의 동작을 검증하는 용도다.
//  GPIO 는 메모리상의 배열로 흉내 내고, millis() 는 테스트가 직접 진행시킨다.
// ---------------------------------------------------------------------------
#pragma once
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <string>

#define HIGH 1
#define LOW  0
#define INPUT           0x01
#define OUTPUT          0x03
#define INPUT_PULLUP    0x05
#define INPUT_PULLDOWN  0x09

// --- Arduino String 최소 구현 ----------------------------------------------
class String {
 public:
  String() {}
  String(const char* s) : s_(s ? s : "") {}
  String(const std::string& s) : s_(s) {}
  String(int v) { char b[24]; snprintf(b, sizeof(b), "%d", v); s_ = b; }
  String(unsigned int v) { char b[24]; snprintf(b, sizeof(b), "%u", v); s_ = b; }
  String(long v) { char b[24]; snprintf(b, sizeof(b), "%ld", v); s_ = b; }
  String(unsigned long v) { char b[24]; snprintf(b, sizeof(b), "%lu", v); s_ = b; }

  const char* c_str() const { return s_.c_str(); }
  size_t length() const { return s_.size(); }
  String& operator+=(const String& o) { s_ += o.s_; return *this; }
  friend String operator+(String a, const String& b) { a += b; return a; }
  bool operator==(const char* o) const { return s_ == o; }
  const std::string& str() const { return s_; }

 private:
  std::string s_;
};

// --- 가상 GPIO -------------------------------------------------------------
struct FakeGpio {
  uint8_t mode = INPUT;
  int     level = 0;        // 물리 레벨 (테스트가 직접 조작)
  int     analog = 0;
  int     ledcChannel = -1;
  bool    ledcAttached = false;
};

extern FakeGpio  g_fakeGpio[64];
extern uint32_t  g_fakeMillis;
extern int       g_ledcDuty[16];
extern uint32_t  g_ledcFreq[16];
extern uint8_t   g_ledcRes[16];

inline uint32_t millis() { return g_fakeMillis; }
inline void     delay(uint32_t ms) { g_fakeMillis += ms; }

inline void pinMode(uint8_t pin, uint8_t mode) {
  g_fakeGpio[pin].mode = mode;
  // 내부 풀 저항의 아이들 레벨을 흉내 낸다
  if (mode == INPUT_PULLUP)   g_fakeGpio[pin].level = 1;
  if (mode == INPUT_PULLDOWN) g_fakeGpio[pin].level = 0;
}
inline void digitalWrite(uint8_t pin, uint8_t v) { g_fakeGpio[pin].level = v ? 1 : 0; }
inline int  digitalRead(uint8_t pin) { return g_fakeGpio[pin].level; }
inline int  analogRead(uint8_t pin) { return g_fakeGpio[pin].analog; }
inline void analogReadResolution(uint8_t) {}

inline void ledcSetup(uint8_t ch, uint32_t freq, uint8_t res) {
  g_ledcFreq[ch] = freq;
  g_ledcRes[ch] = res;
}
inline void ledcAttachPin(uint8_t pin, uint8_t ch) {
  g_fakeGpio[pin].ledcChannel = ch;
  g_fakeGpio[pin].ledcAttached = true;
}
inline void ledcDetachPin(uint8_t pin) {
  g_fakeGpio[pin].ledcAttached = false;
  g_fakeGpio[pin].ledcChannel = -1;
}
inline void ledcWrite(uint8_t ch, uint32_t duty) { g_ledcDuty[ch] = (int)duty; }

// 테스트 편의: 물리 레벨/아날로그 값 주입
inline void fakeSetLevel(uint8_t pin, int v)  { g_fakeGpio[pin].level = v ? 1 : 0; }
inline void fakeSetAnalog(uint8_t pin, int v) { g_fakeGpio[pin].analog = v; }
inline void fakeAdvance(uint32_t ms)          { g_fakeMillis += ms; }
