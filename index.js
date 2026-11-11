require('dotenv').config();
const { Client, GatewayIntentBits, Events, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, Collection, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, SectionBuilder, ThumbnailBuilder, MessageFlags, resolveColor, ActivityType, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const token = process.env.DISCORD_TOKEN;
const { Agent, request } = require('undici');
const { flushAll, createStore } = require('./store');
const { startNewsWatcher, getNewsStatus, getNewsPosts, forgetNewsPost, NEWS_CHANNEL_ID, buildSources, previewSamples, previewRecent, fetchEmojiIds, NEWS_TEST_GUILD_ID, NEWS_TEST_CHANNEL_ID } = require('./news/watcher');
const { decideAccess, canToggleLock } = require('./card-lock');

// 디스코드 API 연결을 60초까지 유지한다. 기본값(약 4초)이면 잠깐만 안 써도 연결이 끊겨서
// 다음 버튼 클릭 때 TLS 연결을 새로 맺느라 느려진다 (이 서버 CPU에서 새 연결 하나에 약 0.3초).
const restAgent = new Agent({ connect: { timeout: 30000 }, keepAliveTimeout: 60000, keepAliveMaxTimeout: 600000 });
const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    // 프로필에 "Monster Hunter Wilds 하는 중" 표시 (옵션에 두면 재접속할 때도 자동으로 다시 보낸다)
    presence: { status: 'online', activities: [{ name: 'Monster Hunter Wilds', type: ActivityType.Playing }] },
    rest: { agent: restAgent }
});

// 아무도 버튼을 안 누르는 동안에도 연결이 끊기지 않게 25초마다 가벼운 요청을 보낸다.
// (토큰이 필요 없는 /gateway 라 봇 요청 한도에 들어가지 않는다. 연결 2개를 살려 두는 건
//  몬스터를 고를 때 요청 두 개를 동시에 보내기 때문)
const WARM_INTERVAL_MS = 25 * 1000;
function warmConnection() {
    for (let i = 0; i < 2; i++) {
        request('https://discord.com/api/v10/gateway', { dispatcher: restAgent })
            .then(res => res.body.dump())
            .catch(() => { /* 다음 차례에 다시 시도 */ });
    }
}
setInterval(warmConnection, WARM_INTERVAL_MS).unref();
warmConnection();

// /관리는 모든 서버에 등록한다(아래 ClientReady). 테스트 서버 전용 목록은 이제 비어 있고, 시작할 때 이 서버의 서버 전용 목록을
// 이 내용으로 덮어써서 예전에 등록한 서버 전용 명령어(/소식테스트·/관리 등)를 지운다 — 남겨 두면 전체 /관리와 이중으로 보인다.
const TEST_GUILD_COMMANDS = [];
const GLOBAL_COMMANDS = [
    { name: '몬스터', description: '몬스터 목록을 열고 정보를 확인합니다.' },
    { name: '관리', description: '[관리] 길드봇 소식 기능 일시정지/재개, 소식 삭제, 상태 확인을 합니다.' },
];

// 소식 기능 일시정지 상태 (꺼졌다 켜져도 유지)
const adminStore = createStore('admin', { newsPaused: false });
// /관리 사용 가능: .env 의 ADMIN_ID(쉼표로 여러 명: ADMIN_ID=111,222)에 적힌 유저만. 서버 관리자 권한은 보지 않는다.
// ADMIN_ID 가 없으면 아래 기본 유저 한 명만 허용한다.
const DEFAULT_ADMIN_ID = '457437911869161472';
const ADMIN_USER_IDS = String(process.env.ADMIN_ID ?? process.env.admin_id ?? DEFAULT_ADMIN_ID).split(/[\s,]+/).filter(id => /^\d{15,25}$/.test(id));
if (!ADMIN_USER_IDS.length) console.error('[설정 오류] ADMIN_ID 에 올바른 유저 ID가 없어 /관리를 아무도 쓸 수 없습니다.');
const canUseAdmin = interaction => ADMIN_USER_IDS.includes(interaction.user.id);
const isNewsPaused = () => !!adminStore.data.newsPaused;

// 응답이 느릴 때 원인을 볼 수 있도록 기록하는 기준 (디스코드 응답 제한은 3초)
const SLOW_RESPONSE_MS = 1500;

// monsters 폴더의 JSON 파일 하나 = 몬스터 하나. 목록 순서는 게임 내 대형 몬스터 도감 순서(MONSTER_ORDER).
// 몬스터를 추가할 때는 JSON 파일만 넣으면 된다 — 여기 순서에 없으면 가나다순으로 뒤에 붙고, 훈련 통 펀처는 항상 맨 끝.
// (아이콘은 파일 안 "emoji": { name, id })
const MONSTER_DIR = path.join(__dirname, 'monsters');
const MONSTER_ORDER = [
    "차타카브라", "케마트리스", "라바라 바리나", "바바콩가", "발라하라", "도샤구마",
    "우드 투나", "푸푸로포루", "레 다우", "네르스큐라", "히라바미", "아자라칸",
    "누 이그드라", "수호룡 도샤구마", "수호룡 리오레우스", "진 다하드", "수호룡 오도가론 아종", "시이우",
    "수호룡 알슈베르도", "조 시아", "얀쿡크", "게리오스", "리오레이아", "수호룡 안쟈나프 아종",
    "리오레우스", "그라비모스", "도도블랑고", "고어 마가라", "알슈베르도", "타마미츠네",
    "셀레기오스", "라기아크루스", "오메가 플라네테스", "고그마지오스"
];
const LAST_IN_LIST = "고양이 훈련 통 펀처";
const orderRank = name => (name === LAST_IN_LIST ? Infinity : MONSTER_ORDER.includes(name) ? MONSTER_ORDER.indexOf(name) : MONSTER_ORDER.length);
const monsterList = fs.readdirSync(MONSTER_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5))
    .sort((a, b) => orderRank(a) - orderRank(b) || a.localeCompare(b, 'ko'));

// 몬스터 아이콘 (봇 애플리케이션 이모지) — 목록 버튼에 표시
const monsterEmojis = {};
for (const name of monsterList) {
    // 버튼 ID가 "동작_몬스터이름_페이지" 형식이라 이름에 _ 가 있으면 버튼이 엉뚱하게 동작한다
    if (name.includes('_')) console.error(`[몬스터 파일 이름 오류] "${name}": 이름에 _ 를 쓸 수 없어요 (띄어쓰기로 바꿔 주세요)`);
    try {
        const emoji = JSON.parse(fs.readFileSync(path.join(MONSTER_DIR, `${name}.json`), 'utf-8').replace(/^﻿/, '')).emoji;
        if (emoji && emoji.id) monsterEmojis[name] = { name: emoji.name, id: emoji.id };
    } catch (e) { console.error(`[몬스터 파일 오류] ${name}:`, e.message); }
}

