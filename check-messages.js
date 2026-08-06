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
            for (let attempt = 0; attempt < 4; attempt++) {
                      const bubble = await row.$('[class*="PostPopup_bubble__"]');
                      if (bubble) {
                                  await bubble.click({ force: true });
                      }
                      await page.waitForTimeout(1500);
                      const stillUnread = await row.evaluate(function (el) {
                                  return !!el.querySelector('[class*="bubbleUnread"]');
                      });
                      if (!stillUnread) {
                                  break;
                      }
            }
            const text = await row.evaluate(function (el) {
                      const t = el.querySelector('[class*="bubbleText"]');
                      return t ? t.innerText.trim() : null;
            });
            const dateText = await row.evaluate(function (el) {
                      return el.innerText;
            });
            const match = dateText.match(/\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2}/);
            const date = match ? match[0] : null;

            if (text && date) {
                      messages.push({ id: date + '__' + text, date: date, text: text });
            }
    }
      return messages;
    }

function encodeHeader(text) {
    const base64 = Buffer.from(text, 'utf-8').toString('base64');
    return '=?UTF-8?B?' + base64 + '?=';
}

async function sendNtfy(msg) {
  await fetch('https://ntfy.sh/' + NTFY_TOPIC, {
    method: 'POST',
    headers: {
  Title: encodeHeader('동시녹음 새 메시지 (' + msg.date + ')'),
  Priority: 'high',
  Tags: 'love_letter',
},
    body: msg.text,
  });
}

async function main() {
  if (!NTFY_TOPIC) {
    throw new Error('NTFY_TOPIC 환경변수가 없습니다.');
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const messages = await scrapeMessages(page);
  await browser.close();

  const isFirstRun = !fs.existsSync(BASELINE_FILE);
  let baseline;
  if (isFirstRun) {
    baseline = { seen: [] };
  } else {
    baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
  }

  const seenSet = new Set(baseline.seen);
  const newMessages = [];
  for (const m of messages) {
    if (!seenSet.has(m.id)) {
      newMessages.push(m);
    }
  }

  if (isFirstRun) {
    console.log('최초 실행: 기존 ' + messages.length + '개를 베이스라인 저장 (알림 없음)');
  } else if (newMessages.length > 0) {
    console.log('새 메시지 ' + newMessages.length + '개, 알림 전송 중...');
    for (const msg of newMessages) {
      await sendNtfy(msg);
    }
  } else {
    console.log('새 메시지 없음');
  }

  const allIds = messages.map(function (m) {
    return m.id;
  });
  fs.writeFileSync(BASELINE_FILE, JSON.stringify({ seen: allIds }, null, 2));
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
