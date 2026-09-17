#include "transport_usb.h"
#include "protocol.h"

TransportUSB g_usb;

void TransportUSB::begin() {
  Serial.begin(115200);
  // CDC 는 호스트가 포트를 열어야 통신이 시작된다. 부팅을 막지 않도록 기다리지 않는다.
}

bool TransportUSB::isConnected() const {
#if ARDUINO_USB_CDC_ON_BOOT
  return (bool)Serial;      // DTR 기반 연결 여부
#else
  return true;
#endif
}

void TransportUSB::loop() {
  bool now = isConnected();
  if (now && !wasConnected_) {
    asm_.reset();
    protocol::sendHello(this);
  }
  wasConnected_ = now;

  uint8_t buf[128];
  while (Serial.available()) {
    size_t n = Serial.readBytes(buf, min((size_t)Serial.available(), sizeof(buf)));
    asm_.feed(buf, n, [this](const char* line) {
      protocol::handleLine(line, this);
    });
  }
}

void TransportUSB::sendLine(const String& line) {
  if (!isConnected()) return;
  Serial.write((const uint8_t*)line.c_str(), line.length());
  Serial.write('\n');
}
