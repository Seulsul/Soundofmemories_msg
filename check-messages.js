const { firefox } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://sound-of-memories.smtown.com/';
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const NTFY_TOKEN = process.env.NTFY_TOKEN;
const BASELINE_FILE = path.join(__dirname, 'baseline.json');

async function scrapeMessages(page, knownDates) {
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const postButton = await page.getByRole('button', { name: 'Post' });
  await postButton.evaluate(function (el) { el.click(); });
  await page.waitForTimeout(1500);

  const rows = await page.$$('[class*="PostPopup_msgRow__"]');
  const messages = [];

  for (const row of rows) {
    const dateText = await row.evaluate(function (el) {
      return el.innerText;
    });
    const match = dateText.match(/\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2}/);
    const date = match ? match[0] : null;
    if (!date) {
      continue;
    }

    if (knownDates.has(date)) {
      messages.push({ date: date, alreadyKnown: true });
      continue;
    }

    for (let attempt = 0; attempt < 8; attempt++) {
      const bubble = await row.$('[class*="PostPopup_bubble__"]');
      if (bubble) {
        await bubble.evaluate(function (el) { el.click(); });
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

    if (text) {
      messages.push({ id: date + '__' + text, date: date, text: text });
    }
  }

  return messages;
}

function computeDDay(dateStr) {
  const m = dateStr.match(/(\d{2})\.(\d{2})\.(\d{2})/);
  if (!m) return '';
  const msgDate = new Date(2000 + parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  const target = new Date(2027, 5, 7);
  const diffDays = Math.round((target - msgDate) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 ? ('D-' + diffDays) : ('D+' + Math.abs(diffDays));
}

function encodeHeader(text) {
  const base64 = Buffer.from(text, 'utf-8').toString('base64');
  return '=?UTF-8?B?' + base64 + '?=';
}

async function sendNtfy(msg) {
  await fetch('https://ntfy.sh/' + NTFY_TOPIC, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + NTFY_TOKEN,
      Title: encodeHeader('🫡 상병 김동영 (' + msg.date + ' / ' + computeDDay(msg.date) + ')'),
      Priority: 'high',
      Icon: 'https://raw.githubusercontent.com/Seulsul/Soundofmemories_msg/main/bbang.png',
    },
    body: msg.text,
  });
}

async function main() {
  if (!NTFY_TOPIC) {
    throw new Error('NTFY_TOPIC 환경변수가 없습니다.');
  }

  const isFirstRun = !fs.existsSync(BASELINE_FILE);
  let baseline;
  if (isFirstRun) {
    baseline = { seen: [] };
  } else {
    baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
  }

  const knownDates = new Set(
    baseline.seen.map(function (id) {
      return id.split('__')[0];
    })
  );

  const browser = await firefox.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const scraped = await scrapeMessages(page, knownDates);
  await browser.close();

  const seenSet = new Set(baseline.seen);
  const newMessages = [];
  const allIds = [];

  for (const m of scraped) {
    if (m.alreadyKnown) {
      const existing = baseline.seen.find(function (id) {
        return id.split('__')[0] === m.date;
      });
      if (existing) {
        allIds.push(existing);
      }
      continue;
    }
    allIds.push(m.id);
    if (!seenSet.has(m.id)) {
      newMessages.push(m);
    }
  }

  if (isFirstRun) {
    console.log('최초 실행: 기존 ' + scraped.length + '개를 베이스라인 저장 (알림 없음)');
  } else if (newMessages.length > 0) {
    console.log('새 메시지 ' + newMessages.length + '개, 알림 전송 중...');
    for (const msg of newMessages) {
      await sendNtfy(msg);
    }
  } else {
    console.log('새 메시지 없음');
  }

  if (allIds.length > 0) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({ seen: allIds }, null, 2));
  } else {
    console.log('경고: 스크래핑된 메시지가 0개라 baseline을 갱신하지 않음');
  }
}

main()
  .then(function () {
    process.exit(0);
  })
  .catch(function (err) {
    console.error(err);
    process.exit(1);
  });
