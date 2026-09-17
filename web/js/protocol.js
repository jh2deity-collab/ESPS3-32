// ---------------------------------------------------------------------------
//  장치 클라이언트
//  전송 방식(USB/BLE/WiFi/시뮬레이터)과 무관하게 동일한 요청/응답 API 를 제공한다.
//    await dev.cmd('io.write', {pin: 2, value: 1})
//  응답은 id 로 짝을 맞추고, evt 필드가 있는 메시지는 이벤트로 흘려보낸다.
// ---------------------------------------------------------------------------
export class Device {
  constructor() {
    /** @type {import('./transports/base.js').Transport|null} */
    this.transport = null;
    this.pending = new Map();
    this.seq = 1;
    this.listeners = new Map();
    this.info = null;
    this.stats = { tx: 0, rx: 0, err: 0, rtt: 0 };
    this.defaultTimeout = 6000;
  }

  get connected() { return !!this.transport?.connected; }
  get transportId() { return this.transport?.id || null; }

  // --- 아주 작은 이벤트 버스 -------------------------------------------------
  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) { this.listeners.get(name)?.delete(fn); }

  emit(name, payload) {
    this.listeners.get(name)?.forEach((fn) => {
      try { fn(payload); } catch (err) { console.error('리스너 오류', name, err); }
    });
    if (name !== '*') this.emit('*', { name, payload });
  }

  // --- 연결 ------------------------------------------------------------------
  /**
   * @param {typeof import('./transports/base.js').Transport} TransportClass
   * @param {object} opts 전송별 옵션 (WiFi: {url}, USB: {baudRate} ...)
   */
  async connect(TransportClass, opts = {}) {
    if (this.connected) await this.disconnect();

    const t = new TransportClass();
    t.onLine = (line) => this._onLine(line);
    t.onLog = (msg, level) => this.emit('log', { msg, level: level || 'info' });
    t.onClose = (reason) => {
      this._failAllPending(reason || '연결이 끊어졌습니다');
      this.transport = null;
      this.info = null;
      this.emit('close', { reason });
    };

    await t.connect(opts);
    this.transport = t;
    this.emit('open', { transport: t.id, description: t.describe() });

    // 연결 직후 장치 정보를 한 번 읽어 둔다 (hello 이벤트가 유실돼도 채워지도록)
    try {
      this.info = await this.cmd('sys.info', {}, { timeout: 8000 });
      this.emit('info', this.info);
    } catch (err) {
      this.emit('log', { msg: `장치 정보 조회 실패: ${err.message}`, level: 'warn' });
    }
    return t;
  }

  async disconnect() {
    const t = this.transport;
    this.transport = null;
    this._failAllPending('연결을 해제했습니다');
    if (t) { try { await t.disconnect(); } catch { /* 무시 */ } }
    this.info = null;
  }

  // --- 명령 ------------------------------------------------------------------
  /**
   * 명령을 보내고 응답을 기다린다. 실패 시 Error 를 던진다.
   * @returns {Promise<object>} result 객체
   */
  cmd(name, args = {}, { timeout } = {}) {
    if (!this.connected) return Promise.reject(new Error('장치에 연결되어 있지 않습니다'));

    const id = this.seq++;
    const msg = { id, cmd: name };
    if (args && Object.keys(args).length) msg.args = args;
    const line = JSON.stringify(msg);

    // BLE 는 청크 전송이라 왕복이 느리다. 여유 있게 잡는다.
    const ms = timeout ?? (this.transportId === 'ble' ? 12000 : this.defaultTimeout);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.stats.err++;
        reject(new Error(`응답 시간 초과 (${ms}ms): ${name}`));
      }, ms);

      this.pending.set(id, { resolve, reject, timer, name, sentAt: performance.now() });
      this.stats.tx++;
      this.emit('tx', { line, cmd: name });

      Promise.resolve(this.transport.send(line)).catch((err) => {
        clearTimeout(timer);
        this.pending.delete(id);
        this.stats.err++;
        reject(err);
      });
    });
  }

  /** 던지지 않는 버전 - 시나리오 실행처럼 실패를 값으로 다루고 싶을 때 */
  async try(name, args = {}, opts = {}) {
    try {
      return { ok: true, result: await this.cmd(name, args, opts) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /** 원본 JSON 문자열을 그대로 보낸다 (콘솔 탭용) */
  async sendRaw(line) {
    if (!this.connected) throw new Error('장치에 연결되어 있지 않습니다');
    this.stats.tx++;
    this.emit('tx', { line, cmd: '(raw)' });
    await this.transport.send(line);
  }

  // --- 수신 ------------------------------------------------------------------
  _onLine(line) {
    this.stats.rx++;
    this.emit('rx', { line });

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      // 펌웨어가 흘린 일반 로그 문자열은 그대로 보여 준다.
      this.emit('log', { msg: line, level: 'device' });
      return;
    }

    if (msg.evt) {
      if (msg.evt === 'hello' && msg.data) {
        this.info = msg.data;
        this.emit('info', msg.data);
      }
      this.emit('event', { evt: msg.evt, data: msg.data || {}, ts: msg.ts });
      this.emit(`evt:${msg.evt}`, msg.data || {});
      return;
    }

    if (msg.id == null) {
      this.emit('log', { msg: line, level: 'device' });
      return;
    }

    const p = this.pending.get(msg.id);
    if (!p) return;                       // 시간 초과 후 늦게 온 응답
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    this.stats.rtt = Math.round(performance.now() - p.sentAt);

    if (msg.ok) {
      p.resolve(msg.result || {});
    } else {
      this.stats.err++;
      p.reject(new Error(msg.error || '알 수 없는 오류'));
    }
  }

  _failAllPending(reason) {
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    });
    this.pending.clear();
  }
}
