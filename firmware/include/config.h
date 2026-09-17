#pragma once
#include <Arduino.h>

// ---------------------------------------------------------------------------
//  ESPS3-32 I/O Test Target - 공통 설정
// ---------------------------------------------------------------------------

#ifndef FW_VERSION
#define FW_VERSION "1.0.0"
#endif

#define DEVICE_MODEL        "ESP32-S3-WROOM-1 N8R2"
#define PROTOCOL_VERSION    1

// --- 기본 장치 이름 (BLE 광고 / mDNS / SoftAP SSID 접두어) -----------------
#define DEFAULT_DEV_NAME    "ESPS3-TEST"

// --- WiFi ------------------------------------------------------------------
#define SOFTAP_PASSWORD     "esp32test"      // 8자 이상
#define WS_PORT             81               // WebSocket 포트
#define HTTP_PORT           80               // 장치 정보 페이지 포트
#define WIFI_CONNECT_TIMEOUT_MS 15000

// --- BLE (Nordic UART Service 호환) ----------------------------------------
#define BLE_SERVICE_UUID    "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define BLE_CHAR_RX_UUID    "6e400002-b5a3-f393-e0a9-e50e24dcca9e"  // write  (웹 -> 장치)
#define BLE_CHAR_TX_UUID    "6e400003-b5a3-f393-e0a9-e50e24dcca9e"  // notify (장치 -> 웹)

// --- 프로토콜 --------------------------------------------------------------
#define MAX_LINE_LEN        1024             // JSON 한 줄 최대 길이
#define MAX_PINS            49               // GPIO0 ~ GPIO48
#define MAX_LEDC_CHANNELS   8                // ESP32-S3 LEDC 채널 수

// --- 입력 폴링 -------------------------------------------------------------
#define DEFAULT_WATCH_INTERVAL_MS   50
#define MIN_WATCH_INTERVAL_MS       10