const cooldowns = new Collection();
const COOLDOWN_TIME = 10000;

function isCooldownActive(interaction) {
    const userId = interaction.user.id;
    const currentTime = Date.now();
    if (cooldowns.has(userId)) {
        const lastTime = cooldowns.get(userId);
        const timePassed = currentTime - lastTime;
        if (timePassed < COOLDOWN_TIME) {
            const remainingSeconds = Math.ceil((COOLDOWN_TIME - timePassed) / 1000);
            interaction.reply(buildNoticeMessage(`<:Timer:1493995200488669217> **${remainingSeconds}초** 후에 다시 시도해 주세요!`))
                .catch(e => console.error('[쿨타임 안내 오류]', e.code || '', e.message));
            return true;
        }
    }
    cooldowns.set(userId, currentTime);
    setTimeout(() => { if (cooldowns.get(userId) === currentTime) cooldowns.delete(userId); }, COOLDOWN_TIME).unref(); // 지난 기록이 쌓이지 않게
    return false;
}

const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const DEFAULT_ACCENT = 0x5865F2;

// 쿨타임/오류 안내도 Components V2 컨테이너로 보낸다
function buildNoticeMessage(text) {
    const container = new ContainerBuilder()
        .setAccentColor(DEFAULT_ACCENT)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    return { components: [container], flags: V2_EPHEMERAL };
}

// /몬스터 목록: Components V2 컨테이너 안에 몬스터 버튼을 한 줄에 3개씩 배치
// (아이콘이 붙은 버튼은 한 줄에 4~5개면 디스코드 창 폭에 따라 줄이 넘어가 들쭉날쭉해진다)
// 메시지 하나에 컴포넌트가 40개까지라 한 페이지에 21마리(7줄)씩 나눈다.
const MONSTER_BUTTONS_PER_ROW = 3;
const MONSTERS_PER_LIST_PAGE = 21;
const listPageCount = () => Math.max(1, Math.ceil(monsterList.length / MONSTERS_PER_LIST_PAGE));
const listPageOf = monsterName => Math.max(0, Math.floor(monsterList.indexOf(monsterName) / MONSTERS_PER_LIST_PAGE));

