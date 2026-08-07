import { config } from './config.js'
import { postJson } from './http.js'
import { log, sleep } from './util.js'

const LIMIT = 4000 // Telegram's hard cap is 4096; leave headroom.

/** Split on paragraph boundaries so a long message never breaks mid-HTML-tag. */
function splitMessage(text) {
  if (text.length <= LIMIT) return [text]
  const parts = []
  let current = ''
  for (const block of text.split('\n\n')) {
    if (current && current.length + block.length + 2 > LIMIT) {
      parts.push(current)
      current = block
    } else {
      current = current ? `${current}\n\n${block}` : block
    }
  }
  if (current) parts.push(current)
  return parts
}

export async function sendAlert(text, { disablePreview = true } = {}) {
  if (config.telegram.dryRun || !config.telegram.token || !config.telegram.chatId) {
    log.info(`[DRY RUN] would send:\n${text.replace(/<[^>]+>/g, '')}\n`)
    return true
  }

  const url = `https://api.telegram.org/bot${config.telegram.token}/sendMessage`
  let allOk = true

  for (const part of splitMessage(text)) {
    const res = await postJson(url, {
      chat_id: config.telegram.chatId,
      text: part,
      parse_mode: 'HTML',
      disable_web_page_preview: disablePreview,
    })
    if (!res.ok) {
      // Never log the bot token, and Telegram echoes the request URL in some errors.
      log.error(`telegram send failed: status ${res.status} ${res.data?.description || ''}`)
      allOk = false
    }
    await sleep(350) // stay under Telegram's ~30 msg/sec and per-chat limits
  }
  return allOk
}
