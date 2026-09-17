#!/usr/bin/env bash
# 전체 자체 점검
#   1) 펌웨어 로직 (호스트 컴파일)
#   2) 웹 콘솔 (프로토콜·시뮬레이터·시나리오)
#   3) 펌웨어 빌드 (PlatformIO 가 있을 때만)
#
# PlatformIO 가 PATH 에 없고 다른 곳에 있다면:  PIO=/경로/pio ./tools/test-all.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIO="${PIO:-$(command -v pio || true)}"

echo "==== 1/3  펌웨어 로직 (호스트 컴파일) ===="
make -C "$ROOT/firmware/test" test

echo "==== 2/3  웹 콘솔 (프로토콜·시뮬레이터·시나리오) ===="
node "$ROOT/tools/selftest.mjs"

echo "==== 3/3  펌웨어 빌드 (ESP32-S3 N8R2) ===="
if [ -z "$PIO" ]; then
  echo "  PlatformIO 가 없어 건너뜁니다. (pip install platformio)"
else
  "$PIO" run -d "$ROOT/firmware"
fi

echo "모든 점검을 통과했습니다."
