#!/usr/bin/env bash
# 用 headless Chrome 给页面截图。
# --virtual-time-budget：给它几秒"虚拟时间"，否则外部图片（比如场面图）
# 还没解码完就拍了，截出来是空的。
# 用法： scripts/shot.sh <url> <输出文件> [宽] [高]
set -uo pipefail

URL="$1"
OUT="$2"
W="${3:-1500}"
H="${4:-1000}"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="$ROOT/.chrome-profile"

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

"$CHROME" --headless=old --no-sandbox --disable-gpu --disable-crash-reporter \
  --hide-scrollbars --force-device-scale-factor=2 \
  --virtual-time-budget=6000 \
  --user-data-dir="$PROFILE" --screenshot="$OUT" \
  --window-size="$W,$H" "$URL" >/dev/null 2>&1 &

PID=$!

# 等文件出现并稳定下来
LAST=0
for _ in $(seq 1 60); do
  sleep 0.5
  if [ -f "$OUT" ]; then
    SIZE=$(stat -f%z "$OUT" 2>/dev/null || echo 0)
    if [ "$SIZE" -gt 0 ] && [ "$SIZE" = "$LAST" ]; then
      break
    fi
    LAST="$SIZE"
  fi
done

kill -TERM "$PID" 2>/dev/null || true
sleep 0.5
kill -9 "$PID" 2>/dev/null || true

if [ -s "$OUT" ]; then
  echo "OK   $OUT"
else
  echo "FAIL $OUT"
  exit 1
fi
