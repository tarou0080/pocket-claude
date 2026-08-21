#!/bin/bash
# Claude Pro 週制限リセット時刻の固定用
# 毎週金曜 5:05 JST に実行し、リセット直後に使用実績を作る
# 「.」だけだとカウントされない可能性があるため、ある程度のやり取りを発生させる

LOG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="${LOG_DIR}/keepalive.log"

# ログローテーション（100行超えたら古い分を削除）
if [ -f "$LOG" ] && [ $(wc -l < "$LOG") -gt 100 ]; then
  tail -50 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Sending keepalive request..." >> "$LOG"

RESULT=$(timeout 60 claude -p "今日は何曜日？簡潔に答えて" --max-turns 1 --no-session-persistence 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] OK: ${RESULT}" >> "$LOG"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] FAILED (exit=${EXIT_CODE}): ${RESULT}" >> "$LOG"
fi
