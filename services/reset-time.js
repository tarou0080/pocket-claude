const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

// tz の壁時計 y-m-d h:m を UTC の Date にする。オフセットはその時刻付近で求める（夏時間境界の前後でもずれない）。
function zonedTimeToDate(year, month, day, hours, minutes, tz) {
  const naive = Date.UTC(year, month, day, hours, minutes)
  const tzLocalStr = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(naive))
  const tzOffsetMs = naive - new Date(tzLocalStr.replace(' ', 'T') + 'Z').getTime()
  return new Date(naive + tzOffsetMs)
}

// rate_limit メッセージ文言からリセット時刻を解析する。
// フロントの parseResetTime と同等のロジック。サーバー側はイベント発生時点で呼ばれるため
// 「呼び出し時刻基準で今日/明日を判定する」性質が正しく機能する（履歴再生での誤算出が起きない）。
function parseResetTime(text, now = new Date()) {
  // ISO datetime: "2024-01-15T22:30:00Z" or "2024-01-15 22:30:00 UTC"
  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})?)/)
  if (isoMatch) {
    const d = new Date(isoMatch[1].replace(' ', 'T').replace(' UTC', 'Z'))
    if (!isNaN(d)) return d
  }
  // "1am (Asia/Tokyo)" / "11:30pm (America/New_York)"（セッション制限＝時刻のみ）
  // "Sep 28, 3am (Asia/Tokyo)"（週制限＝日付付き。日付を読まないと「次の3時」へ1日早く予約してしまう）
  const tzMatch = text.match(/(?:\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?(am|pm)\s*\(([^)]+)\)/i)
  if (tzMatch) {
    const month = tzMatch[1] ? MONTHS[tzMatch[1].toLowerCase()] : undefined
    const day = tzMatch[2] ? parseInt(tzMatch[2]) : undefined
    let hours = parseInt(tzMatch[3])
    const minutes = parseInt(tzMatch[4] || '0')
    const ampm = tzMatch[5].toLowerCase()
    const tz = tzMatch[6]
    if (ampm === 'am') { if (hours === 12) hours = 0 }
    else { if (hours !== 12) hours += 12 }
    try {
      const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      if (month !== undefined) {
        // 年は文言に無い。tz の今年で組み、1日以上過去なら翌年（12/31 に出た "Jan 2" 等）
        const year = parseInt(fmt.format(now).slice(0, 4))
        const result = zonedTimeToDate(year, month, day, hours, minutes, tz)
        return result.getTime() < now.getTime() - 86400000 ? zonedTimeToDate(year + 1, month, day, hours, minutes, tz) : result
      }
      for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
        // そのtzでの「今日/明日」の日付
        const [y, m, d] = fmt.format(new Date(now.getTime() + dayOffset * 86400000)).split('-').map(Number)
        const result = zonedTimeToDate(y, m - 1, d, hours, minutes, tz)
        if (result > now) return result
      }
    } catch {}
  }
  // Time only: "22:30 UTC" or "22:30:00 UTC"
  const timeMatch = text.match(/(\d{2}:\d{2}(?::\d{2})?) UTC/i)
  if (timeMatch) {
    const d = new Date(now.getTime())
    const parts = timeMatch[1].split(':')
    d.setUTCHours(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2] || 0), 0)
    if (d <= now) d.setUTCDate(d.getUTCDate() + 1)
    return d
  }
  return null
}

module.exports = { parseResetTime }
