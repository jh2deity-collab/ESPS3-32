// ---------------------------------------------------------------------------
//  전송 계층 공통 인터페이스
//  USB(Web Serial) / BLE(Web Bluetooth) / WiFi(WebSocket) / 시뮬레이터가
//  모두 같은 모양을 갖도록 한다: connect() / disconnect() / send(line),
//  그리고 onLine·onClose·onLog 콜백.
// ---------------------------------------------------------------------------
export class Transport {
  static id = 'base';
  static label = 'Base';

  constructor() {
    /** @type {(line:string)=>void} */
    this.onLine = () => {};
    /** @type {(reason?:string)=>void} */
    this.onClose = () => {};
    /** @type {(msg:string, level?:string)=>void} */
    this.onLog = () => {};
    this.connected = false;
  }

  get id() { return this.constructor.id; }
  get label() { return this.constructor.label; }

  /** 브라우저가 이 방식을 지원하는가 */
  static isSupported() { return false; }

  /** 지원하지 않을 때 사용자에게 보여 줄 이유 */
  static unsupportedReason() { return '이 브라우저에서 지원하지 않습니다.'; }

  async connect(_opts = {}) { throw new Error('미구현'); }
  async disconnect() {}
  async send(_line) { throw new Error('미구현'); }

  /**
   * 원본 바이트를 그대로 보낼 수 있는가.
   * OTA 는 이게 가능하면 base64 로 부풀리지 않고 바로 보낸다.
   */
  get supportsBinary() { return false; }

  async sendBinary(_bytes) { throw new Error('이 연결 방식은 바이너리 전송을 지원하지 않습니다'); }

  /** 아직 보내지 못하고 쌓인 바이트 수 (흐름 제어용) */
  get bufferedAmount() { return 0; }

  /**
   * 한 번에 보낼 수 있는 텍스트 크기 힌트.
   * BLE 처럼 쪼개 보내는 전송은 작게 잡아 반응성을 지킨다.
   */
  get maxTextChunk() { return 4096; }

  /** 연결 정보 요약 (상태바 표시용) */
  describe() { return this.label; }

  _closed(reason) {
    if (!this.connected) return;
    this.connected = false;
    this.onClose(reason);
  }
}

/**
 * 바이트 스트림을 줄 단위로 재조립한다 (USB·BLE 공용).
 */
export class LineSplitter {
  constructor(onLine) {
    this.onLine = onLine;
    this.buf = '';
    this.decoder = new TextDecoder();
  }

  push(chunk) {
    this.buf += typeof chunk === 'string'
      ? chunk
      : this.decoder.decode(chunk, { stream: true });

    let idx;
    while ((idx = this.buf.search(/[\r\n]/)) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (line) this.onLine(line);
    }

    // 펌웨어 한 줄 상한(1KB)을 크게 넘으면 동기화가 깨진 것으로 보고 버린다.
    if (this.buf.length > 8192) this.buf = '';
  }

  reset() { this.buf = ''; }
}