function buildMonsterListContainer(page = 0) {
    const totalPages = listPageCount();
    page = Math.min(Math.max(Number.isInteger(page) ? page : 0, 0), totalPages - 1);
    const container = new ContainerBuilder()
        .setAccentColor(DEFAULT_ACCENT)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('# 몬스터 목록\n확인하고 싶은 몬스터를 눌러 주세요.')
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );

    const names = monsterList.slice(page * MONSTERS_PER_LIST_PAGE, (page + 1) * MONSTERS_PER_LIST_PAGE);
    for (let i = 0; i < names.length; i += MONSTER_BUTTONS_PER_ROW) {
        const row = new ActionRowBuilder().addComponents(
            names.slice(i, i + MONSTER_BUTTONS_PER_ROW).map(name => {
                const button = new ButtonBuilder().setCustomId(`pick_${name}`).setLabel(name).setStyle(ButtonStyle.Secondary);
                if (monsterEmojis[name]) button.setEmoji(monsterEmojis[name]);
                return button;
            })
        );
        container.addActionRowComponents(row);
    }

    if (totalPages > 1) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`listpage_${page - 1}`).setLabel("◀ 이전").setStyle(ButtonStyle.Primary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId(`dummy_listpage`).setLabel(`${page + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId(`listpage_${page + 1}`).setLabel("다음 ▶").setStyle(ButtonStyle.Primary).setDisabled(page === totalPages - 1)
        ));
    }

    return container;
}

// 버튼을 누르면 같은 메시지를 새 화면으로 갱신하고, 슬래시 명령이면 새 메시지로 보낸다.
// 봇 업데이트 전에 보낸 옛 임베드 메시지의 버튼은 V2로 바꿀 수 없으므로 새 메시지로 띄운다.
// mode: 'auto'(기본, 위 규칙) · 'public'(채널에 모두가 보는 새 메시지) · 'private'(나만 보는 새 메시지)
async function respondWithContainer(interaction, container, mode = 'auto') {
    if (mode === 'public') return postPublicFromList(interaction, container);
    const canUpdate = mode === 'auto' && interaction.isMessageComponent() && interaction.message.flags.has(MessageFlags.IsComponentsV2);
    if (canUpdate) await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
    else await interaction.reply({ components: [container], flags: V2_EPHEMERAL });
    return null;
}

// 나만 보는 목록에서 몬스터를 골랐을 때: 목록을 닫고 채널에 모두가 보는 메시지를 올린다.
// 상호작용 응답(reply)으로 올리면 메시지 위에 "메시지를 보려면 클릭하세요" 답장 표시가 붙어서,
// 봇이 채널에 일반 메시지로 직접 보낸다. 채널에 보낼 권한이 없을 때만 응답(followUp)으로 올린다.
async function postPublicFromList(interaction, container) {
    // 응답 확인(3초 제한)과 채널 전송은 서로 기다릴 필요가 없어 동시에 보낸다
    const [, sent] = await Promise.allSettled([
        interaction.deferUpdate(),
        client.rest.post(Routes.channelMessages(interaction.channelId), {
            body: { components: [container.toJSON()], flags: MessageFlags.IsComponentsV2 }
        })
    ]);
    let message = sent.status === 'fulfilled' ? sent.value : null;
    if (!message) {
        console.error('[채널 메시지 전송 실패 → 응답으로 올림]', sent.reason?.code || '', sent.reason?.message);
        message = await interaction.followUp({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
    // 목록 닫기는 기다리지 않는다 (화면에 보이는 응답은 이미 끝남)
    interaction.deleteReply().catch(e => { if (e.code !== 10008) console.error('[목록 닫기 실패]', e.code || '', e.message); });
    return message;
}

// ── 도배 방지 ──
// 채널마다 봇이 올린 공개 몬스터 메시지를 기억해 두고, 새로 올릴 때
//  · 같은 사람이 전에 올린 메시지(1인 1메시지)
//  · 같은 몬스터를 보여 주는 메시지(중복 몬스터)
// 를 지운다. 기록은 data/state.json 에 저장돼 봇이 재시작해도 이어진다.
const publicPosts = new Map(); // channelId → Map(messageId → { userId, monsterName, token, at, clickedAt })
const privateLists = new Map(); // userId → { applicationId, token, at } (아래 "나만 보는 목록" 참고)

// ── 추적 기록 저장 ──
// 재시작(배포 포함) 뒤에도 예전 공개 메시지·목록을 지울 수 있게 파일로 남긴다.
// 응답 토큰은 15분만 쓸모 있으므로 지난 토큰은 저장할 때 빼서, 파일에 오래 남지 않게 한다.
const STATE_FILE = path.join(__dirname, 'data', 'state.json');
const POSTS_PER_CHANNEL = 100; // 손으로 지운 메시지 기록이 끝없이 쌓이지 않게

function loadState() {
    try {
        const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        for (const [channelId, posts] of Object.entries(s.publicPosts || {})) publicPosts.set(channelId, new Map(Object.entries(posts)));
        for (const [userId, list] of Object.entries(s.privateLists || {})) privateLists.set(userId, list);
        console.log(`[기록 불러옴] 공개 메시지 ${[...publicPosts.values()].reduce((n, m) => n + m.size, 0)}개, 목록 ${privateLists.size}개`);
    } catch (e) {
        if (e.code !== 'ENOENT') console.error('[기록 불러오기 실패]', e.message);
    }
}

function writeStateNow() {
    const now = Date.now();
    const fresh = v => (v.token && now - v.at >= INTERACTION_TOKEN_MS ? { ...v, token: undefined } : v);
    const s = { publicPosts: {}, privateLists: {} };
    for (const [channelId, posts] of publicPosts) {
        if (!posts.size) continue;
        s.publicPosts[channelId] = Object.fromEntries([...posts].slice(-POSTS_PER_CHANNEL).map(([id, p]) => [id, fresh(p)]));
    }
    for (const [userId, list] of privateLists) if (now - list.at < INTERACTION_TOKEN_MS) s.privateLists[userId] = list;
    try {
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        const tmp = STATE_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
        fs.renameSync(tmp, STATE_FILE); // 쓰다가 꺼져도 파일이 깨지지 않게
    } catch (e) { console.error('[기록 저장 실패]', e.message); }
}

// 클릭이 몰려도 1초에 한 번만 쓴다
let saveTimer = null;
function saveState() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; writeStateNow(); }, 1000);
}
// 배포·재시작(systemd 정지 신호) 때 마지막 변경까지 저장하고 끈다
for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, () => {
        if (saveTimer) { clearTimeout(saveTimer); writeStateNow(); }
        flushAll(); // 소식 감지 기록 등 저장소에 남은 변경
        process.exit(0);
    });
}

async function replacePublicPosts(interaction, message, monsterName) {
    const channelId = interaction.channelId;
    if (!channelId || !message) return;
    if (!publicPosts.has(channelId)) publicPosts.set(channelId, new Map());
    const posts = publicPosts.get(channelId);
    const clickedAt = interaction.createdTimestamp;
    const stale = [...posts].filter(([id, p]) => id !== message.id && (p.userId === interaction.user.id || (p.monsterName === monsterName && !p.locked)));
    const mine = { userId: interaction.user.id, monsterName, token: interaction.token, at: Date.now(), clickedAt };
    // 같은 사람이 빠르게 연달아 누르면 응답이 도착하는 순서가 뒤바뀔 수 있다.
    // 내 것보다 나중에 누른 같은 사람의 메시지가 이미 있으면, 늦게 도착한 내 메시지를 지운다(마지막 클릭이 남게).
    if (stale.some(([, p]) => p.userId === interaction.user.id && p.clickedAt > clickedAt)) {
        return deletePublicPost(channelId, message.id, mine);
    }
    posts.set(message.id, mine);
    if (posts.size > POSTS_PER_CHANNEL) posts.delete(posts.keys().next().value);
    for (const [id] of stale) posts.delete(id);
    saveState();
    for (const [id, p] of stale) await deletePublicPost(channelId, id, p);
}

const INTERACTION_TOKEN_MS = 14 * 60 * 1000; // 응답 토큰은 15분 유효
async function deletePublicPost(channelId, messageId, post) {
    try {
        await client.rest.delete(Routes.channelMessage(channelId, messageId));
    } catch (e) {
        if (e.code === 10008) return; // 이미 지워짐
        // 채널 권한이 없으면 응답 토큰으로 지운다(올린 지 15분 안일 때만)
        if (post.token && Date.now() - post.at < INTERACTION_TOKEN_MS) {
            try { return await client.rest.delete(Routes.webhookMessage(client.application.id, post.token, messageId)); }
            catch (e2) { if (e2.code === 10008) return; e = e2; }
        }
        console.error('[이전 몬스터 메시지 삭제 실패]', e.code || '', e.message);
    }
}

// 몬스터 파일은 클릭할 때마다 읽지 않고 처음 한 번 읽어 메모리에 둔다
// (파일이 바뀌면 배포 때 봇이 재시작되므로 다시 읽힌다)
const monsterCache = new Map();
function getMonsterData(monsterName) {
    if (monsterCache.has(monsterName)) return monsterCache.get(monsterName);
    if (!monsterList.includes(monsterName)) return null; // 버튼 ID로 폴더 밖 경로를 읽지 못하게
    try {
        const data = JSON.parse(fs.readFileSync(path.join(MONSTER_DIR, `${monsterName}.json`), 'utf-8').replace(/^﻿/, ''));
        monsterCache.set(monsterName, data);
        return data;
    } catch (e) {
        console.error(`[몬스터 파일 오류] ${monsterName}:`, e.message);
        return null;
    }
}

// 서식지는 한 줄에 2곳까지만 놓는다 (3곳 이상을 한 줄에 쓰면 폭이 좁은 화면에서 줄이 넘어가며 글자가 잘린다)
const HABITATS_PER_LINE = 2;
function habitatLines(habitat) {
    const items = (habitat.replace(/\*\*/g, '').match(/<a?:\w+:\d+>[^<]*/g) || []).map(s => s.trim()).filter(Boolean);
    if (!items.length) return `> ${habitat}`;
    const lines = [];
    for (let i = 0; i < items.length; i += HABITATS_PER_LINE) lines.push(`> **${items.slice(i, i + HABITATS_PER_LINE).join('　')}**`);
    return lines.join('\n');
}

function getArrayAsString(data, key) {
    if (!data[key]) return "정보가 없습니다.";
    return Array.isArray(data[key]) ? data[key].join("\n") : data[key];
}

// 몬스터 화면 한 페이지 = 컨테이너(몬스터 색) 안에 [본문 + 썸네일] 섹션, 구분선, 버튼 줄들
// 요청자: 목록에서 몬스터를 고른 사람. 컴포넌트 V2 에는 임베드 푸터가 없어 컨테이너 맨 아래 작은 글씨로 넣는다.
// 탭·페이지 버튼으로 화면이 갱신될 때는 누른 사람이 아니라 처음 요청한 사람이 유지되도록 기존 메시지에서 읽어 온다.
const REQUESTER_RE = /^-# 요청자 : (.+)$/m;
function findRequester(node) {
    if (!node || typeof node !== 'object') return null;
    if (typeof node.content === 'string') { const m = node.content.match(REQUESTER_RE); if (m) return m[1]; }
    for (const child of [...(node.components || []), ...(node.accessory ? [node.accessory] : [])]) {
        const r = findRequester(child.toJSON ? child.toJSON() : child);
        if (r) return r;
    }
    return null;
}
function getRequester(interaction, mode = 'auto') {
    if (mode === 'public') return interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
    try {
        if (interaction.isMessageComponent() && !interaction.message.flags.has(MessageFlags.Ephemeral)) {
            for (const c of interaction.message.components) { const r = findRequester(c.toJSON ? c.toJSON() : c); if (r) return r; }
        }
    } catch (e) { /* 읽지 못하면 요청자 줄 없이 표시 */ }
    return null;
}

function buildMonsterPageContainer(monsterData, text, rows, requester = null) {
    let accent = 0xFFFFFF;
    try { if (monsterData.color) accent = resolveColor(monsterData.color); } catch (e) { /* 잘못된 색상값이면 흰색 */ }

    const container = new ContainerBuilder().setAccentColor(accent);
    const body = new TextDisplayBuilder().setContent(text);

    if (monsterData.thumbnail) {
        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(body)
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(monsterData.thumbnail))
        );
    } else {
        container.addTextDisplayComponents(body);
    }

    if (rows.length) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addActionRowComponents(rows);
    }
    if (requester) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# 요청자 : ${requester}`));
    return container;
}

