// ---------------------------------------------------------------------------
//  ESP32-S3-WROOM-1 N8R2 핀 메타데이터
//  UI 에서 "이 핀을 건드려도 되는가" 를 사용자에게 알려 주기 위한 표.
// ---------------------------------------------------------------------------

/** @typedef {{pin:number, adc?:string, touch?:number, tags:string[], note?:string,
 *             level?:'ok'|'caution'|'blocked'}} PinMeta */

const RAW = [
  { pin: 0,  tags: ['스트래핑', 'BOOT'], level: 'caution',
    note: '부팅 모드 스트래핑 핀. 리셋 순간 LOW 면 다운로드 모드로 진입한다.' },

  // ADC1 (WiFi 사용 중에도 안정적)
  { pin: 1,  adc: 'ADC1_CH0', touch: 1,  tags: ['ADC1', 'Touch'], level: 'ok' },
  { pin: 2,  adc: 'ADC1_CH1', touch: 2,  tags: ['ADC1', 'Touch'], level: 'ok' },
  { pin: 3,  adc: 'ADC1_CH2', touch: 3,  tags: ['ADC1', 'Touch', '스트래핑'], level: 'caution',
    note: 'JTAG 소스 선택 스트래핑 핀. 부팅 시 강하게 구동하지 말 것.' },
  { pin: 4,  adc: 'ADC1_CH3', touch: 4,  tags: ['ADC1', 'Touch'], level: 'ok' },
  { pin: 5,  adc: 'ADC1_CH4', touch: 5,  tags: ['ADC1', 'Touch'], level: 'ok' },
  { pin: 6,  adc: 'ADC1_CH5', touch: 6,  tags: ['ADC1', 'Touch'], level: 'ok' },
  { pin: 7,  adc: 'ADC1_CH6', touch: 7,  tags: ['ADC1', 'Touch'], level: 'ok' },
  { pin: 8,  adc: 'ADC1_CH7', touch: 8,  tags: ['ADC1', 'Touch'], level: 'ok' },
  { pin: 9,  adc: 'ADC1_CH8', touch: 9,  tags: ['ADC1', 'Touch'], level: 'ok' },
  { pin: 10, adc: 'ADC1_CH9', touch: 10, tags: ['ADC1', 'Touch'], level: 'ok' },

  // ADC2 (WiFi 활성 중 읽기가 불안정할 수 있음)
  { pin: 11, adc: 'ADC2_CH0', touch: 11, tags: ['ADC2', 'Touch'], level: 'ok',
    note: 'ADC2 는 WiFi 사용 중 읽기가 실패할 수 있다. 아날로그는 ADC1(GPIO1~10) 권장.' },
  { pin: 12, adc: 'ADC2_CH1', touch: 12, tags: ['ADC2', 'Touch'], level: 'ok' },
  { pin: 13, adc: 'ADC2_CH2', touch: 13, tags: ['ADC2', 'Touch'], level: 'ok' },
  { pin: 14, adc: 'ADC2_CH3', touch: 14, tags: ['ADC2', 'Touch'], level: 'ok' },
  { pin: 15, adc: 'ADC2_CH4', tags: ['ADC2', 'U0RTS'], level: 'ok' },
  { pin: 16, adc: 'ADC2_CH5', tags: ['ADC2', 'U0CTS'], level: 'ok' },
  { pin: 17, adc: 'ADC2_CH6', tags: ['ADC2', 'U1TXD'], level: 'ok' },
  { pin: 18, adc: 'ADC2_CH7', tags: ['ADC2', 'U1RXD'], level: 'ok' },
  { pin: 19, adc: 'ADC2_CH8', tags: ['ADC2', 'USB D-'], level: 'caution',
    note: '네이티브 USB(D-) 겸용. USB CDC 로 연결 중이면 사용하지 말 것.' },
  { pin: 20, adc: 'ADC2_CH9', tags: ['ADC2', 'USB D+'], level: 'caution',
    note: '네이티브 USB(D+) 겸용. USB CDC 로 연결 중이면 사용하지 말 것.' },

  { pin: 21, tags: ['범용'], level: 'ok' },

  // 26~32: 내장 SPI Flash / PSRAM 전용
  ...[26, 27, 28, 29, 30, 31, 32].map((p) => ({
    pin: p, tags: ['Flash/PSRAM'], level: 'blocked',
    note: '내장 SPI Flash/PSRAM 전용. 구동하면 즉시 크래시한다.',
  })),

  // 33~37: 옥탈 모듈에서는 PSRAM 용. N8R2(쿼드)에서는 여유 핀이지만 보드마다 다르다.
  ...[33, 34, 35, 36, 37].map((p) => ({
    pin: p, tags: ['모듈 의존'], level: 'caution',
    note: 'N8R2(쿼드 PSRAM)에서는 보통 사용 가능하지만, 보드 배선에 따라 예약된 경우가 있다. 배선을 확인하고 쓸 것.',
  })),

  { pin: 38, tags: ['범용', 'RGB(v1.0)'], level: 'ok',
    note: 'DevKitC-1 v1.0 에서는 온보드 RGB LED 가 이 핀에 연결된다.' },
  { pin: 39, tags: ['범용', 'JTAG MTCK'], level: 'ok' },
  { pin: 40, tags: ['범용', 'JTAG MTDO'], level: 'ok' },
  { pin: 41, tags: ['범용', 'JTAG MTDI'], level: 'ok' },
  { pin: 42, tags: ['범용', 'JTAG MTMS'], level: 'ok' },
  { pin: 43, tags: ['U0TXD'], level: 'caution',
    note: 'UART0 TX. USB-Serial 브리지 포트로 로그를 볼 때 사용된다.' },
  { pin: 44, tags: ['U0RXD'], level: 'caution',
    note: 'UART0 RX. USB-Serial 브리지 포트로 로그를 볼 때 사용된다.' },
  { pin: 45, tags: ['스트래핑'], level: 'caution',
    note: 'VDD_SPI 전압 선택 스트래핑 핀. 부팅 시 LOW 를 유지해야 한다.' },
  { pin: 46, tags: ['스트래핑'], level: 'caution',
    note: '부팅 모드 스트래핑 핀(부팅 시 LOW 유지). 출력으로 쓰기 전에 보드 배선을 확인할 것.' },
  { pin: 47, tags: ['범용'], level: 'ok' },
  { pin: 48, tags: ['범용', 'RGB(v1.1)'], level: 'ok',
    note: 'DevKitC-1 v1.1 에서는 온보드 RGB LED 가 이 핀에 연결된다. LED 확인용으로 쓰기 좋다.' },
];

/** @type {Map<number, PinMeta>} */
export const PIN_META = new Map(RAW.map((m) => [m.pin, { level: 'ok', tags: [], ...m }]));

/** 실제로 존재하는 GPIO 번호 목록 (S3 에는 22~25 가 없다) */
export const ALL_PINS = RAW.map((m) => m.pin).sort((a, b) => a - b);

export function meta(pin) {
  return PIN_META.get(pin) || { pin, tags: [], level: 'ok' };
}

export function isBlocked(pin) {
  return meta(pin).level === 'blocked';
}

export function isAdc(pin) {
  return !!meta(pin).adc;
}

/** 안전하게 자유롭게 쓸 수 있는 핀(기본 화면에 먼저 보여 줄 대상) */
export const SAFE_PINS = ALL_PINS.filter((p) => meta(p).level === 'ok');

/** ADC1 우선 정렬된 아날로그 입력 핀 */
export const ADC_PINS = ALL_PINS.filter(isAdc);
