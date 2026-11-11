// 테스트 서버의 테스트 채널에 "모든 임베드 모양 샘플"과 "최근 실제 소식"을 올린다(임시 점검용).
// 슬래시 명령어(/소식테스트)와 같은 코드를 쓰며, 운영 기록(알린 글·버전·카드)은 읽지도 쓰지도 않는다.
// 서버에서 실행:  cd /opt/guild && runuser -u guild -- node deploy/preview-news.js [samples|recent|both]
// (.env 의 DISCORD_TOKEN 을 읽는다 — 토큰은 화면에 출력하지 않는다. 메시지는 테스트 채널에만 올린다)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { REST, Routes } = require('discord.js');
const { buildSources, previewSamples, previewRecent, EMOJI_NAMES, NEWS_TEST_CHANNEL_ID } = require('../news/watcher');

const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('DISCORD_TOKEN 이 없습니다 (.env 확인)'); process.exit(1); }
const mode = ['samples', 'recent', 'both'].includes(process.argv[2]) ? process.argv[2] : 'both';
const CHANNEL = NEWS_TEST_CHANNEL_ID; // 테스트 채널 외에는 올리지 않는다
const rest = new REST({ version: '10' }).setToken(token);

// 카드(컴포넌트 v2)와 일반 메시지를 REST 요청 본문으로 바꾼다
const toBody = p => p.content !== undefined
    ? { content: p.content, allowed_mentions: { parse: [] } }
    : { components: p.components.map(c => c.toJSON()), flags: p.flags, allowed_mentions: { parse: [] } };

(async () => {
    const app = await rest.get(Routes.currentApplication());
    const list = (await rest.get(`/applications/${app.id}/emojis`)).items ?? [];
    const byName = new Map(list.map(e => [e.name, e.id]));
    const emojiIds = Object.fromEntries(Object.entries(EMOJI_NAMES).filter(([, name]) => byName.has(name)).map(([src, name]) => [src, byName.get(name)]));
    console.log('봇 이모지:', Object.keys(emojiIds).length, '/', Object.keys(EMOJI_NAMES).length, '개 찾음');

    const post = async p => (await rest.post(Routes.channelMessages(CHANNEL), { body: toBody(p) })).id;
    const edit = async (id, p) => rest.patch(Routes.channelMessage(CHANNEL, id), { body: toBody(p) });

    if (mode !== 'recent') {
        const r = await previewSamples({ sources: buildSources({ YOUTUBE_API_KEY: 'sample' }), post, edit, emojiIds });
        console.log(`임베드 샘플 ${r.samples}종 올림`);
        r.labels.forEach((l, i) => console.log(`  ${i + 1}. ${l}`));
    }
    if (mode !== 'samples') {
        const r = await previewRecent({ sources: buildSources(process.env), post, emojiIds });
        console.log(`최근 실제 소식 ${r.posted}개 올림`, r.perSource);
        if (r.errors.length) console.log('읽기 실패:', r.errors.join(' | '));
    }
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
