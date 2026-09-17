// ---------------------------------------------------------------------------
//  ESPS3-32 I/O 테스트 콘솔 - 화면 제어
// ---------------------------------------------------------------------------
import { Device } from './protocol.js';
import { SerialTransport } from './transports/serial.js';
import { BleTransport } from './transports/ble.js';
import { WifiTransport } from './transports/wifi.js';
import { MockTransport } from './transports/mock.js';
import { ALL_PINS, SAFE_PINS, meta, isAdc, isBlocked } from './pinmap.js';
import { parseScript, SequenceRunner, PRESETS } from './sequence.js';
import { uploadFirmware, OtaAbort, estimateSeconds, formatBytes, formatDuration } from './ota.js';
import * as flasher from './flasher.js';

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const nowStr = () => new Date().toLocaleTimeString('ko-KR', { hour12: false });

const TRANSPORTS = [SerialTransport, BleTransport, WifiTransport, MockTransport];
const MODES = [
  ['disabled', '사용 안 함'],
  ['input', '입력'],
  ['input_pullup', '입력(풀업)'],
  ['input_pulldown', '입력(풀다운)'],
  ['output', '출력'],
  ['pwm', 'PWM 출력'],
  ['adc', '아날로그 입력'],
];
const ADC_MAX = 4095;
const CHART_WINDOW_MS = 60000;
const CHART_MAX_POINTS = 600;
const MAX_SERIES = 4;          // 5개째부터는 색을 돌려쓰지 않고 안내로 대체한다

const dev = new Device();
const runner = new SequenceRunner(dev);

const state = {
  transport: 'mock',
  pins: new Map(),             // pin -> 장치가 보고한 상태
  rows: new Map(),             // pin -> {el, ctl, sel, watch, mode}
  filter: 'safe',
  search: '',
  pollMs: 1000,
  pollTimer: null,
  series: new Map(),           // pin -> [{t, v}]
  lastSeq: null,
  dl: {                        // 다운로드 탭 상태
    mode: 'flash',
    parts: [],                 // [{address, file, bytes, name, hint}]
    otaFile: null,
    busy: false,
    abort: false,
  },
};

// ---------------------------------------------------------------------------
//  로그
// ---------------------------------------------------------------------------
function appendLog(box, cls, text, autoScroll = true) {
  const line = el('div');
  line.appendChild(el('span', 't', nowStr() + ' '));
  line.appendChild(el('span', cls, text));
  box.appendChild(line);
  while (box.childElementCount > 500) box.removeChild(box.firstChild);
  if (autoScroll) box.scrollTop = box.scrollHeight;
}

const logRaw = (cls, text) => appendLog($('#rawLog'), cls, text, $('#logAutoScroll').checked);
const logEvent = (cls, text) => appendLog($('#eventLog'), cls, text);

function setStatus(msg, kind = '') {
  $('#statMsg').textContent = msg;
  $('#statMsg').style.color = kind === 'err' ? 'var(--bad-text)'
    : kind === 'ok' ? 'var(--good-text)' : '';
}

function banner(msg) {
  const b = $('#banner');
  if (!msg) { b.hidden = true; return; }
  b.hidden = false;
  b.textContent = msg;
}

// ---------------------------------------------------------------------------
//  연결 UI
// ---------------------------------------------------------------------------
function buildTransportSelector() {
  const box = $('#transportSel');
  box.innerHTML = '';
  TRANSPORTS.forEach((T) => {
    const b = el('button', null, T.label);
    b.dataset.t = T.id;
    b.setAttribute('aria-pressed', String(T.id === state.transport));
    if (!T.isSupported()) {
      b.disabled = true;
      b.title = T.unsupportedReason();
    }
    b.onclick = () => selectTransport(T.id);
    box.appendChild(b);
  });
}

