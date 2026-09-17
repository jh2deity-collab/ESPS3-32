import { Transport } from './base.js';
import { ALL_PINS, meta, isAdc, isBlocked } from '../pinmap.js';

// ---------------------------------------------------------------------------
//  시뮬레이터 - 펌웨어 동작을 브라우저 안에서 흉내 낸다.
//  하드웨어 없이 UI·테스트 시나리오를 검증하기 위한 것으로, 명령/이벤트 형식은
//  실제 펌웨어(protocol.cpp)와 동일하게 맞춰 두었다.
// ---------------------------------------------------------------------------
const MODES = ['disabled', 'input', 'input_pullup', 'input_pulldown', 'output', 'pwm', 'adc'];

export class MockTransport extends Transport {
  static id = 'mock';
  static label = '시뮬레이터';

  static isSupported() { return true; }

  constructor() {
    super();
    this.pins = new Map();
    this.timer = null;
    this.startedAt = Date.now();
    this.app = {
      enabled: false, buttonPin: 0, relayPin: -1, ledPin: 48,
      sensorPin: -1, alarmPin: -1, activeLow: true,
      debounceMs: 20, threshold: 3000,
      relay: false, alarm: false, presses: 0,
      _stable: -1, _lastRaw: -1, _edgeAt: 0, _blinkAt: 0, _blinkOn: false,
    };
    this.watchMs = 50;
  }

  _pin(p) {
    if (!this.pins.has(p)) {
      this.pins.set(p, {
        pin: p, mode: 'disabled', out: 0, duty: 0, freq: 5000, res: 10,
        forced: false, forcedValue: 0, watch: false, last: null,
        // 시뮬레이션용 "물리" 상태: 노이즈가 있는 플로팅 입력을 흉내 낸다
        phys: 0, noise: Math.random() * 40,
        pulseAt: 0, pulseKind: null, pulseRestore: 0, pulseRestoreForced: false,
      });
    }
    return this.pins.get(p);
  }

  async connect() {
    this.connected = true;
    this.startedAt = Date.now();
    this.timer = setInterval(() => this._tick(), 25);
    this.onLog('시뮬레이터 시작 - 하드웨어 없이 UI 와 시나리오를 검증할 수 있습니다.', 'ok');
    setTimeout(() => this._emit('hello', { via: 'mock', ...this._sysInfo() }), 30);
  }

  async disconnect() {
    this.connected = false;
    clearInterval(this.timer);
    this.timer = null;
    this.onClose('시뮬레이터를 종료했습니다');
  }

  async send(line) {
    // 실제 장치의 왕복 지연을 흉내 내기 위해 다음 틱에 처리한다.
    setTimeout(() => this._handle(line), 6 + Math.random() * 8);
  }

  describe() { return '시뮬레이터 (하드웨어 없음)'; }

  // --- 내부 유틸 ------------------------------------------------------------
  _emit(evt, data) {
    this.onLine(JSON.stringify({ evt, ts: Date.now() - this.startedAt, data }));
  }

  _reply(id, result) {
    const msg = { ok: true, result };
    if (id != null) msg.id = id;
    this.onLine(JSON.stringify(msg));
  }

  _error(id, error) {
    const msg = { ok: false, error };
    if (id != null) msg.id = id;
    this.onLine(JSON.stringify(msg));
  }

  /** 강제값이 걸려 있으면 그것을, 아니면 물리값을 돌려준다 (펌웨어 io::read 와 동일) */
  _read(p) {
    const s = this._pin(p);
    if (s.forced) return s.forcedValue ? 1 : 0;
    if (s.mode === 'output') return s.out ? 1 : 0;
    return s.phys ? 1 : 0;
  }

  /** 입력 모드로 설정할 때의 아이들 레벨(내부 풀 저항 효과)을 물리 상태에 반영한다 */
  _applyIdleLevel(s) {
    if (s.mode === 'input_pullup') s.phys = 1;
    else if (s.mode === 'input_pulldown' || s.mode === 'input') s.phys = 0;
  }

  _readAdc(p) {
    const s = this._pin(p);
    if (s.forced) return s.forcedValue;
    // 1.2V 근처에서 흔들리는 아날로그 입력을 흉내 낸다
    const base = 1500 + Math.sin((Date.now() - this.startedAt) / 1700) * 120;
    return Math.max(0, Math.min(4095, Math.round(base + (Math.random() - 0.5) * s.noise)));
  }

  _value(p) {
    const s = this._pin(p);
    if (s.mode === 'adc') return this._readAdc(p);
    if (s.mode === 'pwm') return s.duty;
    return this._read(p);
  }