// 긴 본문을 페이지 단위 텍스트로 나눈다 (모든 페이지에 "# 몬스터 이름" 헤더 유지)
function splitToPages(fullDescription) {
    const pages = [];
    const maxLength = 2200;
    
    // 기존 마크다운 양식을 파괴하지 않기 위해, 첫 줄(헤더)만 안전하게 분리
    let header = "";
    let remainingText = fullDescription;
    
    if (fullDescription.startsWith('# ')) {
        const firstLineEnd = fullDescription.indexOf('\n');
        if (firstLineEnd !== -1) {
            header = fullDescription.substring(0, firstLineEnd + 1);
            remainingText = fullDescription.substring(firstLineEnd + 1);
        }
    }

    while (remainingText.length > 0) {
        const availableLength = maxLength - header.length;

        if (remainingText.length <= availableLength) {
            pages.push(header + remainingText);
            break;
        }

        let splitIndex = remainingText.lastIndexOf('\n\n', availableLength);
        if (splitIndex === -1 || splitIndex < availableLength * 0.6) {
            splitIndex = remainingText.lastIndexOf('\n', availableLength);
        }
        if (splitIndex === -1) {
            splitIndex = availableLength;
        }

        pages.push(header + remainingText.substring(0, splitIndex));
        remainingText = remainingText.substring(splitIndex).trim();

        if (pages.length >= 15) break;
    }
    return pages;
}

// 한 화면에 다 들어오도록 칸 개수로 페이지를 나눈다
const BASIC_BLOCKS_PER_PAGE = 3; // 기본 정보: 소개 · 서식지 · 위험도 / 절단·파괴 부위 · 약점 · 추천 속성
const DROP_ITEMS_PER_PAGE = 4;   // 소재: 한 페이지에 소재 4개
const HITZONE_PARTS_PER_PAGE = 4; // 육질: 한 페이지에 부위 4개

// 빈 줄로 나뉜 덩어리(소재 하나 = 덩어리 하나)로 자른다
function splitIntoBlocks(text) {
    return text.split(/\n[ \t]*\n/).map(s => s.trim()).filter(Boolean);
}

function pagesFromBlocks(header, blocks, perPage) {
    if (!blocks.length) return [header];
    const pages = [];
    for (let i = 0; i < blocks.length; i += perPage) {
        const page = `${header}\n${blocks.slice(i, i + perPage).join('\n\n')}`;
        // 칸이 유난히 길면 글자 수 한도에 걸리지 않게 예전 방식으로 한 번 더 나눈다
        pages.push(...(page.length > 3500 ? splitToPages(page) : [page]));
    }
    return pages;
}

// 기존에 작성하셨던 탭 버튼 로직 100% 원상복구 (버튼 ID 왜곡 방지)
function getTabButtons(currentTab, monsterName, monsterData, lock = null) {
    const row = new ActionRowBuilder();
    row.addComponents(new ButtonBuilder().setCustomId(`list_${monsterName}`).setLabel("목록").setEmoji("📋").setStyle(ButtonStyle.Secondary));
    if (currentTab !== "basic" && monsterData.info) row.addComponents(new ButtonBuilder().setCustomId(`basic_${monsterName}`).setLabel("기본 정보").setEmoji("1492145251941482697").setStyle(ButtonStyle.Secondary));
    if (currentTab !== "hitzone" && monsterData.hitzone) row.addComponents(new ButtonBuilder().setCustomId(`hitzone_${monsterName}`).setLabel("육질 정보").setEmoji("1492145248795758602").setStyle(ButtonStyle.Primary));
    if (currentTab !== "drop" && (monsterData.drop || monsterData.drop_low || monsterData.drop_high)) row.addComponents(new ButtonBuilder().setCustomId(`drop_${monsterName}`).setLabel("소재 정보").setEmoji("1492145247327617185").setStyle(ButtonStyle.Success));
    if (currentTab !== "status" && monsterData.status) row.addComponents(new ButtonBuilder().setCustomId(`status_${monsterName}`).setLabel("상태이상 정보").setEmoji("1492145250192331015").setStyle(ButtonStyle.Danger));
    const rows = row.components.length > 0 ? [row] : [];
    // 🔒 잠금 버튼 — 모두가 보는 공개 카드에만, 탭 버튼 아래 별도 줄로 둔다 (lock = { tag: "탭-페이지", locked })
    if (lock) rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`lock_${monsterName}_${lock.tag}`)
        .setLabel(lock.locked ? "잠금 중" : "잠금").setEmoji(lock.locked ? "🔒" : "🔓").setStyle(lock.locked ? ButtonStyle.Danger : ButtonStyle.Secondary)));
    return rows;
}

