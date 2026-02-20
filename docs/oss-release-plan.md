<!-- tags: pocket-claude, オープンソース, 公開計画, GitHub, Qiita, 市場調査, 競合分析, 国際化, セキュリティ -->
# pocket-claude オープンソース公開計画

**作成日**: 2026-02-20
**目的**: pocket-claudeのGitHub公開・Qiita記事投稿に向けた市場調査と改善計画

---

## 市場調査結果

### 1. 公式の動向

**Anthropic公式（2025年10月）:**
- Claude Code on the Web/iOS を既にリリース済み
- 管理されたサンドボックスで実行、claude.ai/code でアクセス可能
- iOS アプリでもプレビュー利用可能

### 2. 競合オープンソースプロジェクト

| プロジェクト | GitHub Star | 特徴 | 技術スタック | 最終更新 |
|------------|------------|------|--------------|---------|
| [claudecodeui (CloudCLI)](https://github.com/siteboon/claudecodeui) | **6.3k** | ファイルエディタ・Git統合・Cursor CLI対応 | React 18, Vite, Express, WebSocket, Tailwind | 2026-02 |
| [claude-code-webui (sugyan)](https://github.com/sugyan/claude-code-webui) | **923** | 日本製、権限モード切り替え、シンプル | Deno/Node.js, React, Vite, TypeScript | アクティブ |
| [claude-relay (chadbyte)](https://github.com/chadbyte/claude-relay) | **94** | プッシュ通知、PWA、ファイルブラウザ | Node.js 18+, WebSocket, Claude Agent SDK | アクティブ |
| [Happy (happy-coder)](http://happy.engineering/) | - | 音声制御、E2E暗号化、マルチプラットフォーム | Next.js, React, Node.js CLI | 2026 |

**参考文献:**
- [GitHub - siteboon/claudecodeui](https://github.com/siteboon/claudecodeui)
- [GitHub - sugyan/claude-code-webui](https://github.com/sugyan/claude-code-webui)
- [GitHub - chadbyte/claude-relay](https://github.com/chadbyte/claude-relay)
- [Happy - Claude Code Mobile Client](http://happy.engineering/)
- [Anthropic's Claude Code Comes to Web and Mobile - The New Stack](https://thenewstack.io/anthropics-claude-code-comes-to-web-and-mobile/)

### 3. 日本語コミュニティの状況

**Qiita記事の傾向（2026年）:**
- sugyan氏の[claude-code-webui開発記事](https://memo.sugyan.com/entry/2025/06/18/173000)（2025-06-18）
  - 動機: ターミナルでの日本語入力問題（AquaSKK との相性）
  - 実装はすべてClaude Codeに任せた開発プロセスが特徴
- GitHub連携ワークフローの記事（getty104氏）
- Claude Code公式ドキュメントの日本語化
- 日本語入力拡張・翻訳機能の記事

**市場ギャップ:**
- 「自宅サーバー・Proxmox特化」の記事はほぼなし
- 「超軽量実装（React/Vite不要）」のアプローチは見当たらず
- **Qiita需要は確実に存在**

---

## pocket-claudeの差別化ポイント

### 独自の価値提案

| 要素 | pocket-claude | 競合プロジェクト |
|------|--------------|----------------|
| **依存性** | 素のHTML/CSS/JS + Express（marked.jsのみ） | React + Vite + TypeScript + 複数ライブラリ |
| **ターゲット** | 自宅サーバー・Proxmox環境 | 汎用・クラウド環境 |
| **設計思想** | 極限のシンプルさ・特定環境最適化 | 高機能・汎用性 |
| **認証** | VPN + Authelia 2段階 | 主に認証なしまたは簡易認証 |
| **履歴管理** | `~/.claude/projects/` 直接読み取り | 独自DB・セッション管理 |
| **UI特徴** | タブ会話単位、コンテキスト使用率表示 | プロジェクト単位、高機能エディタ |

### 技術的優位性

1. **超軽量**: ビルドプロセス不要、node_modules最小限
2. **Proxmox統合**: システムCLAUDE.md自動適用、claude-logsパイプライン連携
3. **iOS最適化**: visualViewport API対応、ソフトウェアキーボード考慮
4. **履歴ブラウザ**: VSCode/pocket-claude両方の履歴を統合表示
5. **プロジェクト即切り替え**: `/home/johnadmin` と `reports` のワンクリック切り替え

**結論: ニッチだが明確な価値あり**
- 「高機能・汎用」市場は飽和
- 「超軽量・特定環境最適化」のポジションは空白

---

## 公開に向けた改善計画

### フェーズ1: 国際化とクリーンアップ（必須）

#### 1.1 UI日本語削除

**対象ファイル**: `public/index.html`

**変更箇所:**
```javascript
// Before
placeholder="プロンプトを入力..."
<button>送信</button>
<button>■ 中断</button>

// After
placeholder="Enter prompt..."
<button>📤</button>  // または "Send"
<button>⏹</button>   // または "Stop"
```

**その他の日本語UI要素:**
- ヘッダーのステータステキスト（接続中 → Connected）
- エラーメッセージ（英語化）
- プレースホルダー全般

**方針:**
- **アイコン優先**: 絵文字・シンボルで直感的に
- **英語併記**: 必要に応じてツールチップ
- **多言語化準備**: 将来的にi18n対応可能な構造

#### 1.2 設定ファイル外出し

**追加ファイル:**
```
/home/johnadmin/pocket-claude/
├── config.example.json    ← サンプル設定（gitに含める）
├── config.json            ← 実際の設定（gitignore）
└── .env.example           ← 環境変数サンプル
```

**config.example.json:**
```json
{
  "projects": {
    "home": "/path/to/project1",
    "work": "/path/to/project2"
  },
  "port": 3333,
  "permissionMode": "ask",  // ask | bypassPermissions
  "sessionDir": "./sessions",
  "logsDir": "./logs"
}
```

**server.js修正:**
```javascript
const config = require('./config.json')
// デフォルト値とマージ
```

#### 1.3 個人情報削除

**削除対象:**
- ドメイン: `karin.pgw.jp` → `example.com`
- IPアドレス: `10.0.0.x` → `192.168.1.x`
- ユーザー名: `johnadmin` → `user` または環境変数 `$USER`
- パス: `/home/johnadmin/` → `/home/$USER/` または相対パス

**対象ファイル:**
- `README.md`（作成予定）
- `server.js`（ハードコード削除）
- `docs/nginx.example.conf`（サンプル化）

### フェーズ2: セキュリティ強化

#### 2.1 permissionMode のオプション化

**現状の問題:**
```javascript
--permission-mode bypassPermissions  // 危険（公開不可）
```

**改善策:**
```javascript
// config.json
{
  "permissionMode": "ask"  // デフォルトを安全側に
}

// server.js
const permissionArg = config.permissionMode === 'bypassPermissions'
  ? '--permission-mode bypassPermissions'
  : '';
```

**README.mdでの警告:**
```markdown
## ⚠️ Security Warning

`bypassPermissions` mode allows Claude Code to execute tools without confirmation.
Only use this mode in trusted environments with proper authentication (VPN + 2FA).

Default: `"permissionMode": "ask"`
```

#### 2.2 認証レイヤーのドキュメント化

**docs/security.md** 新規作成:
- VPN設定例（オプション）
- Authelia統合例（オプション）
- nginx基本認証の代替案
- ローカル開発時の注意点

**推奨構成:**
```
開発環境: localhost:3333（認証なし）
本番環境: VPN + 認証プロキシ（nginx + Authelia/OAuth2 Proxy）
```

### フェーズ3: ドキュメント整備

#### 3.1 README構成（英語・日本語）

**README.md（英語版）:**
```markdown
# pocket-claude

Lightweight Web UI for Claude Code, optimized for mobile (iOS Safari).

## Features
- 📱 Mobile-first design (tested on iPhone Safari)
- 🪶 Ultra-lightweight (vanilla HTML/CSS/JS, no build step)
- 🗂️ Tab-based conversation management
- 📊 Context usage visualization (token limit tracking)
- 📜 Integrated history browser (reads ~/.claude/projects/)
- 🔄 SSE streaming with auto-reconnect
- 🎨 Markdown rendering (using marked.js)

## Screenshots
[スクリーンショット追加予定]

## Quick Start

### Prerequisites
- Node.js v18+
- Claude Code CLI installed and authenticated

### Installation
[詳細手順]

### Usage
[起動方法・アクセス方法]

## Architecture
[簡潔な図]

## Configuration
[config.json の説明]

## Security Considerations
[セキュリティ警告]

## License
MIT

## Acknowledgments
Inspired by [other projects]
```

**README.ja.md（日本語版）:**
- 日本語での詳細説明
- Proxmox/自宅サーバー環境での利用例
- AquaSKK問題など日本語特有の背景

#### 3.2 アーキテクチャ図

**シンプル版（README用）:**
```
[Mobile Browser]
    ↓ HTTPS
[nginx (optional)]
    ↓
[pocket-claude (Node.js)]
    ↓ spawn
[claude CLI (headless)]
    ↓
[Your Project Directory]
```

**詳細版（docs/architecture.md用）:**
- SSE接続フロー
- セッション管理ロジック
- ログバッファリング機構

#### 3.3 スクリーンショット

**必須:**
1. iPhoneでの動作画面（タブ切り替え）
2. プロンプト入力〜応答のストリーミング
3. 履歴ブラウザUI
4. コンテキスト使用率表示

**撮影方法:**
- iPhone実機でスクリーンショット
- 個人情報（ドメイン・プロジェクト名）をマスク

### フェーズ4: デプロイ簡素化

#### 4.1 Docker化

**Dockerfile:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3333
CMD ["node", "server.js"]
```

**docker-compose.yml:**
```yaml
version: '3.8'
services:
  pocket-claude:
    build: .
    ports:
      - "3333:3333"
    volumes:
      - ./config.json:/app/config.json:ro
      - ./sessions:/app/sessions
      - ./logs:/app/logs
      - ~/.claude:/root/.claude:ro
    environment:
      - NODE_ENV=production
```

#### 4.2 systemdテンプレート

**docs/pocket-claude.service.example:**
```ini
[Unit]
Description=pocket-claude WebUI Server
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=/path/to/pocket-claude
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=PORT=3333
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### フェーズ5: ライセンスとクレジット

#### 5.1 ライセンス選定

**推奨: MIT License**
- 競合プロジェクト（sugyan, chadbyte）と同様
- 商用利用・改変・再配布すべて許可
- シンプルで広く受け入れられている

**LICENSE ファイル:**
```
MIT License

Copyright (c) 2026 [Your Name]

Permission is hereby granted...
```

#### 5.2 Third-party Acknowledgments

**README.md に追記:**
```markdown
## Dependencies
- [marked.js](https://github.com/markedjs/marked) - Markdown parser (MIT)
- [Express](https://expressjs.com/) - Web framework (MIT)

## Inspired By
- [claude-code-webui](https://github.com/sugyan/claude-code-webui) by sugyan
- [claude-relay](https://github.com/chadbyte/claude-relay) by chadbyte
```

---

## Qiita記事構成案

### タイトル案

1. 「iPhoneからClaude Codeを快適に使う超軽量WebUIを作った」
2. 「React不要！素のJSで作るClaude Code モバイルUI」
3. 「自宅ProxmoxでClaude Codeをスマホから叩く話」

### 記事構成

```markdown
## はじめに
- Claude Code on the Webは公式にあるが、自宅サーバー環境で動かしたい
- ターミナルの日本語入力問題（AquaSKK）を解決したかった
- 既存OSSは高機能だが依存が重い

## 既存の選択肢と課題
- code-server: Claude Code拡張が動かない
- ttyd + tmux: iOS Safariで日本語IMEバグ
- 既存OSS（claudecodeui等）: React/Viteで重い

## pocket-claudeのアプローチ
- 素のHTML/CSS/JS（依存最小）
- SSE（Server-Sent Events）でストリーミング
- Proxmox直接稼働（VPN+Authelia）

## 実装のポイント
- `claude -p` のheadlessモード活用
- `stream-json` フォーマットのパース
- iOS Safari対応（visualViewport API）
- タブ単位の会話管理

## デモ
[スクリーンショット・GIF]

## ハマった点
- `--verbose` 必須（stream-jsonに必要）
- stdin のハング対策（`stdio: ['ignore', ...]`）
- SSEのバッファリング無効化（nginx設定）

## 今後の展望
- Docker化
- 多言語対応
- プッシュ通知

## まとめ
- 軽量実装でも十分実用的
- 自宅サーバー環境との相性◎

## リポジトリ
[GitHub URL]
```

### 想定読者

- Claude Codeユーザー（特にiPhone利用者）
- 自宅サーバー運用者（Proxmox/Docker）
- 軽量実装・依存最小を好むエンジニア

---

## 公開タイムライン

### Week 1: コード整備
- [ ] UI日本語削除・国際化
- [ ] 個人情報削除
- [ ] config.json外出し
- [ ] permissionMode修正

### Week 2: ドキュメント作成
- [ ] README.md（英語・日本語）
- [ ] LICENSE追加
- [ ] docs/以下の整備
- [ ] スクリーンショット撮影

### Week 3: テスト・調整
- [ ] ローカル環境での動作確認
- [ ] Docker動作確認
- [ ] セキュリティレビュー

### Week 4: 公開
- [ ] GitHubリポジトリ作成（public）
- [ ] 初回リリース（v1.0.0）
- [ ] Qiita記事投稿
- [ ] Hacker News / Reddit投稿（オプション）

---

## リスク管理

### 潜在的リスク

1. **セキュリティ問題の指摘**
   - 対策: デフォルトを安全側に、警告文を明記
   - bypassPermissions は「上級者向けオプション」として文書化

2. **既存OSSとの差別化不足**
   - 対策: 「超軽量・特定環境最適化」を明確に訴求
   - Proxmox/自宅サーバーユースケースを前面に

3. **メンテナンス負担**
   - 対策: スコープを絞る（ファイルエディタ等は追加しない）
   - 「シンプルさ」を維持することを優先

### 成功指標

- GitHub Star: 100+（6ヶ月以内）
- Qiita いいね: 50+（1ヶ月以内）
- Issue/PR: コミュニティからのフィードバック

---

## 参考リンク

### 競合プロジェクト
- [claudecodeui (CloudCLI)](https://github.com/siteboon/claudecodeui) - 6.3k stars
- [claude-code-webui (sugyan)](https://github.com/sugyan/claude-code-webui) - 923 stars
- [claude-relay (chadbyte)](https://github.com/chadbyte/claude-relay) - 94 stars
- [Happy (happy-coder)](http://happy.engineering/)

### 参考記事
- [Claude CodeをWebブラウザ上で操作するツールをClaude Codeで作っている - すぎゃーんメモ](https://memo.sugyan.com/entry/2025/06/18/173000)
- [Anthropic's Claude Code Comes to Web and Mobile - The New Stack](https://thenewstack.io/anthropics-claude-code-comes-to-web-and-mobile/)
- [Claude Code on the web | Claude Help Center](https://support.claude.com/en/articles/12618689-claude-code-on-the-web)

### 公式ドキュメント
- [Run Claude Code programmatically - Claude Code Docs](https://code.claude.com/docs/en/headless)
- [Streaming Messages - Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/streaming)

---

## 次のアクション

1. **承認待ち**: この計画でよいか確認
2. **実装開始**: フェーズ1から順次着手
3. **定期レビュー**: 各フェーズ完了時に進捗確認

**最終目標**: OSS公開を通じて、Claude Codeモバイル利用の知見を共有し、コミュニティに貢献する