function selectTransport(id) {
  state.transport = id;
  $$('#transportSel button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === id)));
  buildConnOptions();
}

function buildConnOptions() {
  const box = $('#connOpts');
  box.innerHTML = '';
  const add = (node) => box.appendChild(node);

  if (state.transport === 'wifi') {
    const input = el('input');
    input.id = 'wifiUrl';
    input.placeholder = '192.168.0.42  또는  esps3-test-ab12.local';
    input.value = localStorage.getItem('esps3.wifiUrl') || '';
    input.setAttribute('aria-label', '장치 주소');
    add(el('label', null, '주소'));
    add(input);
  } else if (state.transport === 'usb') {
    add(el('label', null, '속도'));
    const sel = el('select');
    sel.id = 'usbBaud';
    [115200, 921600, 230400].forEach((b) => {
      const o = el('option', null, String(b));
      o.value = b;
      sel.appendChild(o);
    });
    add(sel);
  } else if (state.transport === 'ble') {
    add(el('label', null, '기기 이름 접두어(선택)'));
    const input = el('input');
    input.id = 'bleName';
    input.placeholder = 'ESPS3-TEST';
    input.style.width = '150px';
    add(input);
  } else {
    add(el('label', null, '하드웨어 없이 UI·시나리오를 검증합니다'));
  }
}

async function toggleConnect() {
  const btn = $('#btnConnect');
  if (dev.connected) {
    await dev.disconnect();
    return;
  }

  const T = TRANSPORTS.find((t) => t.id === state.transport);
  if (!T) return;
  if (!T.isSupported()) { setStatus(T.unsupportedReason(), 'err'); return; }

  const opts = {};
  if (T.id === 'wifi') {
    opts.url = $('#wifiUrl')?.value.trim();
    if (opts.url) localStorage.setItem('esps3.wifiUrl', opts.url);
  } else if (T.id === 'usb') {
    opts.baudRate = Number($('#usbBaud')?.value) || 115200;
  } else if (T.id === 'ble') {
    const p = $('#bleName')?.value.trim();
    if (p) opts.namePrefix = p;
  }

  btn.disabled = true;
  $('#connStatus').textContent = '연결 중…';
  $('#connStatus').className = 'chip busy';
  try {
    await dev.connect(T, opts);
  } catch (err) {
    setStatus(err.message, 'err');
    logRaw('err', `연결 실패: ${err.message}`);
    $('#connStatus').textContent = '연결 실패';
    $('#connStatus').className = 'chip err';
  } finally {
    btn.disabled = false;
  }
}

function onOpen({ description }) {
  $('#btnConnect').textContent = '연결 해제';
  $('#connStatus').textContent = '연결됨';
  $('#connStatus').className = 'chip ok';
  $('#brandDot').classList.add('on');
  $('#statTransport').textContent = description;
  setStatus('연결되었습니다', 'ok');
  banner(null);
  if (dev.transportId === 'ble' && state.pollMs && state.pollMs < 2000) {
    state.pollMs = 2000;                     // BLE 는 대역폭이 좁다
    $('#pollRate').value = '2000';
  }
  startPolling();
  refreshAll();
  renderOtaInfo();
}

function onClose({ reason }) {
  $('#btnConnect').textContent = '연결';
  $('#connStatus').textContent = '미연결';
  $('#connStatus').className = 'chip';
  $('#brandDot').classList.remove('on');
  $('#statTransport').textContent = '연결 안 됨';
  stopPolling();
  setStatus(reason || '연결이 끊어졌습니다');
  logRaw('warn', reason || '연결 종료');
  renderOtaInfo();
}

// ---------------------------------------------------------------------------
//  핀 목록
// ---------------------------------------------------------------------------
function visiblePins() {
  const q = state.search.trim().toLowerCase();
  let list;
  switch (state.filter) {
    case 'safe':   list = SAFE_PINS; break;
    case 'adc':    list = ALL_PINS.filter(isAdc); break;
    case 'used':   list = ALL_PINS.filter((p) => {
      const s = state.pins.get(p);
      return s && (s.mode !== 'disabled' || s.forced || s.watch);
    }); break;
    case 'forced': list = ALL_PINS.filter((p) => state.pins.get(p)?.forced); break;
    default:       list = ALL_PINS;
  }
  if (!q) return list;
  return list.filter((p) => {
    const m = meta(p);
    return String(p) === q
      || `gpio${p}`.includes(q)
      || m.tags.join(' ').toLowerCase().includes(q)
      || (m.adc || '').toLowerCase().includes(q);
  });
}

function renderPinList() {
  const box = $('#pinList');
  box.innerHTML = '';
  state.rows.clear();
  const pins = visiblePins();
  if (!pins.length) {
    box.appendChild(el('div', 'empty', '조건에 맞는 핀이 없습니다.'));
    return;
  }
  pins.forEach((p) => box.appendChild(buildRow(p)));
  pins.forEach((p) => updateRow(p));
}

function buildRow(pin) {
  const m = meta(pin);
  const root = el('div', 'pin');
  root.dataset.pin = String(pin);

  // 1열: 핀 번호 + 성격
  const idBox = el('div', 'pin-id');
  const name = el('b', null, `GPIO${pin}`);
  if (m.level === 'caution') name.classList.add('caution');
  if (m.level === 'blocked') name.classList.add('blocked');
  idBox.appendChild(name);
  const tags = el('span', 'pin-tags', [m.adc, ...m.tags].filter(Boolean).join(' · ') || '범용');
  if (m.note) tags.title = m.note;
  idBox.appendChild(tags);
  root.appendChild(idBox);

  // 2열: 모드
  const mid = el('div', 'pin-mid');
  const sel = el('select', 'mode');
  sel.setAttribute('aria-label', `GPIO${pin} 모드`);
  MODES.forEach(([v, label]) => {
    if (v === 'adc' && !isAdc(pin)) return;
    const o = el('option', null, label);
    o.value = v;
    sel.appendChild(o);
  });
  sel.onchange = () => setMode(pin, sel.value);
  mid.appendChild(sel);
  root.appendChild(mid);

  // 3열: 상태 + 조작
  const ctl = el('div', 'pin-ctl');
  root.appendChild(ctl);

  // 4열: 감시
  const right = el('div', 'pin-right');
  const wl = el('label');
  const wc = el('input');
  wc.type = 'checkbox';
  wc.onchange = () => setWatch(pin, wc.checked);
  wl.appendChild(wc);
  wl.appendChild(document.createTextNode('감시'));
  right.appendChild(wl);
  root.appendChild(right);

  if (m.level === 'blocked') {
    root.classList.add('blocked');
    sel.disabled = true;
    wc.disabled = true;
    ctl.appendChild(el('span', 'hint', m.note || '사용할 수 없는 핀입니다'));
  }

  state.rows.set(pin, { el: root, ctl, sel, watch: wc, mode: null });
  return root;
}

/** 모드가 바뀌었을 때만 조작 UI 를 새로 만든다 (매 폴링마다 다시 만들지 않는다) */
function buildControls(pin, mode) {
  const row = state.rows.get(pin);
  if (!row) return;
  const ctl = row.ctl;
  ctl.innerHTML = '';
  row.mode = mode;

  // 공통: 현재 값 표시
  const st = el('span', 'state unknown');
  st.appendChild(el('span', 'led'));
  st.appendChild(el('span', 'txt', '-'));
  ctl.appendChild(st);
  row.state = st;

  const mkBtn = (label, fn, cls = 'sm') => {
    const b = el('button', cls, label);
    b.onclick = fn;
    ctl.appendChild(b);
    return b;
  };

  if (mode === 'output') {
    row.btnLow  = mkBtn('LOW',  () => send('io.write', { pin, value: 0 }));
    row.btnHigh = mkBtn('HIGH', () => send('io.write', { pin, value: 1 }));
    mkBtn('토글', () => send('io.toggle', { pin }));
    const ms = el('input');
    ms.type = 'number'; ms.value = 200; ms.min = 1; ms.max = 600000; ms.style.width = '70px';
    ms.setAttribute('aria-label', `GPIO${pin} 펄스 길이(ms)`);
    ctl.appendChild(ms);
    mkBtn('펄스', () => send('io.pulse', { pin, value: 1, ms: Number(ms.value) || 100 }));

  } else if (mode === 'pwm') {
    const range = el('input');
    range.type = 'range'; range.min = 0; range.max = 1023; range.value = 0; range.style.width = '130px';
    range.setAttribute('aria-label', `GPIO${pin} PWM duty`);
    const dutyTxt = el('span', 'hint', '0');
    let t = 0;
    range.oninput = () => {
      dutyTxt.textContent = range.value;
      clearTimeout(t);
      t = setTimeout(() => send('io.pwm', { pin, duty: Number(range.value) }), 60);
    };
    ctl.appendChild(range);
    ctl.appendChild(dutyTxt);
    const freq = el('input');
    freq.type = 'number'; freq.value = 5000; freq.min = 1; freq.style.width = '82px';
    freq.setAttribute('aria-label', `GPIO${pin} PWM 주파수(Hz)`);
    freq.onchange = () => send('io.pwm', { pin, duty: Number(range.value), freq: Number(freq.value) });
    ctl.appendChild(el('span', 'hint', 'Hz'));
    ctl.appendChild(freq);
    row.range = range;
    row.dutyTxt = dutyTxt;

  } else if (mode === 'adc') {
    const meter = el('div', 'meter');
    const fill = el('i');
    meter.appendChild(fill);
    ctl.appendChild(meter);
    row.meterFill = fill;

    ctl.appendChild(el('span', 'hint', '강제'));
    const range = el('input');
    range.type = 'range'; range.min = 0; range.max = ADC_MAX; range.value = 0; range.style.width = '110px';
    range.setAttribute('aria-label', `GPIO${pin} 강제 입력값`);
    const numIn = el('input');
    numIn.type = 'number'; numIn.min = 0; numIn.max = ADC_MAX; numIn.value = 0; numIn.style.width = '72px';
    numIn.setAttribute('aria-label', `GPIO${pin} 강제 입력값(raw)`);
    let t = 0;
    const apply = (v) => {
      range.value = numIn.value = v;
      clearTimeout(t);
      t = setTimeout(() => send('force.set', { pin, value: Number(v) }), 60);
    };
    range.oninput = () => apply(range.value);
    numIn.onchange = () => apply(clamp(Number(numIn.value) || 0, 0, ADC_MAX));
    ctl.appendChild(range);
    ctl.appendChild(numIn);
    mkBtn('해제', () => send('force.clear', { pin }));
    row.forceRange = range;
    row.forceNum = numIn;

  } else if (mode && mode.startsWith('input')) {
    ctl.appendChild(el('span', 'hint', '강제 입력'));
    row.btnF0 = mkBtn('0', () => send('force.set', { pin, value: 0 }));
    row.btnF1 = mkBtn('1', () => send('force.set', { pin, value: 1 }));
    mkBtn('해제', () => send('force.clear', { pin }));
    const ms = el('input');
    ms.type = 'number'; ms.value = 120; ms.min = 1; ms.max = 600000; ms.style.width = '70px';
    ms.setAttribute('aria-label', `GPIO${pin} 강제 펄스 길이(ms)`);
    ctl.appendChild(ms);
    mkBtn('펄스', () => {
      const cur = state.pins.get(pin)?.value ?? 1;
      send('force.pulse', { pin, value: cur ? 0 : 1, ms: Number(ms.value) || 100 });
    });

  } else {
    ctl.appendChild(el('span', 'hint', '모드를 선택하면 조작할 수 있습니다'));
  }

  const badge = el('span', 'badge forced', '강제 중');
  badge.hidden = true;
  ctl.appendChild(badge);
  row.badge = badge;
}

function updateRow(pin) {
  const row = state.rows.get(pin);
  if (!row) return;
  const s = state.pins.get(pin);
  const mode = s?.mode || 'disabled';

  if (row.sel.value !== mode) row.sel.value = mode;
  if (row.mode !== mode) buildControls(pin, mode);

  row.el.classList.toggle('active', mode !== 'disabled');
  row.el.classList.toggle('forced', !!s?.forced);
  if (row.badge) row.badge.hidden = !s?.forced;
  if (row.watch) row.watch.checked = !!s?.watch;

  if (!s || !row.state) return;

  // 상태 표시 - 색만이 아니라 항상 글자로도 값을 알린다
  if (mode === 'adc') {
    const v = clamp(Number(s.value) || 0, 0, ADC_MAX);
    row.state.className = 'state';
    row.state.querySelector('.led').style.background = 'var(--series-1)';
    row.state.querySelector('.txt').textContent = `${v} (${Math.round((v * 3300) / ADC_MAX)}mV)`;
    if (row.meterFill) row.meterFill.style.width = `${(v / ADC_MAX) * 100}%`;
    if (s.forced && row.forceRange && document.activeElement !== row.forceRange
        && document.activeElement !== row.forceNum) {
      row.forceRange.value = s.forcedValue ?? v;
      row.forceNum.value = s.forcedValue ?? v;
    }
  } else if (mode === 'pwm') {
    row.state.className = 'state';
    row.state.querySelector('.txt').textContent = `duty ${s.duty ?? 0}/${(1 << (s.res || 10)) - 1}`;
    if (row.range && document.activeElement !== row.range) {
      row.range.max = (1 << (s.res || 10)) - 1;
      row.range.value = s.duty ?? 0;
      row.dutyTxt.textContent = String(s.duty ?? 0);
    }
  } else {
    const v = s.value;
    const high = v === 1;
    row.state.className = `state ${v === 0 || v === 1 ? (high ? 'high' : 'low') : 'unknown'}`;
    row.state.querySelector('.txt').textContent = v === 1 ? 'HIGH (1)' : v === 0 ? 'LOW (0)' : '- ';
    if (row.btnF0) row.btnF0.setAttribute('aria-pressed', String(!!s.forced && s.forcedValue === 0));
    if (row.btnF1) row.btnF1.setAttribute('aria-pressed', String(!!s.forced && s.forcedValue === 1));
    if (row.btnHigh) row.btnHigh.setAttribute('aria-pressed', String(high));
    if (row.btnLow) row.btnLow.setAttribute('aria-pressed', String(v === 0));
  }
}

function applyPinState(s) {
  if (!s || s.pin == null) return;
  const prev = state.pins.get(s.pin) || {};
  state.pins.set(s.pin, { ...prev, ...s });
  updateRow(s.pin);
  if (s.mode === 'adc' && s.watch) pushSample(s.pin, s.value);
  updateForcedCount();
}

function updateForcedCount() {
  const n = [...state.pins.values()].filter((s) => s.forced).length;
  const chip = $('#forcedCount');
  chip.textContent = `강제 ${n}`;
  chip.className = n ? 'chip busy' : 'chip';
}

async function setMode(pin, mode) {
  const r = await dev.try('io.config', { pin, mode });
  if (!r.ok) { setStatus(r.error, 'err'); logRaw('err', r.error); await refreshPin(pin); return; }
  applyPinState(r.result);
}

async function setWatch(pin, on) {
  const r = await dev.try('io.watch', { pin, on });
  if (!r.ok) { setStatus(r.error, 'err'); return; }
  const s = state.pins.get(pin) || { pin };
  s.watch = on;
  state.pins.set(pin, s);
  if (!on) state.series.delete(pin);
  updateRow(pin);
  renderWatchTable();
  drawChart();
}

async function send(cmd, args) {
  const r = await dev.try(cmd, args);
  if (!r.ok) { setStatus(r.error, 'err'); logRaw('err', `${cmd}: ${r.error}`); return null; }
  if (r.result && r.result.pin != null) applyPinState(r.result);
  return r.result;
}

async function refreshPin(pin) {
  const r = await dev.try('io.read', { pin });
  if (r.ok) applyPinState(r.result);
}

async function refreshAll() {
  if (!dev.connected) return;
  // BLE 는 20바이트씩 쪼개 보내므로 전체 핀 스냅샷이 느리다.
  // 그 경우에는 설정·강제·감시 중인 핀만 받는다(나머지는 어차피 'disabled').
  const args = dev.transportId === 'ble' ? {} : { all: true };
  const r = await dev.try('io.snapshot', args);
  if (!r.ok) return;
  r.result.pins.forEach((s) => {
    const prev = state.pins.get(s.pin) || {};
    state.pins.set(s.pin, { ...prev, ...s });
    if (s.mode === 'adc' && s.watch) pushSample(s.pin, s.value);
  });
  [...state.rows.keys()].forEach(updateRow);
  updateForcedCount();
  renderWatchTable();
  drawChart();
}

function startPolling() {
  stopPolling();
  if (!state.pollMs) return;
  state.pollTimer = setInterval(async () => {
    if (!dev.connected || runner.running) return;
    const r = await dev.try('io.snapshot', {});     // 설정된 핀만 - 대역폭 절약
    if (!r.ok) return;
    r.result.pins.forEach((s) => {
      const prev = state.pins.get(s.pin) || {};
      state.pins.set(s.pin, { ...prev, ...s });
      updateRow(s.pin);
      if (s.mode === 'adc' && s.watch) pushSample(s.pin, s.value);
    });
    updateForcedCount();
    renderWatchTable();
    drawChart();
  }, state.pollMs);
}

function stopPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = null;
}