// 지금 그리는 메시지가 모두가 보는 공개 카드면 잠금 버튼 정보를 돌려준다 (나만 보는 화면이면 없음)
function lockInfo(interaction, mode, tag) {
    if (mode === 'private') return null;
    if (mode === 'public') return { tag, locked: false };
    if (!interaction.message || interaction.message.flags.has(MessageFlags.Ephemeral)) return null;
    return { tag, locked: !!getCardPost(interaction)?.locked };
}

// 탭 버튼과 섞이지 않도록 페이지네이션 버튼만 생성하는 독립 함수 추가
function getPaginationRow(currentAction, monsterName, currentPage, totalPages) {
    if (totalPages <= 1) return [];
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${currentAction}_${monsterName}_${currentPage - 1}`).setLabel("◀ 이전").setStyle(ButtonStyle.Primary).setDisabled(currentPage === 0),
        new ButtonBuilder().setCustomId(`dummy_page`).setLabel(`${currentPage + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`${currentAction}_${monsterName}_${currentPage + 1}`).setLabel("다음 ▶").setStyle(ButtonStyle.Primary).setDisabled(currentPage === totalPages - 1)
    );
    return [row];
}

client.once(Events.ClientReady, async c => {
    console.log(`✅ 봇 로그인 완료: ${c.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(token);
    try {
        await rest.put(Routes.applicationCommands(c.user.id), {
            body: GLOBAL_COMMANDS
        });
        // 테스트 서버 전용 목록을 비워 옛 서버 전용 명령어를 지운다
        await rest.put(Routes.applicationGuildCommands(c.user.id, NEWS_TEST_GUILD_ID), { body: TEST_GUILD_COMMANDS })
            .catch(e => console.error(`[테스트 서버 명령어 등록 실패] ${NEWS_TEST_GUILD_ID}:`, e.code || '', e.message));
    } catch (e) { console.error(e); }
    startNewsWatcher(c, createStore('news', {}), isNewsPaused); // 와일즈 소식(공식 패치노트·캡콤아시아 유튜브·디시 제보) 자동 공지
});

// 응답 하나가 실패해도(예: 3초 초과로 Unknown interaction) 봇 전체가 꺼지지 않도록 여기서 잡는다
client.on(Events.InteractionCreate, async interaction => {
    const label = interaction.customId || interaction.commandName || interaction.type;
    const receivedDelay = Date.now() - interaction.createdTimestamp; // 디스코드 → 봇 도착까지 (서버 시계 오차 포함)
    const start = Date.now();
    try {
        await handleInteraction(interaction);
    } catch (e) {
        console.error(`[상호작용 오류] ${label}: 도착 ${receivedDelay}ms, 처리 ${Date.now() - start}ms,`, e.code || '', e.message);
        return;
    }
    const handled = Date.now() - start;
    if (receivedDelay + handled > SLOW_RESPONSE_MS) {
        console.warn(`[느린 응답] ${label}: 도착 ${receivedDelay}ms + 처리 ${handled}ms (웹소켓 핑 ${client.ws.ping}ms)`);
    }
});

client.on(Events.Error, e => console.error('[클라이언트 오류]', e));
process.on('unhandledRejection', e => console.error('[처리되지 않은 오류]', e));

// ── 나만 보는 목록은 사람마다 하나만 ──
// 나만 보는 메시지는 그 메시지를 만든(또는 그 메시지에서 버튼을 눌러 화면을 바꾼) 상호작용의 토큰으로만
// 지울 수 있고, 토큰은 15분 동안만 유효하다. 그래서 사람마다 마지막 목록의 토큰을 기억해 두고,
// 새 목록을 띄우면 예전 목록을 지운다. 15분이 지난 목록은 지울 수 없어 그대로 남는다.
// (privateLists 는 위 "추적 기록 저장"과 함께 선언)

function rememberPrivateList(interaction) {
    privateLists.set(interaction.user.id, { applicationId: interaction.applicationId, token: interaction.token, at: Date.now() });
    saveState();
}

async function openPrivateList(interaction, page, mode) {
    const old = privateLists.get(interaction.user.id);
    await respondWithContainer(interaction, buildMonsterListContainer(page), mode);
    rememberPrivateList(interaction);
    await deletePrivateList(old);
}

// 기억해 둔 목록을 닫는다 (토큰이 15분 지났으면 지울 수 없어 그냥 둔다)
async function deletePrivateList(list) {
    if (!list || Date.now() - list.at >= INTERACTION_TOKEN_MS) return;
    try {
        await client.rest.delete(Routes.webhookMessage(list.applicationId, list.token, '@original'));
    } catch (e) {
        if (e.code !== 10008) console.error('[목록 닫기 실패]', e.code || '', e.message); // 10008: 이미 닫힘
    }
}

// 공개 카드의 기록(요청자·잠금 상태). 나만 보는 메시지나 기록이 없는 옛 카드는 없음.
function getCardPost(interaction) {
    if (!interaction.message || interaction.message.flags.has(MessageFlags.Ephemeral)) return undefined;
    return publicPosts.get(interaction.channelId)?.get(interaction.message.id);
}
const CARD_TABS = new Set(['basic', 'hitzone', 'drop', 'status', 'dropLow', 'dropHigh']);

// /관리: 컴포넌트 v2 패널(모든 서버에서 열림, 지정 유저·테스트 서버 관리자만 사용). 소식 일시정지/재개·상태 확인·잘못 올라온 소식 삭제를 한곳에 모았고, 테스트 항목은 테스트 서버에서만 보인다.
// 테스트는 운영 기록(알린 글·버전·카드)을 건드리지 않는다.
// 나만 보는 안내 한 줄(컴포넌트 v2 메시지에는 content 를 못 쓰므로 컨테이너에 담는다)
function adminNotice(text, rows = [], accent = DEFAULT_ACCENT) {
    const c = new ContainerBuilder().setAccentColor(accent).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    if (rows.length) c.addActionRowComponents(...rows);
    return { components: [c], flags: V2_EPHEMERAL };
}

// 상태 한 줄: 마지막 성공 시각(상대)과 연속 실패
function sourceStatusLine(s) {
    const t = ms => `<t:${Math.floor(ms / 1000)}:R>`;
    if (s.fails) return `⚠️ **${s.label}** — 연속 ${s.fails}회 실패${s.okAt ? ` (마지막 성공 ${t(s.okAt)})` : ''}${s.error ? `\n　└ ${s.error}` : ''}`;
    return s.okAt ? `✅ **${s.label}** — ${t(s.okAt)}` : `⏳ **${s.label}** — 아직 확인 전`;
}

function buildAdminPanel(guildId) {
    const paused = isNewsPaused();
    const status = getNewsStatus();
    const text = s => new TextDisplayBuilder().setContent(s);
    const container = new ContainerBuilder().setAccentColor(paused ? 0xED4245 : 0x57F287);
    container.addTextDisplayComponents(text('## 🛠️ 길드봇 관리'));
    // 소식 상태 줄 + 오른쪽에 일시정지/재개 버튼
    container.addSectionComponents(new SectionBuilder()
        .addTextDisplayComponents(text(`**소식 알림**\n${paused ? '⏸️ 일시정지 중' : '▶️ 작동 중'}${status ? ` · 오늘 ${status.today}개 올림` : ''}`))
        .setButtonAccessory(new ButtonBuilder().setCustomId('admin_toggle').setLabel(paused ? '재개' : '일시정지').setStyle(paused ? ButtonStyle.Success : ButtonStyle.Danger)));
    if (status) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(text(`**🔎 출처별 마지막 확인**\n${status.sources.map(sourceStatusLine).join('\n')}`.slice(0, 3500)));
    }
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin_refresh').setLabel('새로고침').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('admin_delete').setLabel('소식 삭제').setEmoji('🗑️').setStyle(ButtonStyle.Secondary),
        // 테스트 버튼은 테스트 서버에서만 보인다
        ...(guildId === NEWS_TEST_GUILD_ID ? [new ButtonBuilder().setCustomId('admin_test').setLabel('테스트').setEmoji('🧪').setStyle(ButtonStyle.Secondary)] : []),
    ));
    return { components: [container], flags: V2_EPHEMERAL };
}

let newsPreviewRunning = false;
async function runNewsPreview(interaction, mode) {
    if (newsPreviewRunning) return interaction.reply(adminNotice('이미 올리는 중입니다. 끝난 뒤에 다시 눌러 주세요.'));
    newsPreviewRunning = true;
    await interaction.deferReply({ flags: V2_EPHEMERAL });
    const finish = text => interaction.editReply({ components: adminNotice(text).components }).catch(() => {});
    try {
        const channel = await client.channels.fetch(NEWS_TEST_CHANNEL_ID);
        if (!channel?.isTextBased()) throw new Error(`테스트 채널을 찾을 수 없음(${NEWS_TEST_CHANNEL_ID})`);
        const emojiIds = await fetchEmojiIds(client);
        const post = async p => (await channel.send(p)).id;
        const edit = async (id, p) => (await channel.messages.fetch(id)).edit(p);
        const done = [];
        if (mode !== 'recent') {
            const r = await previewSamples({ sources: buildSources({ YOUTUBE_API_KEY: 'sample' }), post, edit, emojiIds });
            done.push(`임베드 샘플 ${r.samples}종`);
        }
        if (mode !== 'samples') {
            const r = await previewRecent({ sources: buildSources(process.env), post, emojiIds });
            done.push(`최근 실제 소식 ${r.posted}개${r.errors.length ? ` (읽기 실패: ${r.errors.join(', ')})` : ''}`);
        }
        await finish(`<#${NEWS_TEST_CHANNEL_ID}> 에 올렸습니다 — ${done.join(' · ')}`);
    } catch (e) {
        await finish(`실패: ${e.message}`);
    } finally {
        newsPreviewRunning = false;
    }
}

// 최근에 올린 소식 목록(최대 25개)을 고르는 메뉴
function buildDeleteList() {
    const posts = getNewsPosts();
    if (!posts.length) return adminNotice('지울 수 있는 최근 소식이 없습니다. (이번 업데이트 이후 올라온 소식부터 목록에 나와요)');
    return adminNotice('지울 소식을 고르세요.', [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('admin_pick').setPlaceholder('최근 올라온 소식')
            .addOptions(posts.map(p => ({ label: p.title.slice(0, 100) || '(제목 없음)', description: `${p.label} · ${new Date(p.at + 9 * 3600_000).toISOString().slice(5, 16).replace('T', ' ')}`.slice(0, 100), value: p.id })))
    )]);
}

