# ESPS3-32 I/O 테스트 콘솔

ESP32-S3-WROOM-1 **N8R2** 기기의 입출력을 브라우저에서 강제로 조작하며
동작을 확인하는 테스트 도구.

* **연결 방식을 고를 수 있다** — WiFi · 블루투스(BLE) · USB 세 가지.
  브라우저가 장치에 직접 붙으므로 중간 서버가 필요 없다.
* **입출력을 강제로 넣을 수 있다** — 출력 핀을 구동하는 것은 물론,
  **입력 핀에 값을 주입**해서 배선을 바꾸지 않고도 기기 로직을 시험한다.
* **하드웨어 없이도 써 볼 수 있다** — 시뮬레이터 연결 방식이 들어 있다.

```
┌─ 브라우저 (web/) ─────────────┐        ┌─ ESP32-S3 N8R2 (firmware/) ─┐
│  Web Serial   ── USB CDC ─────┼───────▶│  TransportUSB                │
│  Web Bluetooth ── BLE(NUS) ───┼───────▶│  TransportBLE      ┐         │
│  WebSocket    ── WiFi :81 ────┼───────▶│  TransportWiFi     ├▶ 명령   │
│  시뮬레이터(내장)             │        │                    ┘  라우터 │
└───────────────────────────────┘        │        │                     │
                                         │        ▼                     │
                                         │   io_manager (강제값 우선)   │
                                         │        │                     │
                                         │        ▼                     │
                                         │   app_logic (테스트 대상)    │
                                         └──────────────────────────────┘
```

## 빠른 시작

### 1. 웹 콘솔 실행

```bash
python3 tools/serve.py          # http://localhost:8000 이 열린다
```

> **`http://localhost` 로 여는 것이 중요하다.**
> USB(Web Serial)와 블루투스(Web Bluetooth)는 보안 컨텍스트에서만 동작하는데
> `localhost` 는 보안 컨텍스트로 인정된다. 반대로 `https://` 로 열면 브라우저가
> `ws://` 연결을 막아 WiFi 방식을 못 쓴다. 세 방식을 모두 쓰려면 `localhost` 다.
> 조건이 맞지 않으면 화면 위쪽에 안내 배너가 뜬다.

장치가 아직 없다면 연결 방식에서 **시뮬레이터**를 고르고 [연결]을 누르면
모든 기능을 그대로 사용해 볼 수 있다.

### 2. 펌웨어 올리기

