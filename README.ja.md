# pocket-claude

**ブラウザから Claude Code を使えるようにします。**

pocket-claude は Claude Code CLI の Web インターフェースです。Claude Code を使っている方は、これをインストールすることでターミナルではなくブラウザベースの UI で操作できるようになります。

[English](README.md) | 日本語

## 💡 何ができるの？

Claude Code CLI を Web アプリに変換：
- **URL にアクセス**して、クリーンな Web インターフェースで Claude Code とチャット
- **スマートフォンやタブレットを使用** - 特に iOS Safari に最適化
- **どこからでもアクセス** - VPN、SSH トンネル、ローカルネットワーク経由
- **会話を整理** - タブベースのセッション管理
- **CLAUDE.md に対応** - プロジェクトの CLAUDE.md 設定を尊重

**すべての Claude Code ユーザーが使えます：**
- ローカルの PC - ターミナルの代わりにブラウザを使用
- 自宅サーバー - 移動中もスマホから Claude Code にアクセス
- クラウド VM - SSH + ターミナルより Web UI が好み
- Claude Code CLI が動く場所ならどこでも - ブラウザインターフェースを追加

**サーバー不要** - Claude Code がインストールされている場所で `npm install` して実行するだけ。

## ✨ 特徴

- 📱 **モバイルファースト設計** - iPhone Safari でテスト・最適化済み
- 🪶 **超軽量** - バニラ HTML/CSS/JS、ビルド不要
- 🗂️ **タブベース会話管理** - 複数の会話を同時に管理
- 📊 **コンテキスト使用量追跡** - リアルタイムトークン使用量可視化
- 📜 **統合履歴ブラウザ** - 過去のセッションを閲覧・再開
- 🔄 **SSE ストリーミング** - 自動再接続付きリアルタイム出力
- 🎨 **Markdown レンダリング** - クリーンで読みやすい出力

## 🎯 なぜ pocket-claude？

既存のソリューションは高機能ですが、依存が重いです。pocket-claude は異なるアプローチを取っています：

- **React/Vite/TypeScript 不要** - Express + バニラ JS のみ
- **セルフホスト特化** - 自宅サーバー環境向け設計
- **iOS 最適化** - visualViewport API で完璧なキーボード処理
- **最小限の依存** - Markdown レンダリングに marked.js のみ使用

## 🚀 クイックスタート

**最もシンプルなインストール（Claude Code で導入可能）：**

```bash
git clone https://github.com/tarou0080/pocket-claude.git
cd pocket-claude
npm install
npm start
```

`http://localhost:3333` でアクセス可能

これだけです！設定なしでそのまま動きます。

### オプション設定

**カスタムプロジェクトディレクトリを追加** (`projects.json`):
```json
{
  "home": "/home/user",
  "work": "/home/user/workspace",
  "myproject": "/path/to/project"
}
```

**設定を変更** (`config.json`):
```json
{
  "port": 3333,
  "permissionMode": "ask",
  "sessionDir": "./sessions",
  "logsDir": "./logs"
}
```

サンプルからコピー:
```bash
cp config.example.json config.json
cp projects.example.json projects.json
```

### 前提条件

