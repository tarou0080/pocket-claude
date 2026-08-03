#!/bin/bash
# Claude Code CLI 自動アップデートスクリプト
# cron: 毎日 3:00 に実行（johnadmin crontab。2026-07-25 週次→日次）
#
# 2026-07-22 修正: グローバル(/usr/local/lib)はroot所有のため johnadmin の
#   `npm install -g` は EACCES で失敗していた → sudo を付与。
#   さらに旧版はバージョン変化の有無だけで判定し、失敗を「Already up-to-date」と
#   誤報告していた → npm 終了コードと npm view の最新版を突き合わせて失敗を検知する。
# 2026-07-25 修正:
#   ① node 24 LTS(/opt/node-lts, /usr/local/bin/node) を明示的に使う。cron の PATH は
#      /usr/bin を先に見る場合があり、EOL の Debian node18 を掴むと engines で弾かれる。
#   ② npm 11 は postinstall をデフォルトでブロックする(allow-scripts)。claude-code は
#      postinstall で native バイナリを bin/claude.exe へコピーする作りなので、
#      ブロックされると node_modules だけ新しく実体は旧版のまま＝バージョンが黙って
#      据え置かれる。npm 後に install.cjs を明示実行し、実体の追従を保証する。
#   ③ 実体(claude --version)が最新と一致しない場合は WARNING でなく ERROR 扱いにし、
#      「エイリアスが旧モデルへ格下げされている」状態を検知できるようにする。

NODE_BIN=/usr/local/bin/node
NPM_BIN=/usr/local/bin/npm
PKG_DIR=/usr/local/lib/node_modules/@anthropic-ai/claude-code

LOG_DIR="/home/johnadmin/logs"
LOG_FILE="$LOG_DIR/claude-cli-update.log"

mkdir -p "$LOG_DIR"

echo "=== $(date '+%Y-%m-%d %H:%M:%S') Claude CLI update started (node $($NODE_BIN -v 2>/dev/null)) ===" >> "$LOG_FILE"

BEFORE=$(claude --version 2>/dev/null | awk '{print $1}')
LATEST=$($NPM_BIN view @anthropic-ai/claude-code version 2>/dev/null)

sudo "$NPM_BIN" install -g @anthropic-ai/claude-code@latest >> "$LOG_FILE" 2>&1
NPM_RC=$?

# postinstall がブロックされていても native バイナリを確実に差し替える（冪等）
if [ -f "$PKG_DIR/install.cjs" ]; then
  sudo "$NODE_BIN" "$PKG_DIR/install.cjs" >> "$LOG_FILE" 2>&1 || \
    echo "WARNING: postinstall (install.cjs) failed." >> "$LOG_FILE"
fi

AFTER=$(claude --version 2>/dev/null | awk '{print $1}')

if [ "$NPM_RC" -ne 0 ]; then
  echo "ERROR: npm install failed (exit $NPM_RC). Still on ${AFTER:-unknown} (latest is ${LATEST:-unknown})." >> "$LOG_FILE"
elif [ -n "$LATEST" ] && [ "$AFTER" != "$LATEST" ]; then
  # npm は成功したのに実体が最新でない = モデルエイリアスが旧世代へ格下げされる状態。
  echo "ERROR: npm reported success but active CLI $AFTER != latest $LATEST (aliases may resolve to legacy models)." >> "$LOG_FILE"
elif [ "$BEFORE" != "$AFTER" ]; then
  echo "Updated: $BEFORE -> $AFTER" >> "$LOG_FILE"
  echo "Restarting pocket-claude.service..." >> "$LOG_FILE"
  sudo systemctl restart pocket-claude
  echo "Restarted." >> "$LOG_FILE"
else
  echo "Already up-to-date: $AFTER" >> "$LOG_FILE"
fi

echo "=== Done ===" >> "$LOG_FILE"
