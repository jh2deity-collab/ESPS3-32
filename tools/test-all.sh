#!/usr/bin/env bash
# 전체 자체 점검: 펌웨어 로직(호스트 컴파일) + 웹 콘솔 프로토콜/시나리오
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==== 1/2  펌웨어 로직 (호스트 컴파일) ===="
make -C "$ROOT/firmware/test" test

echo "==== 2/2  웹 콘솔 (프로토콜·시뮬레이터·시나리오) ===="
node "$ROOT/tools/selftest.mjs"

echo "모든 점검을 통과했습니다."