async function handleAdminInteraction(interaction) {
    // 관리 요청이 봇에 닿았는지·허용됐는지 기록(권한 문제를 추적하기 위해)
    console.log(`[관리] ${interaction.isChatInputCommand() ? '/관리' : interaction.customId} — ${interaction.user.tag}(${interaction.user.id}) 서버 ${interaction.guildId ?? 'DM'} → ${canUseAdmin(interaction) ? '허용' : '거부'}`);
    if (!canUseAdmin(interaction)) return interaction.reply(adminNotice('관리자만 쓸 수 있습니다.'));
    if (interaction.isChatInputCommand()) return interaction.reply(buildAdminPanel(interaction.guildId));
    // 이미 떠 있는 메시지를 고치는 응답(v2 표시는 메시지에 이미 있어서 components 만 보낸다)
    const edit = (text, rows = []) => interaction.update({ components: adminNotice(text, rows).components });
    if (interaction.customId === 'admin_toggle') {
        adminStore.data.newsPaused = !adminStore.data.newsPaused;
        adminStore.save();
        console.log(`[소식] ${adminStore.data.newsPaused ? '일시정지' : '재개'} (by ${interaction.user.tag})`);
        return interaction.update({ components: buildAdminPanel(interaction.guildId).components });
    }
    if (interaction.customId === 'admin_refresh') return interaction.update({ components: buildAdminPanel(interaction.guildId).components });
    // 잘못 올라온 소식 삭제: 목록에서 고르고 → 확인 → 채널에서 메시지를 지운다
    if (interaction.customId === 'admin_delete') return interaction.reply(buildDeleteList());
    if (interaction.customId === 'admin_pick') {
        const id = interaction.values[0];
        const post = getNewsPosts().find(p => p.id === id);
        if (!post) return edit('이미 지워졌거나 목록에 없는 소식입니다.');
        return edit(`이 소식을 지울까요? 되돌릴 수 없어요.\n**${post.title}** (${post.label})`, [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`admin_delok_${id}`).setLabel('삭제').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('admin_delcancel').setLabel('취소').setStyle(ButtonStyle.Secondary),
        )]);
    }
    if (interaction.customId === 'admin_delcancel') return edit('취소했습니다.');
    if (interaction.customId.startsWith('admin_delok_')) {
        const id = interaction.customId.slice('admin_delok_'.length);
        try {
            const channel = await client.channels.fetch(NEWS_CHANNEL_ID);
            await channel.messages.delete(id);
        } catch (e) {
            if (e.code !== 10008) return edit(`삭제 실패: ${e.message}`); // 10008: 이미 지워진 메시지는 기록만 정리
        }
        forgetNewsPost(id);
        console.log(`[소식] 메시지 ${id} 삭제 (by ${interaction.user.tag})`);
        return edit('🗑️ 삭제했습니다. 같은 글은 다시 올라오지 않아요.');
    }
    // 테스트 항목은 테스트 서버에서만(버튼도 거기서만 보이지만, 오래된 메시지의 버튼 등 다른 경로도 막는다)
    if (interaction.customId.startsWith('admin_test') && interaction.guildId !== NEWS_TEST_GUILD_ID) return interaction.reply(adminNotice('테스트는 테스트 서버에서만 쓸 수 있습니다.'));
    // 테스트: 무엇을 올릴지 고른다
    if (interaction.customId === 'admin_test') {
        return interaction.reply(adminNotice(`🧪 <#${NEWS_TEST_CHANNEL_ID}> 에 올릴 테스트를 고르세요. 실제 알림 기록에는 영향이 없어요.`, [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admin_test_samples').setLabel('임베드 샘플').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admin_test_recent').setLabel('최근 실제 소식').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admin_test_both').setLabel('둘 다').setStyle(ButtonStyle.Primary),
        )]));
    }
    const mode = interaction.customId.replace('admin_test_', '');
    if (['samples', 'recent', 'both'].includes(mode)) return runNewsPreview(interaction, mode);
}

