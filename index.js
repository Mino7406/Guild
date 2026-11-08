require('dotenv').config();
const { Client, GatewayIntentBits, Events, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, Collection, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, SectionBuilder, ThumbnailBuilder, MessageFlags, resolveColor } = require('discord.js');
const fs = require('fs');
const path = require('path');

const token = process.env.DISCORD_TOKEN;
const { Agent } = require('undici');

// 디스코드 API 연결을 60초까지 유지한다. 기본값(약 4초)이면 잠깐만 안 써도 연결이 끊겨서
// 다음 버튼 클릭 때 TLS 연결을 새로 맺느라 느려진다 (이 서버에서 약 0.2초 차이).
const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    rest: { agent: new Agent({ connect: { timeout: 30000 }, keepAliveTimeout: 60000, keepAliveMaxTimeout: 600000 }) }
});

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

// 몬스터 아이콘 (봇 애플리케이션 이모지) — 목록 버튼과 정보 화면 제목에 표시
const monsterEmojis = {};
for (const name of monsterList) {
    try {
        const emoji = JSON.parse(fs.readFileSync(path.join(MONSTER_DIR, `${name}.json`), 'utf-8')).emoji;
        if (emoji && emoji.id) monsterEmojis[name] = { name: emoji.name, id: emoji.id };
    } catch (e) { console.error(`[몬스터 파일 오류] ${name}:`, e.message); }
}

function monsterIconText(monsterName, monsterData) {
    if (monsterData.icon) return `${monsterData.icon} `;
    const e = monsterEmojis[monsterName];
    return e ? `<:${e.name}:${e.id}> ` : "";
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
    if (mode === 'public') {
        const res = await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, withResponse: true });
        return res?.resource?.message ?? null;
    }
    const canUpdate = mode === 'auto' && interaction.isMessageComponent() && interaction.message.flags.has(MessageFlags.IsComponentsV2);
    if (canUpdate) await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
    else await interaction.reply({ components: [container], flags: V2_EPHEMERAL });
    return null;
}

// ── 도배 방지 ──
// 채널마다 봇이 올린 공개 몬스터 메시지를 기억해 두고, 새로 올릴 때
//  · 같은 사람이 전에 올린 메시지(1인 1메시지)
//  · 같은 몬스터를 보여 주는 메시지(중복 몬스터)
// 를 지운다. 기록은 메모리에만 있어 봇이 재시작하면 그 전 메시지는 지우지 않는다.
const publicPosts = new Map(); // channelId → Map(messageId → { userId, monsterName })

async function replacePublicPosts(interaction, message, monsterName) {
    const channelId = interaction.channelId;
    if (!channelId || !message) return;
    if (!publicPosts.has(channelId)) publicPosts.set(channelId, new Map());
    const posts = publicPosts.get(channelId);
    const stale = [...posts].filter(([id, p]) => id !== message.id && (p.userId === interaction.user.id || p.monsterName === monsterName));
    posts.set(message.id, { userId: interaction.user.id, monsterName, token: interaction.token, at: Date.now() });
    if (posts.size > 100) posts.delete(posts.keys().next().value); // 손으로 지운 메시지 기록이 끝없이 쌓이지 않게
    for (const [id, p] of stale) {
        posts.delete(id);
        await deletePublicPost(channelId, id, p);
    }
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

function getMonsterData(monsterName) {
    try {
        const filePath = path.join(__dirname, 'monsters', `${monsterName}.json`);
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) { return null; }
}

function getArrayAsString(data, key) {
    if (!data[key]) return "정보가 없습니다.";
    return Array.isArray(data[key]) ? data[key].join("\n") : data[key];
}

// 몬스터 화면 한 페이지 = 컨테이너(몬스터 색) 안에 [본문 + 썸네일] 섹션, 구분선, 버튼 줄들
function buildMonsterPageContainer(monsterData, text, rows) {
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

// 기존에 작성하셨던 탭 버튼 로직 100% 원상복구 (버튼 ID 왜곡 방지)
function getTabButtons(currentTab, monsterName, monsterData) {
    const row = new ActionRowBuilder();
    row.addComponents(new ButtonBuilder().setCustomId(`list_${monsterName}`).setLabel("목록").setEmoji("📋").setStyle(ButtonStyle.Secondary));
    if (currentTab !== "basic" && monsterData.info) row.addComponents(new ButtonBuilder().setCustomId(`basic_${monsterName}`).setLabel("기본 정보").setEmoji("1492145251941482697").setStyle(ButtonStyle.Secondary));
    if (currentTab !== "hitzone" && monsterData.hitzone) row.addComponents(new ButtonBuilder().setCustomId(`hitzone_${monsterName}`).setLabel("육질 정보").setEmoji("1492145248795758602").setStyle(ButtonStyle.Primary));
    if (currentTab !== "drop" && (monsterData.drop || monsterData.drop_low || monsterData.drop_high)) row.addComponents(new ButtonBuilder().setCustomId(`drop_${monsterName}`).setLabel("소재 정보").setEmoji("1492145247327617185").setStyle(ButtonStyle.Success));
    if (currentTab !== "status" && monsterData.status) row.addComponents(new ButtonBuilder().setCustomId(`status_${monsterName}`).setLabel("상태이상 정보").setEmoji("1492145250192331015").setStyle(ButtonStyle.Danger));
    return row.components.length > 0 ? [row] : [];
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
            body: [{
                name: '몬스터',
                description: '몬스터 목록을 열고 정보를 확인합니다.'
            }]
        });
    } catch (e) { console.error(e); }
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

