# 통신 프로토콜

전송 방식(USB CDC · BLE · WiFi)과 **무관하게 동일한 메시지 형식**을 쓴다.
한 메시지는 JSON 한 줄이며 `\n` 으로 끝난다.
(WebSocket 은 메시지 경계가 보장되므로 메시지 하나가 곧 한 줄이다.)

세 채널은 동시에 열려 있을 수 있다. 명령 응답은 **보낸 채널로만** 가고,
상태 변화 이벤트는 **연결된 모든 채널로** 방송된다.

## 메시지 형식

| 종류 | 형식 |
|---|---|
| 요청 | `{"id":1,"cmd":"io.write","args":{"pin":2,"value":1}}` |
| 성공 | `{"id":1,"ok":true,"result":{...}}` |
| 실패 | `{"id":1,"ok":false,"error":"사유"}` |
| 이벤트 | `{"evt":"pin.change","ts":123456,"data":{...}}` |

* `id` 는 응답을 짝지어 주는 값이다. 생략하면 응답에도 `id` 가 없다.
* `args` 는 생략 가능하다.
* `ts` 는 장치 부팅 후 경과 밀리초다.

## 핀 상태 객체

`io.read`, `io.write`, `force.set` 등의 응답과 `pin.state` 이벤트가 공통으로 쓰는 모양:

```json
{
  "pin": 4,
  "mode": "input_pullup",
  "value": 0,          // 현재 논리값 (ADC 모드면 raw, PWM 모드면 duty)
  "raw": 1,            // 강제값을 무시한 실제 물리 레벨
  "forced": true,      // 강제 입력이 걸려 있는가
  "forcedValue": 0,    // forced 일 때만
  "out": 1,            // output 모드일 때만
  "duty": 512, "freq": 5000, "res": 10,   // pwm 모드일 때만
  "watch": true        // 감시 중일 때만
}
```

`value` 와 `raw` 가 다르면 강제 입력이 적용 중이라는 뜻이다.

## 명령

### 시스템

| 명령 | 인자 | 설명 |
|---|---|---|
| `sys.ping` | - | 왕복 확인 |
| `sys.info` | - | 모델·펌웨어·메모리·연결 채널·네트워크 정보 |
| `sys.pinmap` | - | 존재하는 GPIO 목록과 예약/ADC 여부 |
| `sys.reset` | - | 장치 재부팅 (응답 후 약 150ms 뒤) |

### 핀 설정과 출력

| 명령 | 인자 | 설명 |
|---|---|---|
| `io.config` | `pin`, `mode`, (`freq`, `res`) | 모드 설정 |
| `io.write` | `pin`, `value` | 디지털 출력 강제 (필요하면 출력 모드로 자동 전환) |
| `io.toggle` | `pin` | 출력 반전 |
| `io.pulse` | `pin`, `value`, `ms` | 지정 시간 동안 출력했다가 원래 값으로 복귀 |
| `io.pwm` | `pin`, `duty`, (`freq`, `res`) | PWM 출력. duty 는 해상도 상한으로 잘린다 |

`mode` 는 `disabled` / `input` / `input_pullup` / `input_pulldown` /
`output` / `pwm` / `adc` 중 하나다.

### 입력 읽기

| 명령 | 인자 | 설명 |
|---|---|---|
| `io.read` | `pin` | 핀 상태 객체 |
| `io.adc` | `pin` | `{pin, raw, mv, forced}` — 12비트 기준 mV 환산 포함 |
| `io.snapshot` | (`pins`), (`all`) | 여러 핀을 한 번에. 기본은 설정·강제·감시 중인 핀만 |

### 강제 입력 (가상 입력 주입)

배선을 바꾸지 않고 입력을 만들어 내는, 이 프로젝트의 핵심 기능이다.
강제값이 걸린 핀은 펌웨어의 `io::read()` / `io::readAdc()` 가 물리 레벨 대신
주입값을 돌려주므로, **테스트 대상 로직이 실제로 그 값에 반응한다.**