async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand() && interaction.commandName === '관리') return handleAdminInteraction(interaction);
    if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('admin_')) return handleAdminInteraction(interaction);
    if (interaction.isChatInputCommand() && interaction.commandName === '몬스터') {
        if (isCooldownActive(interaction)) return;
        return openPrivateList(interaction, 0, 'auto');
    }
    if (interaction.isButton()) {
        const parts = interaction.customId.split('_');
        const action = parts[0];
        const monsterName = parts[1];
        // 탭 버튼을 눌렀을 때는 page 정보가 없으므로 0으로 초기화 (숫자가 아니면 0)
        const page = (parts.length > 2 && parseInt(parts[2], 10)) || 0;

        if (action === 'dummy') return;
        // 목록으로 돌아가면 보던 몬스터가 있는 페이지를 연다 (예전 메시지의 'list' 버튼은 첫 페이지).
        // 모두가 보는 몬스터 메시지에서 누르면 그 메시지는 그대로 두고, 누른 사람에게만 목록을 따로 띄운다.
        // 이때 그 사람이 전에 띄워 둔 목록은 지운다.
        if (action === 'list') {
            const listPage = monsterName ? listPageOf(monsterName) : 0;
            if (!interaction.message.flags.has(MessageFlags.Ephemeral)) return openPrivateList(interaction, listPage, 'private');
            await respondWithContainer(interaction, buildMonsterListContainer(listPage));
            return rememberPrivateList(interaction); // 목록을 넘길 때마다 지울 수 있는 시간(15분)도 새로 늘어난다
        }
        if (action === 'listpage') {
            await respondWithContainer(interaction, buildMonsterListContainer(parseInt(monsterName, 10)));
            return rememberPrivateList(interaction);
        }

        const monsterData = getMonsterData(monsterName);
        if (!monsterData) return interaction.reply(buildNoticeMessage(`<:X_:1493987174750748812> 데이터 없음: \`${monsterName}\``));
        // 몬스터를 고르면 채널에 모두가 보는 메시지로 올리고, 고른 나만 보는 목록은 닫는다
        // (다시 고르려면 공개 메시지의 "목록" 버튼으로 새 목록을 연다).
        // 응답을 먼저 보내고(3초 제한) 그다음 목록과 이전 메시지를 지운다.
        if (action === 'pick') {
            const message = await sendPage(interaction, !monsterData.info && monsterData.hitzone ? "hitzone" : "basic", monsterName, monsterData, 0, 'public');
            privateLists.delete(interaction.user.id); // 고른 목록은 위에서 닫혔다
            saveState();
            await replacePublicPosts(interaction, message, monsterName);
            return;
        }
        // 🔒 잠금 버튼: 요청자만 켜고 끌 수 있다. 같은 탭·페이지를 다시 그려 버튼 모양을 바꾼다.
        if (action === 'lock') {
            const post = getCardPost(interaction);
            if (!canToggleLock(post, interaction.user.id)) {
                return interaction.reply(buildNoticeMessage(post ? '🔒 요청자만 잠글 수 있어요.' : '이 메시지는 잠글 수 없어요. 몬스터를 새로 불러 주세요.'));
            }
            post.locked = !post.locked;
            saveState();
            const [tab, pg] = (parts[2] || '').split('-');
            const lockedPage = parseInt(pg, 10) || 0;
            if (tab === 'dropLow' || tab === 'dropHigh') return sendDropPage(interaction, tab === 'dropHigh' ? 'drop_high' : 'drop_low', monsterName, monsterData, lockedPage);
            return sendPage(interaction, CARD_TABS.has(tab) ? tab : 'basic', monsterName, monsterData, lockedPage);
        }
        // 탭·페이지 버튼: 잠긴 공개 카드를 요청자가 아닌 사람이 누르면 카드는 그대로 두고 누른 사람에게만 보이는 사본을 띄운다.
        const mode = decideAccess(getCardPost(interaction), interaction.user.id) === 'locked' ? 'private' : 'auto';
        if (['dropLow', 'dropHigh'].includes(action)) await sendDropPage(interaction, action === 'dropHigh' ? 'drop_high' : 'drop_low', monsterName, monsterData, page, mode);
        else await sendPage(interaction, action, monsterName, monsterData, page, mode);
    }
}