[PlatformIO](https://platformio.org/) 가 필요하다.

```bash
cd firmware
pio run -t upload          # 빌드 + 업로드
pio device monitor         # (선택) 로그 확인
```

보드는 `esp32-s3-devkitc-1` 기준이며, N8R2 에 맞춰
8MB Flash(QIO) + 2MB Quad PSRAM(`qio_qspi`) 로 설정되어 있다.
다른 모듈(N8R8 등)이면 `platformio.ini` 의 `board_build.arduino.memory_type`
을 바꿔야 한다.

첫 업로드 후 장치는 이렇게 동작한다.

* USB CDC 포트가 바로 열린다.
* `ESPS3-TEST-xxxx` 이름으로 BLE 광고를 시작한다.
* 저장된 WiFi 정보가 없으면 **SoftAP** 를 띄운다
  (SSID `ESPS3-TEST-XXXX`, 비밀번호 `esp32test`, 주소 `192.168.4.1`).

## 연결 방식 고르기

| 방식 | 브라우저 | 준비물 | 특징 |
|---|---|---|---|
| **USB** | 데스크톱 Chrome/Edge | USB 케이블(네이티브 USB 포트) | 가장 빠르고 안정적. 첫 연결 시 포트 선택 창이 뜬다 |
| **블루투스** | Chrome/Edge, 안드로이드 Chrome | - | 선이 필요 없다. 20바이트 단위 전송이라 응답이 느리다 |
| **WiFi** | 모든 최신 브라우저 | 같은 네트워크 | 여러 사람이 동시에 붙을 수 있다 |

### WiFi 로 붙는 순서

1. 먼저 USB 나 블루투스로 연결한다.
2. **장치** 탭 → SSID/비밀번호 입력 → [접속]. (`검색` 으로 주변 AP 를 훑을 수 있다)
3. [상태 확인] 으로 받은 IP 를 확인하고, 그 아래 **[이 주소로 WiFi 연결하기]** 를 누른다.
4. 다음부터는 장치가 부팅하면서 알아서 그 AP 에 접속한다. 실패하면 SoftAP 로 되돌아간다.

접속을 못 찾겠으면 SoftAP(`192.168.4.1`) 에 붙거나, mDNS 이름
(`esps3-test-xxxx.local`)을 주소 칸에 넣어도 된다.

## 입출력 강제하기

### 출력 강제

핀 목록에서 모드를 **출력**으로 바꾸면 `LOW` / `HIGH` / `토글` / `펄스` 버튼이 나온다.
**PWM 출력** 모드에서는 duty 슬라이더와 주파수 입력이 나온다.
펄스는 지정한 시간이 지나면 장치가 알아서 원래 값으로 되돌린다.

### 입력 강제 (이 도구의 핵심)

모드를 **입력** 계열이나 **아날로그 입력**으로 바꾸면 `강제 입력` 조작이 나온다.

* 디지털: `0` / `1` 버튼으로 주입, `해제` 로 원복, `펄스` 로 짧게 반대값 주입
* 아날로그: 슬라이더나 숫자(0~4095)로 주입

주입된 핀은 행이 노란 테두리로 강조되고 `강제 중` 배지가 붙는다.
펌웨어는 그 핀을 읽을 때 물리 레벨 대신 주입값을 돌려주므로,
**버튼을 누르지 않아도, 센서를 연결하지 않아도 기기 로직이 실제로 반응한다.**

핀 상태 객체의 `value`(논리값)와 `raw`(실제 레벨)를 나란히 보면
지금 무엇이 주입되어 있는지 바로 알 수 있다.

### 무엇이 반응하는지 — 앱 로직 탭

`firmware/src/app_logic.cpp` 에 "테스트 대상" 예시가 들어 있다.

* 버튼 입력(디바운스 20ms) → 릴레이 토글 → 상태 LED
* 센서(ADC) 값이 임계를 넘으면 경보 출력

**앱 로직** 탭에서 핀을 지정하고 [적용]을 누른 뒤,
[버튼 1회 주입]을 누르거나 왼쪽에서 직접 값을 주입해 보면 릴레이/경보가 따라 움직인다.
자신의 제품 코드로 이 파일을 갈아 끼우면 그대로 테스트 하네스가 된다.
**단, 핀을 `digitalRead()` 로 직접 읽지 말고 `io::read()` / `io::readAdc()` 를 쓸 것.**
그래야 강제 입력이 통한다.

## 시나리오로 반복 테스트

**시나리오** 탭에서 한 줄에 한 동작씩 적고 [실행] 하면 순서대로 수행하며
`expect` 로 결과를 검증한다. 결과는 JSON 으로 저장할 수 있다.

```
appreset                 # 테스트 대상 로직 상태 초기화
config 4 input_pullup
force 4 1                # 버튼 안 눌린 상태
wait 100
expect app.relay == 0

force 4 0                # 누름
wait 150
force 4 1                # 뗌
wait 150
expect app.relay == 1    # 릴레이가 켜져야 한다
expect 5 == 1            # 릴레이 출력 핀도 HIGH

unforce 4
```

| 명령 | 뜻 |
|---|---|
| `config <핀> <모드>` | 모드 설정 |
| `write` / `toggle` / `pulse` / `pwm` | 출력 강제 |
| `force` / `forcepulse` / `unforce` / `unforceall` | 입력 주입 |
| `watch <핀> on\|off` | 변화 이벤트 구독 |
| `read <핀>` / `wait <ms>` / `log <메시지>` | 읽기 · 대기 · 기록 |
| `expect <핀> <비교> <값>` | 검증. `expect adc 6 > 2000`, `expect app.relay == 1` 도 가능 |
| `reset` / `appreset` | 핀 초기화 / 로직 상태 초기화 |
| `repeat <n>` … `end` | 블록 반복(중첩 가능) |

비교 연산자는 `== != > < >= <=`. `#` 뒤는 주석이다.
드롭다운의 예제 네 가지를 불러와서 시작하면 편하다.

## 핀 사용 시 주의

화면의 핀 목록은 기본적으로 **안전 핀**만 보여 준다. 필터를 `전체` 로 바꾸면
나머지도 나오지만, 표시된 성격을 확인하고 쓸 것.

| 핀 | 주의 |
|---|---|
| GPIO26~32 | 내장 Flash/PSRAM 전용. 펌웨어가 조작 자체를 거부한다 |
| GPIO33~37 | N8R2 에서는 보통 여유 핀이지만 보드 배선에 따라 예약될 수 있다 |
| GPIO0, 3, 45, 46 | 스트래핑 핀. 부팅 순간의 레벨이 부팅 모드를 바꾼다 |
| GPIO19, 20 | 네이티브 USB(D-/D+). USB 로 연결 중이면 건드리지 말 것 |
| GPIO43, 44 | UART0. 시리얼 로그를 볼 때 쓰인다 |
| GPIO22~25 | ESP32-S3 에는 없는 번호 |
| ADC2(GPIO11~20) | WiFi 사용 중에는 읽기가 실패할 수 있다. 아날로그는 ADC1(GPIO1~10) 권장 |

## 구성

```
firmware/            PlatformIO 프로젝트 (Arduino 프레임워크)
  src/
    main.cpp           세 전송 채널을 열고 주기 처리를 돌린다
    io_manager.*       핀 상태·강제값·펄스·감시. 강제 입력의 핵심
    app_logic.*        테스트 대상(DUT) 예시 - 자신의 코드로 교체
    protocol.*         JSON 명령 라우터와 이벤트 방송
    transport_*.{h,cpp}  USB CDC / BLE(NUS) / WiFi(WebSocket)
  test/              호스트에서 펌웨어 로직을 컴파일해 돌리는 테스트
web/                 정적 웹 콘솔 (빌드 도구 없음, ES 모듈 그대로)
  js/protocol.js       요청/응답 대응, 이벤트 버스
  js/transports/       Web Serial · Web Bluetooth · WebSocket · 시뮬레이터
  js/sequence.js       시나리오 파서와 실행기
  js/pinmap.js         ESP32-S3 핀 성격 표
  js/app.js            화면 제어
docs/protocol.md     통신 프로토콜 전체 명세
tools/               로컬 서버 · 자체 점검 스크립트
```

## 점검 실행

```bash
./tools/test-all.sh
```

* `firmware/test` — 장치에 올라가는 `io_manager.cpp` / `app_logic.cpp` 를
  Arduino 스텁 위에서 그대로 컴파일해 강제 입력 우선순위, 펄스 만료,
  감시 이벤트, 디바운스, 임계 경보를 검증한다. (g++ 필요)
* `tools/selftest.mjs` — 브라우저 없이 장치 클라이언트 + 시뮬레이터 +
  시나리오 엔진을 그대로 돌려 프로토콜 왕복을 검증한다. (node 필요)

## 라이선스

MIT
