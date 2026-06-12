// rate_limit メッセージ文言からリセット時刻を解析する。
// フロントの parseResetTime と同等のロジック。サーバー側はイベント発生時点で呼ばれるため
// 「呼び出し時刻基準で今日/明日を判定する」性質が正しく機能する（履歴再生での誤算出が起きない）。
function parseResetTime(text) {
  // ISO datetime: "2024-01-15T22:30:00Z" or "2024-01-15 22:30:00 UTC"
  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})?)/)
  if (isoMatch) {
    const d = new Date(isoMatch[1].replace(' ', 'T').replace(' UTC', 'Z'))
    if (!isNaN(d)) return d
  }
  // "1am (Asia/Tokyo)" or "11:30pm (America/New_York)"
  const tzMatch = text.match(/(\d{1,2})(?::(\d{2}))?(am|pm)\s*\(([^)]+)\)/i)
  if (tzMatch) {
    let hours = parseInt(tzMatch[1])
    const minutes = parseInt(tzMatch[2] || '0')
    const ampm = tzMatch[3].toLowerCase()
    const tz = tzMatch[4]
    if (ampm === 'am') { if (hours === 12) hours = 0 }
    else { if (hours !== 12) hours += 12 }
    try {
      const now = new Date()
      for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
        // そのtzでの「今日/明日」の日付文字列を取得
        const base = new Date(now.getTime() + dayOffset * 86400000)
        const dateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(base)
        // tzのオフセットを求める: UTCとtzのローカル時刻の差
        const tzLocalStr = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(base)
        const tzOffsetMs = base.getTime() - new Date(tzLocalStr.replace(' ', 'T') + 'Z').getTime()
        // tz内でのhours:minutesをUTCに変換
        const result = new Date(new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`).getTime() + tzOffsetMs)
        if (result > now) return result
      }
    } catch {}
  }
  // Time only: "22:30 UTC" or "22:30:00 UTC"
  const timeMatch = text.match(/(\d{2}:\d{2}(?::\d{2})?) UTC/i)
  if (timeMatch) {
    const d = new Date()
    const parts = timeMatch[1].split(':')
    d.setUTCHours(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2] || 0), 0)
    if (d <= new Date()) d.setUTCDate(d.getUTCDate() + 1)
    return d
  }
  return null
}

module.exports = { parseResetTime }