// ---------------------------------------------------------------------------
//  모니터 - 아날로그 실시간 그래프
//  · 축은 하나(ADC raw 0~4095). mV 는 툴팁에서 환산해 보여 준다.
//  · 계열 색은 고정 순서로만 배정하고, 5개째부터는 색을 돌려쓰지 않는다.
//  · 옆의 '감시 중인 핀' 표가 같은 값을 숫자로 제공한다(색만으로 읽지 않도록).
// ---------------------------------------------------------------------------
function pushSample(pin, v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return;
  let arr = state.series.get(pin);
  if (!arr) { arr = []; state.series.set(pin, arr); }
  const t = Date.now();
  if (arr.length && t - arr[arr.length - 1].t < 40) return;
  arr.push({ t, v });
  const cutoff = t - CHART_WINDOW_MS;
  while (arr.length > CHART_MAX_POINTS || (arr.length && arr[0].t < cutoff)) arr.shift();
}

function chartSeries() {
  return [...state.series.entries()]
    .filter(([pin, arr]) => arr.length && state.pins.get(pin)?.watch && state.pins.get(pin)?.mode === 'adc')
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_SERIES)
    .map(([pin, data], i) => ({
      pin, data,
      color: getComputedStyle(document.documentElement).getPropertyValue(`--series-${i + 1}`).trim(),
    }));
}

const chartState = { hoverX: null, series: [], geom: null };

function drawChart() {
  const canvas = $('#adcChart');
  if (!canvas) return;
  const series = chartSeries();
  chartState.series = series;

  const hidden = series.length === 0;
  $('#chartEmpty').style.display = hidden ? '' : 'none';
  canvas.parentElement.style.display = hidden ? 'none' : '';
  renderLegend(series);
  if (hidden) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 360;
  const cssH = 170;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cssW, cssH);

  const css = getComputedStyle(document.documentElement);
  const ink3 = css.getPropertyValue('--ink-3').trim();
  const line = css.getPropertyValue('--line').trim();

  const padL = 40, padR = 46, padT = 10, padB = 20;
  const W = cssW - padL - padR;
  const H = cssH - padT - padB;
  const now = Date.now();
  const t0 = now - CHART_WINDOW_MS;
  const x = (t) => padL + ((t - t0) / CHART_WINDOW_MS) * W;
  const y = (v) => padT + H - (clamp(v, 0, ADC_MAX) / ADC_MAX) * H;
  chartState.geom = { padL, padR, padT, padB, W, H, t0, now, x, y };

  // 그리드와 축은 뒤로 물러나 있어야 한다
  g.font = '10px ui-monospace, monospace';
  g.textBaseline = 'middle';
  g.strokeStyle = line;
  g.fillStyle = ink3;
  g.lineWidth = 1;
  [0, 1024, 2048, 3072, 4095].forEach((v) => {
    const yy = Math.round(y(v)) + 0.5;
    g.beginPath();
    g.moveTo(padL, yy);
    g.lineTo(padL + W, yy);
    g.stroke();
    g.textAlign = 'right';
    g.fillText(String(v), padL - 6, yy);
  });
  g.textAlign = 'center';
  ['-60초', '-30초', '지금'].forEach((label, i) => {
    g.fillText(label, padL + (W * i) / 2, padT + H + 10);
  });

  // 데이터: 2px 선, 마커 없음(스트리밍)
  g.lineWidth = 2;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const endPoints = [];
  series.forEach((s) => {
    g.strokeStyle = s.color;
    g.beginPath();
    let started = false;
    s.data.forEach((pt) => {
      if (pt.t < t0) return;
      const px = x(pt.t), py = y(pt.v);
      if (!started) { g.moveTo(px, py); started = true; } else { g.lineTo(px, py); }
    });
    g.stroke();

    const last = s.data[s.data.length - 1];
    if (last) {
      endPoints.push({
        pin: s.pin, color: s.color,
        x: x(last.t),
        y: clamp(y(last.v), padT + 4, padT + H - 4),
      });
    }
  });

  // 데이터 끝 마커 + 직접 레이블.
  // 값이 비슷한 계열끼리 레이블이 포개지면 읽을 수 없으므로, 마커는 제 위치에
  // 두고 글자만 세로로 밀어 최소 간격을 확보한다.
  const LABEL_GAP = 13;
  endPoints.sort((a, b) => a.y - b.y);
  endPoints.forEach((p, i) => {
    p.labelY = i === 0 ? p.y : Math.max(p.y, endPoints[i - 1].labelY + LABEL_GAP);
  });
  // 아래로 밀다가 그래프를 벗어나면 위로 되돌린다
  for (let i = endPoints.length - 1; i >= 0; i--) {
    const p = endPoints[i];
    const limit = i === endPoints.length - 1
      ? padT + H - 2
      : endPoints[i + 1].labelY - LABEL_GAP;
    p.labelY = Math.min(p.labelY, limit);
    p.labelY = Math.max(p.labelY, padT + 6);
  }

  const surface = css.getPropertyValue('--surface-2').trim();
  const inkLabel = css.getPropertyValue('--ink-2').trim();
  endPoints.forEach((p) => {
    g.fillStyle = p.color;
    g.beginPath();
    g.arc(p.x, p.y, 4, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 2;                       // 겹칠 때를 위한 서피스 링
    g.strokeStyle = surface;
    g.stroke();

    // 레이블을 밀었으면 마커와 글자를 가는 선으로 이어 준다
    const lx = Math.min(p.x + 8, padL + W + 4);
    if (Math.abs(p.labelY - p.y) > 2) {
      g.strokeStyle = p.color;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(p.x + 4, p.y);
      g.lineTo(lx - 2, p.labelY);
      g.stroke();
    }
    g.fillStyle = inkLabel;
    g.textAlign = 'left';
    g.fillText(`GPIO${p.pin}`, lx, p.labelY);
  });
  g.lineWidth = 2;

  // 호버 크로스헤어
  if (chartState.hoverX != null) {
    const hx = clamp(chartState.hoverX, padL, padL + W);
    g.strokeStyle = ink3;
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(hx + 0.5, padT);
    g.lineTo(hx + 0.5, padT + H);
    g.stroke();
    g.setLineDash([]);
  }
}

