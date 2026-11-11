// assets/emojis 의 PNG 를 봇의 "애플리케이션 이모지"로 등록한다(서버 상관없이 어디서든 쓸 수 있는 봇 전용 이모지).
// 이미 같은 이름이 있으면 건너뛰고, 마지막에 이름과 ID 를 보여 준다(ID 는 비밀이 아님).
// 서버에서 실행:  cd /opt/guild && node deploy/register-emojis.js
// (.env 의 DISCORD_TOKEN 을 읽는다 — 토큰은 화면에 출력하지 않는다)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('DISCORD_TOKEN 이 없습니다 (.env 확인)'); process.exit(1); }

const DIR = path.join(__dirname, '..', 'assets', 'emojis');
const API = 'https://discord.com/api/v10';
const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'GuildBot (emoji setup, 1.0)' };

async function api(method, url, body) {
    const res = await fetch(API + url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${url} → HTTP ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
}

(async () => {
    const me = await api('GET', '/applications/@me');
    const existing = new Map(((await api('GET', `/applications/${me.id}/emojis`)).items ?? []).map(e => [e.name, e]));
    const files = fs.readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
    for (const f of files) {
        const name = f.slice(0, -4);
        if (existing.has(name)) { console.log(`건너뜀(이미 있음): ${name}`); continue; }
        const image = `data:image/png;base64,${fs.readFileSync(path.join(DIR, f)).toString('base64')}`;
        existing.set(name, await api('POST', `/applications/${me.id}/emojis`, { name, image }));
        console.log(`등록: ${name}`);
    }
    console.log('\n이름: ID');
    for (const name of files.map(f => f.slice(0, -4))) console.log(`${name}: ${existing.get(name)?.id}`);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
