// ---------------------------------------------------------------------------
//  테스트 시나리오 엔진
//  한 줄에 한 동작씩 적는 작은 스크립트를 파싱해서 순서대로 실행하고,
//  expect 로 결과를 검증한다. 회귀 테스트를 반복 실행할 때 쓴다.
//
//    config 4 output        핀 모드 설정 (input/input_pullup/input_pulldown/output/pwm/adc/disabled)
//    write 4 1              디지털 출력 강제
//    toggle 4               출력 반전
//    pulse 4 1 200          200ms 동안 1 을 출력하고 원래 값으로 복귀
//    pwm 5 512 1000 10      duty [freq] [res]
//    force 6 1              강제 입력 주입 (배선 없이 입력을 만들어 낸다)
//    forcepulse 6 0 50      50ms 동안만 주입
//    unforce 6              주입 해제
//    watch 6 on|off         변화 이벤트 구독
//    read 6                 현재 값을 로그에 남긴다
//    wait 500               대기(ms)
//    expect 7 == 1          검증 (== != > < >= <=)
//    expect adc 3 > 2000    ADC 원시값 검증
//    expect app.relay == 1  테스트 대상 로직 상태 검증 (relay/alarm/presses)
//    log 메시지
//    reset                  모든 핀 초기화
//    appreset               테스트 대상 로직 상태 초기화(릴레이/경보/카운터)
//    unforceall             모든 강제 입력 해제
//    repeat 3 ... end       블록 반복 (중첩 가능)
// ---------------------------------------------------------------------------

