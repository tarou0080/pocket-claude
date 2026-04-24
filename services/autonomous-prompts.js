// 自律開発モード用のプロンプトテンプレート

/**
 * Worker用の標準指示プロンプト
 * @param {string} projectId - プロジェクトID
 * @param {string} workerSessionId - WorkerセッションID
 * @param {number} phase - Phase番号
 * @param {string} phaseName - Phase名
 * @param {string} objective - このPhaseの目的
 * @param {string} criteria - 完了条件
 * @returns {string} Workerへの指示プロンプト
 */
function generateWorkerPrompt(projectId, workerSessionId, phase, phaseName, objective, criteria) {
  return `【自律開発モード: Phase ${phase} - ${phaseName}】

あなたはWorkerとして、このPhaseのタスクを実行してください。

## プロジェクト情報

プロジェクトID: ${projectId}
WorkerセッションID: ${workerSessionId}
Phase: ${phase}
Phase名: ${phaseName}

## このPhaseの目的

${objective}

## 完了条件

${criteria}

## 作業手順

1. **planファイルを読む**
   autonomous-progress.jsonから「planFile」を確認し、/home/johnadmin/reports/<planFile>を読んでください。

2. **タスクを実行**
   上記の目的・完了条件に従ってタスクを実行してください。

3. **完了報告**
   タスクが完了したら、以下のNode.jsコードを実行してManagerに報告してください：

\`\`\`javascript
const http = require('http');

const postData = JSON.stringify({
  projectId: '${projectId}',
  workerSessionId: '${workerSessionId}',
  phase: ${phase},
  status: 'completed',
  summary: 'ここに完了サマリを記載',
  artifacts: ['作成したファイルのパス1', '作成したファイルのパス2']
});

const options = {
  hostname: 'localhost',
  port: 3333,
  path: '/api/autonomous/worker-complete',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  res.on('data', (d) => process.stdout.write(d));
});

req.on('error', (e) => console.error(e));
req.write(postData);
req.end();
\`\`\`

または、Bashツールで以下を実行：

\`\`\`bash
curl -X POST http://localhost:3333/api/autonomous/worker-complete \\
  -H "Content-Type: application/json" \\
  -d '{"projectId":"${projectId}","workerSessionId":"${workerSessionId}","phase":${phase},"status":"completed","summary":"完了サマリ","artifacts":["ファイルパス"]}'
\`\`\`

## 注意事項

- planファイルには過去のPhase結果も記載されています。参照して矛盾のないように作業してください。
- 完了報告は必ず実行してください（報告がないとManagerが次Phaseに進めません）
- エラーが発生した場合は、status: 'error' で報告してください。
`
}

/**
 * Manager用のPhase完了チェックポイントプロンプト
 * @param {number} phase - 完了したPhase番号
 * @param {string} summary - Phase完了サマリ
 * @param {string} nextPhaseName - 次のPhase名
 * @returns {string} チェックポイントプロンプト
 */
function generateCheckpointPrompt(phase, summary, nextPhaseName) {
  return `
━━━━━━━━━━━━━━━━━━━━━━━━
✅ Phase ${phase} 完了
━━━━━━━━━━━━━━━━━━━━━━━━

【完了サマリ】
${summary}

【次のPhase】
Phase ${phase + 1}: ${nextPhaseName}

続けますか？

[続ける] [修正が必要] [一旦停止]
━━━━━━━━━━━━━━━━━━━━━━━━
`
}

/**
 * Manager用のプロジェクト開始プロンプト
 * @param {string} goal - プロジェクトのゴール
 * @returns {string} 要件定義プロンプト
 */
function generateRequirementsPrompt(goal) {
  return `自律開発モードで「${goal}」を開始します。

まず、要件を明確にしましょう。以下を教えてください：

1. どのような機能が必要ですか？
2. 技術スタックの希望はありますか？
3. 既存のコード・システムとの統合が必要ですか？
4. その他、重要な要件や制約はありますか？

回答いただいた内容を元に、Phase分割とplanファイルを作成します。`
}

module.exports = {
  generateWorkerPrompt,
  generateCheckpointPrompt,
  generateRequirementsPrompt
}