- Node.js v18+
- [Claude Code CLI](https://code.claude.com/) がインストール・認証済み

## ⚙️ 設定オプション

### パーミッションモード

- `"ask"` (デフォルト) - ツール実行前に確認
- `"bypassPermissions"` - 全ツール実行を自動承認

⚠️ **セキュリティ警告**: `bypassPermissions` モードは Claude Code が確認なしでツールを実行できます。VPN + 2FA などの適切な認証がある信頼できる環境でのみ使用してください。

### プロジェクト

`projects.json` で作業ディレクトリを定義します。各プロジェクトは新しい会話作成時に選択可能なオプションとして表示されます。

## 🏗️ アーキテクチャ

```
[モバイルブラウザ]
    ↓ HTTP
[pocket-claude (Node.js/Express)]
    ↓ spawn
[claude CLI (headless mode)]
    ↓
[プロジェクトディレクトリ]
```

- **フロントエンド**: バニラ JavaScript の単一 HTML ファイル
- **バックエンド**: `claude -p` プロセスを spawn する Express サーバー
- **通信**: ストリーミング用 Server-Sent Events (SSE)
- **セッション管理**: 永続化用 JSON ファイル

## 🔒 セキュリティ上の考慮事項

pocket-claude は **ローカル/信頼できるネットワーク用** に設計されています：

- **ローカルネットワークのみ** - デフォルトで localhost または LAN で動作
- **パーミッションモード** - より安全な操作のため `permissionMode: "ask"` を使用
- **信頼できる環境** - 公開インターネットへの露出向けではありません

リモートアクセスには、サーバーを直接公開するのではなく、VPN または SSH トンネルの使用を検討してください。

### 環境変数

追加のディレクトリへのアクセスを許可するには、`ADDITIONAL_ALLOWED_DIRS` を設定します（コロン区切り）：

```bash
export ADDITIONAL_ALLOWED_DIRS="/srv/shell:/opt/projects"
npm start
```

## 🚫 スコープ外

pocket-claude は意図的にミニマルです。以下の機能は**計画されていません**：

- **ファイルエディタ** - VSCode またはお好みのエディタを使用してください
- **ターミナルエミュレータ** - SSH またはネイティブターミナルを使用してください
- **マルチユーザーサポート** - シングルユーザー、信頼できる環境向け設計
- **データベース統合** - セッションデータはシンプルな JSON ファイルに保存
- **認証システム** - ネットワークレベルのセキュリティ（VPN、ファイアウォール）に依存

これらの機能が必要な場合は以下を検討してください：
- [claudecodeui](https://github.com/siteboon/claudecodeui) - フル機能 Web IDE
- [claude-relay](https://github.com/chadbyte/claude-relay) - より高度な機能

## 🔧 トラブルシューティング

### Claude CLI が見つからない
Claude Code CLI がインストールされ、PATH に含まれていることを確認してください：
```bash
which claude
```

### パーミッション拒否エラー
pocket-claude を実行しているユーザーがプロジェクトディレクトリを読み取り可能か確認してください。

### SSE 接続の問題
nginx を使用している場合、バッファリングが無効になっていることを確認してください：
```nginx
proxy_buffering off;
proxy_cache off;
```

### ポートが既に使用中
`config.json` でポートを変更するか、`PORT` 環境変数を設定してください：
```bash
PORT=3334 npm start
```

## 🎨 背景

このプロジェクトは、自宅サーバー環境での個人的なツールとして始まりました。以下の課題を解決するために作られました：

- ターミナルでの日本語入力の問題（特に AquaSKK との相性）
- iPhone Safari からの Claude Code 快適な利用
- React/Vite などの重い依存関係を避けたシンプルな実装

## 📝 ライセンス

MIT License - 詳細は [LICENSE](LICENSE) ファイルを参照してください。

## 🙏 謝辞

- [marked.js](https://github.com/markedjs/marked) - Markdown パーサー (MIT)
- [Express](https://expressjs.com/) - Web フレームワーク (MIT)

以下のプロジェクトからインスピレーションを得ました：
- [claude-code-webui](https://github.com/sugyan/claude-code-webui) by sugyan
- [claudecodeui](https://github.com/siteboon/claudecodeui) by siteboon
- [claude-relay](https://github.com/chadbyte/claude-relay) by chadbyte

## 🤝 コントリビューション

コントリビューション歓迎！お気軽に Pull Request を送信してください。

## 📧 サポート

- Issues: [GitHub Issues](https://github.com/tarou0080/pocket-claude/issues)
- Discussions: [GitHub Discussions](https://github.com/tarou0080/pocket-claude/discussions)
