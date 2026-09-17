#!/usr/bin/env node
// ---------------------------------------------------------------------------
//  웹 콘솔 자체 점검
//  브라우저 없이 Device + 시뮬레이터 + 시나리오 엔진을 그대로 돌려,
//  프로토콜 왕복과 강제 입력/출력 동작이 깨지지 않았는지 확인한다.
//
//    node tools/selftest.mjs
// ---------------------------------------------------------------------------
import { Device } from '../web/js/protocol.js';
import { MockTransport } from '../web/js/transports/mock.js';
import { parseScript, SequenceRunner, PRESETS } from '../web/js/sequence.js';
import { uploadFirmware, toBase64, estimateSeconds, formatBytes, formatDuration } from '../web/js/ota.js';
import { md5Hex, Md5 } from '../web/js/md5.js';
import { parseAddress, checkOverlaps, formatAddress, DEFAULT_LAYOUT } from '../web/js/flasher.js';
import { ALL_PINS, SAFE_PINS, ADC_PINS, isBlocked } from '../web/js/pinmap.js';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dev = new Device();
const events = [];
dev.on('event', (e) => events.push(e));

console.log('\n[1] 연결 및 장치 정보');
await dev.connect(MockTransport);
check('연결됨', dev.connected);
check('sys.info 수신', !!dev.info?.model, JSON.stringify(dev.info?.model));
const ping = await dev.cmd('sys.ping');
check('sys.ping 응답', typeof ping.pong === 'number');

console.log('\n[2] 핀맵');
check('GPIO 22~25 는 목록에 없음', ![22, 23, 24, 25].some((p) => ALL_PINS.includes(p)));
check('Flash/PSRAM 핀(26~32) 차단됨', [26, 27, 28, 29, 30, 31, 32].every(isBlocked));
check(`안전 핀 ${SAFE_PINS.length}개 / ADC 핀 ${ADC_PINS.length}개`, SAFE_PINS.length > 20 && ADC_PINS.length === 20);
const blocked = await dev.try('io.write', { pin: 30, value: 1 });
check('예약 핀 쓰기는 거부됨', !blocked.ok, blocked.error);

console.log('\n[3] 출력 강제');
let st = await dev.cmd('io.write', { pin: 48, value: 1 });
check('io.write → value=1', st.value === 1 && st.mode === 'output');
st = await dev.cmd('io.toggle', { pin: 48 });
check('io.toggle → value=0', st.value === 0);
st = await dev.cmd('io.pwm', { pin: 48, duty: 512, freq: 5000, res: 10 });
check('io.pwm duty 반영', st.duty === 512 && st.mode === 'pwm');
st = await dev.cmd('io.pwm', { pin: 48, duty: 99999 });
check('duty 상한 클램프', st.duty === 1023, String(st.duty));

console.log('\n[4] 강제 입력(가상 입력 주입)');
await dev.cmd('io.config', { pin: 4, mode: 'input_pullup' });
st = await dev.cmd('io.read', { pin: 4 });
check('풀업 입력 기본값 = 1', st.value === 1);
st = await dev.cmd('force.set', { pin: 4, value: 0 });
check('강제 입력 0 주입', st.value === 0 && st.forced === true);
st = await dev.cmd('io.read', { pin: 4 });
check('읽기에도 주입값 반영', st.value === 0 && st.forced === true);
const forced = await dev.cmd('force.list');
check('force.list 에 포함', forced.pins.some((p) => p.pin === 4));
st = await dev.cmd('force.clear', { pin: 4 });
check('강제 해제 후 물리값 복귀', st.forced === false && st.value === 1);

await dev.cmd('force.pulse', { pin: 4, value: 0, ms: 80 });
st = await dev.cmd('io.read', { pin: 4 });
check('강제 펄스 동안 주입값 유지', st.value === 0);
await sleep(200);
st = await dev.cmd('io.read', { pin: 4 });
check('강제 펄스 만료 후 자동 복귀', st.forced === false && st.value === 1);

console.log('\n[5] ADC 주입');
await dev.cmd('io.config', { pin: 6, mode: 'adc' });
await dev.cmd('force.set', { pin: 6, value: 3300 });
const adc = await dev.cmd('io.adc', { pin: 6 });
check('ADC 주입값 반영', adc.raw === 3300 && adc.forced === true);
check('mV 환산', Math.abs(adc.mv - Math.round((3300 * 3300) / 4095)) <= 1, String(adc.mv));
await dev.cmd('force.clear', { pin: 6 });

console.log('\n[6] 감시 이벤트');
events.length = 0;
await dev.cmd('io.watch', { pins: [4], on: true, interval: 20 });
await dev.cmd('force.set', { pin: 4, value: 0 });
await sleep(150);
check('pin.change 이벤트 수신', events.some((e) => e.evt === 'pin.change' && e.data.pin === 4 && e.data.value === 0));
await dev.cmd('force.clear', { pin: 4 });