async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand() && interaction.commandName === '몬스터') {
        if (isCooldownActive(interaction)) return;
        return respondWithContainer(interaction, buildMonsterListContainer());
    }

    if (interaction.isButton()) {
        const parts = interaction.customId.split('_');
        const action = parts[0];
        const monsterName = parts[1];
        // 탭 버튼을 눌렀을 때는 page 정보가 없으므로 0으로 초기화
        const page = parts.length > 2 ? parseInt(parts[2], 10) : 0;

        if (action === 'dummy') return;
        // 목록으로 돌아가면 보던 몬스터가 있는 페이지를 연다 (예전 메시지의 'list' 버튼은 첫 페이지).
        // 모두가 보는 몬스터 메시지에서 누르면 그 메시지는 그대로 두고, 누른 사람에게만 목록을 따로 띄운다.
        if (action === 'list') {
            const isPublicPost = !interaction.message.flags.has(MessageFlags.Ephemeral);
            return respondWithContainer(interaction, buildMonsterListContainer(monsterName ? listPageOf(monsterName) : 0), isPublicPost ? 'private' : 'auto');
        }
        if (action === 'listpage') return respondWithContainer(interaction, buildMonsterListContainer(parseInt(monsterName, 10)));

        const monsterData = getMonsterData(monsterName);
        if (!monsterData) return interaction.reply(buildNoticeMessage(`<:X_:1493987174750748812> 데이터 없음: \`${monsterName}\``));
        // 몬스터를 고르면 채널에 모두가 보는 메시지로 올린다 (나만 보는 목록은 그대로 남아 다른 몬스터도 고를 수 있음).
        // 응답을 먼저 보내고(3초 제한) 그다음 이전 메시지를 지운다.
        if (action === 'pick') {
            const message = await sendPage(interaction, !monsterData.info && monsterData.hitzone ? "hitzone" : "basic", monsterName, monsterData, 0, 'public');
            await replacePublicPosts(interaction, message, monsterName);
            return;
        }
        else if (['dropLow', 'dropHigh'].includes(action)) await sendDropPage(interaction, action === 'dropHigh' ? 'drop_high' : 'drop_low', monsterName, monsterData, page);
        else await sendPage(interaction, action, monsterName, monsterData, page);
    }
}

// 기존 마크다운 구축 로직 100% 복구
async function sendPage(interaction, type, monsterName, monsterData, page = 0, mode = 'auto') {
    const icon = monsterIconText(monsterName, monsterData);
    let description = `# ${icon}${monsterName}\n`;

    if (type === "basic") {
        if (monsterData.species) description += `**【 ${monsterData.species} 】**\n\n`;
        description += `${getArrayAsString(monsterData, "info")}\n\n`;
        if (monsterData.habitat) description += `**《 서식지 》**\n> ${monsterData.habitat}\n\n`;
        if (monsterData.threat_level) description += `**《 위험도 》**\n> ${monsterData.threat_level}\n\n`;
        [['breakable_parts', '절단/파괴 가능 부위'], ['weak_point', '약점'], ['element_weakness', '추천 속성']].forEach(([k, t]) => {
            if (monsterData[k]) description += `**《 ${t} 》**\n${monsterData[k].map(el => `> ${el.trim()}`).join("\n")}\n\n`;
        });
    } else if (type === "hitzone") {
        description += getArrayAsString(monsterData, "hitzone");
    } else if (type === "drop") {
        if (monsterData.drop_low) return sendDropPage(interaction, 'drop_low', monsterName, monsterData, page);
        description += getArrayAsString(monsterData, "drop");
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

    const pages = splitToPages(description);
    const totalPages = pages.length;
    if (page >= totalPages) page = totalPages - 1;
    if (page < 0) page = 0;

    // 탭 버튼(기존)과 페이지 버튼(신규)을 안전하게 결합
    const rows = [
        ...getPaginationRow(type, monsterName, page, totalPages),
        ...getTabButtons(type, monsterName, monsterData)
    ];

    return respondWithContainer(interaction, buildMonsterPageContainer(monsterData, pages[page], rows), mode);
}

// 소재 전용 페이지 역시 기존 마크다운 구축 로직 100% 복구
async function sendDropPage(interaction, rankKey, monsterName, monsterData, page = 0) {
    const icon = monsterIconText(monsterName, monsterData);
    const description = `# ${icon}${monsterName}\n\n${getArrayAsString(monsterData, rankKey)}`;
    const pages = splitToPages(description);

    const totalPages = pages.length;
    if (page >= totalPages) page = totalPages - 1;
    if (page < 0) page = 0;

    const rankRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`dropLow_${monsterName}`).setLabel("《 하위 》").setEmoji("1492424259262222356").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`dropHigh_${monsterName}`).setLabel("《 상위 》").setEmoji("1492424261032214589").setStyle(ButtonStyle.Success)
    );
    
    const currentAction = rankKey === 'drop_high' ? 'dropHigh' : 'dropLow';
    
    const rows = [
        ...getPaginationRow(currentAction, monsterName, page, totalPages),
        rankRow,
        ...getTabButtons("drop", monsterName, monsterData)
    ];

    await respondWithContainer(interaction, buildMonsterPageContainer(monsterData, pages[page], rows));
}

client.login(token);