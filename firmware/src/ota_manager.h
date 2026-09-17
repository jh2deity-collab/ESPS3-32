#pragma once
#include <Arduino.h>
#include "config.h"

// ---------------------------------------------------------------------------
//  OTA(무선/무접점) 펌웨어 갱신
//
//  기기가 이미 이 펌웨어로 돌고 있을 때, 연결된 아무 채널(USB·BLE·WiFi)로나
//  새 app 이미지를 받아 반대편 OTA 파티션에 굽고 재부팅한다.
//
//  * WiFi 는 WebSocket 바이너리 프레임으로 원본 바이트를 그대로 받는다(빠름).
//  * USB/BLE 는 JSON 안에 base64 로 실어 보낸다(줄 단위 프로토콜을 유지).
//  * 완전히 빈 칩이나 부트로더까지 새로 굽는 건 OTA 로 할 수 없다.
//    그 경우는 웹 콘솔의 'USB 전체 플래시'(ROM 부트로더)를 쓴다.
// ---------------------------------------------------------------------------

enum OtaState : uint8_t {
  OTA_IDLE = 0,
  OTA_RECEIVING,
  OTA_SUCCESS,
  OTA_FAILED,
};

// 진행 상황 알림 (프로토콜 계층이 이벤트로 방송한다)
typedef void (*OtaProgressCb)(uint32_t received, uint32_t total);

namespace ota {

void begin();

// 시작. size 는 전체 바이트 수, md5 는 소문자 16진수 32자(빈 문자열이면 검증 생략).
bool start(uint32_t size, const String& md5, const char* via, String& err);

// 이어서 쓰기. 순서대로 들어와야 한다.
bool write(const uint8_t* data, size_t len, String& err);

// base64 한 조각을 디코드해서 쓴다 (USB/BLE 경로).
bool writeBase64(const char* b64, size_t len, String& err);

// 마무리. 성공하면 재부팅을 예약한다.
bool finish(String& err);

void cancel(const char* reason);
void onProgress(OtaProgressCb cb);

void loop();               // 수신 타임아웃 감시 + 예약된 재부팅 처리

OtaState    state();
uint32_t    received();
uint32_t    total();
const char* via();         // 어느 채널이 올리고 있는가
const char* lastError();
uint8_t     percent();
bool        isReceiving();

}  // namespace ota
