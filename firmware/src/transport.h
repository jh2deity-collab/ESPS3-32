#pragma once
#include <Arduino.h>
#include "config.h"

// ---------------------------------------------------------------------------
//  전송 계층 공통 인터페이스
//  USB CDC / BLE / WiFi(WebSocket) 어느 쪽으로 들어오든 동일한 명령 라우터를
//  통과하도록 얇은 추상화를 둔다. 세 채널은 동시에 열려 있을 수 있다.
// ---------------------------------------------------------------------------
class ITransport {
 public:
  virtual ~ITransport() {}

  virtual const char* name() const = 0;   // "usb" | "ble" | "wifi"
  virtual void begin() = 0;
  virtual void loop() = 0;
  virtual bool isConnected() const = 0;

  // 한 줄(JSON) 전송. 줄바꿈은 구현체가 필요에 따라 덧붙인다.
  virtual void sendLine(const String& line) = 0;

  // 마지막 응답을 돌려줄 클라이언트를 구분해야 하는 전송(WebSocket 등)을 위해
  // 라우터가 현재 처리 중인 클라이언트 핸들을 넣어 둔다.
  int32_t activeClient = -1;
};

// 라인 단위 수신 버퍼 - 스트림(USB)·청크(BLE) 양쪽에서 재사용한다.
class LineAssembler {
 public:
  // 바이트를 밀어 넣고, 완전한 줄이 만들어지면 cb(line) 을 호출한다.
  template <typename Fn>
  void feed(const uint8_t* data, size_t len, Fn cb) {
    for (size_t i = 0; i < len; i++) {
      char c = (char)data[i];
      if (c == '\n' || c == '\r') {
        if (len_ > 0) {
          buf_[len_] = '\0';
          cb(buf_);
          len_ = 0;
        }
        continue;
      }
      if (len_ < MAX_LINE_LEN - 1) {
        buf_[len_++] = c;
      } else {
        // 과도하게 긴 입력은 버린다 (다음 줄바꿈까지 동기화 손실 방지)
        len_ = 0;
        overflow_ = true;
      }
    }
  }
  void reset() { len_ = 0; overflow_ = false; }
  bool takeOverflow() { bool o = overflow_; overflow_ = false; return o; }

 private:
  char   buf_[MAX_LINE_LEN];
  size_t len_ = 0;
  bool   overflow_ = false;
};
