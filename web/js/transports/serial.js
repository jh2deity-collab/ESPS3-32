import { Transport, LineSplitter } from './base.js';

// ---------------------------------------------------------------------------
//  USB - Web Serial API
//  ESP32-S3 의 네이티브 USB CDC 포트에 직접 붙는다.
//  (Chrome/Edge/Opera 데스크톱, HTTPS 또는 localhost 에서만 동작)
// ---------------------------------------------------------------------------
export class SerialTransport extends Transport {
  static id = 'usb';
  static label = 'USB';

  static isSupported() { return 'serial' in navigator; }
  static unsupportedReason() {
    return 'Web Serial API 미지원. 데스크톱 Chrome/Edge 에서 https:// 또는 http://localhost 로 열어 주세요.';
  }

  constructor() {
    super();
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.encoder = new TextEncoder();
    this._readTask = null;
  }

  async connect(opts = {}) {
    if (!SerialTransport.isSupported()) throw new Error(SerialTransport.unsupportedReason());

    const baudRate = Number(opts.baudRate) || 115200;

    // 이전에 권한을 준 포트가 있으면 재사용, 없으면 선택 창을 띄운다.
    let port = null;
    if (opts.reuse !== false) {
      const granted = await navigator.serial.getPorts();
      if (granted.length === 1) port = granted[0];
    }
    if (!port) {
      port = await navigator.serial.requestPort();   // 사용자 제스처 필요
    }

    await port.open({ baudRate, bufferSize: 8192 });
    this.port = port;

    // DTR/RTS 를 올려 CDC 포트를 "열린" 상태로 만든다.
    try { await port.setSignals({ dataTerminalReady: true, requestToSend: false }); } catch { /* 무시 */ }

    this.writer = port.writable.getWriter();
    this.connected = true;

    const info = port.getInfo?.() || {};
    this._info = [info.usbVendorId, info.usbProductId]
      .filter((v) => v != null)
      .map((v) => '0x' + v.toString(16).padStart(4, '0'))
      .join(':');

    this._readTask = this._readLoop();
    this.onLog(`USB 시리얼 연결됨 (${baudRate} bps${this._info ? ', ' + this._info : ''})`, 'ok');
  }

  async _readLoop() {
    const splitter = new LineSplitter((line) => this.onLine(line));
    try {
      while (this.port?.readable && this.connected) {
        this.reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value) splitter.push(value);
          }
        } finally {
          try { this.reader.releaseLock(); } catch { /* 무시 */ }
          this.reader = null;
        }
      }
    } catch (err) {
      if (this.connected) this.onLog(`USB 읽기 오류: ${err.message}`, 'err');
    }
    this._closed('USB 연결이 끊어졌습니다');
  }

  async send(line) {
    if (!this.writer) throw new Error('USB 포트가 열려 있지 않습니다');
    await this.writer.write(this.encoder.encode(line + '\n'));
  }

  async disconnect() {
    this.connected = false;
    try { await this.reader?.cancel(); } catch { /* 무시 */ }
    try { this.writer?.releaseLock(); } catch { /* 무시 */ }
    this.writer = null;
    try { await this.port?.close(); } catch { /* 무시 */ }
    this.port = null;
    this.onClose('사용자가 연결을 해제했습니다');
  }

  describe() { return `USB CDC${this._info ? ' ' + this._info : ''}`; }
}
