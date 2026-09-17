# ESPS3-32 I/O 테스트 콘솔

ESP32-S3-WROOM-1 **N8R2** 기기의 입출력을 브라우저에서 강제로 조작하며
동작을 확인하는 테스트 도구.

* **연결 방식을 고를 수 있다** — WiFi · 블루투스(BLE) · USB 세 가지.
  브라우저가 장치에 직접 붙으므로 중간 서버가 필요 없다.
* **입출력을 강제로 넣을 수 있다** — 출력 핀을 구동하는 것은 물론,
  **입력 핀에 값을 주입**해서 배선을 바꾸지 않고도 기기 로직을 시험한다.
* **펌웨어를 기기에 내려받을 수 있다** — USB 로 전체를 굽거나(빈 칩도 가능),
  연결된 채널 그대로 OTA 로 앱만 갱신한다.
* **하드웨어 없이도 써 볼 수 있다** — 시뮬레이터 연결 방식이 들어 있다.

```
┌─ 브라우저 (web/) ─────────────┐        ┌─ ESP32-S3 N8R2 (firmware/) ─┐
│  Web Serial   ── USB CDC ─────┼───────▶│  TransportUSB                │
│  Web Bluetooth ── BLE(NUS) ───┼───────▶│  TransportBLE      ┐         │
│  WebSocket    ── WiFi :81 ────┼───────▶│  TransportWiFi     ├▶ 명령   │
│  시뮬레이터(내장)             │        │                    ┘  라우터 │
│                               │        │        │                     │
│                               │        │        ├──▶ io_manager        │
│                               │        │        │    (강제값 우선)     │
│                               │        │        │       │              │
│                               │        │        │       ▼              │
│                               │        │        │   app_logic (DUT)    │
│                               │        │        └──▶ ota_manager       │
│                               │        │             (앱 파티션 갱신)  │
│  esptool-js ── ROM 부트로더 ──┼═══════▶│  (펌웨어 없이도 통함)         │
└───────────────────────────────┘        └──────────────────────────────┘
```

## 빠른 시작

### 1. 웹 콘솔 실행

```bash
python3 tools/serve.py          # http://localhost:8000 이 열린다

# 윈도우에서 python3 를 못 찾으면
py -3 tools\serve.py            # 또는 탐색기에서 tools\serve.bat 더블클릭
```

> `index.html` 을 더블클릭해서 여는 방식(`file://`)은 **동작하지 않는다.**
> 브라우저가 자바스크립트 모듈 로딩을 막기 때문이며, 그렇게 열면 화면에
> 안내가 뜬다. 반드시 위 명령으로 띄운 주소로 열 것.

> **`http://localhost` 로 여는 것이 중요하다.**
> USB(Web Serial)와 블루투스(Web Bluetooth)는 보안 컨텍스트에서만 동작하는데
> `localhost` 는 보안 컨텍스트로 인정된다. 반대로 `https://` 로 열면 브라우저가
> `ws://` 연결을 막아 WiFi 방식을 못 쓴다. 세 방식을 모두 쓰려면 `localhost` 다.
> 조건이 맞지 않으면 화면 위쪽에 안내 배너가 뜬다.

장치가 아직 없다면 연결 방식에서 **시뮬레이터**를 고르고 [연결]을 누르면
모든 기능을 그대로 사용해 볼 수 있다.

### 2. 펌웨어 빌드와 업로드