  _state(p) {
    const s = this._pin(p);
    const o = {
      pin: p, mode: s.mode, value: this._value(p),
      raw: s.mode === 'adc' ? this._readAdc(p) : s.phys,
      forced: s.forced,
    };
    if (s.forced) o.forcedValue = s.forcedValue;
    if (s.mode === 'output') o.out = s.out;
    if (s.mode === 'pwm') { o.duty = s.duty; o.freq = s.freq; o.res = s.res; }
    if (s.watch) o.watch = true;
    return o;
  }

  _sysInfo() {
    return {
      model: 'ESP32-S3-WROOM-1 N8R2 (시뮬레이터)',
      fw: '1.0.0-sim', proto: 1, chip: 'ESP32-S3', cores: 2, cpuMhz: 240,
      flashMB: 8, psramMB: 2, freeHeap: 280000, freePsram: 2000000,
      uptimeMs: Date.now() - this.startedAt,
      mac: '7C:DF:A1:00:00:01', watchMs: this.watchMs,
      transports: { usb: false, ble: false, wifi: false, mock: true },
      net: { mode: 'sim', ip: '192.168.0.42', ssid: 'SIMULATED', host: 'esps3-test-sim.local', clients: 1 },
      bleName: 'ESPS3-TEST-SIM',
    };
  }

  _checkPin(p) {
    if (!Number.isInteger(p)) return "'pin' 인자가 필요합니다";
    if (!ALL_PINS.includes(p)) return `존재하지 않는 GPIO: ${p}`;
    if (isBlocked(p)) return `GPIO${p} 은(는) Flash/PSRAM 전용이라 사용할 수 없습니다`;
    return null;
  }

