#pragma once
#include "transport.h"

// BLE 전송 - Nordic UART Service(NUS) 호환.
// 브라우저의 Web Bluetooth API 가 이 서비스에 붙는다.
class TransportBLE : public ITransport {
 public:
  const char* name() const override { return "ble"; }
  void begin() override;
  void loop() override;
  bool isConnected() const override;
  void sendLine(const String& line) override;

  // 콜백에서 호출
  void onConnectEvent(bool connected);
  void onRxChunk(const uint8_t* data, size_t len);

  const char* deviceName() const { return devName_.c_str(); }

 private:
  LineAssembler asm_;
  String        devName_;
  volatile bool connected_   = false;
  volatile bool pendingHello_ = false;
  bool          restartAdv_  = false;
};

extern TransportBLE g_ble;