[PlatformIO Core](https://platformio.org/) 가 필요하다.

```bash
pip install platformio        # 처음 한 번

pio run -d firmware           # 빌드
pio run -d firmware -t upload # 빌드 + 업로드
pio device monitor            # (선택) 로그 확인
```

첫 빌드는 툴체인과 Arduino 코어(합쳐서 수백 MB)를 받느라 몇 분 걸리고,
그다음부터는 빠르다. 산출물은 여기에 생긴다.

```
firmware/.pio/build/esp32s3-n8r2/
  firmware.bin     애플리케이션        → 0x10000  (OTA 로 올릴 때도 이 파일)
  bootloader.bin   부트로더            → 0x0
  partitions.bin   파티션 테이블       → 0x8000
```

케이블만 꽂혀 있으면 `-t upload` 가 제일 편하고, PlatformIO 를 깔기 어려운
자리에서는 이 파일들을 웹 콘솔의 **다운로드** 탭으로 구우면 된다.

현재 사용량(espressif32 6.9.0 / Arduino core 2.0.17 기준):

```
RAM:   26.6%  (87 KB / 320 KB)
Flash: 42.0%  (1.34 MB / 3.19 MB — app 파티션)
```

`build_src_flags` 로 이 프로젝트 소스에만 `-Wall -Wextra` 를 걸어 두었다
(프레임워크 경고까지 켜면 소음이 너무 커진다). 현재 경고 0건이며,
새로 짠 코드가 경고를 내면 바로 보인다.

보드는 `esp32-s3-devkitc-1` 기준이며, N8R2 에 맞춰
8MB Flash(QIO) + 2MB Quad PSRAM(`qio_qspi`) 로 설정되어 있다.
다른 모듈(N8R8 등)이면 `platformio.ini` 의 `board_build.arduino.memory_type`
을 `qio_opi` 로 바꿔야 한다.

> 파티션은 `default_8MB.csv` (app0/app1 각 3.1MB + SPIFFS)를 쓴다.
> **OTA 는 app0/app1 두 칸이 있어야 동작하므로**, 파티션 표를 바꿀 때는
> OTA 가능 여부를 함께 확인할 것(웹 콘솔 **장치** 탭에 표시된다).

#### 사람마다 다른 설정은 `firmware/local/` 에

`platformio.ini` 는 `extra_configs = local/*.ini` 를 두고 있어서,
`firmware/local/` 에 넣은 `.ini` 가 자동으로 합쳐진다. 이 폴더는 커밋되지
않으므로 포트 이름이나 사내 미러 설정을 여기에 둔다.

```bash
mkdir -p firmware/local
cp firmware/local.example/upload-port.ini firmware/local/   # 포트 고정
```

패키지 레지스트리를 막아 둔 망분리 환경이라면
`firmware/local.example/offline-packages.ini` 를 참고해 툴체인과 코어를
업스트림 GitHub 릴리스에서 직접 받도록 고정할 수 있다.

첫 업로드 후 장치는 이렇게 동작한다.

* USB CDC 포트가 바로 열린다.
* `ESPS3-TEST-xxxx` 이름으로 BLE 광고를 시작한다.
* 저장된 WiFi 정보가 없으면 **SoftAP** 를 띄운다
  (SSID `ESPS3-TEST-XXXX`, 비밀번호 `esp32test`, 주소 `192.168.4.1`).

## 잘 안 될 때

| 증상 | 원인 | 해결 |
|---|---|---|
| 화면이 하얗게 비거나 "화면을 불러오지 못했습니다" 안내가 뜬다 | `index.html` 을 더블클릭해 `file://` 로 열었다. 브라우저가 모듈을 막는다 | `python3 tools/serve.py` 로 띄우고 `http://localhost:8000` 으로 열기 |
| `python3` 명령을 찾을 수 없다 (윈도우) | 윈도우에는 `python3` 이름이 없다 | `py -3 tools/serve.py` 또는 `tools\serve.bat` 더블클릭 |
| 포트가 이미 사용 중이라고 나온다 | 8000 을 다른 프로그램이 쓰고 있다 | 서버가 알아서 다음 빈 포트를 잡는다. 화면에 찍힌 주소를 그대로 열 것 |
| `USB` / `블루투스` 버튼이 회색이다 | 브라우저가 지원하지 않거나 보안 컨텍스트가 아니다 | 데스크톱 Chrome/Edge 로, `http://localhost` 또는 `https://` 에서 열기. 버튼에 마우스를 올리면 이유가 보인다 |
| 연결 방식이 다 회색이고 시뮬레이터만 된다 | `127.0.0.1` 이 아닌 LAN 주소(예: `192.168.x.x:8000`)로 열었다 | 반드시 `localhost` 로 열 것. LAN 주소는 보안 컨텍스트가 아니다 |
| WiFi 연결이 즉시 막힌다 | 페이지를 `https://` 로 열어 `ws://` 가 혼합 콘텐츠로 차단됐다 | `http://localhost` 로 열기 |
| 서버는 뜨는데 브라우저가 자동으로 안 열린다 | 원격/컨테이너 환경 | 주소를 직접 입력해서 열면 된다 |
| USB 포트 선택 창에 기기가 없다 | 케이블이 충전 전용이거나, 보드의 다른 USB 포트에 꽂았다 | 데이터 케이블로 **네이티브 USB** 포트에 연결. 그래도 없으면 BOOT 누른 채 RESET |

그래도 안 되면 브라우저 개발자도구(F12) **콘솔** 탭의 빨간 오류 메시지와,
서버를 띄운 터미널의 출력을 함께 확인해 주세요. 어디서 막혔는지 바로 드러납니다.

하드웨어가 아직 없다면 연결 방식에서 **시뮬레이터**를 고르면 모든 기능을
그대로 시험해 볼 수 있습니다.

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

## 펌웨어 내려받기 (다운로드 탭)

두 가지 경로가 있다. 상황에 맞는 쪽을 고르면 된다.

| | **USB 전체 플래시** | **OTA 업데이트** |
|---|---|---|
| 통로 | USB (ROM 부트로더) | 지금 연결된 채널 — USB · 블루투스 · WiFi |
| 굽는 범위 | 부트로더 + 파티션 + 앱 **전체** | **앱 파티션만** |
| 빈 칩 / 망가진 펌웨어 | 가능 | 불가 (기기가 돌고 있어야 한다) |
| 준비 | 콘솔의 USB 연결을 끊어야 함 | 연결된 채로 그대로 |
| 속도(대략 1MB) | 10~20초 | USB 10초 · WiFi 5초 · **BLE 5분 이상** |

### USB 전체 플래시

1. **다운로드** 탭 → `USB 전체 플래시`.
2. `빌드 폴더에서 한 번에 선택…` 으로 아래 파일들을 고른다.
   이름이 같으면 주소가 자동으로 맞춰진다.

   | 주소 | 파일 | PlatformIO 경로 |
   |---|---|---|
   | `0x0` | `bootloader.bin` | `.pio/build/esp32s3-n8r2/bootloader.bin` |
   | `0x8000` | `partitions.bin` | `.pio/build/esp32s3-n8r2/partitions.bin` |
   | `0xE000` | `boot_app0.bin` | `~/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin` |
   | `0x10000` | `firmware.bin` | `.pio/build/esp32s3-n8r2/firmware.bin` |

   `esptool.py merge_bin` 으로 만든 병합 이미지 하나만 있다면,
   행을 하나만 남기고 주소를 `0x0` 으로 두면 된다.
3. `플래시 시작`. 콘솔이 USB 로 연결되어 있으면 먼저 끊을지 물어본다
   (한 포트를 두 곳에서 열 수 없다).

> 주소 칸은 `0x` 를 붙이든 안 붙이든 **항상 16진수**로 읽고, 입력한 값을
> `0x…` 표기로 되돌려 보여 준다. (`10000` 을 십진수로 읽으면 파티션 테이블
> 영역에 덮어쓰는 사고가 난다.)

부트로더 연결에 실패하면 보드의 **BOOT 버튼을 누른 채 RESET 을 한 번** 누르고
(다운로드 모드) 다시 시도한다.

### OTA 업데이트

1. 기기에 연결한 상태에서 **다운로드** 탭 → `OTA 업데이트`.
2. `firmware.bin` 을 고른다. 전송 채널과 예상 소요 시간이 표시된다.
3. `업로드 시작`. 진행률·속도·남은 시간이 나오고, 끝나면 기기가 새 펌웨어로
   재부팅한다(연결이 한 번 끊긴다).

안전장치:

* 파일 첫 바이트가 `0xE9`(ESP32 이미지 매직)가 아니면 시작하지 않는다.
  실수로 `firmware.elf` 를 고르는 사고를 막는다.
* 업로드 전에 **MD5 를 계산해 장치에 알려 주고**, 장치가 다 받은 뒤 검증한다.
  중간에 한 바이트라도 깨지면 재부팅 전에 걸러진다.
* 이미지가 OTA 파티션보다 크거나 파티션 구성이 OTA 를 지원하지 않으면
  시작 자체를 거부한다.
* 전송이 끊기면 장치가 15초 뒤 스스로 정리한다.

BLE 는 한 번에 보낼 수 있는 양이 작아 느리다. 연결 시 더 큰 조각을 써도 되는지
**실제 왕복으로 확인**한 뒤에만 크기를 올리므로(조용히 잘려 펌웨어가 깨지는 일을
막는다), 그래도 느리면 USB 나 WiFi 를 쓰는 편이 낫다.

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
    ota_manager.*      OTA 수신과 검증(Update 라이브러리)
    protocol.*         JSON 명령 라우터와 이벤트 방송
    transport_*.{h,cpp}  USB CDC / BLE(NUS) / WiFi(WebSocket)
  test/              호스트에서 펌웨어 로직을 컴파일해 돌리는 테스트
web/                 정적 웹 콘솔 (빌드 도구 없음, ES 모듈 그대로)
  js/protocol.js       요청/응답 대응, 이벤트 버스
  js/transports/       Web Serial · Web Bluetooth · WebSocket · 시뮬레이터
  js/sequence.js       시나리오 파서와 실행기
  js/ota.js            OTA 업로드(채널별 최적 경로 선택)
  js/flasher.js        USB 전체 플래시(esptool-js 감싸기)
  js/md5.js            펌웨어 검증용 MD5
  js/pinmap.js         ESP32-S3 핀 성격 표
  js/app.js            화면 제어
  vendor/esptool-js/   Espressif 공식 플래셔 (Apache-2.0, 벤더링)
docs/protocol.md     통신 프로토콜 전체 명세
tools/               로컬 서버 · 자체 점검 스크립트
```

## 점검 실행

```bash
./tools/test-all.sh
```

셋을 차례로 돌린다. PlatformIO 가 `PATH` 에 없으면 3번은 건너뛴다
(다른 곳에 있으면 `PIO=/경로/pio ./tools/test-all.sh`).

* `firmware/test` — 장치에 올라가는 `io_manager.cpp` / `app_logic.cpp` /
  `ota_manager.cpp` 를 Arduino 스텁 위에서 그대로 컴파일해 강제 입력
  우선순위, 펄스 만료, 감시 이벤트, 디바운스, 임계 경보와 OTA 상태 기계
  (크기·MD5 검증, 타임아웃, 재부팅 예약)를 검증한다. (g++ 필요)
* `tools/selftest.mjs` — 브라우저 없이 장치 클라이언트 + 시뮬레이터 +
  시나리오 엔진을 돌려 프로토콜 왕복을 검증한다. OTA 는 시뮬레이터가
  받은 바이트의 MD5 를 직접 계산하므로, 전송 중 한 바이트만 바꿔도
  검증에서 걸리는지까지 확인한다. (node 필요)
* `pio run -d firmware` — 진짜 크로스 컴파일. 위 둘이 통과해도 여기서
  깨질 수 있으므로(장치 전용 API), 펌웨어를 고쳤으면 꼭 함께 돌릴 것.

GitHub Actions(`.github/workflows/build.yml`)가 푸시마다 같은 셋을 돌리고,
빌드 산출물(`firmware.bin`/`bootloader.bin`/`partitions.bin`)을 artifact 로
올린다. 보드는 없지만 펌웨어만 받아서 굽고 싶을 때 그 artifact 를 내려받아
웹 콘솔의 **다운로드** 탭에 넣으면 된다.

## 라이선스

MIT
