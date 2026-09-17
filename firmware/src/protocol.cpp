#include "protocol.h"
#include "io_manager.h"
#include "app_logic.h"
#include "transport_usb.h"
#include "transport_ble.h"
#include "transport_wifi.h"

#include <WiFi.h>
#include <esp_system.h>

namespace {

ITransport* g_transports[4] = {nullptr, nullptr, nullptr, nullptr};
uint8_t     g_count = 0;

// ---- 응답 헬퍼 -------------------------------------------------------------
void sendDoc(ITransport* t, JsonDocument& doc) {
  String out;
  serializeJson(doc, out);
  protocol::sendRaw(t, out);
}

void replyError(ITransport* t, long id, const String& msg) {
  JsonDocument doc;
  if (id >= 0) doc["id"] = id;
  doc["ok"]    = false;
  doc["error"] = msg;
  sendDoc(t, doc);
}

// 인자 추출 헬퍼
bool argPin(JsonObjectConst args, uint8_t& pin, String& err, const char* key = "pin") {
  if (!args[key].is<int>()) { err = "'" + String(key) + "' 인자가 필요합니다"; return false; }
  int v = args[key].as<int>();
  if (v < 0 || v >= MAX_PINS) { err = "핀 번호 범위를 벗어났습니다: " + String(v); return false; }
  pin = (uint8_t)v;
  return true;
}

}  // namespace

