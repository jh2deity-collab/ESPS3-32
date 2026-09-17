import { Transport, LineSplitter } from './base.js';

// ---------------------------------------------------------------------------
//  블루투스 - Web Bluetooth (BLE, Nordic UART Service 호환)
//  펌웨어의 NUS 특성 두 개(RX=write, TX=notify)에 붙는다.
//  (Chrome/Edge 데스크톱·안드로이드, HTTPS 또는 localhost 필요)
// ---------------------------------------------------------------------------
const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // 웹 -> 장치 (write)
const NUS_TX      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // 장치 -> 웹 (notify)

const SAFE_CHUNK  = 20;    // MTU 협상 결과와 무관하게 언제나 통하는 크기
const FAST_CHUNK  = 180;   // MTU 가 넉넉할 때. 반드시 왕복으로 확인하고 쓴다

export class BleTransport extends Transport {
  static id = 'ble';
  static label = '블루투스';

  static isSupported() { return 'bluetooth' in navigator && !!navigator.bluetooth?.requestDevice; }
  static unsupportedReason() {
    return 'Web Bluetooth API 미지원. 데스크톱 Chrome/Edge 또는 안드로이드 Chrome 에서 https:// 또는 http://localhost 로 열어 주세요.';
  }

  constructor() {
    super();
    this.device = null;
    this.rxChar = null;
    this.txChar = null;
    this.encoder = new TextEncoder();
    this._txQueue = Promise.resolve();
    this.chunk = SAFE_CHUNK;
    this._probed = false;
    this._onDisc = () => this._closed('BLE 연결이 끊어졌습니다');
  }

  async connect(opts = {}) {
    if (!BleTransport.isSupported()) throw new Error(BleTransport.unsupportedReason());

    const filters = opts.namePrefix
      ? [{ namePrefix: opts.namePrefix }]
      : [{ services: [NUS_SERVICE] }];

    this.device = await navigator.bluetooth.requestDevice({   // 사용자 제스처 필요
      filters,
      optionalServices: [NUS_SERVICE],
    });
    this.device.addEventListener('gattserverdisconnected', this._onDisc);

    this.onLog(`'${this.device.name || '이름 없음'}' 에 연결 중...`);
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(NUS_SERVICE);
    this.rxChar = await service.getCharacteristic(NUS_RX);
    this.txChar = await service.getCharacteristic(NUS_TX);

    const splitter = new LineSplitter((line) => this.onLine(line));
    this.txChar.addEventListener('characteristicvaluechanged', (ev) => {
      splitter.push(new Uint8Array(ev.target.value.buffer));
    });
    await this.txChar.startNotifications();

    this.connected = true;
    this.chunk = SAFE_CHUNK;
    this._probed = false;
    this.onLog(`BLE 연결됨: ${this.device.name || this.device.id}`, 'ok');
  }

  // BLE 는 조각을 잘게 나눠 보내므로 펌웨어 업로드가 오래 걸린다.
  get maxTextChunk() { return this.chunk >= FAST_CHUNK ? 1024 : 384; }

  /**
   * 더 큰 조각으로 보내도 되는지 **왕복으로 확인**한다.
   *
   * MTU 를 넘는 쓰기는 플랫폼에 따라 예외가 나기도 하고 조용히 잘리기도 한다.
   * 조용히 잘리면 펌웨어가 깨진 채로 구워지므로, 크기를 올린 뒤 실제로 명령
   * 하나를 주고받아 성공했을 때만 그 크기를 유지한다.
   *
   * @param {() => Promise<any>} pingFn 왕복을 확인할 함수 (보통 sys.ping)
   */
  async probeChunkSize(pingFn) {
    if (this._probed || !this.connected) return this.chunk;
    this._probed = true;

    const prev = this.chunk;
    this.chunk = FAST_CHUNK;
    try {
      await pingFn();
      this.onLog(`BLE 전송 단위를 ${FAST_CHUNK}B 로 올렸습니다(업로드가 빨라집니다)`, 'ok');
    } catch {
      this.chunk = prev;
      // 잘린 조각이 장치 버퍼에 남아 있을 수 있으므로 줄바꿈으로 비워 준다
      try { await this._flushAssembler(); } catch { /* 무시 */ }
      this.onLog('BLE MTU 가 작아 전송 단위를 20B 로 유지합니다(업로드가 느립니다)');
    }
    return this.chunk;
  }

  /** 장치의 줄 조립 버퍼를 비운다. 줄바꿈만 보내면 아무 명령도 실행되지 않는다. */
  async _flushAssembler() {
    const nl = new Uint8Array(SAFE_CHUNK).fill(0x0a);
    if (this.rxChar.writeValueWithoutResponse) await this.rxChar.writeValueWithoutResponse(nl);
    else await this.rxChar.writeValue(nl);
  }

  /**
   * BLE 는 한 번에 보낼 수 있는 크기가 작으므로 청크로 쪼개 순서대로 보낸다.
   * 큐로 직렬화하지 않으면 GATT 연산이 겹쳐 InvalidStateError 가 난다.
   */
  async send(line) {
    if (!this.rxChar) throw new Error('BLE 가 연결되어 있지 않습니다');
    const bytes = this.encoder.encode(line + '\n');

    const chunk = this.chunk;
    this._txQueue = this._txQueue.then(async () => {
      for (let i = 0; i < bytes.length; i += chunk) {
        const part = bytes.slice(i, i + chunk);
        if (this.rxChar.writeValueWithoutResponse) {
          await this.rxChar.writeValueWithoutResponse(part);
        } else {
          await this.rxChar.writeValue(part);
        }
      }
    }).catch((err) => {
      this.onLog(`BLE 전송 실패: ${err.message}`, 'err');
    });

    return this._txQueue;
  }

  async disconnect() {
    this.connected = false;
    this.device?.removeEventListener('gattserverdisconnected', this._onDisc);
    try { await this.txChar?.stopNotifications(); } catch { /* 무시 */ }
    try { this.device?.gatt?.disconnect(); } catch { /* 무시 */ }
    this.rxChar = this.txChar = null;
    this.device = null;
    this._probed = false;
    this.chunk = SAFE_CHUNK;
    this.onClose('사용자가 연결을 해제했습니다');
  }

  describe() { return `BLE ${this.device?.name || ''}`.trim(); }
}
