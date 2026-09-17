// ---------------------------------------------------------------------------
//  OTA 업로드 클라이언트
//
//  지금 연결된 채널이 무엇이든 같은 함수로 펌웨어를 올린다.
//    · WiFi  : WebSocket 바이너리 프레임으로 원본 그대로 (가장 빠름)
//    · USB   : JSON + base64, 조각마다 응답을 받아 흐름을 제어
//    · BLE   : 같은 방식이지만 조각이 작다 (느리므로 예상 시간을 미리 알린다)
//
//  업로드 전에 MD5 를 계산해 장치에 알려 주고, 장치가 Update.setMD5() 로
//  검증한다. 중간에 깨진 이미지는 재부팅 전에 걸러진다.
// ---------------------------------------------------------------------------
import { Md5 } from './md5.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** WebSocket 송신 버퍼가 이보다 쌓이면 잠깐 쉰다 (메모리 폭주 방지) */
const WS_BUFFER_LIMIT = 256 * 1024;

/** 전송 방식별 기본 조각 크기 (바이트, 인코딩 전) */
const CHUNK_BY_TRANSPORT = {
  wifi: 4096,
  mock: 4096,
  usb: 2048,
  ble: 512,
};

/** 대략적인 전송 속도(B/s) - 시작 전에 예상 시간을 보여 주기 위한 값 */
export const ROUGH_SPEED = {
  usb: 120000,
  wifi: 200000,
  ble: 3000,
  mock: 400000,
};

export function estimateSeconds(transportId, bytes) {
  const rate = ROUGH_SPEED[transportId] || 50000;
  return Math.max(1, Math.round(bytes / rate));
}