const MAX_STEPS = 20000;
const CMP = {
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '>':  (a, b) => a > b,
  '<':  (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
};

const MODES = ['disabled', 'input', 'input_pullup', 'input_pulldown', 'output', 'pwm', 'adc'];

class ParseError extends Error {
  constructor(lineNo, msg) {
    super(`${lineNo}번 줄: ${msg}`);
    this.lineNo = lineNo;
  }
}

function num(tok, lineNo, what) {
  if (tok === undefined || tok === null || tok === '') throw new ParseError(lineNo, `${what} 값이 빠졌습니다`);
  const v = Number(tok);
  if (!Number.isFinite(v)) throw new ParseError(lineNo, `${what} 값이 숫자가 아닙니다: '${tok}'`);
  return v;
}

function pinArg(tok, lineNo) {
  const v = num(tok, lineNo, '핀 번호');
  if (!Number.isInteger(v) || v < 0 || v > 48) throw new ParseError(lineNo, `핀 번호가 올바르지 않습니다: ${tok}`);
  return v;
}

/**
 * 스크립트를 실행 가능한 스텝 배열로 펼친다. repeat 블록은 파싱 단계에서 전개한다.
 * @returns {{steps:Array, error:string|null}}
 */
export function parseScript(text) {
  const rawLines = String(text || '').split('\n');
  const steps = [];
  /** @type {{count:number, start:number, lineNo:number}[]} */
  const stack = [];

  try {
    for (let i = 0; i < rawLines.length; i++) {
      const lineNo = i + 1;
      const line = rawLines[i].replace(/#.*$/, '').trim();
      if (!line) continue;

      const tok = line.split(/\s+/);
      const op = tok[0].toLowerCase();

      if (op === 'repeat') {
        const n = num(tok[1], lineNo, '반복 횟수');
        if (!Number.isInteger(n) || n < 1 || n > 1000) throw new ParseError(lineNo, 'repeat 횟수는 1~1000 입니다');
        stack.push({ count: n, start: steps.length, lineNo });
        continue;
      }

      if (op === 'end') {
        const blk = stack.pop();
        if (!blk) throw new ParseError(lineNo, '짝이 맞지 않는 end 입니다');
        const body = steps.slice(blk.start);
        for (let r = 1; r < blk.count; r++) {
          for (const s of body) steps.push({ ...s, iter: r + 1 });
          if (steps.length > MAX_STEPS) throw new ParseError(lineNo, `스텝이 너무 많습니다(최대 ${MAX_STEPS})`);
        }
        continue;
      }

      steps.push({ ...parseStep(op, tok, lineNo, line), lineNo, line });
      if (steps.length > MAX_STEPS) throw new ParseError(lineNo, `스텝이 너무 많습니다(최대 ${MAX_STEPS})`);
    }

    if (stack.length) throw new ParseError(stack[stack.length - 1].lineNo, 'repeat 에 대응하는 end 가 없습니다');
    return { steps, error: null };
  } catch (err) {
    if (err instanceof ParseError) return { steps: [], error: err.message };
    throw err;
  }
}

function parseStep(op, tok, lineNo, line) {
  switch (op) {
    case 'config': {
      const pin = pinArg(tok[1], lineNo);
      const mode = (tok[2] || '').toLowerCase();
      if (!MODES.includes(mode)) throw new ParseError(lineNo, `알 수 없는 모드: '${tok[2]}' (${MODES.join('/')})`);
      return { op, pin, mode };
    }
    case 'write':
      return { op, pin: pinArg(tok[1], lineNo), value: num(tok[2], lineNo, '출력') ? 1 : 0 };
    case 'toggle':
    case 'unforce':
    case 'read':
      return { op, pin: pinArg(tok[1], lineNo) };
    case 'pulse':
    case 'forcepulse':
      return {
        op,
        pin: pinArg(tok[1], lineNo),
        value: num(tok[2] ?? 1, lineNo, '값'),
        ms: num(tok[3] ?? 100, lineNo, '지속 시간'),
      };
    case 'pwm': {
      const step = { op, pin: pinArg(tok[1], lineNo), duty: num(tok[2], lineNo, 'duty') };
      if (tok[3] != null) step.freq = num(tok[3], lineNo, 'freq');
      if (tok[4] != null) step.res = num(tok[4], lineNo, 'res');
      return step;
    }
    case 'force':
      return { op, pin: pinArg(tok[1], lineNo), value: num(tok[2], lineNo, '주입값') };
    case 'watch':
      return { op, pin: pinArg(tok[1], lineNo), on: (tok[2] ?? 'on').toLowerCase() !== 'off' };
    case 'wait': {
      const ms = num(tok[1], lineNo, '대기 시간');
      if (ms < 0 || ms > 600000) throw new ParseError(lineNo, '대기 시간은 0~600000ms 입니다');
      return { op, ms };
    }
    case 'log':
      return { op, text: line.slice(3).trim() };
    case 'reset':
    case 'appreset':
    case 'unforceall':
      return { op };
    case 'expect': {
      // expect <pin> <op> <value>  |  expect adc <pin> <op> <value>  |  expect app.<key> <op> <value>
      let kind = 'pin';
      let idx = 1;
      let target;

      if ((tok[1] || '').toLowerCase() === 'adc') {
        kind = 'adc';
        idx = 2;
        target = pinArg(tok[2], lineNo);
      } else if ((tok[1] || '').toLowerCase().startsWith('app.')) {
        kind = 'app';
        target = tok[1].slice(4).toLowerCase();
        if (!['relay', 'alarm', 'presses'].includes(target)) {
          throw new ParseError(lineNo, `app.relay / app.alarm / app.presses 만 검증할 수 있습니다`);
        }
      } else {
        target = pinArg(tok[1], lineNo);
      }

      const cmp = tok[idx + 1];
      if (!CMP[cmp]) throw new ParseError(lineNo, `비교 연산자가 올바르지 않습니다: '${cmp}' (${Object.keys(CMP).join(' ')})`);
      const value = num(tok[idx + 2], lineNo, '기대값');
      return { op, kind, target, cmp, value };
    }
    default:
      throw new ParseError(lineNo, `알 수 없는 명령: '${op}'`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 파싱된 스텝을 순서대로 장치에 실행한다.
 */
export class SequenceRunner {
  /** @param {import('./protocol.js').Device} dev */
  constructor(dev) {
    this.dev = dev;
    this.aborted = false;
    this.running = false;
  }

  abort() { this.aborted = true; }

  /**
   * @param {Array} steps
   * @param {{onStep?:(r:object)=>void, stopOnFail?:boolean}} opts
   */
  async run(steps, { onStep = () => {}, stopOnFail = false } = {}) {
    this.aborted = false;
    this.running = true;
    const started = performance.now();
    const results = [];
    let passed = 0, failed = 0, errored = 0;

    for (let i = 0; i < steps.length; i++) {
      if (this.aborted) {
        const r = { index: i, step: steps[i], status: 'abort', detail: '사용자가 중단했습니다' };
        results.push(r);
        onStep(r);
        break;
      }

      const step = steps[i];
      const t0 = performance.now();
      let r;
      try {
        r = { index: i, step, ...(await this._exec(step)) };
      } catch (err) {
        r = { index: i, step, status: 'error', detail: err.message };
      }
      r.ms = Math.round(performance.now() - t0);
      results.push(r);
      onStep(r);

      if (r.status === 'pass') passed++;
      else if (r.status === 'fail') failed++;
      else if (r.status === 'error') errored++;

      if (stopOnFail && (r.status === 'fail' || r.status === 'error')) break;
    }

    this.running = false;
    return {
      total: steps.length,
      executed: results.length,
      passed, failed, errored,
      ms: Math.round(performance.now() - started),
      aborted: this.aborted,
      results,
    };
  }

  async _exec(step) {
    const d = this.dev;
    switch (step.op) {
      case 'config':
        await d.cmd('io.config', { pin: step.pin, mode: step.mode });
        return { status: 'ok', detail: `GPIO${step.pin} → ${step.mode}` };

      case 'write':
        await d.cmd('io.write', { pin: step.pin, value: step.value });
        return { status: 'ok', detail: `GPIO${step.pin} 출력 = ${step.value}` };

      case 'toggle': {
        const r = await d.cmd('io.toggle', { pin: step.pin });
        return { status: 'ok', detail: `GPIO${step.pin} 반전 → ${r.value}` };
      }

      case 'pulse':
        await d.cmd('io.pulse', { pin: step.pin, value: step.value, ms: step.ms });
        return { status: 'ok', detail: `GPIO${step.pin} 펄스 ${step.value} / ${step.ms}ms` };

      case 'pwm': {
        const args = { pin: step.pin, duty: step.duty };
        if (step.freq) args.freq = step.freq;
        if (step.res) args.res = step.res;
        await d.cmd('io.pwm', args);
        return { status: 'ok', detail: `GPIO${step.pin} PWM duty=${step.duty}` };
      }

      case 'force':
        await d.cmd('force.set', { pin: step.pin, value: step.value });
        return { status: 'ok', detail: `GPIO${step.pin} 강제 입력 = ${step.value}` };

      case 'forcepulse':
        await d.cmd('force.pulse', { pin: step.pin, value: step.value, ms: step.ms });
        return { status: 'ok', detail: `GPIO${step.pin} 강제 입력 펄스 ${step.value} / ${step.ms}ms` };

      case 'unforce':
        await d.cmd('force.clear', { pin: step.pin });
        return { status: 'ok', detail: `GPIO${step.pin} 강제 입력 해제` };

      case 'unforceall':
        await d.cmd('force.clearAll');
        return { status: 'ok', detail: '모든 강제 입력 해제' };

      case 'watch':
        await d.cmd('io.watch', { pin: step.pin, on: step.on });
        return { status: 'ok', detail: `GPIO${step.pin} 감시 ${step.on ? '켬' : '끔'}` };

      case 'reset':
        await d.cmd('io.reset');
        return { status: 'ok', detail: '핀 초기화' };

      case 'appreset':
        await d.cmd('app.reset');
        return { status: 'ok', detail: '앱 로직 상태 초기화' };

      case 'read': {
        const r = await d.cmd('io.read', { pin: step.pin });
        return { status: 'ok', detail: `GPIO${step.pin} = ${r.value}${r.forced ? ' (강제)' : ''}` };
      }

      case 'wait':
        await sleep(step.ms);
        return { status: 'ok', detail: `${step.ms}ms 대기` };

      case 'log':
        return { status: 'ok', detail: step.text };

      case 'expect': {
        const { actual, label } = await this._readTarget(step);
        const ok = CMP[step.cmp](actual, step.value);
        return {
          status: ok ? 'pass' : 'fail',
          actual,
          detail: `${label} = ${actual} (기대: ${step.cmp} ${step.value})`,
        };
      }

      default:
        return { status: 'error', detail: `실행할 수 없는 명령: ${step.op}` };
    }
  }

  async _readTarget(step) {
    if (step.kind === 'adc') {
      const r = await this.dev.cmd('io.adc', { pin: step.target });
      return { actual: r.raw, label: `GPIO${step.target} ADC` };
    }
    if (step.kind === 'app') {
      const r = await this.dev.cmd('app.status');
      const v = r[step.target];
      return { actual: typeof v === 'boolean' ? (v ? 1 : 0) : Number(v), label: `app.${step.target}` };
    }
    const r = await this.dev.cmd('io.read', { pin: step.target });
    return { actual: r.value, label: `GPIO${step.target}` };
  }
}

/** UI 의 "예제 불러오기" 에 쓰는 기본 시나리오들 */
export const PRESETS = {
  '출력 핀 점검': `# 출력 핀을 순서대로 켰다 끄며 배선을 확인한다
log 출력 점검 시작
config 48 output
repeat 3
  write 48 1
  wait 200
  expect 48 == 1
  write 48 0
  wait 200
  expect 48 == 0
end
log 출력 점검 완료`,

  '강제 입력 → 로직 반응': `# 배선 없이 버튼 입력을 주입해 앱 로직(버튼→릴레이)이 도는지 본다
# 먼저 '앱 로직' 탭에서 버튼=GPIO4, 릴레이=GPIO5 로 켜 두세요.
log 강제 입력 테스트 시작
appreset
force 4 1
wait 100
expect app.relay == 0

# 버튼 누름(액티브 로우: 0) -> 릴레이 ON
force 4 0
wait 150
force 4 1
wait 150
expect app.relay == 1
expect 5 == 1

# 한 번 더 누르면 OFF
force 4 0
wait 150
force 4 1
wait 150
expect app.relay == 0
expect 5 == 0

unforce 4
log 강제 입력 테스트 완료`,

  '아날로그 임계 경보': `# ADC 값을 주입해 경보 출력이 뜨는지 확인한다
# '앱 로직' 탭에서 센서=GPIO3, 경보=GPIO6, 임계=3000 으로 켜 두세요.
log 아날로그 경보 테스트
appreset
force 3 1000
wait 150
expect app.alarm == 0
expect 6 == 0

force 3 3500
wait 150
expect app.alarm == 1
expect 6 == 1

force 3 500
wait 150
expect app.alarm == 0
unforce 3
log 완료`,

  'PWM 스윕': `# PWM duty 를 단계적으로 올려 LED 밝기를 확인한다
config 48 pwm
pwm 48 0 5000 10
repeat 4
  pwm 48 256
  wait 300
  pwm 48 512
  wait 300
  pwm 48 1023
  wait 300
end
pwm 48 0
config 48 output
log PWM 스윕 완료`,
};
