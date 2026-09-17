// ---------------------------------------------------------------------------
//  USB 전체 플래시 (ROM 부트로더)
//
//  Espressif 의 esptool-js 를 감싸, 브라우저에서 Web Serial 로 칩의 ROM
//  부트로더와 직접 이야기한다. OTA 와 달리 **완전히 빈 칩에도** 구울 수 있고
//  부트로더·파티션 테이블까지 통째로 바꿀 수 있다.
//
//  주의: 이 포트는 콘솔의 USB 연결과 같은 장치다. 굽기 전에 콘솔 연결을
//  반드시 끊어야 한다(한 포트를 두 곳에서 열 수 없다).
// ---------------------------------------------------------------------------
import { ESPLoader, Transport } from '../vendor/esptool-js/esptool.js';
import { md5Hex } from './md5.js';

/** ESP32-S3 기본 배치 (PlatformIO/Arduino 빌드 산출물 기준) */
export const DEFAULT_LAYOUT = [
  { address: 0x0,     name: 'bootloader.bin',  hint: '부트로더' },
  { address: 0x8000,  name: 'partitions.bin',  hint: '파티션 테이블' },
  { address: 0xe000,  name: 'boot_app0.bin',   hint: 'OTA 데이터 초기화(선택)' },
  { address: 0x10000, name: 'firmware.bin',    hint: '애플리케이션' },
];

export const BAUD_RATES = [921600, 460800, 230400, 115200];

export function isSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/**
 * 주소가 겹치면 나중에 쓴 쪽이 앞을 덮어써 조용히 망가진다. 굽기 전에 막는다.
 * @param {{data: Uint8Array, address: number, name?: string}[]} parts
 */
export function checkOverlaps(parts) {
  const sorted = [...parts].sort((a, b) => a.address - b.address);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const end = prev.address + prev.data.length;
    if (sorted[i].address < end) {
      throw new Error(
        `주소가 겹칩니다: ${prev.name || '파일'} (${formatAddress(prev.address)}~${formatAddress(end)})` +
        ` 와 ${sorted[i].name || '파일'} (${formatAddress(sorted[i].address)})`);
    }
  }
}

export class FlashAbort extends Error {
  constructor() { super('플래시를 취소했습니다'); this.name = 'FlashAbort'; }
}

/**
 * 파일들을 각자의 주소에 굽는다.
 *
 * @param {{data: Uint8Array, address: number, name?: string}[]} parts
 * @param {{
 *   baudRate?: number,
 *   eraseAll?: boolean,
 *   port?: SerialPort,
 *   onLog?: (msg:string, level?:string) => void,
 *   onProgress?: (p:{fileIndex:number, written:number, total:number, name:string}) => void,
 *   shouldAbort?: () => boolean,
 * }} opts
 */
export async function flashParts(parts, opts = {}) {
  if (!isSupported()) {
    throw new Error('Web Serial API 를 지원하지 않는 브라우저입니다. ' +
                    '데스크톱 Chrome/Edge 에서 http://localhost 로 열어 주세요.');
  }
  if (!parts.length) throw new Error('구울 파일을 선택하세요');

  const onLog = opts.onLog || (() => {});
  const onProgress = opts.onProgress || (() => {});
  const shouldAbort = opts.shouldAbort || (() => false);
  const baudRate = Number(opts.baudRate) || 921600;

  checkOverlaps(parts);

  let port = opts.port;
  if (!port) {
    const granted = await navigator.serial.getPorts();
    port = granted.length === 1 ? granted[0] : await navigator.serial.requestPort();
  }

  const terminal = {
    clean() {},
    writeLine(data) { onLog(String(data)); },
    write(data) { const s = String(data).trim(); if (s) onLog(s); },
  };

  const transport = new Transport(port, false);
  let loader = null;

  try {
    loader = new ESPLoader({ transport, baudrate: baudRate, terminal, enableTracing: false });

    onLog('부트로더에 연결하는 중…');
    let chip;
    try {
      chip = await loader.main();
    } catch (err) {
      throw new Error(
        `부트로더에 연결하지 못했습니다: ${err.message}\n` +
        '보드의 BOOT 버튼을 누른 채로 RESET 을 한 번 누르고(다운로드 모드) 다시 시도해 보세요.');
    }
    onLog(`칩 확인: ${chip}`, 'ok');

    const chipName = loader.chip?.CHIP_NAME || String(chip);
    if (!/S3/i.test(chipName)) {
      onLog(`경고: ESP32-S3 가 아닌 것 같습니다(${chipName}). 이미지가 맞는지 확인하세요.`, 'warn');
    }

    if (shouldAbort()) throw new FlashAbort();

    if (opts.eraseAll) onLog('플래시 전체를 지우는 중… (시간이 걸립니다)');

    const totalBytes = parts.reduce((n, p) => n + p.data.length, 0);
    onLog(`${parts.length}개 파일 / 합계 ${(totalBytes / 1024).toFixed(0)} KB 를 씁니다`);

    await loader.writeFlash({
      fileArray: parts.map((p) => ({ data: p.data, address: p.address })),
      flashSize: 'keep',      // 이미지 헤더의 설정을 그대로 둔다
      flashMode: 'keep',
      flashFreq: 'keep',
      eraseAll: !!opts.eraseAll,
      compress: true,
      reportProgress: (fileIndex, written, total) => {
        onProgress({ fileIndex, written, total, name: parts[fileIndex]?.name || `#${fileIndex + 1}` });
      },
      // 칩이 계산한 해시와 맞춰 본다 - 여기서 틀리면 esptool 이 오류를 낸다
      calculateMD5Hash: (image) => md5Hex(image),
    });

    onLog('기록과 검증을 마쳤습니다', 'ok');

    await loader.after('hard_reset');
    onLog('장치를 재시작했습니다', 'ok');
    return { chip: chipName, bytes: totalBytes };

  } finally {
    // 포트를 놓아 주지 않으면 콘솔이 다시 USB 로 연결할 수 없다
    try { await transport.disconnect(); } catch { /* 무시 */ }
  }
}

/** 파일 하나를 Uint8Array 로 읽는다 */
export async function readFileBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * 플래시 주소를 읽는다. **0x 를 붙이든 안 붙이든 언제나 16진수로** 해석한다.
 * ('10000' 을 십진수로 읽으면 0x2710 - 파티션 테이블 영역 - 에 덮어쓰게 된다.
 *  화면에는 해석 결과를 0x 표기로 되돌려 보여 주므로 오해할 일이 없다.)
 */
export function parseAddress(text) {
  const s = String(text).trim().replace(/^0x/i, '');
  if (!s) throw new Error('주소를 입력하세요');
  if (!/^[0-9a-f]+$/i.test(s)) throw new Error(`주소가 올바르지 않습니다: ${text}`);
  const v = parseInt(s, 16);
  if (!Number.isInteger(v) || v < 0 || v > 0x1000000) throw new Error(`주소 범위를 벗어났습니다: ${text}`);
  if (v % 4 !== 0) throw new Error(`주소는 4바이트 단위여야 합니다: ${text}`);
  return v;
}

export function formatAddress(v) {
  return '0x' + v.toString(16).toUpperCase().padStart(4, '0');
}