  // --- 명령 처리 ------------------------------------------------------------
  _handle(line) {
    let req;
    try { req = JSON.parse(line); }
    catch (e) { return this._error(null, `JSON 파싱 실패: ${e.message}`); }

    const { id, cmd } = req;
    const a = req.args || {};
    const p = a.pin;
    const bad = () => { const e = this._checkPin(p); if (e) { this._error(id, e); return true; } return false; };
    const after = () => { this._emit('pin.state', this._state(p)); this._reply(id, this._state(p)); };

    switch (cmd) {
      case 'sys.ping':   return this._reply(id, { pong: Date.now() - this.startedAt });
      case 'sys.info':   return this._reply(id, this._sysInfo());
      case 'sys.pinmap':
        return this._reply(id, {
          pins: ALL_PINS.map((n) => {
            const o = { pin: n };
            if (isBlocked(n)) o.reserved = true;
            if (isAdc(n)) o.adc = true;
            return o;
          }),
        });
      case 'sys.reset':
        this._reply(id, { restarting: true });
        this.pins.clear();
        this.startedAt = Date.now();
        setTimeout(() => this._emit('hello', { via: 'mock', ...this._sysInfo() }), 400);
        return;

      case 'io.config': {
        if (bad()) return;
        if (!MODES.includes(a.mode)) return this._error(id, '알 수 없는 mode');
        if (a.mode === 'adc' && !isAdc(p)) return this._error(id, `GPIO${p} 은(는) ADC 입력이 아닙니다`);
        const s = this._pin(p);
        s.mode = a.mode;
        this._applyIdleLevel(s);
        if (a.freq) s.freq = a.freq;
        if (a.res) s.res = a.res;
        s.last = null;
        return after();
      }
      case 'io.write': {
        if (bad()) return;
        if (a.value == null) return this._error(id, "'value' 인자가 필요합니다");
        const s = this._pin(p);
        s.mode = 'output';
        s.out = a.value ? 1 : 0;
        s.phys = s.out;
        return after();
      }
      case 'io.toggle': {
        if (bad()) return;
        const s = this._pin(p);
        s.mode = 'output';
        s.out = s.out ? 0 : 1;
        s.phys = s.out;
        return after();
      }
      case 'io.pulse': {
        if (bad()) return;
        const s = this._pin(p);
        const ms = a.ms ?? 100;
        if (!(ms > 0 && ms <= 600000)) return this._error(id, '펄스 길이는 1~600000ms 입니다');
        s.pulseRestore = s.out;
        s.mode = 'output';
        s.out = a.value ?? 1 ? 1 : 0;
        s.phys = s.out;
        s.pulseKind = 'out';
        s.pulseAt = Date.now() + ms;
        return after();
      }
      case 'io.pwm': {
        if (bad()) return;
        const s = this._pin(p);
        s.mode = 'pwm';
        if (a.freq) s.freq = a.freq;
        if (a.res) s.res = a.res;
        const max = (1 << s.res) - 1;
        if (a.duty != null) s.duty = Math.max(0, Math.min(max, a.duty));
        return after();
      }
      case 'io.read':
        if (bad()) return;
        return this._reply(id, this._state(p));
      case 'io.adc': {
        if (bad()) return;
        if (!isAdc(p)) return this._error(id, 'ADC 입력이 아닌 핀입니다');
        const raw = this._readAdc(p);
        return this._reply(id, { pin: p, raw, mv: Math.round((raw * 3300) / 4095), forced: this._pin(p).forced });
      }
      case 'io.snapshot': {
        let list;
        if (Array.isArray(a.pins)) {
          list = a.pins.filter((n) => ALL_PINS.includes(n));
        } else {
          list = ALL_PINS.filter((n) => {
            if (isBlocked(n)) return false;
            if (a.all) return true;
            const s = this.pins.get(n);
            return s && (s.mode !== 'disabled' || s.forced || s.watch);
          });
        }
        return this._reply(id, { pins: list.map((n) => this._state(n)) });
      }
      case 'io.watch': {
        const on = a.on ?? true;
        if (a.interval) this.watchMs = Math.max(10, a.interval);
        const targets = Array.isArray(a.pins) ? a.pins : (a.pin != null ? [a.pin] : null);
        if (!targets) return this._error(id, "'pin' 또는 'pins' 인자가 필요합니다");
        targets.forEach((n) => {
          if (!ALL_PINS.includes(n) || isBlocked(n)) return;
          const s = this._pin(n);
          s.watch = on;
          if (on) s.last = null;
        });
        return this._reply(id, { on, interval: this.watchMs });
      }
      case 'io.reset':
        this.pins.clear();
        this._emit('io.reset', {});
        return this._reply(id, { reset: true });

      case 'force.set': {
        if (bad()) return;
        if (a.value == null) return this._error(id, "'value' 인자가 필요합니다");
        const s = this._pin(p);
        s.forced = true;
        s.forcedValue = a.value;
        return after();
      }
      case 'force.clear': {
        if (bad()) return;
        this._pin(p).forced = false;
        return after();
      }
      case 'force.clearAll':
        this.pins.forEach((s) => { s.forced = false; });
        this._emit('force.clearAll', {});
        return this._reply(id, { cleared: true });
      case 'force.pulse': {
        if (bad()) return;
        const s = this._pin(p);
        const ms = a.ms ?? 100;
        if (!(ms > 0 && ms <= 600000)) return this._error(id, '펄스 길이는 1~600000ms 입니다');
        s.pulseRestoreForced = s.forced;
        s.pulseRestore = s.forcedValue;
        s.forced = true;
        s.forcedValue = a.value ?? 1;
        s.pulseKind = 'force';
        s.pulseAt = Date.now() + ms;
        return after();
      }
      case 'force.list':
        return this._reply(id, {
          pins: [...this.pins.values()].filter((s) => s.forced).map((s) => this._state(s.pin)),
        });

      case 'app.status':
        return this._reply(id, this._appStatus());
      case 'app.reset': {
        const A = this.app;
        A.relay = false; A.alarm = false; A.presses = 0;
        A._stable = -1; A._lastRaw = -1; A._edgeAt = 0;
        [A.relayPin, A.alarmPin].forEach((n) => {
          if (n < 0) return;
          const s2 = this._pin(n);
          s2.mode = 'output'; s2.out = 0; s2.phys = 0;
          this._emit('pin.state', this._state(n));
        });
        this._emit('app.status', this._appStatus());
        return this._reply(id, this._appStatus());
      }
      case 'app.config': {
        const keys = ['enabled', 'buttonPin', 'relayPin', 'ledPin', 'sensorPin',
                      'alarmPin', 'activeLow', 'debounceMs', 'threshold'];
        keys.forEach((k) => { if (a[k] !== undefined) this.app[k] = a[k]; });
        const A = this.app;
        if (A.enabled) {
          if (A.buttonPin >= 0) {
            const b = this._pin(A.buttonPin);
            b.mode = A.activeLow ? 'input_pullup' : 'input_pulldown';
            this._applyIdleLevel(b);
          }
          if (A.relayPin >= 0) this._pin(A.relayPin).mode = 'output';
          if (A.ledPin >= 0) this._pin(A.ledPin).mode = 'output';
          if (A.alarmPin >= 0) this._pin(A.alarmPin).mode = 'output';
          if (A.sensorPin >= 0) {
            if (!isAdc(A.sensorPin)) return this._error(id, '센서 핀은 ADC 가능 핀이어야 합니다');
            this._pin(A.sensorPin).mode = 'adc';
          }
          A._stable = -1; A._lastRaw = -1;
        }
        return this._reply(id, this._appStatus());
      }

      case 'wifi.status':
        return this._reply(id, {
          mode: 'sim', connected: true, ip: '192.168.0.42', ssid: 'SIMULATED',
          rssi: -48, host: 'esps3-test-sim.local', ws: 'ws://192.168.0.42:81/', clients: 1,
        });
      case 'wifi.connect':
        return this._reply(id, { connecting: true, ssid: a.ssid, note: '시뮬레이터에서는 실제 접속이 일어나지 않습니다' });
      case 'wifi.scan':
        return this._reply(id, {
          networks: [
            { ssid: 'HOME-WIFI', rssi: -42, open: false },
            { ssid: 'OFFICE-5G', rssi: -61, open: false },
            { ssid: 'GUEST', rssi: -74, open: true },
          ],
        });
      case 'wifi.ap':
        return this._reply(id, { mode: 'ap', connected: false, ip: '192.168.4.1', ssid: 'ESPS3-TEST-SIM' });
      case 'wifi.forget':
        return this._reply(id, { forgotten: true });
      case 'ble.status':
        return this._reply(id, { name: 'ESPS3-TEST-SIM', connected: false, service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e' });

      default:
        return this._error(id, `알 수 없는 명령: ${cmd}`);
    }
  }

  _appStatus() {
    const A = this.app;
    return {
      enabled: A.enabled, buttonPin: A.buttonPin, relayPin: A.relayPin, ledPin: A.ledPin,
      sensorPin: A.sensorPin, alarmPin: A.alarmPin, activeLow: A.activeLow,
      debounceMs: A.debounceMs, threshold: A.threshold,
      relay: A.relay, alarm: A.alarm, presses: A.presses,
    };
  }

  // --- 주기 처리 (펄스 만료 / 감시 폴링 / 앱 로직) ----------------------------
  _tick() {
    const now = Date.now();

    for (const s of this.pins.values()) {
      if (!s.pulseKind || now < s.pulseAt) continue;
      if (s.pulseKind === 'force') {
        s.forced = s.pulseRestoreForced;
        s.forcedValue = s.pulseRestore;
      } else {
        s.out = s.pulseRestore;
        s.phys = s.out;
      }
      s.pulseKind = null;
      this._emit('pin.state', this._state(s.pin));
    }

    this._appLoop(now);

    for (const s of this.pins.values()) {
      if (!s.watch) continue;
      const v = this._value(s.pin);
      if (v === s.last) continue;
      if (s.mode === 'adc' && s.last != null && Math.abs(v - s.last) < 32) continue;
      s.last = v;
      this._emit('pin.change', { pin: s.pin, value: v, forced: s.forced, mode: s.mode });
    }
  }

  /** 펌웨어 app_logic.cpp 와 같은 동작 - 강제 입력이 실제로 반영되는지 확인용 */
  _appLoop(now) {
    const A = this.app;
    if (!A.enabled) return;

    if (A.buttonPin >= 0) {
      const raw = this._read(A.buttonPin);
      if (raw !== A._lastRaw) {
        A._lastRaw = raw;
        A._edgeAt = now;
      } else if (now - A._edgeAt >= A.debounceMs && raw !== A._stable) {
        const prev = A._stable;
        A._stable = raw;
        const pressed = A.activeLow ? raw === 0 : raw === 1;
        if (prev !== -1 && pressed) {
          A.presses++;
          A.relay = !A.relay;
          if (A.relayPin >= 0) {
            const r = this._pin(A.relayPin);
            r.mode = 'output';
            r.out = A.relay ? 1 : 0;
            r.phys = r.out;
            this._emit('pin.state', this._state(A.relayPin));
          }
          this._emit('app.status', this._appStatus());
        }
      }
    }

    if (A.ledPin >= 0) {
      const led = this._pin(A.ledPin);
      led.mode = 'output';
      if (A.relay) {
        led.out = 1;
      } else if (now - A._blinkAt >= 1000) {
        A._blinkAt = now;
        A._blinkOn = !A._blinkOn;
        led.out = A._blinkOn ? 1 : 0;
      }
      led.phys = led.out;
    }

    if (A.sensorPin >= 0) {
      const v = this._readAdc(A.sensorPin);
      const alarm = v >= A.threshold;
      if (alarm !== A.alarm) {
        A.alarm = alarm;
        if (A.alarmPin >= 0) {
          const al = this._pin(A.alarmPin);
          al.mode = 'output';
          al.out = alarm ? 1 : 0;
          al.phys = al.out;
          this._emit('pin.state', this._state(A.alarmPin));
        }
        this._emit('app.status', this._appStatus());
      }
    }
  }
}
