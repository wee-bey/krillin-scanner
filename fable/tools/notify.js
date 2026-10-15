/* Fable · Telegram delivery. Sends only when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set (repository secrets
   that Jeffrey creates himself); otherwise the message is written to fable/data/outbox.txt and nothing is sent. */
'use strict';
const fs = require('fs');
const path = require('path');

async function send(text, outDir) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  fs.mkdirSync(outDir, { recursive: true });
  fs.appendFileSync(path.join(outDir, 'outbox.txt'), `--- ${new Date().toISOString()}\n${text}\n`);
  if (!token || !chat) return { sent: false, why: 'telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)' };
  const chunks = []; for (let i = 0; i < text.length; i += 3800) chunks.push(text.slice(i, i + 3800)); // Telegram caps a message at 4096 chars
  for (const c of chunks) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text: c, disable_web_page_preview: true }) });
    if (!r.ok) return { sent: false, why: `telegram HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };
  }
  return { sent: true };
}
module.exports = { send };
