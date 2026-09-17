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
await dev.cmd('io.config', { pin: 3, mode: 'adc' });
await dev.cmd('force.set', { pin: 3, value: 3300 });
const adc = await dev.cmd('io.adc', { pin: 3 });
check('ADC 주입값 반영', adc.raw === 3300 && adc.forced === true);
check('mV 환산', Math.abs(adc.mv - Math.round((3300 * 3300) / 4095)) <= 1, String(adc.mv));
await dev.cmd('force.clear', { pin: 3 });

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
  sensorPin: 3, alarmPin: 6, activeLow: true, debounceMs: 20, threshold: 3000,
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

await dev.cmd('force.set', { pin: 3, value: 3500 });  // 임계 초과
await sleep(150);
app = await dev.cmd('app.status');
check('ADC 주입 → 경보 ON', app.alarm === true);
st = await dev.cmd('io.read', { pin: 6 });
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

console.log('\n[9] 오류 처리');
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
