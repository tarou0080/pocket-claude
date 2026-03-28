# 変更履歴

[English](CHANGELOG.md) | 日本語

pocket-claude の主要な変更をここに記録します。

## [1.0.0] - 2026-03-21

初回公開リリース。

### 機能

#### コア
- `claude -p` ワンショットモードによる Claude Code CLI Web インターフェース
- SSE ストリーミング（自動再接続・出力バッファリング対応）
- タブベースの会話管理（localStorage のみ、サーバー側タブ管理なし）
- セッション永続化：履歴ブラウザから過去の会話を再開可能
- キュー方式の実行（タブごとに Claude プロセス1つ）
- SIGTERM 時のグレースフルシャットダウン

#### UI
- ブラウザベース UI（デスクトップ・モバイルのブラウザで動作）
- ダークテーマ（Blue Dark / Purple Dark）：CSS 変数 + themes.js で管理
- リアルタイムコンテキスト使用量バー（トークン %）
- Markdown レンダリング（marked.js）
- 新規タブ作成時に現在のタブのモデル・Effort・Thinking 設定を継承
- 言語切り替え：日本語 / 英語（localStorage に永続化）

#### 設定
- モデル選択：Sonnet 4.6、Opus 4.6、Haiku 4.5
- 思考レベル（Effort）：Low / Medium / High（Opus のみ Max あり）
- 内部推論（Thinking）：指定なし / オン / オフ（3ステートセグメントコントロール）
- フォントサイズとコードフォントサイズを個別に設定可能

#### ツール表示
- VS Code スタイルのツール展開表示：Bash は IN/OUT 形式、Edit は赤/緑の diff 形式
- AskUserQuestion の自動展開（質問・選択肢をリスト表示）
- エラー結果（`is_error: true`）を赤字表示

#### レート制限対応
- レート制限メッセージを赤字で表示
- 自動再開スケジューラ：時刻を設定すると pocket-claude がサーバーサイドで自動再送信（ブラウザ不要）
- スケジュールを `schedules.json` に永続化（サーバー再起動後も復元）

#### 予約投稿
- 指定日時にプロンプトを自動送信
- 出力パネルから編集・キャンセル可能
- `scheduled-posts.json` に永続化（サーバー再起動後も復元）

#### プロジェクト管理
- ブラウザ UI からプロジェクトディレクトリの追加・削除
- `projects.json` による永続設定
- `ADDITIONAL_ALLOWED_DIRS` 環境変数のサポート

#### 信頼性
- systemd 検知バッジ：systemd 管理外で起動した場合に警告を表示
- 起動時自動修復：前回クラッシュ時の未完了ログエントリを自動でクローズ
- `/api/health` エンドポイント（`systemd_managed` フラグを返す）
