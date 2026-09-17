#include "app_logic.h"
#include "io_manager.h"

namespace {
AppLogicConfig g_cfg;
bool     g_relay      = false;
bool     g_alarm      = false;
uint32_t g_pressCount = 0;

int      g_lastRawBtn = -1;
uint32_t g_lastEdgeAt = 0;
int      g_stableBtn  = -1;
uint32_t g_blinkAt    = 0;
bool     g_blinkOn    = false;

inline bool pinUsed(int8_t p) { return p >= 0 && io::isValidPin((uint8_t)p) && !io::isReservedPin((uint8_t)p); }
}  // namespace

namespace applogic {

AppLogicConfig& config() { return g_cfg; }
bool relayState()  { return g_relay; }
bool alarmState()  { return g_alarm; }
uint32_t pressCount() { return g_pressCount; }

void begin() {
  // 기본값은 비활성. 웹에서 app.config 로 켠다.
}

bool applyConfig(const AppLogicConfig& cfg, String& err) {
  // 요청된 핀들을 실제 모드로 세팅한다.
  if (cfg.enabled) {
    if (pinUsed(cfg.buttonPin)) {
      uint8_t m = cfg.buttonActiveLow ? IO_INPUT_PULLUP : IO_INPUT_PULLDOWN;
      if (!io::configure((uint8_t)cfg.buttonPin, m, err)) return false;
    }
    if (pinUsed(cfg.relayPin) && !io::configure((uint8_t)cfg.relayPin, IO_OUTPUT, err)) return false;
    if (pinUsed(cfg.ledPin)   && !io::configure((uint8_t)cfg.ledPin,   IO_OUTPUT, err)) return false;
    if (pinUsed(cfg.alarmPin) && !io::configure((uint8_t)cfg.alarmPin, IO_OUTPUT, err)) return false;
    if (pinUsed(cfg.sensorPin)) {
      if (!io::isAdcCapable((uint8_t)cfg.sensorPin)) { err = "센서 핀은 ADC 가능 핀이어야 합니다"; return false; }
      if (!io::configure((uint8_t)cfg.sensorPin, IO_ADC, err)) return false;
    }
  }
  g_cfg = cfg;
  g_lastRawBtn = -1;
  g_stableBtn  = -1;
  return true;
}

void reset() {
  g_relay = false;
  g_alarm = false;
  g_pressCount = 0;
  g_lastRawBtn = -1;
  g_stableBtn  = -1;
  g_blinkOn    = false;
  String err;
  if (pinUsed(g_cfg.relayPin)) io::write((uint8_t)g_cfg.relayPin, 0, err);
  if (pinUsed(g_cfg.alarmPin)) io::write((uint8_t)g_cfg.alarmPin, 0, err);
}

void loop() {
  if (!g_cfg.enabled) return;
  uint32_t now = millis();

  // --- 버튼: 디바운스 후 상승/하강 에지 검출 -------------------------------
  if (pinUsed(g_cfg.buttonPin)) {
    int raw = io::read((uint8_t)g_cfg.buttonPin);      // ★ 강제 입력이 여기로 들어온다
    if (raw != g_lastRawBtn) {
      g_lastRawBtn = raw;
      g_lastEdgeAt = now;
    } else if (now - g_lastEdgeAt >= g_cfg.debounceMs && raw != g_stableBtn) {
      int prev = g_stableBtn;
      g_stableBtn = raw;
      bool pressed = g_cfg.buttonActiveLow ? (raw == 0) : (raw == 1);
      if (prev != -1 && pressed) {
        g_pressCount++;
        g_relay = !g_relay;
        String err;
        if (pinUsed(g_cfg.relayPin)) io::write((uint8_t)g_cfg.relayPin, g_relay ? 1 : 0, err);
      }
    }
  }

  // --- 상태 LED ------------------------------------------------------------
  if (pinUsed(g_cfg.ledPin)) {
    String err;
    if (g_relay) {
      io::write((uint8_t)g_cfg.ledPin, 1, err);
    } else if (now - g_blinkAt >= 1000) {
      g_blinkAt = now;
      g_blinkOn = !g_blinkOn;
      io::write((uint8_t)g_cfg.ledPin, g_blinkOn ? 1 : 0, err);
    }
  }

  // --- 센서 임계 경보 -------------------------------------------------------
  if (pinUsed(g_cfg.sensorPin)) {
    int v = io::readAdc((uint8_t)g_cfg.sensorPin);     // ★ 강제 입력이 여기로 들어온다
    bool alarm = (v >= 0) && (v >= (int)g_cfg.alarmThreshold);
    if (alarm != g_alarm) {
      g_alarm = alarm;
      String err;
      if (pinUsed(g_cfg.alarmPin)) io::write((uint8_t)g_cfg.alarmPin, alarm ? 1 : 0, err);
    }
  }
}

}  // namespace applogic
