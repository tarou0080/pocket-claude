# ops/

pocket-claude 本体ではなく、**Claude CLI の運用に付随するスクリプト**を置く。
どちらもリポジトリから自動配置されない。更新したら実機へ手動コピーすること。

| ファイル | 実機の配置先 | 役割 |
|---|---|---|
| `update-claude-cli.sh` | ホストの `/usr/local/bin/` | Claude CLI の自動更新（サービス実行ユーザーのcrontab・毎日4:30）。更新後の再起動は `$POCKET_URL/api/busy`（既定 `http://localhost:3333`）が0のときだけ。特定アドレスで待ち受けているなら crontab 行で `POCKET_URL=http://<addr>:3333` を渡す |
| `claude-keepalive/keepalive.sh` | 任意のディレクトリ（cronから実行） | 週制限のリセット時刻を固定するため、毎週金曜5:05に軽い実績を作る |

`keepalive.log` は実行ログなのでgit管理しない。