function renderLegend(series) {
  const box = $('#chartLegend');
  box.innerHTML = '';
  // 계열이 하나면 제목이 곧 이름이므로 범례를 두지 않는다
  if (series.length < 2) return;
  series.forEach((s) => {
    const sp = el('span');
    const i = el('i');
    i.style.background = s.color;
    sp.appendChild(i);
    sp.appendChild(document.createTextNode(`GPIO${s.pin}`));
    box.appendChild(sp);
  });
  const watchedAdc = [...state.pins.values()].filter((s) => s.watch && s.mode === 'adc').length;
  if (watchedAdc > MAX_SERIES) {
    box.appendChild(el('span', null, `(그래프는 ${MAX_SERIES}개까지 표시 — 나머지는 아래 표에서 확인)`));
  }
}

function setupChartHover() {
  const canvas = $('#adcChart');
  const tip = $('#chartTip');

  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    chartState.hoverX = ev.clientX - rect.left;
    const geom = chartState.geom;
    if (!geom || !chartState.series.length) return;

    const t = geom.t0 + ((clamp(chartState.hoverX, geom.padL, geom.padL + geom.W) - geom.padL) / geom.W) * CHART_WINDOW_MS;
    const lines = [];
    let shownAt = null;
    chartState.series.forEach((s) => {
      let best = null, bestD = Infinity;
      s.data.forEach((pt) => {
        const d = Math.abs(pt.t - t);
        if (d < bestD) { bestD = d; best = pt; }
      });
      if (!best || bestD > 4000) return;
      shownAt = shownAt == null ? best.t : Math.max(shownAt, best.t);
      lines.push(`GPIO${s.pin}  ${best.v}  (${Math.round((best.v * 3300) / ADC_MAX)}mV)`);
    });
    // 해당 시각에 표본이 없으면 값을 지어내지 않고 그렇다고 알린다
    tip.textContent = lines.length
      ? [new Date(shownAt).toLocaleTimeString('ko-KR', { hour12: false }), ...lines].join('\n')
      : `${new Date(t).toLocaleTimeString('ko-KR', { hour12: false })}\n(이 시각에는 기록된 값이 없습니다)`;
    tip.style.display = 'block';
    const wrapRect = canvas.parentElement.getBoundingClientRect();
    tip.style.left = `${clamp(ev.clientX - wrapRect.left + 12, 4, wrapRect.width - tip.offsetWidth - 4)}px`;
    tip.style.top = `${clamp(ev.clientY - wrapRect.top + 12, 4, wrapRect.height - tip.offsetHeight - 4)}px`;
    drawChart();
  });

  canvas.addEventListener('mouseleave', () => {
    chartState.hoverX = null;
    tip.style.display = 'none';
    drawChart();
  });

  window.addEventListener('resize', () => drawChart());
}

function renderWatchTable() {
  const tb = $('#watchTable');
  const rows = [...state.pins.values()].filter((s) => s.watch);
  tb.innerHTML = '';
  if (!rows.length) {
    const tr = el('tr');
    const td = el('td', 'empty', '감시 중인 핀이 없습니다. 왼쪽 목록에서 "감시"를 켜세요.');
    td.colSpan = 2;
    tr.appendChild(td);
    tb.appendChild(tr);
    return;
  }
  rows.sort((a, b) => a.pin - b.pin).forEach((s) => {
    const tr = el('tr');
    tr.appendChild(el('th', null, `GPIO${s.pin}`));
    const v = s.mode === 'adc'
      ? `${s.value} (${Math.round((clamp(s.value, 0, ADC_MAX) * 3300) / ADC_MAX)}mV)`
      : s.value === 1 ? 'HIGH (1)' : s.value === 0 ? 'LOW (0)' : String(s.value);
    tr.appendChild(el('td', null, `${v}${s.forced ? '  [강제]' : ''}`));
    tb.appendChild(tr);
  });
}

// ---------------------------------------------------------------------------
//  콘솔 탭
// ---------------------------------------------------------------------------
const CMD_PRESETS = [
  ['{"cmd":"sys.info"}', '장치 정보'],
  ['{"cmd":"io.snapshot","args":{"all":true}}', '전체 핀 상태'],
  ['io.config 48 output', 'GPIO48 출력 모드'],
  ['io.write 48 1', 'GPIO48 HIGH'],
  ['io.pulse 48 1 300', 'GPIO48 300ms 펄스'],
  ['io.pwm 48 512 5000', 'GPIO48 PWM duty 512'],
  ['io.config 4 input_pullup', 'GPIO4 풀업 입력'],
  ['force.set 4 0', 'GPIO4 강제 입력 0'],
  ['force.clear 4', 'GPIO4 강제 해제'],
  ['{"cmd":"force.list"}', '강제 중인 핀 목록'],
  ['io.adc 6', 'GPIO6 아날로그 읽기'],
  ['{"cmd":"app.status"}', '앱 로직 상태'],
  ['{"cmd":"wifi.status"}', 'WiFi 상태'],
  ['{"cmd":"sys.reset"}', '장치 재부팅'],
];

/** 'io.write 2 1' 같은 축약 입력을 JSON 으로 바꾼다 */
const POSITIONAL = {
  'io.config': ['pin', 'mode'],
  'io.write': ['pin', 'value'],
  'io.toggle': ['pin'],
  'io.read': ['pin'],
  'io.adc': ['pin'],
  'io.pulse': ['pin', 'value', 'ms'],
  'io.pwm': ['pin', 'duty', 'freq', 'res'],
  'io.watch': ['pin', 'on'],
  'force.set': ['pin', 'value'],
  'force.clear': ['pin'],
  'force.pulse': ['pin', 'value', 'ms'],
};

export function toJsonCommand(input) {
  const s = input.trim();
  if (!s) throw new Error('명령이 비어 있습니다');
  if (s.startsWith('{')) {
    JSON.parse(s);            // 형식 확인만 하고 원문 그대로 보낸다
    return s;
  }

  const tok = s.split(/\s+/);
  const cmd = tok[0];
  const args = {};
  const names = POSITIONAL[cmd] || [];
  let pos = 0;

  for (let i = 1; i < tok.length; i++) {
    const t = tok[i];
    const kv = t.match(/^([A-Za-z_][\w.]*)=(.*)$/);
    if (kv) {
      args[kv[1]] = coerce(kv[2]);
    } else {
      const name = names[pos++];
      if (!name) throw new Error(`'${cmd}' 에 위치 인자를 더 쓸 수 없습니다. key=value 로 지정하세요.`);
      args[name] = coerce(t);
    }
  }
  const msg = { cmd };
  if (Object.keys(args).length) msg.args = args;
  return JSON.stringify(msg);
}

