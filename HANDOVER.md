# pocket-claude 引継ぎ書

**最終更新**: 2026-02-20
**対象**: 次のClaude Code セッション

---

## プロジェクト概要

iPhoneからClaude Codeを操作するための超軽量WebUI。`claude -p` (headless) をラップし、SSEでストリーミング表示。

**リポジトリ**: `/home/johnadmin/pocket-claude/` (GitLab)
**稼働環境**: Proxmox (johnadmin), systemd管理
**アクセス**: `https://claude.karin.pgw.jp` (VPN + Authelia認証)

---

## 技術スタック

- **Backend**: Node.js + Express
- **Frontend**: 素のHTML/CSS/JS (marked.js のみ)
- **通信**: SSE (Server-Sent Events)
- **プロセス管理**: `child_process.spawn` で claude CLI 起動

---

## ディレクトリ構成

```
/home/johnadmin/pocket-claude/
├── server.js                    # Express サーバー本体
├── public/index.html            # フロントエンド UI
├── config.json                  # サーバー設定 (gitignore)
├── config.example.json          # 設定サンプル
├── projects.json                # プロジェクト一覧 (gitignore)
├── projects.example.json        # プロジェクトサンプル
├── sessions/                    # セッションID保存 (gitignore)
├── logs/                        # タブごとの出力バッファ (gitignore)
├── tabs.json                    # タブ一覧 (gitignore)
├── docs/                        # ドキュメント
│   └── oss-release-plan.md      # OSS公開計画
├── README.md                    # 英語README (OSS公開用)
├── LICENSE                      # MIT License
└── .gitignore
```

---

## 設定ファイル

### config.json (本番環境)

```json
{
  "port": 3333,
  "permissionMode": "bypassPermissions",
  "sessionDir": "./sessions",
  "logsDir": "./logs",
  "uiLang": "ja"
}
```

**重要**: 既存環境は `bypassPermissions` で動作中。公開版デフォルトは `"ask"`。

### projects.json (本番環境)

```json
{
  "home": "/home/johnadmin",
  "reports": "/home/johnadmin/reports"
}
```

---

## systemd サービス

**ファイル**: `/etc/systemd/system/pocket-claude.service`
**実行ユーザー**: johnadmin
**ポート**: 3333
**自動起動**: 有効

```bash
sudo systemctl status pocket-claude
sudo systemctl restart pocket-claude
sudo journalctl -u pocket-claude -f
```

---

## nginx 設定 (Nicky: 10.0.0.101)

**ファイル**: `/etc/nginx/conf.d/claude.karin.pgw.jp.conf`
**upstream**: `http://10.0.0.10:3333` (Proxmox)
**認証**: Authelia
**SSE対応**: `/api/stream` は `proxy_buffering off`

---

## 主要機能

### v3 (現在)

- タブ単位の会話管理
- プロジェクト切り替え (home/reports)
- モデル選択 (Sonnet 4.6 / Opus 4.6 / Haiku 4.5)
- 履歴ブラウザ (`~/.claude/projects/` 読み取り)
- 履歴復元 (過去メッセージ表示 + 新規タブで再開)
- コンテキスト使用率表示 (200K トークン上限)
- マークダウンレンダリング (marked.js)
- iOS Safari 最適化 (visualViewport API)
- 送信キュー (実行中は次のプロンプトをキュー)
- 中断ボタン (実行中プロセスをkill)
- セッションリセット

---

## 最近の変更 (2026-02-20)

### OSS公開準備

1. **UI国際化**
   - 日本語→英語 (Send, Pause, Loading...など)
   - `lang` 属性を `config.uiLang` で動的設定可能

2. **個人情報削除**
   - `/home/johnadmin` → `process.env.HOME`
   - ハードコードパスを環境変数化

3. **設定外出し**
   - `config.example.json`, `projects.example.json` 追加
   - `config.json`, `projects.json` を `.gitignore`

4. **セキュリティ**
   - `permissionMode` のデフォルトを `"ask"` に変更
   - README に警告文追加

5. **ドキュメント**
   - 英語 README 作成
   - MIT LICENSE 追加
   - nginx/Docker セクション削除 (スコープ外)

---

## 既知の問題・制限

1. **同時実行制限**
   - タブごとに1プロセスのみ
   - 複数タブ同時実行は可能だが、同一タブ内では順次実行

2. **iOS スリープ**
   - SSE接続が切れるが、自動再接続
   - バッファにより切断中の出力も復元可能

3. **セッション永続性**
   - `~/.claude/` 以下にClaude CLIが管理
   - セッションIDさえあれば何日後でも再開可能

---

## トラブルシューティング

### プロンプト送信しても無応答

**原因**: `--verbose` 抜け、または stdin ハング
**対処**: server.js の claude 起動オプション確認
- `--output-format stream-json` には `--verbose` 必須
- `stdio: ['ignore', 'pipe', 'pipe']` 設定済み

### SSE接続が切れる

**原因**: nginx タイムアウト、または iOS スリープ
**対処**:
- nginx: `proxy_read_timeout 600s` 設定済み
- iOS: EventSource 自動再接続で復旧

### コンテキスト使用率が表示されない

**原因**: `stream-json` に `budget` フィールドがない
**対処**: Claude CLI が最新版か確認 (`claude --version`)

---

## 次の作業 (TODO)

### 未実装・検討中

- [ ] スクリーンショット撮影 (iPhone実機)
- [ ] 日本語 README.ja.md 作成
- [ ] Qiita 記事執筆
- [ ] GitHub public リポジトリ作成

### デプロイ前確認

- [ ] 既存環境で動作確認 (`uiLang: "ja"` 設定)
- [ ] config.json に `permissionMode: "bypassPermissions"` 追記

---

## 参考ドキュメント

- `/home/johnadmin/reports/svc_pocket-claude.md` - 詳細設計・実装レポート
- `docs/oss-release-plan.md` - OSS公開計画・市場調査
- `README.md` - 公開用README (英語)

---

## 競合プロジェクト (参考)

- [claudecodeui](https://github.com/siteboon/claudecodeui) - 6.3k stars, 高機能
- [claude-code-webui](https://github.com/sugyan/claude-code-webui) - 923 stars, シンプル (日本製)
- [claude-relay](https://github.com/chadbyte/claude-relay) - 94 stars, PWA対応

**差別化**: 超軽量 (React/Vite不要)、自宅サーバー特化、iOS最適化

---

## 開発ルール

1. **既存動作を壊さない**
   - 本番環境 (`config.json`, `projects.json`) は手動設定
   - デフォルト値は安全側に倒す

2. **スコープ管理**
   - pocket-claude 本体のみ
   - nginx/Authelia/Docker は外部ドキュメント化

3. **ドキュメント更新**
   - 大きな変更時は `HANDOVER.md` を更新
   - OSS公開計画は `docs/oss-release-plan.md`
   - 運用詳細は `/home/johnadmin/reports/svc_pocket-claude.md`

---

## 質問があれば

- `README.md` - 使い方・設定
- `docs/oss-release-plan.md` - 市場調査・公開戦略
- `/home/johnadmin/reports/svc_pocket-claude.md` - 詳細仕様・履歴
- この `HANDOVER.md` - 引継ぎ事項

次のClaude、よろしく！