// 기존 마크다운 구축 로직 100% 복구
async function sendPage(interaction, type, monsterName, monsterData, page = 0, mode = 'auto') {
    // 제목에는 아이콘 없이 이름만 (아이콘은 목록 버튼과 오른쪽 썸네일에 있음)
    let description = `# ${monsterName}\n`;

    let blocks = null; // 칸 단위로 나눌 화면(기본 정보·소재)은 여기에 칸을 모으고, 한 페이지에 정해진 개수만 보여 준다
    if (type === "basic") {
        blocks = [];
        blocks.push(`${monsterData.species ? `**【 ${monsterData.species} 】**\n\n` : ''}${getArrayAsString(monsterData, "info")}`);
        if (monsterData.habitat) blocks.push(`**《 서식지 》**\n${habitatLines(monsterData.habitat)}`);
        if (monsterData.threat_level) blocks.push(`**《 위험도 》**\n> ${monsterData.threat_level}`);
        [['breakable_parts', '절단/파괴 가능 부위'], ['weak_point', '약점'], ['element_weakness', '추천 속성']].forEach(([k, t]) => {
            if (monsterData[k]) blocks.push(`**《 ${t} 》**\n${monsterData[k].map(el => `> ${el.trim()}`).join("\n")}`);
        });
    } else if (type === "hitzone") {
        blocks = splitIntoBlocks(getArrayAsString(monsterData, "hitzone"));
    } else if (type === "drop") {
        if (monsterData.drop_low) return sendDropPage(interaction, 'drop_low', monsterName, monsterData, page);
        blocks = splitIntoBlocks(getArrayAsString(monsterData, "drop"));
    } else if (type === "status") {
        if (monsterData.status) {
            const groups = { s3: [], s2: [], s1: [], s0: [] };
            monsterData.status.forEach(el => {
                const cleanName = el.replace(/\s*\(<:[^>]+>\)$/, "").trim();
                const item = `> ${cleanName}`;
                if (el.includes("Star_3")) groups.s3.push(item);
                else if (el.includes("Star_2")) groups.s2.push(item);
                else if (el.includes("Star_1")) groups.s1.push(item);
                else if (el.includes("X_")) groups.s0.push(item);
                else groups.s2.push(item);
            });
            if (groups.s3.length) description += `**《 <:Star_3:1493987178642935941> 매우 유효 》**\n${groups.s3.join("\n")}\n\n`;
            if (groups.s2.length) description += `**《 <:Star_2:1493987181176426629> 유효 》**\n${groups.s2.join("\n")}\n\n`;
            if (groups.s1.length) description += `**《 <:Star_1:1493987182992691280> 조금 유효 》**\n${groups.s1.join("\n")}\n\n`;
            if (groups.s0.length) description += `**《 <:X_:1493987174750748812> 효과 없음 》**\n${groups.s0.join("\n")}\n\n`;
        }

        if (monsterData.special_attack) {
            description += `**《 <:Info_4:1492145251941482697> 몬스터의 특수 공격 》**\n${monsterData.special_attack.map(el => `> ${el}`).join("\n")}\n\n`;
        }

        if (monsterData.item) {
            const valid = [], invalid = [];
            monsterData.item.forEach(el => {
                const cleanName = el.replace(/\s*\(<:[^>]+>\)$/, "").trim();
                const item = `> ${cleanName}`;
                if (el.includes("X_")) invalid.push(item);
                else valid.push(item);
            });
            if (valid.length) description += `**《 <:Check:1493987173194661919> 유효 아이템 》**\n${valid.join("\n")}\n\n`;
            if (invalid.length) description += `**《 <:X_:1493987174750748812> 무효 아이템 》**\n${invalid.join("\n")}\n\n`;
        }
    }

    const pages = blocks
        ? pagesFromBlocks(description, blocks, type === "basic" ? BASIC_BLOCKS_PER_PAGE : type === "hitzone" ? HITZONE_PARTS_PER_PAGE : DROP_ITEMS_PER_PAGE)
        : splitToPages(description);
    const totalPages = pages.length;
    if (page >= totalPages) page = totalPages - 1;
    if (page < 0) page = 0;

    // 탭 버튼(기존)과 페이지 버튼(신규)을 안전하게 결합
    const rows = [
        ...getPaginationRow(type, monsterName, page, totalPages),
        ...getTabButtons(type, monsterName, monsterData, lockInfo(interaction, mode, `${type}-${page}`))
    ];

    return respondWithContainer(interaction, buildMonsterPageContainer(monsterData, pages[page], rows, getRequester(interaction, mode)), mode);
}

// 소재 전용 페이지 역시 기존 마크다운 구축 로직 100% 복구
async function sendDropPage(interaction, rankKey, monsterName, monsterData, page = 0, mode = 'auto') {
    const pages = pagesFromBlocks(`# ${monsterName}\n`, splitIntoBlocks(getArrayAsString(monsterData, rankKey)), DROP_ITEMS_PER_PAGE);

    const totalPages = pages.length;
    if (page >= totalPages) page = totalPages - 1;
    if (page < 0) page = 0;

    // 지금 보고 있는 쪽(하위/상위) 버튼은 회색으로 잠가서 어느 쪽인지 보이게 하고, 다른 쪽만 누를 수 있게 한다
    const isHigh = rankKey === 'drop_high';
    const rankRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`dropLow_${monsterName}`).setLabel("《 하위 》").setEmoji("1492424259262222356")
            .setStyle(isHigh ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!isHigh),
        new ButtonBuilder().setCustomId(`dropHigh_${monsterName}`).setLabel("《 상위 》").setEmoji("1492424261032214589")
            .setStyle(isHigh ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(isHigh)
    );
    
    const currentAction = rankKey === 'drop_high' ? 'dropHigh' : 'dropLow';
    
    const rows = [
        ...getPaginationRow(currentAction, monsterName, page, totalPages),
        rankRow,
        ...getTabButtons("drop", monsterName, monsterData, lockInfo(interaction, mode, `${currentAction}-${page}`))
    ];

    await respondWithContainer(interaction, buildMonsterPageContainer(monsterData, pages[page], rows, getRequester(interaction, mode)), mode);
}

loadState(); // 재시작 전에 올린 공개 메시지·목록 기록 불러오기
client.login(token);