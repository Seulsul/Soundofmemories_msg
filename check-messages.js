const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://sound-of-memories.smtown.com/';
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const BASELINE_FILE = path.join(__dirname, 'baseline.json');

async function scrapeMessages(page) {
  await page.goto(SITE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Post' }).click({ force: true });
  await page.waitForTimeout(1500);

  const rows = await page.$$('[class*="PostPopup_msgRow__"]');
  const messages = [];

  for (const row of rows) {
    // 안읽음 상태면 클릭해서 실제 텍스트를 revealed 시킴
    const isUnread = await row.evaluate(el => !!el.querySelector('[class*="bubbleUnread"]'));

    if (isUnread) {
      const bubble = await row.$('[class*="PostPopup_bubble__"]');
      if (bubble) {
        await bubble.click({ force: true });
        await page.waitForTimeout(800);
      }
    }

    const text = await row.evaluate(el => {
      const t = el.querySelector('[class*="bubbleText"]');
      return t ? t.innerText.trim() : null;
    });
    const dateText = await row.evaluate(el => el.innerText);
    const match = dateText.match(/\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2}/);
    const date = match ? match[0] : null;

    if (text && date) messages.push({ id: `${date}__${text}`, date, text });
  }
  return messages;
}

async function sendNtfy({ date, text }) {
  await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: 'POST',
    headers: { Title: `동시녹음 새 메시지 (${date})`, Priority: 'high', Tags: 'love_letter' },
    body: text,
  });
}

async function main() {
  if (!NTFY_TOPIC) throw new Error('NTFY_TOPIC 환경변수가 없습니다.');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const messages = await scrapeMessages(page);
  await browser.close();

  const isFirstRun = !fs.existsSync(BASELINE_FILE);
  const baseline = isFirstRun ? { seen: [] } : JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
  const seenSet = new Set(baseline.seen);
  const n
