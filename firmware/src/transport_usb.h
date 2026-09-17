#pragma once
#include "transport.h"

// USB CDC (네이티브 USB) 전송.
// 웹 브라우저의 Web Serial API 가 이 포트에 그대로 붙는다.
class TransportUSB : public ITransport {
 public:
  const char* name() const override { return "usb"; }
  void begin() override;
  void loop() override;
  bool isConnected() const override;
  void sendLine(const String& line) override;

 private:
  LineAssembler asm_;
  bool          wasConnected_ = false;
};

extern TransportUSB g_usb;
