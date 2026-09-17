#include "io_manager.h"

namespace {

PinInfo     g_pins[MAX_PINS];
PinChangeCb g_cb = nullptr;
uint32_t    g_watchInterval = DEFAULT_WATCH_INTERVAL_MS;
uint32_t    g_lastPoll = 0;
bool        g_ledcUsed[MAX_LEDC_CHANNELS] = {false};

// 펄스 예약 (핀당 1개)
struct Pulse {
  bool     active   = false;
  bool     isForce  = false;   // 강제 입력 펄스인가, 실제 출력 펄스인가
  int      restore  = 0;       // 종료 시 되돌릴 값
  bool     restoreForced = false;
  uint32_t expireAt = 0;
};
Pulse g_pulse[MAX_PINS];

int8_t allocLedc() {
  for (int8_t i = 0; i < MAX_LEDC_CHANNELS; i++) {
    if (!g_ledcUsed[i]) { g_ledcUsed[i] = true; return i; }
  }
  return -1;
}

void freeLedc(int8_t ch) {
  if (ch >= 0 && ch < MAX_LEDC_CHANNELS) g_ledcUsed[ch] = false;
}

}  // namespace

namespace io {

// ---------------------------------------------------------------------------
//  핀 메타데이터
// ---------------------------------------------------------------------------
bool isValidPin(uint8_t pin) {
  if (pin >= MAX_PINS) return false;
  if (pin >= 22 && pin <= 25) return false;   // ESP32-S3 에는 존재하지 않는 번호
  return true;
}

bool isReservedPin(uint8_t pin) {
  // GPIO26~32 : 내장 SPI Flash / PSRAM 전용. 건드리면 즉시 크래시한다.
  if (pin >= 26 && pin <= 32) return true;
  return false;
}

bool isAdcCapable(uint8_t pin) {
  // ADC1: GPIO1~10, ADC2: GPIO11~20
  return pin >= 1 && pin <= 20;
}

const char* modeName(uint8_t mode) {
  switch (mode) {
    case IO_INPUT:          return "input";
    case IO_INPUT_PULLUP:   return "input_pullup";
    case IO_INPUT_PULLDOWN: return "input_pulldown";
    case IO_OUTPUT:         return "output";
    case IO_PWM:            return "pwm";
    case IO_ADC:            return "adc";
    default:                return "disabled";
  }
}

bool parseMode(const char* s, uint8_t& out) {
  if (!s) return false;
  if (!strcmp(s, "input"))          { out = IO_INPUT;          return true; }
  if (!strcmp(s, "input_pullup"))   { out = IO_INPUT_PULLUP;   return true; }
  if (!strcmp(s, "input_pulldown")) { out = IO_INPUT_PULLDOWN; return true; }
  if (!strcmp(s, "output"))         { out = IO_OUTPUT;         return true; }
  if (!strcmp(s, "pwm"))            { out = IO_PWM;            return true; }
  if (!strcmp(s, "adc"))            { out = IO_ADC;            return true; }
  if (!strcmp(s, "disabled"))       { out = IO_DISABLED;       return true; }
  return false;
}

static bool checkPin(uint8_t pin, String& err) {
  if (!isValidPin(pin))    { err = "존재하지 않는 GPIO: " + String(pin); return false; }
  if (isReservedPin(pin))  { err = "GPIO" + String(pin) + " 은(는) Flash/PSRAM 전용이라 사용할 수 없습니다"; return false; }
  return true;
}

void begin() {
  analogReadResolution(12);
  for (uint8_t i = 0; i < MAX_PINS; i++) g_pins[i] = PinInfo();
}

// ---------------------------------------------------------------------------
//  설정
// ---------------------------------------------------------------------------
bool configure(uint8_t pin, uint8_t mode, String& err) {
  if (!checkPin(pin, err)) return false;
  PinInfo& p = g_pins[pin];

  // 이전 모드 정리
  if (p.mode == IO_PWM && p.ledcCh >= 0) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcDetach(pin);
#else
    ledcDetachPin(pin);
#endif
    freeLedc(p.ledcCh);
    p.ledcCh = -1;
  }

