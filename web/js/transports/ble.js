import { Transport, LineSplitter } from './base.js';

// ---------------------------------------------------------------------------
//  블루투스 - Web Bluetooth (BLE, Nordic UART Service 호환)
//  펌웨어의 NUS 특성 두 개(RX=write, TX=notify)에 붙는다.
//  (Chrome/Edge 데스크톱·안드로이드, HTTPS 또는 localhost 필요)
// ---------------------------------------------------------------------------
const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // 웹 -> 장치 (write)
const NUS_TX      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // 장치 -> 웹 (notify)

const CHUNK = 20;   // MTU 협상 결과와 무관하게 안전한 크기

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
    this.onLog(`BLE 연결됨: ${this.device.name || this.device.id}`, 'ok');
  }

  /**
   * BLE 는 한 번에 보낼 수 있는 크기가 작으므로 청크로 쪼개 순서대로 보낸다.
   * 큐로 직렬화하지 않으면 GATT 연산이 겹쳐 InvalidStateError 가 난다.
   */
  async send(line) {
    if (!this.rxChar) throw new Error('BLE 가 연결되어 있지 않습니다');
    const bytes = this.encoder.encode(line + '\n');

    this._txQueue = this._txQueue.then(async () => {
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const part = bytes.slice(i, i + CHUNK);
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
    this.onClose('사용자가 연결을 해제했습니다');
  }

  describe() { return `BLE ${this.device?.name || ''}`.trim(); }
}
