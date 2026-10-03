#!/bin/bash
# Claude Code CLI 自動アップデートスクリプト
# cron: 毎日 4:30 に実行（サービス実行ユーザーのcrontab）
#
# 注: グローバル(/usr/local/lib)はroot所有のため一般ユーザーの
#   `npm install -g` は EACCES で失敗する → sudo を付与している。
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
# 2026-09-24 修正: claude も絶対パスで呼ぶ。cron の PATH(/usr/bin:/bin) には
#   /usr/local/bin が無く、`claude --version` が command not found で空になっていた。
#   日次化(7/25)以降の cron 実行は全回が「active CLI  != latest」の誤 ERROR で、
#   BEFORE=AFTER=空のため更新後の pocket-claude 再起動も一度も走っていなかった。
#   版が読めないことは「最新でない」と別の ERROR として出す。
# 2026-09-28 修正: 再起動は「ターン実行中の会話が無いとき」だけ行う。
#   再起動は実行中のターンを捨てる（pocket-claude の既知の注意点）。更新直後に実行中なら
#   印ファイルを残して見送り、翌日以降の実行で空いていれば再起動する（CLI は既に新しいので
#   版比較では再起動の必要を拾えない＝印で持ち越す）。見送りが3日続いたら固まったターンと
#   みなして再起動する。印より後に別の理由で再起動済みなら印を消すだけ。
#   時刻も 3:00 → 4:30。週制限のリセットが 3:00 JST で、明けの自動再開(3:03〜)と重なっていた。

NODE_BIN=/usr/local/bin/node
NPM_BIN=/usr/local/bin/npm
CLAUDE_BIN=/usr/local/bin/claude
PKG_DIR=/usr/local/lib/node_modules/@anthropic-ai/claude-code
POCKET_URL="${POCKET_URL:-http://localhost:3333}"
PENDING_FILE="${HOME}/.local/state/pocket-claude/cli-restart-pending"
MAX_DEFER_SEC=$((3 * 86400))

LOG_DIR="${HOME}/logs"
LOG_FILE="$LOG_DIR/claude-cli-update.log"

mkdir -p "$LOG_DIR"

echo "=== $(date '+%Y-%m-%d %H:%M:%S') Claude CLI update started (node $($NODE_BIN -v 2>/dev/null)) ===" >> "$LOG_FILE"

BEFORE=$($CLAUDE_BIN --version 2>/dev/null | awk '{print $1}')
LATEST=$($NPM_BIN view @anthropic-ai/claude-code version 2>/dev/null)

sudo "$NPM_BIN" install -g @anthropic-ai/claude-code@latest >> "$LOG_FILE" 2>&1
NPM_RC=$?

# postinstall がブロックされていても native バイナリを確実に差し替える（冪等）
if [ -f "$PKG_DIR/install.cjs" ]; then
  sudo "$NODE_BIN" "$PKG_DIR/install.cjs" >> "$LOG_FILE" 2>&1 || \
    echo "WARNING: postinstall (install.cjs) failed." >> "$LOG_FILE"
fi

AFTER=$($CLAUDE_BIN --version 2>/dev/null | awk '{print $1}')

if [ "$NPM_RC" -ne 0 ]; then
  echo "ERROR: npm install failed (exit $NPM_RC). Still on ${AFTER:-unknown} (latest is ${LATEST:-unknown})." >> "$LOG_FILE"
elif [ -z "$AFTER" ]; then
  echo "ERROR: cannot read active CLI version ($CLAUDE_BIN --version returned nothing)." >> "$LOG_FILE"
elif [ -n "$LATEST" ] && [ "$AFTER" != "$LATEST" ]; then
  # npm は成功したのに実体が最新でない = モデルエイリアスが旧世代へ格下げされる状態。
  echo "ERROR: npm reported success but active CLI $AFTER != latest $LATEST (aliases may resolve to legacy models)." >> "$LOG_FILE"
elif [ "$BEFORE" != "$AFTER" ]; then
  echo "Updated: $BEFORE -> $AFTER" >> "$LOG_FILE"
  mkdir -p "$(dirname "$PENDING_FILE")"
  [ -f "$PENDING_FILE" ] || echo "$AFTER" > "$PENDING_FILE"
else
  echo "Already up-to-date: $AFTER" >> "$LOG_FILE"
fi

# 新しい CLI を常駐プロセスへ反映する再起動（今回の更新分＋前回までに見送った分）
if [ -f "$PENDING_FILE" ]; then
  PENDING_SINCE=$(stat -c %Y "$PENDING_FILE")
  STARTED=$(date -d "$(systemctl show -p ActiveEnterTimestamp --value pocket-claude)" +%s 2>/dev/null || echo 0)
  RUNNING=$(curl -sf --max-time 5 "$POCKET_URL/api/busy" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).running)}catch{}})')
  AGE=$(( $(date +%s) - PENDING_SINCE ))
  if [ "$STARTED" -gt "$PENDING_SINCE" ]; then
    echo "pocket-claude already restarted since the update; nothing to do." >> "$LOG_FILE"
    rm -f "$PENDING_FILE"
  elif [ "$RUNNING" = "0" ] || [ "$AGE" -ge "$MAX_DEFER_SEC" ] || ! systemctl is-active -q pocket-claude; then
    [ "$RUNNING" = "0" ] || ! systemctl is-active -q pocket-claude || echo "WARNING: deferred for $((AGE / 86400)) days (running=${RUNNING:-unknown}); restarting anyway." >> "$LOG_FILE"
    echo "Restarting pocket-claude.service..." >> "$LOG_FILE"
    sudo systemctl restart pocket-claude
    echo "Restarted." >> "$LOG_FILE"
    rm -f "$PENDING_FILE"
  else
    # 実行中 or 状態が読めない（稼働中なのに応答が無い）→ 作業を捨てないよう見送る
    echo "Restart deferred: running=${RUNNING:-unknown} (pending since $(date -d "@$PENDING_SINCE" '+%F %T'))." >> "$LOG_FILE"
  fi
fi

echo "=== Done ===" >> "$LOG_FILE"
