// ---------------------------------------------------------------------------
//  ESPS3-32  I/O 테스트 타깃 펌웨어
//  ESP32-S3-WROOM-1 N8R2 (8MB Flash / 2MB PSRAM)
//
//  USB CDC · BLE(NUS) · WiFi(WebSocket) 세 채널을 동시에 열어 두고,
//  어느 쪽으로 들어오든 같은 JSON 명령 세트로 GPIO 를 강제 구동/주입한다.
// ---------------------------------------------------------------------------
#include <Arduino.h>
#include "config.h"
#include "io_manager.h"
#include "app_logic.h"
#include "protocol.h"
#include "transport_usb.h"
#include "transport_ble.h"
#include "transport_wifi.h"

static void onPinChanged(uint8_t pin, int value, bool forced) {
  protocol::broadcastEvent("pin.change", [pin, value, forced](JsonObject d) {
    d["pin"]    = pin;
    d["value"]  = value;
    d["forced"] = forced;
    d["mode"]   = io::modeName(io::info(pin).mode);
  });
}

void setup() {
  // 1) USB CDC - 가장 먼저 열어 부팅 로그를 볼 수 있게 한다
  g_usb.begin();
  protocol::registerTransport(&g_usb);

  // 2) I/O 및 테스트 대상 로직
  io::begin();
  io::onPinChange(onPinChanged);
  applogic::begin();

  // 3) BLE - Nordic UART Service 로 광고 시작
  g_ble.begin();
  protocol::registerTransport(&g_ble);

  // 4) WiFi - 저장된 AP 로 접속 시도, 실패하면 SoftAP 로 폴백
  g_wifi.begin();
  protocol::registerTransport(&g_wifi);
}

void loop() {
  g_usb.loop();
  g_ble.loop();
  g_wifi.loop();

  io::loop();          // 펄스 만료 + 감시 핀 폴링(변화 시 이벤트 브로드캐스트)
  applogic::loop();    // 테스트 대상 로직 (강제 입력이 여기에 반영된다)

  delay(1);            // 다른 태스크(WiFi/BLE 스택)에 CPU 양보
}