  switch (mode) {
    case IO_DISABLED:
      pinMode(pin, INPUT);
      break;
    case IO_INPUT:
      pinMode(pin, INPUT);
      break;
    case IO_INPUT_PULLUP:
      pinMode(pin, INPUT_PULLUP);
      break;
    case IO_INPUT_PULLDOWN:
      pinMode(pin, INPUT_PULLDOWN);
      break;
    case IO_OUTPUT:
      pinMode(pin, OUTPUT);
      digitalWrite(pin, p.outValue ? HIGH : LOW);
      break;
    case IO_ADC:
      if (!isAdcCapable(pin)) { err = "GPIO" + String(pin) + " 은(는) ADC 입력이 아닙니다"; return false; }
      pinMode(pin, INPUT);
      break;
    case IO_PWM: {
      int8_t ch = allocLedc();
      if (ch < 0) { err = "사용 가능한 LEDC 채널이 없습니다(최대 " + String(MAX_LEDC_CHANNELS) + "개)"; return false; }
      p.ledcCh = ch;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
      if (!ledcAttach(pin, p.pwmFreq, p.pwmRes)) {
        freeLedc(ch); p.ledcCh = -1;
        err = "LEDC 설정 실패"; return false;
      }
      ledcWrite(pin, p.pwmDuty);
#else
      ledcSetup(ch, p.pwmFreq, p.pwmRes);
      ledcAttachPin(pin, ch);
      ledcWrite(ch, p.pwmDuty);
#endif
      break;
    }
    default:
      err = "알 수 없는 모드"; return false;
  }

  p.mode = mode;
  p.lastValue = -1;   // 다음 폴링에서 반드시 한 번 보고하도록
  return true;
}

bool configurePwm(uint8_t pin, uint32_t freq, uint8_t resolution, String& err) {
  if (!checkPin(pin, err)) return false;
  if (freq < 1 || freq > 40000000UL) { err = "PWM 주파수 범위를 벗어났습니다"; return false; }
  if (resolution < 1 || resolution > 14) { err = "PWM 해상도는 1~14비트입니다"; return false; }

  PinInfo& p = g_pins[pin];
  p.pwmFreq = freq;
  p.pwmRes  = resolution;
  uint16_t maxDuty = (1u << resolution) - 1;
  if (p.pwmDuty > maxDuty) p.pwmDuty = maxDuty;

  if (p.mode == IO_PWM) return configure(pin, IO_PWM, err);   // 재부착
  return true;
}

void resetAll() {
  String err;
  for (uint8_t i = 0; i < MAX_PINS; i++) {
    if (!isValidPin(i) || isReservedPin(i)) continue;
    if (g_pins[i].mode != IO_DISABLED) configure(i, IO_DISABLED, err);
    g_pins[i] = PinInfo();
    g_pulse[i] = Pulse();
  }
}

// ---------------------------------------------------------------------------
//  읽기 / 쓰기
// ---------------------------------------------------------------------------
int readRaw(uint8_t pin) {
  if (!isValidPin(pin) || isReservedPin(pin)) return -1;
  return digitalRead(pin) ? 1 : 0;
}

int read(uint8_t pin) {
  if (!isValidPin(pin) || isReservedPin(pin)) return -1;
  const PinInfo& p = g_pins[pin];
  if (p.forced) return p.forcedValue ? 1 : 0;           // ★ 강제 입력 우선
  if (p.mode == IO_OUTPUT) return p.outValue ? 1 : 0;
  return digitalRead(pin) ? 1 : 0;
}

int readAdcRaw(uint8_t pin) {
  if (!isAdcCapable(pin)) return -1;
  return analogRead(pin);
}

int readAdc(uint8_t pin) {
  if (!isValidPin(pin)) return -1;
  const PinInfo& p = g_pins[pin];
  if (p.forced) return p.forcedValue;                    // ★ 강제 입력 우선
  return readAdcRaw(pin);
}

bool write(uint8_t pin, int value, String& err) {
  if (!checkPin(pin, err)) return false;
  PinInfo& p = g_pins[pin];
  if (p.mode != IO_OUTPUT) {
    if (!configure(pin, IO_OUTPUT, err)) return false;    // 편의를 위해 자동 전환
  }
  p.outValue = value ? true : false;
  digitalWrite(pin, p.outValue ? HIGH : LOW);
  return true;
}

bool toggle(uint8_t pin, String& err) {
  if (!checkPin(pin, err)) return false;
  return write(pin, g_pins[pin].outValue ? 0 : 1, err);
}

bool writePwm(uint8_t pin, uint16_t duty, String& err) {
  if (!checkPin(pin, err)) return false;
  PinInfo& p = g_pins[pin];
  if (p.mode != IO_PWM) {
    if (!configure(pin, IO_PWM, err)) return false;
  }
  uint16_t maxDuty = (1u << p.pwmRes) - 1;
  if (duty > maxDuty) duty = maxDuty;
  p.pwmDuty = duty;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(pin, duty);
#else
  ledcWrite(p.ledcCh, duty);
#endif
  return true;
}

