#include "transport_ble.h"
#include "protocol.h"

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

TransportBLE g_ble;

namespace {
BLEServer*         s_server = nullptr;
BLECharacteristic* s_txChar = nullptr;
BLECharacteristic* s_rxChar = nullptr;
uint16_t           s_connId = 0;

class ServerCb : public BLEServerCallbacks {
  void onConnect(BLEServer* srv) override {
    s_connId = srv->getConnId();
    g_ble.onConnectEvent(true);
  }
  void onDisconnect(BLEServer* srv) override {
    g_ble.onConnectEvent(false);
  }
};

class RxCb : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    // 코어 2.x 는 std::string, 3.x 는 String 을 돌려준다. 어느 쪽이든
    // 데이터 포인터와 길이만 꺼내 쓰면 되므로 auto 로 받는다.
    auto v = c->getValue();
    size_t n = v.length();
    if (n) g_ble.onRxChunk((const uint8_t*)v.c_str(), n);
  }
};
}  // namespace

void TransportBLE::begin() {
  uint64_t efuse = ESP.getEfuseMac();
  char suffix[8];
  snprintf(suffix, sizeof(suffix), "%02X%02X",
           (uint8_t)((efuse >> 32) & 0xFF), (uint8_t)((efuse >> 40) & 0xFF));
  devName_ = String(DEFAULT_DEV_NAME) + "-" + suffix;

  BLEDevice::init(devName_.c_str());
  BLEDevice::setMTU(247);   // 가능하면 큰 MTU 를 쓰되, 실제 값은 협상 결과를 따른다

  s_server = BLEDevice::createServer();
  s_server->setCallbacks(new ServerCb());

  BLEService* svc = s_server->createService(BLE_SERVICE_UUID);

  s_txChar = svc->createCharacteristic(BLE_CHAR_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  s_txChar->addDescriptor(new BLE2902());

  s_rxChar = svc->createCharacteristic(
      BLE_CHAR_RX_UUID,
      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  s_rxChar->setCallbacks(new RxCb());

  svc->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(BLE_SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
}

bool TransportBLE::isConnected() const { return connected_; }

void TransportBLE::onConnectEvent(bool connected) {
  connected_ = connected;
  if (connected) {
    pendingHello_ = true;
  } else {
    restartAdv_ = true;
  }
}

void TransportBLE::onRxChunk(const uint8_t* data, size_t len) {
  // BLE 는 MTU 단위로 쪼개져 오므로 줄 단위로 재조립한다.
  asm_.feed(data, len, [this](const char* line) {
    protocol::handleLine(line, this);
  });
}

void TransportBLE::loop() {
  if (restartAdv_) {
    restartAdv_ = false;
    asm_.reset();
    delay(50);                    // 스택이 정리될 시간을 준다
    BLEDevice::startAdvertising();
  }
  if (pendingHello_) {
    pendingHello_ = false;
    delay(200);                   // CCCD 등록 전에 보내면 유실된다
    protocol::sendHello(this);
  }
}

void TransportBLE::sendLine(const String& line) {
  if (!connected_ || !s_txChar) return;

  size_t mtu = 23;
  if (s_server) {
    uint16_t peer = s_server->getPeerMTU(s_connId);
    if (peer > 23) mtu = peer;
  }
  size_t chunk = mtu - 3;         // ATT 헤더 3바이트
  if (chunk < 20)  chunk = 20;
  if (chunk > 244) chunk = 244;

  String payload = line + "\n";
  const uint8_t* p = (const uint8_t*)payload.c_str();
  size_t remaining = payload.length();

  while (remaining > 0 && connected_) {
    size_t n = remaining > chunk ? chunk : remaining;
    s_txChar->setValue((uint8_t*)p, n);
    s_txChar->notify();
    p += n;
    remaining -= n;
    if (remaining) delay(4);      // 연속 notify 혼잡 방지
  }
}