console.log('\n[7] 앱 로직 + 강제 입력 연동');
await dev.cmd('io.reset');
await dev.cmd('app.config', {
  enabled: true, buttonPin: 4, relayPin: 5, ledPin: 48,
  sensorPin: 6, alarmPin: 7, activeLow: true, debounceMs: 20, threshold: 3000,
});
await dev.cmd('force.set', { pin: 4, value: 1 });   // 눌리지 않은 상태
await sleep(120);
let app = await dev.cmd('app.status');
check('초기 릴레이 OFF', app.relay === false);

await dev.cmd('force.set', { pin: 4, value: 0 });   // 누름
await sleep(120);
await dev.cmd('force.set', { pin: 4, value: 1 });   // 뗌
await sleep(120);
app = await dev.cmd('app.status');
check('버튼 주입 1회 → 릴레이 ON', app.relay === true, JSON.stringify(app));
st = await dev.cmd('io.read', { pin: 5 });
check('릴레이 출력 핀도 HIGH', st.value === 1);

await dev.cmd('force.set', { pin: 6, value: 3500 });  // 임계 초과
await sleep(150);
app = await dev.cmd('app.status');
check('ADC 주입 → 경보 ON', app.alarm === true);
st = await dev.cmd('io.read', { pin: 7 });
check('경보 출력 핀 HIGH', st.value === 1);
await dev.cmd('force.clearAll');

console.log('\n[8] 시나리오 엔진');
for (const [name, src] of Object.entries(PRESETS)) {
  const { steps, error } = parseScript(src);
  check(`프리셋 파싱: ${name} (${steps.length} 스텝)`, !error, error || '');
}

await dev.cmd('io.reset');
await dev.cmd('app.config', { enabled: true, buttonPin: 4, relayPin: 5, ledPin: 48, activeLow: true });
const { steps, error } = parseScript(PRESETS['강제 입력 → 로직 반응']);
check('시나리오 파싱 성공', !error, error || '');
const runner = new SequenceRunner(dev);
const summary = await runner.run(steps);
check(`시나리오 실행: ${summary.passed} 통과 / ${summary.failed} 실패 / ${summary.errored} 오류 (${summary.ms}ms)`,
      summary.failed === 0 && summary.errored === 0,
      summary.results.filter((r) => r.status === 'fail' || r.status === 'error')
                     .map((r) => `${r.step.lineNo}번 줄 ${r.detail}`).join(' | '));

console.log('\n[9] MD5 / base64');
check('MD5 표준 벡터', md5Hex(new TextEncoder().encode('abc')) === '900150983cd24fb0d6963f7d28e17f72');
check('빈 입력 MD5', md5Hex(new Uint8Array(0)) === 'd41d8cd98f00b204e9800998ecf8427e');
{
  // 증분 해시가 한 번에 한 것과 같은가 (조각 경계가 64바이트와 어긋나는 경우)
  const buf = new Uint8Array(10000).map((_, i) => (i * 37 + 11) & 0xff);
  const inc = new Md5();
  for (let i = 0; i < buf.length; i += 333) inc.update(buf.subarray(i, Math.min(i + 333, buf.length)));
  check('증분 MD5 == 일괄 MD5', inc.hex() === md5Hex(buf));
  check('base64 왕복', (() => {
    const enc = toBase64(buf.subarray(0, 3001));
    const bin = atob(enc);
    if (bin.length !== 3001) return false;
    for (let i = 0; i < 3001; i++) if (bin.charCodeAt(i) !== buf[i]) return false;
    return true;
  })());
}

console.log('\n[10] 플래시 주소 처리');
check('0x 없는 값도 16진수로', parseAddress('10000') === 0x10000 && parseAddress('0x10000') === 0x10000);
check('4바이트 정렬 강제', (() => { try { parseAddress('0x10001'); return false; } catch { return true; } })());
check('주소 표기', formatAddress(0x10000) === '0x10000');
check('기본 배치는 겹치지 않음', (() => {
  try {
    checkOverlaps(DEFAULT_LAYOUT.map((l, i) => ({ ...l, data: new Uint8Array(i === 0 ? 0x7000 : 0x1000) })));
    return true;
  } catch { return false; }
})());
check('겹치면 거부', (() => {
  try {
    checkOverlaps([
      { name: 'a', address: 0, data: new Uint8Array(0x9000) },
      { name: 'b', address: 0x8000, data: new Uint8Array(16) },
    ]);
    return false;
  } catch { return true; }
})());

