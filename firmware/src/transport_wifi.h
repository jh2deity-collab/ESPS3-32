#pragma once
#include "transport.h"

// WiFi 전송 - WebSocket 서버(포트 81).
// 브라우저에서 ws://<장치IP>:81/ 로 직접 접속한다.
// 포트 80 에는 상태 확인용 미니 HTTP 페이지를 띄워 둔다.
class TransportWiFi : public ITransport {
 public:
  const char* name() const override { return "wifi"; }
  void begin() override;
  void loop() override;
  bool isConnected() const override;      // WebSocket 클라이언트가 1개 이상인가
  void sendLine(const String& line) override;

  // --- 네트워크 제어 --------------------------------------------------------
  bool   connectSta(const String& ssid, const String& pass, bool save, String& err);
  void   startSoftAp();
  void   forget();

  bool   staConnected() const;
  bool   apActive() const { return apActive_; }
  String ip() const;
  String ssid() const;
  int8_t rssi() const;
  String hostname() const { return host_; }
  uint8_t clientCount() const { return clients_; }

  void onWsEvent(uint8_t num, int type, uint8_t* payload, size_t length);

 private:
  void startServers();

  String  host_;
  bool    apActive_   = false;
  bool    serversUp_  = false;
  uint8_t clients_    = 0;
  uint32_t staStartedAt_ = 0;
  bool    staPending_ = false;
  String  pendingSsid_, pendingPass_;
  bool    pendingSave_ = false;
};

extern TransportWiFi g_wifi;