namespace protocol {

void registerTransport(ITransport* t) {
  if (g_count < 4) g_transports[g_count++] = t;
}

void sendRaw(ITransport* t, const String& line) {
  if (t) t->sendLine(line);
}

void broadcastRaw(const String& line) {
  for (uint8_t i = 0; i < g_count; i++) {
    ITransport* t = g_transports[i];
    if (!t || !t->isConnected()) continue;
    int32_t saved = t->activeClient;
    t->activeClient = -1;          // 모든 클라이언트에게
    t->sendLine(line);
    t->activeClient = saved;
  }
}

void broadcastEvent(const char* evt) {
  JsonDocument doc;
  doc["evt"] = evt;
  doc["ts"]  = millis();
  String out;
  serializeJson(doc, out);
  broadcastRaw(out);
}

// ---------------------------------------------------------------------------
//  핀 상태 직렬화
// ---------------------------------------------------------------------------
void fillPinState(JsonObject o, uint8_t pin) {
  const PinInfo& p = io::info(pin);
  o["pin"]    = pin;
  o["mode"]   = io::modeName(p.mode);
  o["value"]  = io::logicalValue(pin);
  o["raw"]    = (p.mode == IO_ADC) ? io::readAdcRaw(pin) : io::readRaw(pin);
  o["forced"] = p.forced;
  if (p.forced) o["forcedValue"] = p.forcedValue;
  if (p.mode == IO_OUTPUT) o["out"] = p.outValue ? 1 : 0;
  if (p.mode == IO_PWM) {
    o["duty"] = p.pwmDuty;
    o["freq"] = p.pwmFreq;
    o["res"]  = p.pwmRes;
  }
  if (p.watch) o["watch"] = true;
}

static void broadcastPinState(uint8_t pin) {
  broadcastEvent("pin.state", [pin](JsonObject d) { fillPinState(d, pin); });
}

// ---------------------------------------------------------------------------
//  sys.info
// ---------------------------------------------------------------------------
static void fillSysInfo(JsonObject r) {
  r["model"]    = DEVICE_MODEL;
  r["fw"]       = FW_VERSION;
  r["proto"]    = PROTOCOL_VERSION;
  r["chip"]     = ESP.getChipModel();
  r["cores"]    = ESP.getChipCores();
  r["cpuMhz"]   = ESP.getCpuFreqMHz();
  r["flashMB"]  = ESP.getFlashChipSize() / (1024 * 1024);
  r["psramMB"]  = ESP.getPsramSize() / (1024 * 1024);
  r["freeHeap"] = ESP.getFreeHeap();
  r["freePsram"]= ESP.getFreePsram();
  r["uptimeMs"] = millis();
  r["mac"]      = WiFi.macAddress();
  r["watchMs"]  = io::watchInterval();

  JsonObject tr = r["transports"].to<JsonObject>();
  tr["usb"]  = g_usb.isConnected();
  tr["ble"]  = g_ble.isConnected();
  tr["wifi"] = g_wifi.isConnected();

  JsonObject net = r["net"].to<JsonObject>();
  net["mode"]    = g_wifi.apActive() ? "ap" : (g_wifi.staConnected() ? "sta" : "off");
  net["ip"]      = g_wifi.ip();
  net["ssid"]    = g_wifi.ssid();
  net["host"]    = g_wifi.hostname() + ".local";
  net["clients"] = g_wifi.clientCount();

  r["bleName"] = g_ble.deviceName();
}

static void fillWifiStatus(JsonObject r) {
  r["mode"]      = g_wifi.apActive() ? "ap" : (g_wifi.staConnected() ? "sta" : "connecting");
  r["connected"] = g_wifi.staConnected();
  r["ip"]        = g_wifi.ip();
  r["ssid"]      = g_wifi.ssid();
  r["rssi"]      = g_wifi.rssi();
  r["host"]      = g_wifi.hostname() + ".local";
  r["ws"]        = g_wifi.ip().length() ? ("ws://" + g_wifi.ip() + ":" + String(WS_PORT) + "/") : "";
  r["clients"]   = g_wifi.clientCount();
}

static void fillAppStatus(JsonObject r) {
  AppLogicConfig& c = applogic::config();
  r["enabled"]    = c.enabled;
  r["buttonPin"]  = c.buttonPin;
  r["relayPin"]   = c.relayPin;
  r["ledPin"]     = c.ledPin;
  r["sensorPin"]  = c.sensorPin;
  r["alarmPin"]   = c.alarmPin;
  r["activeLow"]  = c.buttonActiveLow;
  r["debounceMs"] = c.debounceMs;
  r["threshold"]  = c.alarmThreshold;
  r["relay"]      = applogic::relayState();
  r["alarm"]      = applogic::alarmState();
  r["presses"]    = applogic::pressCount();
}

void sendHello(ITransport* t) {
  JsonDocument doc;
  doc["evt"] = "hello";
  doc["ts"]  = millis();
  JsonObject d = doc["data"].to<JsonObject>();
  d["via"] = t->name();
  fillSysInfo(d);
  sendDoc(t, doc);
}

// ---------------------------------------------------------------------------
//  명령 라우터
// ---------------------------------------------------------------------------
void handleLine(const char* line, ITransport* src) {
  if (!line || !*line) return;

  JsonDocument req;
  DeserializationError e = deserializeJson(req, line);
  if (e) {
    replyError(src, -1, String("JSON 파싱 실패: ") + e.c_str());
    return;
  }

  long id = req["id"].is<long>() ? req["id"].as<long>() : -1;
  const char* cmd = req["cmd"];
  if (!cmd) { replyError(src, id, "'cmd' 가 없습니다"); return; }

  JsonObjectConst args = req["args"].is<JsonObjectConst>() ? req["args"].as<JsonObjectConst>()
                                                           : JsonObjectConst();

  JsonDocument res;
  if (id >= 0) res["id"] = id;
  res["ok"] = true;
  JsonObject r = res["result"].to<JsonObject>();

  String err;
  uint8_t pin = 0;

  // ---- 시스템 -------------------------------------------------------------
  if (!strcmp(cmd, "sys.ping")) {
    r["pong"] = millis();

  } else if (!strcmp(cmd, "sys.info")) {
    fillSysInfo(r);

  } else if (!strcmp(cmd, "sys.pinmap")) {
    JsonArray arr = r["pins"].to<JsonArray>();
    for (uint8_t i = 0; i < MAX_PINS; i++) {
      if (!io::isValidPin(i)) continue;
      JsonObject o = arr.add<JsonObject>();
      o["pin"] = i;
      if (io::isReservedPin(i))  o["reserved"] = true;
      if (io::isAdcCapable(i))   o["adc"] = true;
    }

  } else if (!strcmp(cmd, "sys.reset")) {
    r["restarting"] = true;
    sendDoc(src, res);
    delay(150);
    ESP.restart();
    return;

  // ---- 핀 설정 / 출력 ------------------------------------------------------
  } else if (!strcmp(cmd, "io.config")) {
    uint8_t mode;
    if (!argPin(args, pin, err))                       { replyError(src, id, err); return; }
    if (!io::parseMode(args["mode"] | "", mode))       { replyError(src, id, "알 수 없는 mode"); return; }
    if (mode == IO_PWM) {
      uint32_t freq = args["freq"] | (uint32_t)io::info(pin).pwmFreq;
      uint8_t  bits = args["res"]  | io::info(pin).pwmRes;
      if (!io::configurePwm(pin, freq, bits, err))     { replyError(src, id, err); return; }
    }
    if (!io::configure(pin, mode, err))                { replyError(src, id, err); return; }
    fillPinState(r, pin);
    broadcastPinState(pin);

  } else if (!strcmp(cmd, "io.write")) {
    if (!argPin(args, pin, err))                       { replyError(src, id, err); return; }
    if (!args["value"].is<int>())                      { replyError(src, id, "'value' 인자가 필요합니다"); return; }
    if (!io::write(pin, args["value"].as<int>(), err)) { replyError(src, id, err); return; }
    fillPinState(r, pin);
    broadcastPinState(pin);

  } else if (!strcmp(cmd, "io.toggle")) {
    if (!argPin(args, pin, err))                       { replyError(src, id, err); return; }
    if (!io::toggle(pin, err))                         { replyError(src, id, err); return; }
    fillPinState(r, pin);
    broadcastPinState(pin);

  } else if (!strcmp(cmd, "io.pulse")) {
    if (!argPin(args, pin, err))                       { replyError(src, id, err); return; }
    {
      int      v  = args["value"] | 1;
      uint32_t ms = args["ms"]    | 100;
      if (!io::pulse(pin, v, ms, err))                 { replyError(src, id, err); return; }
    }
    fillPinState(r, pin);
    broadcastPinState(pin);

  } else if (!strcmp(cmd, "io.pwm")) {
    if (!argPin(args, pin, err))                       { replyError(src, id, err); return; }
    {
      uint32_t freq = args["freq"] | (uint32_t)io::info(pin).pwmFreq;
      uint8_t  bits = args["res"]  | io::info(pin).pwmRes;
      if (!io::configurePwm(pin, freq, bits, err))     { replyError(src, id, err); return; }
      uint16_t duty = (uint16_t)(args["duty"] | (int)io::info(pin).pwmDuty);
      if (!io::writePwm(pin, duty, err))               { replyError(src, id, err); return; }
    }
    fillPinState(r, pin);
    broadcastPinState(pin);

  // ---- 입력 읽기 -----------------------------------------------------------
  } else if (!strcmp(cmd, "io.read")) {
    if (!argPin(args, pin, err))                       { replyError(src, id, err); return; }
    fillPinState(r, pin);

  } else if (!strcmp(cmd, "io.adc")) {
    if (!argPin(args, pin, err))                       { replyError(src, id, err); return; }
    if (!io::isAdcCapable(pin))                        { replyError(src, id, "ADC 입력이 아닌 핀입니다"); return; }
    {
      int raw = io::readAdc(pin);
      r["pin"]    = pin;
      r["raw"]    = raw;
      r["mv"]     = raw < 0 ? -1 : (int)((long)raw * 3300 / 4095);
      r["forced"] = io::isForced(pin);
    }

  } else if (!strcmp(cmd, "io.snapshot")) {
    JsonArray arr = r["pins"].to<JsonArray>();
    if (args["pins"].is<JsonArrayConst>()) {
      for (JsonVariantConst v : args["pins"].as<JsonArrayConst>()) {
        int p = v.as<int>();
        if (p < 0 || p >= MAX_PINS || !io::isValidPin((uint8_t)p)) continue;
        fillPinState(arr.add<JsonObject>(), (uint8_t)p);
      }
    } else {
      // 기본값: 설정된(또는 강제 중인) 핀만 - 응답 크기를 줄인다
      bool all = args["all"] | false;
      for (uint8_t i = 0; i < MAX_PINS; i++) {
        if (!io::isValidPin(i) || io::isReservedPin(i)) continue;
        const PinInfo& p = io::info(i);
        if (!all && p.mode == IO_DISABLED && !p.forced && !p.watch) continue;
        fillPinState(arr.add<JsonObject>(), i);
      }
    }

  // ---- 감시 ---------------------------------------------------------------
  } else if (!strcmp(cmd, "io.watch")) {
    bool on = args["on"] | true;
    if (args["interval"].is<int>()) io::setWatchInterval(args["interval"].as<uint32_t>());
    if (args["pins"].is<JsonArrayConst>()) {
      for (JsonVariantConst v : args["pins"].as<JsonArrayConst>()) {
        int p = v.as<int>();
        if (p >= 0 && p < MAX_PINS) io::setWatch((uint8_t)p, on, err);
      }
    } else if (args["pin"].is<int>()) {
      if (!argPin(args, pin, err))                     { replyError(src, id, err); return; }
      if (!io::setWatch(pin, on, err))                 { replyError(src, id, err); return; }
    } else {
      replyError(src, id, "'pin' 또는 'pins' 인자가 필요합니다"); return;
    }
    r["on"]       = on;
    r["interval"] = io::watchInterval();

  } else if (!strcmp(cmd, "io.reset")) {
    io::resetAll();
    r["reset"] = true;
    broadcastEvent("io.reset");

  // ---- 강제 입력 (가상 입력 주입) -------------------------------------------
  } else if (!strcmp(cmd, "force.set")) {
    if (!argPin(args, pin, err))                       { replyError(src, id, err); return; }
    if (!args["value"].is<int>())                      { replyError(src, id, "'value' 인자가 필요합니다"); return; }
    if (!io::force(pin, args["value"].as<int>(), err)) { replyError(src, id, err); return; }
    fillPinState(r, pin);
    broadcastPinState(pin);

  } else if (!strcmp(cmd, "force.clear")) {
    if (!argPin(args, pin, err))                       { replyError(src, id, err); return; }
    if (!io::clearForce(pin, err))                     { replyError(src, id, err); return; }
    fillPinState(r, pin);
    broadcastPinState(pin);

  } else if (!strcmp(cmd, "force.clearAll")) {
    io::clearAllForces();
    r["cleared"] = true;
    broadcastEvent("force.clearAll");

  } else if (!strcmp(cmd, "force.pulse")) {
    if (!argPin(args, pin, err))                       { replyError(src, id, err); return; }
    {
      int      v  = args["value"] | 1;
      uint32_t ms = args["ms"]    | 100;
      if (!io::forcePulse(pin, v, ms, err))            { replyError(src, id, err); return; }
    }
    fillPinState(r, pin);
    broadcastPinState(pin);

  } else if (!strcmp(cmd, "force.list")) {
    JsonArray arr = r["pins"].to<JsonArray>();
    for (uint8_t i = 0; i < MAX_PINS; i++) {
      if (!io::isValidPin(i) || !io::isForced(i)) continue;
      fillPinState(arr.add<JsonObject>(), i);
    }

  // ---- 테스트 대상 앱 로직 --------------------------------------------------
  } else if (!strcmp(cmd, "app.status")) {
    fillAppStatus(r);

  } else if (!strcmp(cmd, "app.reset")) {
    applogic::reset();
    fillAppStatus(r);
    broadcastEvent("app.status", [](JsonObject d) { fillAppStatus(d); });

  } else if (!strcmp(cmd, "app.config")) {
    AppLogicConfig c = applogic::config();
    if (args["enabled"].is<bool>())    c.enabled         = args["enabled"];
    if (args["buttonPin"].is<int>())   c.buttonPin       = args["buttonPin"];
    if (args["relayPin"].is<int>())    c.relayPin        = args["relayPin"];
    if (args["ledPin"].is<int>())      c.ledPin          = args["ledPin"];
    if (args["sensorPin"].is<int>())   c.sensorPin       = args["sensorPin"];
    if (args["alarmPin"].is<int>())    c.alarmPin        = args["alarmPin"];
    if (args["activeLow"].is<bool>())  c.buttonActiveLow = args["activeLow"];
    if (args["debounceMs"].is<int>())  c.debounceMs      = args["debounceMs"];
    if (args["threshold"].is<int>())   c.alarmThreshold  = args["threshold"];
    if (!applogic::applyConfig(c, err))                { replyError(src, id, err); return; }
    fillAppStatus(r);

  // ---- 네트워크 ------------------------------------------------------------
  } else if (!strcmp(cmd, "wifi.status")) {
    fillWifiStatus(r);

  } else if (!strcmp(cmd, "wifi.connect")) {
    {
      String ssid = args["ssid"] | "";
      String pass = args["pass"] | "";
      bool   save = args["save"] | true;
      if (!g_wifi.connectSta(ssid, pass, save, err))   { replyError(src, id, err); return; }
      r["connecting"] = true;
      r["ssid"]       = ssid;
      r["note"]       = "wifi.status 로 접속 결과를 확인하세요";
    }

  } else if (!strcmp(cmd, "wifi.ap")) {
    g_wifi.startSoftAp();
    fillWifiStatus(r);

  } else if (!strcmp(cmd, "wifi.forget")) {
    g_wifi.forget();
    r["forgotten"] = true;

  } else if (!strcmp(cmd, "wifi.scan")) {
    {
      int n = WiFi.scanNetworks();
      JsonArray arr = r["networks"].to<JsonArray>();
      for (int i = 0; i < n && i < 20; i++) {
        JsonObject o = arr.add<JsonObject>();
        o["ssid"] = WiFi.SSID(i);
        o["rssi"] = WiFi.RSSI(i);
        o["open"] = (WiFi.encryptionType(i) == WIFI_AUTH_OPEN);
      }
      WiFi.scanDelete();
    }

  } else if (!strcmp(cmd, "ble.status")) {
    r["name"]      = g_ble.deviceName();
    r["connected"] = g_ble.isConnected();
    r["service"]   = BLE_SERVICE_UUID;

  } else {
    replyError(src, id, String("알 수 없는 명령: ") + cmd);
    return;
  }

  sendDoc(src, res);
}

}  // namespace protocol
