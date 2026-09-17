import { Transport } from './base.js';

// ---------------------------------------------------------------------------
//  WiFi - WebSocket (펌웨어의 WebSocket 서버, 기본 포트 81)
//  주의: 이 페이지를 https:// 로 열면 브라우저가 ws:// 연결을 차단한다.
//        (혼합 콘텐츠) WiFi 로 붙을 때는 http://localhost 로 열어 주세요.
// ---------------------------------------------------------------------------
export class WifiTransport extends Transport {
  static id = 'wifi';
  static label = 'WiFi';

  static isSupported() { return typeof WebSocket !== 'undefined'; }
  static unsupportedReason() { return 'WebSocket 을 지원하지 않는 브라우저입니다.'; }

  constructor() {
    super();
    this.ws = null;
    this.url = '';
  }

  static normalizeUrl(input) {
    let s = String(input || '').trim();
    if (!s) throw new Error('장치 주소를 입력하세요 (예: 192.168.0.42)');
    if (!/^wss?:\/\//i.test(s)) s = 'ws://' + s;
    // 포트가 없으면 펌웨어 기본 포트 81 을 붙인다.
    const u = new URL(s);
    if (!u.port) u.port = '81';
    if (!u.pathname || u.pathname === '/') u.pathname = '/';
    return u.toString();
  }

  async connect(opts = {}) {
    const url = WifiTransport.normalizeUrl(opts.url);
    const timeoutMs = Number(opts.timeoutMs) || 8000;
    this.url = url;

    if (location.protocol === 'https:' && url.startsWith('ws://')) {
      throw new Error('https 페이지에서는 ws:// 연결이 차단됩니다. http://localhost 로 열어 주세요.');
    }

    this.onLog(`${url} 에 접속 중...`);

    await new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { /* 무시 */ }
        reject(new Error(`접속 시간 초과: ${url} (장치 IP 와 같은 네트워크인지 확인하세요)`));
      }, timeoutMs);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.connected = true;
        this.onLog(`WiFi 연결됨: ${url}`, 'ok');
        resolve();
      };

      ws.onmessage = (ev) => {
        // 펌웨어는 WebSocket 메시지 하나당 JSON 한 줄을 보낸다.
        String(ev.data).split('\n').forEach((l) => {
          const t = l.trim();
          if (t) this.onLine(t);
        });
      };

      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`접속 실패: ${url}`));
      };

      ws.onclose = () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(new Error(`접속이 거부되었습니다: ${url}`));
          return;
        }
        this._closed('WiFi 연결이 끊어졌습니다');
      };
    });
  }

  async send(line) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 이 열려 있지 않습니다');
    }
    this.ws.send(line);
  }

  // 펌웨어는 바이너리 프레임을 OTA 데이터로만 해석한다.
  get supportsBinary() { return true; }

  async sendBinary(bytes) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 이 열려 있지 않습니다');
    }
    this.ws.send(bytes);
  }

  get bufferedAmount() { return this.ws ? this.ws.bufferedAmount : 0; }

  async disconnect() {
    this.connected = false;
    try { this.ws?.close(); } catch { /* 무시 */ }
    this.ws = null;
    this.onClose('사용자가 연결을 해제했습니다');
  }

  describe() { return `WiFi ${this.url}`; }
}
