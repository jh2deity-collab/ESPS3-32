#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"
#include "transport.h"

// ---------------------------------------------------------------------------
//  명령 프로토콜 (줄바꿈으로 구분되는 JSON, 전송 방식과 무관하게 동일)
//
//    요청 : {"id":1,"cmd":"io.write","args":{"pin":2,"value":1}}
//    응답 : {"id":1,"ok":true,"result":{...}}
//           {"id":1,"ok":false,"error":"사유"}
//    이벤트: {"evt":"pin.state","ts":12345,"data":{...}}
// ---------------------------------------------------------------------------
namespace protocol {

void registerTransport(ITransport* t);
void handleLine(const char* line, ITransport* src);
void sendHello(ITransport* t);

void sendRaw(ITransport* t, const String& line);
void broadcastRaw(const String& line);

// 핀 상태를 표준 형태로 채운다 (응답/이벤트 공용)
void fillPinState(JsonObject o, uint8_t pin);

// 데이터 없는 이벤트
void broadcastEvent(const char* evt);

// 데이터 있는 이벤트 - fill(JsonObject) 로 data 를 채운다
template <typename Fn>
void broadcastEvent(const char* evt, Fn fill) {
  JsonDocument doc;
  doc["evt"] = evt;
  doc["ts"]  = millis();
  JsonObject d = doc["data"].to<JsonObject>();
  fill(d);
  String out;
  serializeJson(doc, out);
  broadcastRaw(out);
}

}  // namespace protocol