// ---------------------------------------------------------------------------
//  강제 입력 (가상 입력 주입)
// ---------------------------------------------------------------------------
bool force(uint8_t pin, int value, String& err) {
  if (!checkPin(pin, err)) return false;
  PinInfo& p = g_pins[pin];
  p.forced      = true;
  p.forcedValue = value;
  return true;
}

bool clearForce(uint8_t pin, String& err) {
  if (!checkPin(pin, err)) return false;
  g_pins[pin].forced = false;
  return true;
}

void clearAllForces() {
  for (uint8_t i = 0; i < MAX_PINS; i++) g_pins[i].forced = false;
}

bool isForced(uint8_t pin) {
  return isValidPin(pin) && g_pins[pin].forced;
}

// ---------------------------------------------------------------------------
//  펄스
// ---------------------------------------------------------------------------
bool pulse(uint8_t pin, int value, uint32_t ms, String& err) {
  if (!checkPin(pin, err)) return false;
  if (ms == 0 || ms > 600000UL) { err = "펄스 길이는 1~600000ms 입니다"; return false; }
  PinInfo& p = g_pins[pin];
  int restore = p.outValue ? 1 : 0;
  if (!write(pin, value, err)) return false;
  Pulse& q = g_pulse[pin];
  q.active   = true;
  q.isForce  = false;
  q.restore  = restore;
  q.expireAt = millis() + ms;
  return true;
}

bool forcePulse(uint8_t pin, int value, uint32_t ms, String& err) {
  if (!checkPin(pin, err)) return false;
  if (ms == 0 || ms > 600000UL) { err = "펄스 길이는 1~600000ms 입니다"; return false; }
  PinInfo& p = g_pins[pin];
  Pulse& q = g_pulse[pin];
  q.active        = true;
  q.isForce       = true;
  q.restoreForced = p.forced;
  q.restore       = p.forcedValue;
  q.expireAt      = millis() + ms;
  return force(pin, value, err);
}

// ---------------------------------------------------------------------------
//  감시
// ---------------------------------------------------------------------------
bool setWatch(uint8_t pin, bool on, String& err) {
  if (!checkPin(pin, err)) return false;
  g_pins[pin].watch = on;
  if (on) g_pins[pin].lastValue = -1;   // 최초 1회는 무조건 보고
  return true;
}

void setWatchInterval(uint32_t ms) {
  if (ms < MIN_WATCH_INTERVAL_MS) ms = MIN_WATCH_INTERVAL_MS;
  g_watchInterval = ms;
}

uint32_t watchInterval() { return g_watchInterval; }

void onPinChange(PinChangeCb cb) { g_cb = cb; }

// ---------------------------------------------------------------------------
//  상태
// ---------------------------------------------------------------------------
const PinInfo& info(uint8_t pin) {
  static PinInfo dummy;
  if (!isValidPin(pin)) return dummy;
  return g_pins[pin];
}

int logicalValue(uint8_t pin) {
  if (!isValidPin(pin) || isReservedPin(pin)) return -1;
  const PinInfo& p = g_pins[pin];
  switch (p.mode) {
    case IO_ADC:  return readAdc(pin);
    case IO_PWM:  return p.pwmDuty;
    default:      return read(pin);
  }
}

// ---------------------------------------------------------------------------
//  주기 처리
// ---------------------------------------------------------------------------
void loop() {
  uint32_t now = millis();

  // 펄스 만료
  for (uint8_t i = 0; i < MAX_PINS; i++) {
    Pulse& q = g_pulse[i];
    if (!q.active) continue;
    if ((int32_t)(now - q.expireAt) < 0) continue;
    q.active = false;
    String err;
    if (q.isForce) {
      if (q.restoreForced) force(i, q.restore, err);
      else                 clearForce(i, err);
    } else {
      write(i, q.restore, err);
    }
  }

  // 감시 폴링
  if (now - g_lastPoll < g_watchInterval) return;
  g_lastPoll = now;

  for (uint8_t i = 0; i < MAX_PINS; i++) {
    PinInfo& p = g_pins[i];
    if (!p.watch || !isValidPin(i) || isReservedPin(i)) continue;
    int v = logicalValue(i);
    if (v == p.lastValue) continue;
    // ADC 는 미세 노이즈로 매번 바뀌므로 유의미한 변화만 보고한다.
    if (p.mode == IO_ADC && p.lastValue >= 0 && abs(v - p.lastValue) < 32) continue;
    p.lastValue = v;
    if (g_cb) g_cb(i, v, p.forced);
  }
}

}  // namespace io
