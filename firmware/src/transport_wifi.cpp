#include "transport_wifi.h"
#include "protocol.h"
#include "ota_manager.h"

#include <WiFi.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WebSocketsServer.h>

TransportWiFi g_wifi;

namespace {
WebSocketsServer s_ws(WS_PORT);
WiFiServer       s_http(HTTP_PORT);
Preferences      s_prefs;

void wsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  g_wifi.onWsEvent(num, (int)type, payload, length);
}
}  // namespace

void TransportWiFi::begin() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char suffix[8];
  snprintf(suffix, sizeof(suffix), "%02X%02X", mac[4], mac[5]);
  host_ = String(DEFAULT_DEV_NAME) + "-" + suffix;
  host_.toLowerCase();

  WiFi.setHostname(host_.c_str());
  WiFi.setSleep(false);            // 응답 지연을 줄인다

  s_prefs.begin("esps3io", true);
  String ssid = s_prefs.getString("ssid", "");
  String pass = s_prefs.getString("pass", "");
  s_prefs.end();

  if (ssid.length()) {
    String err;
    connectSta(ssid, pass, false, err);
  } else {
    startSoftAp();
  }
}

// ---------------------------------------------------------------------------
//  STA / SoftAP
// ---------------------------------------------------------------------------
bool TransportWiFi::connectSta(const String& ssid, const String& pass, bool save, String& err) {
  if (ssid.length() == 0) { err = "SSID 가 비어 있습니다"; return false; }
  if (ssid.length() > 32) { err = "SSID 가 너무 깁니다"; return false; }

  if (save) {
    s_prefs.begin("esps3io", false);
    s_prefs.putString("ssid", ssid);
    s_prefs.putString("pass", pass);
    s_prefs.end();
  }

  apActive_ = false;
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.length() ? pass.c_str() : nullptr);

  staPending_   = true;
  staStartedAt_ = millis();
  pendingSsid_  = ssid;
  pendingPass_  = pass;
  pendingSave_  = save;
  return true;     // 접속 완료 여부는 wifi.status 로 폴링한다(블로킹하지 않음)
}

void TransportWiFi::startSoftAp() {
  staPending_ = false;
  WiFi.mode(WIFI_AP);
  String apSsid = host_;
  apSsid.toUpperCase();
  WiFi.softAP(apSsid.c_str(), SOFTAP_PASSWORD);
  apActive_ = true;
  startServers();
}

void TransportWiFi::forget() {
  s_prefs.begin("esps3io", false);
  s_prefs.remove("ssid");
  s_prefs.remove("pass");
  s_prefs.end();
}

bool TransportWiFi::staConnected() const { return WiFi.status() == WL_CONNECTED; }
bool TransportWiFi::isConnected() const  { return clients_ > 0; }

String TransportWiFi::ip() const {
  if (apActive_) return WiFi.softAPIP().toString();
  if (staConnected()) return WiFi.localIP().toString();
  return "";
}

String TransportWiFi::ssid() const {
  if (apActive_) { String s = host_; s.toUpperCase(); return s; }
  return WiFi.SSID();
}

int8_t TransportWiFi::rssi() const {
  return staConnected() ? (int8_t)WiFi.RSSI() : 0;
}

void TransportWiFi::startServers() {
  if (serversUp_) return;
  s_ws.begin();
  s_ws.onEvent(wsEvent);
  s_ws.enableHeartbeat(15000, 3000, 2);   // 죽은 연결 정리
  s_http.begin();
  s_http.setNoDelay(true);
  if (MDNS.begin(host_.c_str())) {
    MDNS.addService("http", "tcp", HTTP_PORT);
    MDNS.addService("ws", "tcp", WS_PORT);
  }
  serversUp_ = true;
}

// ---------------------------------------------------------------------------
//  WebSocket
// ---------------------------------------------------------------------------
void TransportWiFi::onWsEvent(uint8_t num, int type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      clients_++;
      activeClient = (int32_t)num;
      protocol::sendHello(this);
      activeClient = -1;
      break;

    case WStype_DISCONNECTED:
      if (clients_) clients_--;
      break;

    // 바이너리 프레임은 OTA 데이터 전용. base64 로 부풀리지 않아 가장 빠르다.
    case WStype_BIN: {
      if (!ota::isReceiving()) {
        activeClient = (int32_t)num;
        protocol::broadcastEvent("ota.done", [](JsonObject d) {
          d["ok"] = false;
          d["error"] = "OTA 를 시작하지 않은 채로 바이너리 데이터가 들어왔습니다";
        });
        activeClient = -1;
        break;
      }
      String e;
      if (!ota::write(payload, length, e)) {
        protocol::broadcastEvent("ota.done", [&e](JsonObject d) {
          d["ok"] = false;
          d["error"] = e;
        });
      }
      break;
    }

    case WStype_TEXT: {
      // WebSocket 은 메시지 경계가 보장되므로 그대로 한 줄로 취급한다.
      if (length == 0 || length >= MAX_LINE_LEN) break;
      static char line[MAX_LINE_LEN];
      memcpy(line, payload, length);
      line[length] = '\0';
      activeClient = (int32_t)num;
      protocol::handleLine(line, this);
      activeClient = -1;
      break;
    }
    default:
      break;
  }
}

void TransportWiFi::sendLine(const String& line) {
  if (!serversUp_ || clients_ == 0) return;
  // String& 를 받는 오버로드는 라이브러리 버전마다 const 여부가 달라서,
  // 어느 버전에나 있는 (const char*, length) 오버로드를 쓴다.
  if (activeClient >= 0) s_ws.sendTXT((uint8_t)activeClient, line.c_str(), line.length());
  else                   s_ws.broadcastTXT(line.c_str(), line.length());
}

// ---------------------------------------------------------------------------
//  주기 처리
// ---------------------------------------------------------------------------
void TransportWiFi::loop() {
  // STA 접속 진행 상태 감시
  if (staPending_) {
    if (staConnected()) {
      staPending_ = false;
      startServers();
      protocol::broadcastEvent("wifi.connected", [this](JsonObject d) {
        d["ip"]   = ip();
        d["ssid"] = ssid();
        d["host"] = host_ + ".local";
      });
    } else if (millis() - staStartedAt_ > WIFI_CONNECT_TIMEOUT_MS) {
      staPending_ = false;
      protocol::broadcastEvent("wifi.failed", [this](JsonObject d) {
        d["ssid"]     = pendingSsid_;
        d["fallback"] = "softap";
      });
      startSoftAp();     // 접속 실패 시 SoftAP 로 되돌아가 항상 접근 가능하게 한다
    }
  }

  if (!serversUp_) return;
  s_ws.loop();

  // 포트 80: 장치 정보 페이지(연결 주소 확인용)
  WiFiClient c = s_http.available();
  if (c) {
    // 여기서 오래 기다리면 WebSocket 처리까지 함께 멈춘다. 짧게만 기다린다.
    uint32_t t0 = millis();
    while (c.connected() && !c.available() && millis() - t0 < 150) delay(1);
    while (c.available()) c.read();          // 요청 헤더는 버린다

    String body = String("{\"device\":\"") + DEVICE_MODEL +
                  "\",\"name\":\"" + host_ +
                  "\",\"fw\":\"" + FW_VERSION +
                  "\",\"ws\":\"ws://" + ip() + ":" + String(WS_PORT) + "/\"}";
    c.print(String("HTTP/1.1 200 OK\r\n") +
            "Content-Type: application/json\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Content-Length: " + String(body.length()) + "\r\n" +
            "Connection: close\r\n\r\n" + body);
    c.stop();
  }
}