console.log('\n[11] OTA 업로드 (바이너리 경로)');
{
  // 앱 이미지처럼 0xE9 로 시작하는 가짜 펌웨어
  const fw = new Uint8Array(70000);
  fw[0] = 0xe9;
  for (let i = 1; i < fw.length; i++) fw[i] = (i * 131 + 17) & 0xff;

  const progress = [];
  const otaEvents = [];
  const offEvt = dev.on('event', (e) => { if (e.evt.startsWith('ota.')) otaEvents.push(e); });

  const res = await uploadFirmware(dev, fw, { onProgress: (p) => progress.push(p) });
  check(`업로드 성공 (${formatBytes(res.bytes)} / ${res.elapsedSec.toFixed(2)}초)`, !!res);
  check('클라이언트가 계산한 MD5 를 장치가 확인함', res.md5 === md5Hex(fw), res.md5);
  check('진행률이 보고됨', progress.length > 1 && progress[progress.length - 1].percent === 100);
  check('ota.progress 이벤트 수신', otaEvents.some((e) => e.evt === 'ota.progress'));
  check('ota.done(성공) 이벤트 수신', otaEvents.some((e) => e.evt === 'ota.done' && e.data.ok === true));
  offEvt();
  await sleep(700);   // 시뮬레이터 재부팅
}

console.log('\n[12] OTA 거부 조건');
{
  const notFw = new Uint8Array(1000);
  notFw[0] = 0x7f;                       // ELF - 실수로 firmware.elf 를 고른 경우
  let msg = '';
  try { await uploadFirmware(dev, notFw, {}); } catch (e) { msg = e.message; }
  check('ESP32 이미지가 아니면 거부', /0xE9/.test(msg), msg);

  const huge = new Uint8Array(4 * 1024 * 1024);
  huge[0] = 0xe9;
  msg = '';
  try { await uploadFirmware(dev, huge, {}); } catch (e) { msg = e.message; }
  check('파티션보다 크면 거부', /파티션보다 큽니다|OTA 파티션/.test(msg), msg);

  msg = '';
  try { await uploadFirmware(dev, new Uint8Array(0), {}); } catch (e) { msg = e.message; }
  check('빈 파일 거부', /비어 있습니다/.test(msg), msg);

  // 손상 감지: 전송 중 한 바이트가 바뀌면 장치의 MD5 검증이 잡아내야 한다
  const fw2 = new Uint8Array(20000);
  fw2[0] = 0xe9;
  for (let i = 1; i < fw2.length; i++) fw2[i] = (i * 7) & 0xff;
  const realSend = dev.transport.sendBinary.bind(dev.transport);
  let flipped = false;
  dev.transport.sendBinary = async (bytes) => {
    if (!flipped && bytes.length > 10) { bytes[5] ^= 0xff; flipped = true; }   // 한 비트 손상
    return realSend(bytes);
  };
  msg = '';
  try { await uploadFirmware(dev, fw2, {}); } catch (e) { msg = e.message; }
  dev.transport.sendBinary = realSend;
  check('전송 중 손상은 MD5 검증에서 걸림', /MD5 불일치|검증 실패/.test(msg), msg);
  check('실패 후 장치는 idle 로 복귀', (await dev.cmd('ota.status')).state !== 'receiving');
}

console.log('\n[13] OTA 취소');
{
  const fw = new Uint8Array(200000);
  fw[0] = 0xe9;
  // onProgress 는 화면 갱신용이라 120ms 간격으로 눌러서 보고한다.
  // 중단 판정은 조각마다 확인하므로, 보낸 조각 수로 중단을 걸어 본다.
  let chunks = 0;
  const realSend = dev.transport.sendBinary.bind(dev.transport);
  dev.transport.sendBinary = async (b) => { chunks++; return realSend(b); };
  let msg = '';
  let sentBefore = 0;
  try {
    await uploadFirmware(dev, fw, {
      shouldAbort: () => chunks >= 5,
      onProgress: (p) => { sentBefore = p.sent; },
    });
  } catch (e) { msg = e.name; }
  dev.transport.sendBinary = realSend;
  check('중단 요청이 반영됨', msg === 'OtaAbort', msg);
  check('중단 시점까지만 전송됨', chunks < 50, `${chunks} 조각`);
  const st = await dev.cmd('ota.status');
  check('취소 후 수신 상태가 아님', st.state !== 'receiving', st.state);
}

console.log('\n[14] 예상 시간 안내');
check('BLE 가 USB 보다 오래 걸린다고 안내', estimateSeconds('ble', 1e6) > estimateSeconds('usb', 1e6));
check('시간 표기', formatDuration(90) === '1분 30초' && formatDuration(30) === '30초',
      formatDuration(90) + ' / ' + formatDuration(30));

console.log('\n[15] 오류 처리');
const unknown = await dev.try('does.not.exist');
check('알 수 없는 명령 거부', !unknown.ok && /알 수 없는 명령/.test(unknown.error));
const noPin = await dev.try('io.write', { value: 1 });
check('필수 인자 누락 거부', !noPin.ok, noPin.error);

await dev.disconnect();
check('연결 해제됨', !dev.connected);
const afterClose = await dev.try('sys.ping');
check('해제 후 명령은 실패', !afterClose.ok);

console.log(`\n${fail === 0 ? '전체 통과' : '실패 있음'}: ${pass} 통과, ${fail} 실패\n`);
process.exit(fail === 0 ? 0 : 1);
