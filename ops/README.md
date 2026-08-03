# ops/

pocket-claude 本体ではなく、**Claude CLI の運用に付随するスクリプト**を置く。
どちらもリポジトリから自動配置されない。更新したら実機へ手動コピーすること。

| ファイル | 実機の配置先 | 役割 |
|---|---|---|
| `update-claude-cli.sh` | Proxmox `/usr/local/bin/` | Claude CLI の自動更新（johnadmin crontab・毎日3:00） |
| `claude-keepalive/keepalive.sh` | podmanVM `/srv/shell/claude-keepalive/` | 週制限のリセット時刻を固定するため、毎週金曜5:05に軽い実績を作る |

`keepalive.log` は実行ログなのでgit管理しない。