| 명령 | 인자 | 설명 |
|---|---|---|
| `force.set` | `pin`, `value` | 주입 시작 (디지털 0/1 또는 ADC raw) |
| `force.clear` | `pin` | 해당 핀 해제 |
| `force.clearAll` | - | 전체 해제 |
| `force.pulse` | `pin`, `value`, `ms` | 지정 시간만 주입하고 이전 상태로 복귀 |
| `force.list` | - | 현재 주입 중인 핀 목록 |

### 감시

| 명령 | 인자 | 설명 |
|---|---|---|
| `io.watch` | `pin` 또는 `pins`, `on`, (`interval`) | 값이 바뀔 때 `pin.change` 이벤트를 받는다 |
| `io.reset` | - | 모든 핀을 초기 상태로 |

폴링 주기(`interval`)는 전역이며 최소 10ms 다.
ADC 는 노이즈 때문에 **32 이상 변했을 때만** 보고한다.

### 테스트 대상 로직

| 명령 | 인자 | 설명 |
|---|---|---|
| `app.status` | - | 릴레이·경보·누름 횟수와 핀 구성 |
| `app.config` | `enabled`, `buttonPin`, `relayPin`, `ledPin`, `sensorPin`, `alarmPin`, `activeLow`, `debounceMs`, `threshold` | 구성 변경 (준 항목만 반영) |
| `app.reset` | - | 릴레이·경보·카운터 초기화 (시나리오 반복 실행 전에) |

### 네트워크

| 명령 | 인자 | 설명 |
|---|---|---|
| `wifi.status` | - | 모드·IP·SSID·RSSI·WebSocket 주소 |
| `wifi.connect` | `ssid`, `pass`, `save` | 접속 시도(비동기). 결과는 `wifi.status` 또는 이벤트로 |
| `wifi.scan` | - | 주변 AP 최대 20개 |
| `wifi.ap` | - | SoftAP 모드로 전환 |
| `wifi.forget` | - | 저장된 접속 정보 삭제 |
| `ble.status` | - | BLE 이름·연결 여부·서비스 UUID |

## 이벤트

| 이벤트 | 시점 | data |
|---|---|---|
| `hello` | 채널이 연결된 직후 | `sys.info` 와 동일 + `via`(채널 이름) |
| `pin.state` | 핀 상태를 바꾸는 명령이 처리될 때 | 핀 상태 객체 |
| `pin.change` | 감시 중인 핀 값이 바뀔 때 | `{pin, value, forced, mode}` |
| `app.status` | 테스트 대상 로직 상태가 바뀔 때 | `app.status` 결과와 동일 |
| `io.reset` / `force.clearAll` | 일괄 초기화 시 | - |
| `wifi.connected` | STA 접속 성공 | `{ip, ssid, host}` |
| `wifi.failed` | 접속 실패(SoftAP 로 폴백) | `{ssid, fallback}` |

## 전송별 특성

| 항목 | USB (CDC) | BLE (NUS) | WiFi (WebSocket) |
|---|---|---|---|
| 브라우저 API | Web Serial | Web Bluetooth | WebSocket |
| 주소/식별 | 시리얼 포트 선택 | `ESPS3-TEST-xxxx` 광고 | `ws://<IP>:81/` |
| 메시지 경계 | `\n` 으로 구분 | MTU 청크를 재조립 | 메시지 = 한 줄 |
| 속도 | 빠름 | 느림(20바이트 단위 쓰기) | 빠름 |
| 비고 | 보안 컨텍스트 필요 | 보안 컨텍스트 필요, 응답 타임아웃 12초 | https 페이지에서는 차단됨 |

## 직접 붙여 보기

USB 로 연결한 뒤 시리얼 모니터에서 그대로 입력해도 된다:

```
{"id":1,"cmd":"sys.info"}
{"id":2,"cmd":"io.config","args":{"pin":48,"mode":"output"}}
{"id":3,"cmd":"io.write","args":{"pin":48,"value":1}}
{"id":4,"cmd":"force.set","args":{"pin":4,"value":0}}
```