function coerce(v) {
  if (v === 'true' || v === 'on') return true;
  if (v === 'false' || v === 'off') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

async function sendConsole() {
  const input = $('#cmdInput');
  let json;
  try {
    json = toJsonCommand(input.value);
  } catch (err) {
    logRaw('err', `입력 오류: ${err.message}`);
    return;
  }
  try {
    await dev.sendRaw(json);
    input.value = '';
  } catch (err) {
    logRaw('err', err.message);
  }
}

// ---------------------------------------------------------------------------
//  시나리오 탭
// ---------------------------------------------------------------------------
function renderSeqResult(r) {
  const box = $('#seqResults');
  const div = el('div', `r ${r.status}`);
  const tagText = { pass: 'PASS', fail: 'FAIL', error: 'ERR', abort: 'STOP', ok: '·' }[r.status] || r.status;
  div.appendChild(el('span', 'tag', tagText));
  div.appendChild(el('span', 'ln', r.step.lineNo ? `${r.step.lineNo}:` : ''));
  div.appendChild(el('span', 'grow', r.detail || r.step.line || r.step.op));
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function runSequence() {
  if (!dev.connected) { setStatus('먼저 장치에 연결하세요', 'err'); return; }
  const { steps, error } = parseScript($('#seqScript').value);
  const box = $('#seqResults');
  box.innerHTML = '';
  if (error) {
    $('#seqSummary').innerHTML = `<b class="fail">파싱 오류</b> — ${error}`;
    return;
  }
  if (!steps.length) { $('#seqSummary').textContent = '실행할 스텝이 없습니다.'; return; }

  $('#btnSeqRun').disabled = true;
  $('#btnSeqStop').disabled = false;
  $('#seqSummary').textContent = `실행 중… (${steps.length} 스텝)`;

  const summary = await runner.run(steps, {
    onStep: renderSeqResult,
    stopOnFail: $('#seqStopOnFail').checked,
  });
  state.lastSeq = { at: new Date().toISOString(), device: dev.info?.model || null, ...summary };

  $('#btnSeqRun').disabled = false;
  $('#btnSeqStop').disabled = true;
  const verdict = summary.failed || summary.errored ? 'fail' : 'pass';
  $('#seqSummary').innerHTML =
    `<b class="${verdict}">${verdict === 'pass' ? '통과' : '실패'}</b> — ` +
    `검증 ${summary.passed} 통과 / ${summary.failed} 실패 / ${summary.errored} 오류, ` +
    `${summary.executed}/${summary.total} 스텝, ${summary.ms}ms${summary.aborted ? ' (중단됨)' : ''}`;
  await refreshAll();
}

function saveSeqResult() {
  if (!state.lastSeq) { setStatus('저장할 실행 결과가 없습니다', 'err'); return; }
  const payload = {
    ...state.lastSeq,
    results: state.lastSeq.results.map((r) => ({
      line: r.step.lineNo, op: r.step.op, source: r.step.line,
      status: r.status, detail: r.detail, actual: r.actual, ms: r.ms,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `esps3-test-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------------------
//  앱 로직 탭
// ---------------------------------------------------------------------------
function appFormValues() {
  return {
    enabled: $('#appEnabled').checked,
    buttonPin: Number($('#appButtonPin').value),
    relayPin: Number($('#appRelayPin').value),
    ledPin: Number($('#appLedPin').value),
    sensorPin: Number($('#appSensorPin').value),
    alarmPin: Number($('#appAlarmPin').value),
    activeLow: $('#appActiveLow').value === '1',
    debounceMs: Number($('#appDebounce').value),
    threshold: Number($('#appThreshold').value),
  };
}

function renderAppStatus(s) {
  const tb = $('#appStatus');
  tb.innerHTML = '';
  if (!s) return;
  const rows = [
    ['실행 중', s.enabled ? '예' : '아니오'],
    ['릴레이', s.relay ? 'ON (1)' : 'OFF (0)'],
    ['경보', s.alarm ? '경보 (1)' : '정상 (0)'],
    ['버튼 눌린 횟수', String(s.presses ?? 0)],
    ['핀 구성', `버튼 ${s.buttonPin} / 릴레이 ${s.relayPin} / LED ${s.ledPin} / 센서 ${s.sensorPin} / 경보 ${s.alarmPin}`],
  ];
  rows.forEach(([k, v]) => {
    const tr = el('tr');
    tr.appendChild(el('th', null, k));
    tr.appendChild(el('td', null, v));
    tb.appendChild(tr);
  });
}

function fillAppForm(s) {
  if (!s) return;
  $('#appEnabled').checked = !!s.enabled;
  if (s.buttonPin != null) $('#appButtonPin').value = s.buttonPin;
  if (s.relayPin != null) $('#appRelayPin').value = s.relayPin;
  if (s.ledPin != null) $('#appLedPin').value = s.ledPin;
  if (s.sensorPin != null) $('#appSensorPin').value = s.sensorPin;
  if (s.alarmPin != null) $('#appAlarmPin').value = s.alarmPin;
  if (s.activeLow != null) $('#appActiveLow').value = s.activeLow ? '1' : '0';
  if (s.debounceMs != null) $('#appDebounce').value = s.debounceMs;
  if (s.threshold != null) $('#appThreshold').value = s.threshold;
}

/** 버튼을 한 번 누른 것처럼 강제 입력을 넣었다 뺀다 */
async function simulatePress() {
  const cfg = appFormValues();
  if (cfg.buttonPin < 0) { setStatus('버튼 핀이 지정되지 않았습니다', 'err'); return; }
  const rest = cfg.activeLow ? 1 : 0;
  const pressed = cfg.activeLow ? 0 : 1;
  // 먼저 '눌리지 않음' 을 확정한 뒤 눌림 펄스를 준다(펄스 후 이 값으로 되돌아간다)
  await send('force.set', { pin: cfg.buttonPin, value: rest });
  await new Promise((r) => setTimeout(r, Math.max(60, cfg.debounceMs * 2)));
  await send('force.pulse', { pin: cfg.buttonPin, value: pressed, ms: Math.max(80, cfg.debounceMs * 3) });
  setStatus(`GPIO${cfg.buttonPin} 에 버튼 누름을 주입했습니다`, 'ok');
}

// ---------------------------------------------------------------------------
//  장치 탭
// ---------------------------------------------------------------------------
function renderInfo(info) {
  const tb = $('#infoTable');
  tb.innerHTML = '';
  if (!info) return;
  const t = info.transports || {};
  const net = info.net || {};
  const rows = [
    ['모델', info.model],
    ['펌웨어 / 프로토콜', `${info.fw} / v${info.proto}`],
    ['칩', `${info.chip} · ${info.cores}코어 · ${info.cpuMhz}MHz`],
    ['플래시 / PSRAM', `${info.flashMB}MB / ${info.psramMB}MB`],
    ['여유 메모리', `heap ${Number(info.freeHeap || 0).toLocaleString()} B · psram ${Number(info.freePsram || 0).toLocaleString()} B`],
    ['가동 시간', `${Math.floor((info.uptimeMs || 0) / 1000)} 초`],
    ['MAC', info.mac],
    ['연결된 채널', Object.entries(t).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(', ') || '없음'],
    ['네트워크', `${net.mode || '-'} · ${net.ip || '-'} · ${net.ssid || '-'}`],
    ['mDNS 이름', net.host],
    ['BLE 이름', info.bleName],
  ];
  rows.forEach(([k, v]) => {
    if (v == null || v === '') return;
    const tr = el('tr');
    tr.appendChild(el('th', null, k));
    tr.appendChild(el('td', null, String(v)));
    tb.appendChild(tr);
  });
}

function renderWifi(w) {
  const tb = $('#wifiTable');
  tb.innerHTML = '';
  if (!w) return;
  const rows = [
    ['모드', w.mode],
    ['접속됨', w.connected ? '예' : '아니오'],
    ['IP', w.ip || '-'],
    ['SSID', w.ssid || '-'],
    ['신호(RSSI)', w.rssi ? `${w.rssi} dBm` : '-'],
    ['mDNS', w.host || '-'],
    ['WebSocket 주소', w.ws || '-'],
  ];
  rows.forEach(([k, v]) => {
    const tr = el('tr');
    tr.appendChild(el('th', null, k));
    tr.appendChild(el('td', null, String(v)));
    tb.appendChild(tr);
  });
  if (w.ws) {
    const tr = el('tr');
    tr.appendChild(el('th', null, ''));
    const td = el('td');
    const b = el('button', 'sm', '이 주소로 WiFi 연결하기');
    b.onclick = async () => {
      await dev.disconnect();
      selectTransport('wifi');
      $('#wifiUrl').value = w.ip;
      localStorage.setItem('esps3.wifiUrl', w.ip);
      toggleConnect();
    };
    td.appendChild(b);
    tr.appendChild(td);
    tb.appendChild(tr);
  }
}

async function wifiScan() {
  setStatus('주변 WiFi 검색 중…');
  const r = await dev.try('wifi.scan', {}, { timeout: 20000 });
  if (!r.ok) { setStatus(r.error, 'err'); return; }
  const tb = $('#wifiTable');
  tb.innerHTML = '';
  r.result.networks.forEach((n) => {
    const tr = el('tr');
    const th = el('th');
    const b = el('button', 'sm', n.ssid || '(숨김)');
    b.onclick = () => { $('#wifiSsid').value = n.ssid; };
    th.appendChild(b);
    tr.appendChild(th);
    tr.appendChild(el('td', null, `${n.rssi} dBm${n.open ? ' · 개방' : ''}`));
    tb.appendChild(tr);
  });
  setStatus(`${r.result.networks.length}개 발견`, 'ok');
}

// ---------------------------------------------------------------------------
//  다운로드 탭 - 기기에 펌웨어 내려받기
//
//  두 가지 경로를 제공한다.
//   · USB 전체 플래시: ROM 부트로더와 직접 이야기한다. 빈 칩에도 구울 수 있고
//     부트로더·파티션까지 통째로 바꾼다. 콘솔의 USB 연결과 포트를 공유하므로
//     굽기 전에 콘솔 연결을 끊어야 한다.
//   · OTA: 지금 연결된 채널(USB/BLE/WiFi) 그대로 앱 파티션만 갱신한다.
// ---------------------------------------------------------------------------
const dlLog = (msg, level) => appendLog($('#dlLog'), level || 'rx', msg);

function setDlMode(mode) {
  state.dl.mode = mode;
  $$('#dlMode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === mode)));
  $('#dlFlash').hidden = mode !== 'flash';
  $('#dlOta').hidden = mode !== 'ota';
  updateDlHint();
  if (mode === 'ota') renderOtaInfo();
}

function updateDlHint() {
  const hint = $('#dlHint');
  if (state.dl.mode === 'flash') {
    hint.innerHTML = flasher.isSupported()
      ? 'ROM 부트로더로 <b>전체</b>를 굽습니다. 빈 칩이나 펌웨어가 망가진 기기도 복구할 수 있습니다. ' +
        'USB 케이블을 <b>네이티브 USB 포트</b>에 연결하세요.'
      : '이 브라우저는 Web Serial 을 지원하지 않아 USB 플래시를 쓸 수 없습니다. ' +
        '데스크톱 Chrome/Edge 에서 http://localhost 로 열어 주세요.';
  } else {
    hint.innerHTML = '지금 연결된 채널로 <b>앱 파티션만</b> 갱신합니다. 기기가 이 펌웨어로 동작 중이어야 하며, ' +
                     '부트로더·파티션 테이블은 바뀌지 않습니다.';
  }
}

// --- 진행 표시 -------------------------------------------------------------
function showProgress(on) {
  $('#dlProgress').hidden = !on;
  if (on) {
    $('#dlProgress .progress').className = 'progress';
    setProgress(0, '');
  }
}

function setProgress(percent, detail, kind) {
  const pct = clamp(Math.round(percent), 0, 100);
  const bar0 = $('#dlBar');
  // 끝난 상태는 즉시 반영한다. 전환 애니메이션이 남아 있으면 숫자는 100% 인데
  // 막대는 따라가는 중이라 어긋나 보인다(빠른 업로드에서 특히 눈에 띈다).
  bar0.style.transition = kind ? 'none' : '';
  bar0.style.width = `${pct}%`;
  $('#dlPct').textContent = `${pct}%`;
  $('#dlDetail').textContent = detail || '';
  const bar = $('#dlProgress .progress');
  bar.className = `progress${kind ? ' ' + kind : ''}`;
  bar.setAttribute('aria-valuenow', String(pct));
}

// --- USB 전체 플래시 --------------------------------------------------------
function resetFlashParts() {
  state.dl.parts = flasher.DEFAULT_LAYOUT.map((l) => ({
    address: l.address, name: l.name, hint: l.hint, file: null, bytes: null,
  }));
  renderFlashParts();
}

function renderFlashParts() {
  const box = $('#flashParts');
  box.innerHTML = '';
  state.dl.parts.forEach((part, idx) => {
    const row = el('div', 'part-row');

    const addr = el('input');
    addr.type = 'text';
    addr.value = flasher.formatAddress(part.address);
    addr.title = '플래시 주소. 0x 를 생략해도 16진수로 읽습니다.';
    addr.setAttribute('aria-label', `${idx + 1}번 파일 주소`);
    addr.onchange = () => {
      try {
        part.address = flasher.parseAddress(addr.value);
        addr.value = flasher.formatAddress(part.address);   // 해석 결과를 되돌려 보여 준다
        addr.style.color = '';
      } catch (err) {
        addr.style.color = 'var(--bad-text)';
        dlLog(err.message, 'err');
      }
    };
    row.appendChild(addr);

    const pick = el('label', 'filepick grow');
    const input = el('input');
    input.type = 'file';
    input.accept = '.bin';
    input.hidden = true;
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      part.file = f;
      part.name = f.name;
      part.bytes = null;
      renderFlashParts();
    };
    const label = el('span', `pname${part.file ? ' set' : ''}`, part.file ? part.name : `${part.name} 선택…`);
    label.style.cursor = 'pointer';
    pick.appendChild(input);
    pick.appendChild(label);
    row.appendChild(pick);

    row.appendChild(el('span', 'psize', part.file ? formatBytes(part.file.size) : (part.hint || '')));

    const del = el('button', 'sm', '✕');
    del.title = '이 행 제거';
    del.onclick = () => {
      state.dl.parts.splice(idx, 1);
      renderFlashParts();
    };
    row.appendChild(del);

    box.appendChild(row);
  });

  if (!state.dl.parts.length) {
    box.appendChild(el('div', 'empty', '행을 추가하고 파일을 선택하세요.'));
  }
}

/** 여러 파일을 한 번에 받아 이름으로 주소를 맞춘다 (PlatformIO 산출물 기준) */
function assignPickedFiles(files) {
  let matched = 0;
  [...files].forEach((f) => {
    const known = flasher.DEFAULT_LAYOUT.find((l) => l.name.toLowerCase() === f.name.toLowerCase());
    let part = state.dl.parts.find((p) => p.name.toLowerCase() === f.name.toLowerCase());
    if (!part && known) {
      part = state.dl.parts.find((p) => p.address === known.address);
    }
    if (part) {
      part.file = f;
      part.name = f.name;
      matched++;
    } else {
      // 이름을 모르는 파일은 주소를 비운 채 행만 만들어 사용자가 정하게 한다
      state.dl.parts.push({ address: 0x10000, name: f.name, hint: '주소를 확인하세요', file: f, bytes: null });
      dlLog(`'${f.name}' 의 주소를 알 수 없어 0x10000 으로 넣었습니다. 확인해 주세요.`, 'warn');
    }
  });
  renderFlashParts();
  if (matched) dlLog(`${matched}개 파일을 이름으로 맞췄습니다`, 'ok');
}

async function startFlash() {
  const parts = state.dl.parts.filter((p) => p.file);
  if (!parts.length) { dlLog('구울 파일을 선택하세요', 'err'); return; }

  // 콘솔이 USB 로 붙어 있으면 포트를 점유하고 있어 플래시할 수 없다
  if (dev.connected && dev.transportId === 'usb') {
    if (!confirm('USB 포트를 플래셔가 써야 합니다. 콘솔 연결을 먼저 해제할까요?')) return;
    await dev.disconnect();
  }

  state.dl.busy = true;
  state.dl.abort = false;
  $('#btnFlash').disabled = true;
  $('#btnFlashStop').disabled = false;
  showProgress(true);

  const loaded = [];
  try {
    for (const p of parts) {
      loaded.push({ address: p.address, name: p.name, data: await flasher.readFileBytes(p.file) });
    }
    const totalBytes = loaded.reduce((n, p) => n + p.data.length, 0);
    dlLog(`${loaded.map((p) => `${flasher.formatAddress(p.address)} ${p.name}`).join(', ')}`);

    const startedAt = performance.now();
    let doneBytes = 0;
    let curIndex = -1;

    await flasher.flashParts(loaded, {
      baudRate: Number($('#flashBaud').value),
      eraseAll: $('#eraseAll').checked,
      shouldAbort: () => state.dl.abort,
      onLog: (msg, level) => dlLog(msg, level),
      onProgress: ({ fileIndex, written, total, name }) => {
        if (fileIndex !== curIndex) {
          if (curIndex >= 0) doneBytes += loaded[curIndex]?.data.length || 0;
          curIndex = fileIndex;
        }
        // 파일별 진행을 전체 대비로 환산한다(압축 후 크기 기준이라 근사값)
        const fileBytes = loaded[fileIndex]?.data.length || 0;
        const within = total ? (written / total) * fileBytes : 0;
        const pct = totalBytes ? ((doneBytes + within) / totalBytes) * 100 : 0;
        const elapsed = (performance.now() - startedAt) / 1000;
        setProgress(pct, `${name} · ${fileIndex + 1}/${loaded.length} · ${formatDuration(elapsed)} 경과`);
      },
    });

    const elapsed = (performance.now() - startedAt) / 1000;
    setProgress(100, `완료 · ${formatBytes(totalBytes)} / ${formatDuration(elapsed)}`, 'done');
    dlLog('플래시 완료. 기기가 새 펌웨어로 재시작했습니다.', 'ok');
    setStatus('플래시 완료', 'ok');

  } catch (err) {
    const aborted = err instanceof flasher.FlashAbort;
    setProgress(0, aborted ? '중지했습니다' : '실패', aborted ? '' : 'err');
    dlLog(aborted ? '사용자가 중지했습니다' : `플래시 실패: ${err.message}`, aborted ? 'warn' : 'err');
    if (!aborted) setStatus(`플래시 실패: ${err.message}`, 'err');
  } finally {
    state.dl.busy = false;
    $('#btnFlash').disabled = false;
    $('#btnFlashStop').disabled = true;
  }
}

// --- OTA -------------------------------------------------------------------
function renderOtaInfo() {
  const tb = $('#otaInfo');
  tb.innerHTML = '';
  const f = state.dl.otaFile;
  const rows = [];

  if (!dev.connected) {
    rows.push(['연결', '연결되어 있지 않습니다 — 먼저 위에서 연결하세요']);
  } else {
    const t = TRANSPORTS.find((T) => T.id === dev.transportId);
    rows.push(['전송 채널', t ? t.label : dev.transportId]);
    const part = dev.info?.partition;
    if (part) {
      rows.push(['실행 중인 파티션', `${part.running || '-'} → ${part.next || '-'} 에 기록`]);
      if (part.otaCapable === false) rows.push(['주의', 'OTA 파티션이 없어 USB 전체 플래시를 써야 합니다']);
    }
  }

  if (f) {
    rows.push(['파일', `${f.name} · ${formatBytes(f.size)}`]);
    if (dev.connected) {
      const eta = estimateSeconds(dev.transportId, f.size);
      rows.push(['예상 소요 시간', `약 ${formatDuration(eta)}`
        + (dev.transportId === 'ble' ? ' — BLE 는 느립니다. 가능하면 USB 나 WiFi 를 쓰세요.' : '')]);
    }
  }

  rows.forEach(([k, v]) => {
    const tr = el('tr');
    tr.appendChild(el('th', null, k));
    tr.appendChild(el('td', null, v));
    tb.appendChild(tr);
  });
}

async function startOta() {
  const f = state.dl.otaFile;
  if (!f) { dlLog('펌웨어 파일을 선택하세요', 'err'); return; }
  if (!dev.connected) { dlLog('먼저 장치에 연결하세요', 'err'); return; }

  state.dl.busy = true;
  state.dl.abort = false;
  $('#btnOta').disabled = true;
  $('#btnOtaStop').disabled = false;
  showProgress(true);
  stopPolling();                     // 업로드 중에는 상태 폴링이 대역을 뺏지 않게 한다

  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const res = await uploadFirmware(dev, bytes, {
      onLog: (msg, level) => dlLog(msg, level),
      shouldAbort: () => state.dl.abort,
      onProgress: ({ sent, total, percent, bps, etaSec }) => {
        setProgress(percent,
          `${formatBytes(sent)} / ${formatBytes(total)} · ${formatBytes(Math.round(bps))}/s · ` +
          `남은 시간 ${formatDuration(etaSec)}`);
      },
    });
    setProgress(100, `완료 · ${formatBytes(res.bytes)} / ${formatDuration(res.elapsedSec)}`, 'done');
    dlLog('기기가 새 펌웨어로 재부팅합니다. 잠시 뒤 다시 연결하세요.', 'ok');
    setStatus('OTA 업데이트 완료 — 기기 재부팅 중', 'ok');

  } catch (err) {
    const aborted = err instanceof OtaAbort;
    setProgress(0, aborted ? '취소했습니다' : '실패', aborted ? '' : 'err');
    dlLog(aborted ? '사용자가 취소했습니다' : `OTA 실패: ${err.message}`, aborted ? 'warn' : 'err');
    if (!aborted) setStatus(`OTA 실패: ${err.message}`, 'err');
  } finally {
    state.dl.busy = false;
    $('#btnOta').disabled = false;
    $('#btnOtaStop').disabled = true;
    startPolling();
  }
}

function wireDownloadTab() {
  $('#dlMode').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-m]');
    if (b) setDlMode(b.dataset.m);
  });

  flasher.BAUD_RATES.forEach((b) => {
    const o = el('option', null, `${b} bps`);
    o.value = b;
    $('#flashBaud').appendChild(o);
  });

  resetFlashParts();
  $('#btnAddPart').onclick = () => {
    state.dl.parts.push({ address: 0x10000, name: '파일', hint: '', file: null, bytes: null });
    renderFlashParts();
  };
  $('#btnResetParts').onclick = resetFlashParts;
  $('#flashPick').onchange = (e) => {
    assignPickedFiles(e.target.files);
    e.target.value = '';
  };
  $('#btnFlash').onclick = startFlash;
  $('#btnFlashStop').onclick = () => { state.dl.abort = true; $('#btnFlashStop').disabled = true; };

  $('#otaFile').onchange = (e) => {
    state.dl.otaFile = e.target.files[0] || null;
    $('#otaFileName').textContent = state.dl.otaFile
      ? `${state.dl.otaFile.name} · ${formatBytes(state.dl.otaFile.size)}`
      : '선택된 파일 없음';
    renderOtaInfo();
  };
  $('#btnOta').onclick = startOta;
  $('#btnOtaStop').onclick = () => { state.dl.abort = true; $('#btnOtaStop').disabled = true; };

  setDlMode(flasher.isSupported() ? 'flash' : 'ota');
}

// ---------------------------------------------------------------------------
//  장치 이벤트 구독
// ---------------------------------------------------------------------------
function wireDevice() {
  dev.on('open', onOpen);
  dev.on('close', onClose);

  dev.on('tx', ({ line }) => logRaw('tx', '→ ' + line));
  dev.on('rx', ({ line }) => logRaw('rx', '← ' + line));
  dev.on('log', ({ msg, level }) => {
    const cls = level === 'err' ? 'err' : level === 'ok' ? 'ok' : level === 'warn' ? 'warn' : 'rx';
    logRaw(cls, msg);
    if (level === 'err' || level === 'warn') setStatus(msg, level === 'err' ? 'err' : '');
  });

  dev.on('info', (info) => { renderInfo(info); updateStats(); });

  dev.on('event', ({ evt, data }) => {
    switch (evt) {
      case 'pin.state':
        applyPinState(data);
        break;
      case 'pin.change': {
        applyPinState(data);
        const s = state.pins.get(data.pin) || {};
        const shown = s.mode === 'adc'
          ? `${data.value} (${Math.round((clamp(data.value, 0, ADC_MAX) * 3300) / ADC_MAX)}mV)`
          : data.value === 1 ? 'HIGH (1)' : 'LOW (0)';
        logEvent(data.forced ? 'warn' : 'evt',
                 `GPIO${data.pin} → ${shown}${data.forced ? '  [강제 입력]' : ''}`);
        renderWatchTable();
        drawChart();
        break;
      }
      case 'app.status':
        renderAppStatus(data);
        fillAppForm(data);
        logEvent('evt', `앱 로직: 릴레이 ${data.relay ? 'ON' : 'OFF'} · 경보 ${data.alarm ? '있음' : '없음'} · 누름 ${data.presses}`);
        break;
      case 'ota.progress':
        // 장치가 실제로 받은 양. 화면 막대는 보낸 양 기준이라 로그로만 남긴다.
        if (data.percent % 25 === 0) logEvent('evt', `OTA 수신 ${data.percent}% (${data.via})`);
        break;
      case 'ota.begin':
        logEvent('ok', `OTA 시작: ${formatBytes(data.total || 0)} (${data.via})`);
        break;
      case 'ota.done':
        logEvent(data.ok ? 'ok' : 'err', data.ok ? 'OTA 완료 — 재부팅합니다' : `OTA 실패: ${data.error}`);
        break;
      case 'io.reset':
        logEvent('warn', '핀이 초기화되었습니다');
        state.pins.clear();
        state.series.clear();
        refreshAll();
        break;
      case 'force.clearAll':
        logEvent('warn', '모든 강제 입력이 해제되었습니다');
        refreshAll();
        break;
      case 'wifi.connected':
        logEvent('ok', `WiFi 접속됨: ${data.ip} (${data.ssid})`);
        setStatus(`장치가 WiFi 에 접속했습니다: ${data.ip}`, 'ok');
        break;
      case 'wifi.failed':
        logEvent('err', `WiFi 접속 실패: ${data.ssid} → SoftAP 로 전환`);
        break;
      case 'hello':
        logEvent('ok', `장치 연결: ${data.model} (${data.via})`);
        break;
      default:
        logEvent('evt', `${evt} ${JSON.stringify(data)}`);
    }
  });

  setInterval(updateStats, 500);
}

function updateStats() {
  $('#statTx').textContent = dev.stats.tx;
  $('#statRx').textContent = dev.stats.rx;
  $('#statErr').textContent = dev.stats.err;
  $('#statRtt').textContent = dev.stats.rtt || '-';
}

// ---------------------------------------------------------------------------
//  초기화
// ---------------------------------------------------------------------------
function wireUi() {
  // 탭
  $('#tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-tab]');
    if (!b) return;
    $$('#tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('.tab-page').forEach((p) => { p.dataset.active = String(p.dataset.page === b.dataset.tab); });
    if (b.dataset.tab === 'monitor') drawChart();
  });

  // 테마
  const applyTheme = (t) => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('esps3.theme', t);
    drawChart();
  };
  applyTheme(localStorage.getItem('esps3.theme')
    || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  $('#btnTheme').onclick = () =>
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

  // 연결
  $('#btnConnect').onclick = toggleConnect;

  // 핀 목록 도구
  $('#pinFilter').onchange = (e) => { state.filter = e.target.value; renderPinList(); };
  $('#pinSearch').oninput = (e) => { state.search = e.target.value; renderPinList(); };
  $('#pollRate').onchange = (e) => { state.pollMs = Number(e.target.value); startPolling(); };
  $('#btnRefresh').onclick = refreshAll;
  $('#btnUnforceAll').onclick = async () => {
    if (await send('force.clearAll')) setStatus('모든 강제 입력을 해제했습니다', 'ok');
    await refreshAll();
  };
  $('#btnResetPins').onclick = async () => {
    if (!confirm('모든 핀을 초기 상태로 되돌립니다. 계속할까요?')) return;
    await send('io.reset');
    state.pins.clear();
    state.series.clear();
    await refreshAll();
  };

  // 콘솔
  const presetSel = $('#cmdPreset');
  presetSel.appendChild(el('option', null, '예제 명령 선택…'));
  CMD_PRESETS.forEach(([cmd, label]) => {
    const o = el('option', null, `${label}  —  ${cmd}`);
    o.value = cmd;
    presetSel.appendChild(o);
  });
  presetSel.onchange = () => {
    if (!presetSel.value) return;
    $('#cmdInput').value = presetSel.value;
    presetSel.selectedIndex = 0;
    $('#cmdInput').focus();
  };
  $('#btnSend').onclick = sendConsole;
  $('#cmdInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendConsole(); });
  $('#btnClearLog').onclick = () => { $('#rawLog').innerHTML = ''; };

  // 시나리오
  const seqSel = $('#seqPreset');
  Object.keys(PRESETS).forEach((name) => {
    const o = el('option', null, name);
    o.value = name;
    seqSel.appendChild(o);
  });
  const loadPreset = () => { $('#seqScript').value = PRESETS[seqSel.value]; };
  $('#btnSeqLoad').onclick = loadPreset;
  loadPreset();
  $('#btnSeqRun').onclick = runSequence;
  $('#btnSeqStop').onclick = () => { runner.abort(); $('#btnSeqStop').disabled = true; };
  $('#btnSeqSave').onclick = saveSeqResult;

  // 앱 로직
  $('#btnAppApply').onclick = async () => {
    const r = await dev.try('app.config', appFormValues());
    if (!r.ok) { setStatus(r.error, 'err'); return; }
    renderAppStatus(r.result);
    setStatus('앱 로직 설정을 적용했습니다', 'ok');
    await refreshAll();
  };
  $('#btnAppReset').onclick = async () => {
    const r = await dev.try('app.reset');
    if (r.ok) { renderAppStatus(r.result); setStatus('앱 로직 상태를 초기화했습니다', 'ok'); }
    else setStatus(r.error, 'err');
  };
  $('#btnAppPress').onclick = simulatePress;

  // 장치
  $('#btnInfoRefresh').onclick = async () => {
    const r = await dev.try('sys.info');
    if (r.ok) { dev.info = r.result; renderInfo(r.result); }
  };
  $('#btnReboot').onclick = async () => {
    if (!confirm('장치를 재부팅합니다. 연결이 끊어집니다. 계속할까요?')) return;
    await dev.try('sys.reset', {}, { timeout: 2000 });
    setStatus('재부팅 명령을 보냈습니다');
  };
  $('#btnWifiScan').onclick = wifiScan;
  $('#btnWifiStatus').onclick = async () => {
    const r = await dev.try('wifi.status');
    if (r.ok) renderWifi(r.result); else setStatus(r.error, 'err');
  };
  $('#btnWifiConnect').onclick = async () => {
    const ssid = $('#wifiSsid').value.trim();
    if (!ssid) { setStatus('SSID 를 입력하세요', 'err'); return; }
    const r = await dev.try('wifi.connect', { ssid, pass: $('#wifiPass').value, save: true });
    if (!r.ok) { setStatus(r.error, 'err'); return; }
    setStatus('접속을 시도합니다. 잠시 후 상태를 확인하세요.', 'ok');
    setTimeout(async () => {
      const s = await dev.try('wifi.status');
      if (s.ok) renderWifi(s.result);
    }, 6000);
  };
  $('#btnWifiAp').onclick = async () => {
    const r = await dev.try('wifi.ap');
    if (r.ok) renderWifi(r.result);
  };
  $('#btnWifiForget').onclick = async () => {
    if (!confirm('장치에 저장된 WiFi 정보를 지웁니다. 계속할까요?')) return;
    const r = await dev.try('wifi.forget');
    if (r.ok) setStatus('저장된 WiFi 정보를 삭제했습니다', 'ok');
  };
}

function checkEnvironment() {
  const secure = window.isSecureContext;
  const notes = [];
  if (!secure) {
    notes.push('USB(Web Serial)와 블루투스(Web Bluetooth)는 https:// 또는 http://localhost 에서만 동작합니다. ' +
               'tools/serve.py 로 실행해 http://localhost:8000 으로 열어 주세요.');
  }
  if (location.protocol === 'https:') {
    notes.push('https 로 열려 있어 WiFi(ws://) 직접 연결은 브라우저가 차단합니다. WiFi 로 붙으려면 http://localhost 로 열어 주세요.');
  }
  if (location.protocol === 'file:') {
    notes.push('file:// 로 열면 모듈 로딩이 차단됩니다. tools/serve.py 를 사용하세요.');
  }
  banner(notes.join(' '));

  // 지원되는 첫 번째 방식을 기본 선택 (없으면 시뮬레이터)
  const first = TRANSPORTS.find((T) => T.isSupported() && T.id !== 'mock');
  selectTransport(first ? first.id : 'mock');
}

function init() {
  // 모듈이 여기까지 왔다는 것은 정상 부팅이라는 뜻이다. 실패 안내를 치운다.
  clearTimeout(window.__bootTimer);
  const boot = document.getElementById('bootFail');
  if (boot) boot.remove();

  buildTransportSelector();
  buildConnOptions();
  wireUi();
  wireDownloadTab();
  wireDevice();
  setupChartHover();
  checkEnvironment();
  renderPinList();
  renderWatchTable();
  drawChart();
  setStatus('연결 방식을 고르고 [연결] 을 누르세요');
}

init();

// 개발/디버깅 편의를 위해 콘솔에서 접근할 수 있게 노출한다
window.esps3 = { dev, state, refreshAll, send };