export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '-';
  if (sec < 1)  return `${Math.round(sec * 1000)}ms`;
  if (sec < 10) return `${sec.toFixed(1)}초`;     // 빠른 전송이 '0초' 로 보이지 않도록
  if (sec < 60) return `${Math.round(sec)}초`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m}분 ${s}초` : `${m}분`;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const B64_TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Uint8Array 조각을 base64 로 (btoa 는 큰 입력에서 문자열을 크게 만들어 직접 만든다) */
export function toBase64(bytes) {
  let out = '';
  const len = bytes.length;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64_TABLE[(v >> 18) & 63] + B64_TABLE[(v >> 12) & 63] +
           B64_TABLE[(v >> 6) & 63] + B64_TABLE[v & 63];
  }
  if (i < len) {
    const rem = len - i;
    const v = (bytes[i] << 16) | ((rem > 1 ? bytes[i + 1] : 0) << 8);
    out += B64_TABLE[(v >> 18) & 63] + B64_TABLE[(v >> 12) & 63];
    out += rem > 1 ? B64_TABLE[(v >> 6) & 63] : '=';
    out += '=';
  }
  return out;
}

export class OtaAbort extends Error {
  constructor() { super('업로드를 취소했습니다'); this.name = 'OtaAbort'; }
}

/**
 * 펌웨어 이미지를 장치에 올린다.
 *
 * @param {import('./protocol.js').Device} dev
 * @param {Uint8Array} image
 * @param {{
 *   onProgress?: (p:{sent:number,total:number,percent:number,bps:number,etaSec:number}) => void,
 *   onLog?: (msg:string, level?:string) => void,
 *   shouldAbort?: () => boolean,
 *   verify?: boolean,
 * }} opts
 */
export async function uploadFirmware(dev, image, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const onLog = opts.onLog || (() => {});
  const shouldAbort = opts.shouldAbort || (() => false);
  const verify = opts.verify !== false;

  if (!dev.connected) throw new Error('장치에 연결되어 있지 않습니다');
  if (!image || image.length === 0) throw new Error('펌웨어 파일이 비어 있습니다');

  // 앱 이미지는 0xE9 매직으로 시작한다. 엉뚱한 파일을 굽는 사고를 미리 막는다.
  if (image[0] !== 0xe9) {
    throw new Error('ESP32 펌웨어 이미지가 아닌 것 같습니다(첫 바이트가 0xE9 가 아님). ' +
                    'firmware.bin 이 맞는지 확인하세요.');
  }

  const transportId = dev.transportId;
  const total = image.length;

  // 1) 장치 쪽 준비 상태 확인
  const status = await dev.cmd('ota.status');
  if (status.otaCapable === false) {
    throw new Error('이 장치의 파티션 구성으로는 OTA 를 쓸 수 없습니다. USB 전체 플래시를 사용하세요.');
  }
  if (status.maxSize && total > status.maxSize) {
    throw new Error(`이미지가 OTA 파티션보다 큽니다 (${formatBytes(total)} > ${formatBytes(status.maxSize)})`);
  }
  if (status.state === 'receiving') {
    onLog('이전 업로드가 남아 있어 정리합니다', 'warn');
    await dev.try('ota.abort');
  }

  // 2) BLE 라면 더 큰 조각으로 보내도 되는지 왕복으로 확인해 둔다
  if (transportId === 'ble' && dev.transport?.probeChunkSize) {
    await dev.transport.probeChunkSize(() => dev.cmd('sys.ping', {}, { timeout: 6000 }));
  }

  // 3) MD5 계산
  const md5 = verify ? new Md5().update(image).hex() : '';
  onLog(`펌웨어 ${formatBytes(total)}${verify ? ` · MD5 ${md5}` : ' · 검증 생략'}`);

  // 4) 시작
  await dev.cmd('ota.begin', { size: total, md5 }, { timeout: 15000 });
  onLog(`업로드 시작 (${transportId.toUpperCase()})`, 'ok');

  const startedAt = performance.now();
  let sent = 0;
  let lastReport = 0;

  const report = (force = false) => {
    const now = performance.now();
    if (!force && now - lastReport < 120) return;
    lastReport = now;
    const elapsed = (now - startedAt) / 1000;
    const bps = elapsed > 0 ? sent / elapsed : 0;
    onProgress({
      sent, total,
      percent: total ? Math.round((sent / total) * 100) : 0,
      bps,
      etaSec: bps > 0 ? (total - sent) / bps : Infinity,
    });
  };

  const bail = async () => {
    await dev.try('ota.abort');
    throw new OtaAbort();
  };

  try {
    const useBinary = !!dev.transport?.supportsBinary;
    const chunkSize = Math.min(
      CHUNK_BY_TRANSPORT[transportId] || 1024,
      useBinary ? 8192 : Math.max(256, status.maxChunk || 1024),
      // BLE 등 텍스트 조각이 작은 전송은 그 상한도 함께 본다
      useBinary ? 8192 : (dev.transport?.maxTextChunk || 1024),
    );

    report(true);

    while (sent < total) {
      if (shouldAbort()) await bail();

      const end = Math.min(sent + chunkSize, total);
      const slice = image.subarray(sent, end);

      if (useBinary) {
        // WebSocket 은 순서가 보장되므로 응답을 기다리지 않고 밀어 넣는다.
        // 대신 송신 버퍼가 너무 쌓이지 않게 지켜본다.
        let guard = 0;
        while ((dev.transport.bufferedAmount || 0) > WS_BUFFER_LIMIT) {
          if (shouldAbort()) await bail();
          await sleep(4);
          if (++guard > 5000) throw new Error('전송 버퍼가 비워지지 않습니다(연결 상태를 확인하세요)');
        }
        await dev.transport.sendBinary(slice.slice());   // 복사본을 넘긴다
      } else {
        // 조각마다 응답을 받는다. 흐름 제어와 오류 감지를 겸한다.
        await dev.cmd('ota.data', { b64: toBase64(slice) }, { timeout: 20000 });
      }

      sent = end;
      report();
    }

    report(true);

    // 5) 마무리 - 장치가 크기와 MD5 를 확인한다
    onLog('전송 완료, 장치가 이미지를 검증하는 중…');
    const done = await dev.cmd('ota.end', {}, { timeout: 30000 });
    const elapsed = (performance.now() - startedAt) / 1000;
    onLog(`업로드 성공 · ${formatBytes(total)} / ${formatDuration(elapsed)} ` +
          `(${formatBytes(Math.round(total / Math.max(elapsed, 0.001)))}/s)`, 'ok');
    return { ...done, elapsedSec: elapsed, bytes: total, md5 };

  } catch (err) {
    if (err instanceof OtaAbort) throw err;
    // 장치가 플래시를 붙잡은 채로 남지 않도록 정리한다
    await dev.try('ota.abort');
    throw err;
  }
}
