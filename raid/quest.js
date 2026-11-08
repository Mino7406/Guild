// /퀘스트 — 모집 → 턴제 전투 → 결과. 채널마다 퀘스트는 하나.
// 반응 속도·동시 클릭은 Arcade 레이드 방식을 따른다:
//  · 버튼은 즉시 확인(deferUpdate)만 하고 상태를 바꾼다
//  · 메시지 수정은 퀘스트마다 대기열 하나가 차례로 맡고, 보낼 때마다 "지금 상태"로 화면을 새로 만든다
//    (늦게 도착한 옛 화면이 새 화면을 덮어쓰지 않음). 글자만 바뀌면 300ms 모아서, 그림이 바뀌면 바로 보낸다
//  · 채팅에 묻히면 맨 아래로 다시 올린다
//  · 진행 상태는 data/quests.json 에 저장돼 봇이 재시작해도 이어진다
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, AttachmentBuilder, MessageFlags, Routes } = require('discord.js');
const { createStore } = require('./store');
const { WEAPONS, weaponLabel } = require('./weapons');
const { getHunter, grantRewards, hrOf } = require('./hunters');
const B = require('./battle');
const { renderPanel } = require('./render');
const { openEquipment, onLoadoutChange } = require('./equipment');

const PARTY_MAX = 4;
const RECRUIT_MS = 10 * 60 * 1000;     // 모집 대기 — 지나면 자동 취소
const TURN_MS = 45 * 1000;             // 턴당 선택 시간 — 못 고르면 공격
const BATTLE_LIMIT_MS = 25 * 60 * 1000; // 전투 제한 시간
const RENDER_DEBOUNCE_MS = 300;
const BUMP_DELAY_MS = 3000;
const IMAGE_NAME = 'quest.png';
const ACCENT = { recruit: 0xD9A93F, battle: 0xC9A227, rage: 0xE8453C, win: 0x57F287, fail: 0x4E5058, cancel: 0x4E5058 };

let client = null;
const store = createStore('quests', {}); // channelId → 저장용 퀘스트
const quests = new Map();                 // channelId → 퀘스트(타이머 등 런타임 포함)

const questOf = userId => [...quests.values()].find(q => q.phase !== 'ended' && (q.battle ? q.battle.hunters : q.members).some(m => m.userId === userId));
const isLockedForEquip = userId => questOf(userId)?.phase === 'battle';

// ── 저장 ──
function persist(q) {
    if (q.phase === 'ended') delete store.data[q.channelId];
    else store.data[q.channelId] = {
        channelId: q.channelId, messageId: q.messageId, monster: q.monster, hostId: q.hostId, phase: q.phase,
        members: q.members, battle: q.battle, createdAt: q.createdAt, battleStartedAt: q.battleStartedAt, turnDeadline: q.turnDeadline,
    };
    store.save();
}

// ── 화면 ──
const ts = ms => `<t:${Math.floor(ms / 1000)}:R>`;

function headerLines(q) {
    const m = B.MONSTERS[q.monster];
    return [`# 📜 ${m.name} 토벌`, `-# 의뢰인 <@${q.hostId}>`];
}

function recruitView(q, imageUrl) {
    const lines = [...headerLines(q), '',
        `**파티** ${q.members.length} / ${PARTY_MAX}`,
        ...q.members.map(mem => `> ${mem.userId === q.hostId ? '👑 ' : ''}**${mem.name}** — ${weaponLabel(mem.loadout)}`),
        '', `-# "참가"는 /장비에 저장한 장비로 참가해요. 모집 마감 ${ts(q.createdAt + RECRUIT_MS)}`];
    const rows = [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('q:join').setLabel('참가').setEmoji('⚔️').setStyle(ButtonStyle.Success).setDisabled(q.members.length >= PARTY_MAX),
        new ButtonBuilder().setCustomId('q:leave').setLabel('나가기').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('q:equip').setLabel('장비').setEmoji('🛡️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('q:start').setLabel('출발').setEmoji('🚩').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('q:cancel').setLabel('취소').setStyle(ButtonStyle.Danger),
    )];
    return assemble(ACCENT.recruit, imageUrl, lines.join('\n'), rows);
}

function battleView(q, imageUrl) {
    const b = q.battle;
    const m = B.MONSTERS[q.monster];
    const choosing = B.activeHunters(b);
    const waiting = choosing.filter(h => !h.action).map(h => h.name);
    const lines = [...headerLines(q), '',
        `### ${B.isSmashIntent(b) ? '⚠️' : '🐉'} 다음 행동`,
        `> ${B.telegraphText(b)}`, '',
        waiting.length ? `⏳ 고르는 중: ${waiting.join(', ')} · ${ts(q.turnDeadline)}` : '✅ 모두 골랐어요',
    ];
    if (b.log.length) lines.push('', `**《 지난 턴 》**`, ...b.log.slice(0, 14).map(l => `-# ${l}`));
    const partSelect = new StringSelectMenuBuilder().setCustomId('q:part').setPlaceholder('노릴 부위 바꾸기 (각자 따로 저장)')
        .addOptions(m.parts.map(p => ({ label: `${p.name}${b.parts[p.id].broken ? ' (파괴됨)' : ''}`, value: p.id, description: `절단 ${p.hz.slash} · 타격 ${p.hz.strike} · 탄 ${p.hz.shot}` })));
    const rows = [
        new ActionRowBuilder().addComponents(partSelect),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('q:act:attack').setLabel('공격').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('q:act:skill').setLabel('무기 기술').setEmoji('✨').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('q:act:defend').setLabel('회피 / 가드').setEmoji('💨').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('q:act:potion').setLabel('회복약').setEmoji('🧪').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('q:mine').setLabel('내 상태').setStyle(ButtonStyle.Secondary),
        ),
    ];
    return assemble(b.rage ? ACCENT.rage : ACCENT.battle, imageUrl, lines.join('\n'), rows);
}

function endView(q, imageUrl) {
    const m = B.MONSTERS[q.monster];
    const lines = [...headerLines(q), ''];
    if (q.outcome === 'win') {
        lines.push(`## 🏆 토벌 성공!`);
        for (const r of q.rewards || []) {
            const mats = Object.entries(r.materials).map(([n, c]) => `${n}${c > 1 ? ` ×${c}` : ''}`).join(', ') || '없음';
            lines.push(`> **${r.name}** — ${mats} · HR ${r.hr}`);
        }
    } else if (q.outcome === 'fail') lines.push('## 🛒 퀘스트 실패', `> ${m.name}에게 수레 ${B.MAX_CARTS}회로 쓰러졌어요.`);
    else if (q.outcome === 'timeout') lines.push('## ⌛ 시간 초과', `> ${m.name}이(가) 자리를 떠났어요.`);
    else lines.push('## 퀘스트 취소', `> ${q.cancelReason || '모집이 취소됐어요.'}`);
    if (q.battle?.log.length) lines.push('', '**《 마지막 턴 》**', ...q.battle.log.slice(0, 12).map(l => `-# ${l}`));
    const accent = q.outcome === 'win' ? ACCENT.win : q.outcome === 'fail' ? ACCENT.fail : ACCENT.cancel;
    return assemble(accent, imageUrl, lines.join('\n'), []);
}

function assemble(accent, imageUrl, text, rows) {
    const c = new ContainerBuilder().setAccentColor(accent);
    if (imageUrl) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl)));
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    if (rows.length) {
        c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        c.addActionRowComponents(rows);
    }
    return c;
}

async function buildPayload(q, redraw) {
    const view = q.phase === 'recruit' ? recruitView : q.phase === 'battle' ? battleView : endView;
    if (redraw || !q.imageUrl) {
        const png = await renderPanel(q);
        return { components: [view(q, `attachment://${IMAGE_NAME}`)], files: [new AttachmentBuilder(png, { name: IMAGE_NAME })], attachments: [], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
    }
    return { components: [view(q, q.imageUrl)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function rememberImage(q, message) {
    const att = message?.attachments?.first?.();
    if (att) q.imageUrl = att.url;
}

// ── 화면 갱신 대기열 ──
function requestRender(q, { image = false, immediate = false } = {}) {
    q.dirty = true;
    if (image) q.imageDirty = true;
    if (q.flushing) return;
    if (q.flushTimer && !immediate) return;
    if (q.flushTimer) clearTimeout(q.flushTimer);
    q.flushTimer = setTimeout(() => flush(q).catch(e => console.error('[퀘스트 화면 갱신 실패]', e)), immediate ? 0 : RENDER_DEBOUNCE_MS);
}

const FATAL_CODES = new Set([10003, 50001, 50013]);

async function flush(q) {
    q.flushTimer = null;
    q.flushing = true;
    try {
        while (q.dirty) {
            q.dirty = false;
            const redraw = q.imageDirty;
            q.imageDirty = false;
            const channel = await client.channels.fetch(q.channelId).catch(() => null);
            if (!channel) { endQuest(q, 'cancel', '채널을 찾을 수 없어요.'); continue; }
            const buried = q.phase !== 'ended' && channel.lastMessageId && channel.lastMessageId !== q.messageId;
            const payload = await buildPayload(q, redraw || buried);
            try {
                let message;
                if (buried || !q.messageId) {
                    message = await channel.send(payload);
                    const oldId = q.messageId;
                    q.messageId = message.id;
                    if (oldId) channel.messages.delete(oldId).catch(() => {});
                } else {
                    message = await channel.messages.edit(q.messageId, payload);
                }
                if (payload.files) rememberImage(q, message);
                persist(q);
            } catch (e) {
                console.error('[퀘스트 메시지 갱신 실패]', e.code || '', e.message);
                if (e.code === 10008) { q.messageId = null; q.dirty = true; q.imageDirty = true; continue; } // 누가 지웠으면 새로 올림
                if (FATAL_CODES.has(e.code) && q.phase !== 'ended') endQuest(q, 'cancel', '채널 권한이 없어 퀘스트를 이어갈 수 없어요.');
                else if (redraw) q.imageDirty = true;
            }
        }
    } finally {
        q.flushing = false;
    }
}

// ── 진행 ──
function clearTimers(q) {
    for (const k of ['recruitTimer', 'turnTimer', 'limitTimer', 'flushTimer']) if (q[k]) { clearTimeout(q[k]); q[k] = null; }
}

function scheduleRecruit(q) {
    q.recruitTimer = setTimeout(() => endQuest(q, 'cancel', '모집 시간이 지나 퀘스트가 취소됐어요.'), Math.max(0, q.createdAt + RECRUIT_MS - Date.now()));
}

function scheduleTurn(q) {
    if (q.turnTimer) clearTimeout(q.turnTimer);
    q.turnTimer = setTimeout(() => advanceTurn(q), Math.max(0, q.turnDeadline - Date.now()));
}

function startBattle(q) {
    clearTimeout(q.recruitTimer); q.recruitTimer = null;
    // 시작할 때의 장비로 고정
    q.battle = B.createBattle(q.monster, q.members.map(mem => ({ ...mem, loadout: { ...getHunter(mem.userId).loadout } })));
    q.phase = 'battle';
    q.battleStartedAt = Date.now();
    q.turnDeadline = Date.now() + TURN_MS;
    scheduleTurn(q);
    q.limitTimer = setTimeout(() => endQuest(q, 'timeout'), BATTLE_LIMIT_MS);
    requestRender(q, { image: true, immediate: true });
}

function advanceTurn(q) {
    if (q.phase !== 'battle') return;
    B.resolveTurn(q.battle);
    if (q.battle.outcome) return endQuest(q, q.battle.outcome);
    q.turnDeadline = Date.now() + TURN_MS;
    scheduleTurn(q);
    requestRender(q, { image: true, immediate: true });
}

function endQuest(q, outcome, reason) {
    if (q.phase === 'ended') return;
    clearTimers(q);
    q.phase = 'ended';
    q.outcome = outcome;
    q.cancelReason = reason;
    if (outcome === 'win') {
        q.rewards = q.battle.hunters.map(h => {
            const r = B.rollRewards(q.battle);
            grantRewards(h.userId, r.materials, r.hrp);
            return { name: h.name, materials: r.materials, hr: hrOf(getHunter(h.userId).hrp) };
        });
    }
    if (quests.get(q.channelId) === q) quests.delete(q.channelId);
    persist(q);
    requestRender(q, { image: true, immediate: true });
}

// ── 명령·버튼 ──
const displayName = interaction => interaction.member?.displayName || interaction.user.globalName || interaction.user.username;

async function notice(interaction, text) {
    const c = new ContainerBuilder().setAccentColor(0x5865F2).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    const payload = { components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
    return interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload);
}

// /퀘스트 → 본인만 보는 몬스터 선택
async function openQuestBoard(interaction) {
    if (!interaction.inGuild()) return notice(interaction, '퀘스트는 서버 채널에서만 열 수 있어요.');
    const keys = Object.keys(B.MONSTERS);
    const c = new ContainerBuilder().setAccentColor(ACCENT.recruit)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('# 📜 퀘스트 보드\n토벌할 몬스터를 고르면 이 채널에 파티 모집이 열려요.'))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    for (let i = 0; i < keys.length; i += 3) {
        c.addActionRowComponents(new ActionRowBuilder().addComponents(keys.slice(i, i + 3).map(k => {
            const btn = new ButtonBuilder().setCustomId(`q:open:${k}`).setLabel(B.MONSTERS[k].name).setStyle(ButtonStyle.Secondary);
            const e = B.MONSTERS[k].dex.emoji;
            if (e?.id) btn.setEmoji({ name: e.name, id: e.id });
            return btn;
        })));
    }
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# 다른 몬스터는 업데이트로 추가돼요. 장비는 /장비에서 미리 정해 두세요.'));
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

async function openQuest(interaction, monsterKey) {
    if (!B.MONSTERS[monsterKey]) return notice(interaction, '알 수 없는 몬스터예요.');
    const existing = quests.get(interaction.channelId);
    if (existing) return notice(interaction, '이 채널에는 이미 진행 중인 퀘스트가 있어요.');
    if (questOf(interaction.user.id)) return notice(interaction, '이미 다른 퀘스트에 참가 중이에요.');
    await interaction.deferUpdate();
    const q = {
        channelId: interaction.channelId, messageId: null, monster: monsterKey, hostId: interaction.user.id, phase: 'recruit',
        members: [{ userId: interaction.user.id, name: displayName(interaction), loadout: { ...getHunter(interaction.user.id).loadout } }],
        createdAt: Date.now(),
    };
    quests.set(q.channelId, q);
    scheduleRecruit(q);
    requestRender(q, { image: true, immediate: true });
    interaction.deleteReply().catch(() => {}); // 퀘스트 보드 닫기
}

const isAdmin = interaction => interaction.memberPermissions?.has('ManageMessages');

async function handleQuestButton(interaction) {
    const [, action, arg] = interaction.customId.split(':');
    if (action === 'open') return openQuest(interaction, arg);

    const q = quests.get(interaction.channelId);
    if (!q || q.messageId !== interaction.message.id) return notice(interaction, '이미 끝났거나 아래로 옮겨진 퀘스트예요.');
    const uid = interaction.user.id;

    if (action === 'equip') return openEquipment(interaction);

    if (q.phase === 'recruit') {
        const inParty = q.members.some(m => m.userId === uid);
        if (action === 'join') {
            if (inParty) return notice(interaction, '이미 참가했어요.');
            if (questOf(uid)) return notice(interaction, '이미 다른 퀘스트에 참가 중이에요.');
            if (q.members.length >= PARTY_MAX) return notice(interaction, '파티가 가득 찼어요.');
            await interaction.deferUpdate();
            q.members.push({ userId: uid, name: displayName(interaction), loadout: { ...getHunter(uid).loadout } });
            return requestRender(q, { image: true, immediate: true });
        }
        if (action === 'leave') {
            if (!inParty) return notice(interaction, '참가하지 않았어요.');
            await interaction.deferUpdate();
            q.members = q.members.filter(m => m.userId !== uid);
            if (!q.members.length) return endQuest(q, 'cancel', '파티원이 모두 나가 퀘스트가 취소됐어요.');
            if (q.hostId === uid) q.hostId = q.members[0].userId; // 방장이 나가면 다음 사람에게
            return requestRender(q, { image: true, immediate: true });
        }
        if (action === 'start') {
            if (uid !== q.hostId) return notice(interaction, '의뢰인(👑)만 출발할 수 있어요.');
            await interaction.deferUpdate();
            return startBattle(q);
        }
        if (action === 'cancel') {
            if (uid !== q.hostId && !isAdmin(interaction)) return notice(interaction, '의뢰인(👑)이나 관리자만 취소할 수 있어요.');
            await interaction.deferUpdate();
            return endQuest(q, 'cancel', '의뢰인이 퀘스트를 취소했어요.');
        }
    }

    if (q.phase === 'battle') {
        const b = q.battle;
        const h = b.hunters.find(x => x.userId === uid);
        if (action === 'mine') {
            if (!h) return notice(interaction, '이 퀘스트의 파티원이 아니에요.');
            const part = B.MONSTERS[q.monster].parts.find(p => p.id === h.target);
            return notice(interaction, [`**${h.name}** — ${weaponLabel(h.loadout)}`, `체력 ${h.hp} / ${B.HUNTER_MAX_HP}`, `노리는 부위: **${part?.name}**`, `이번 턴: ${h.action ? B.ACTIONS[h.action].name : '아직 안 고름'}`, `준 피해 합계: ${h.dealt}`].join('\n'));
        }
        if (action === 'act') {
            const act = arg === 'defend' ? (h && WEAPONS[h.loadout.weapon].guard ? 'guard' : 'evade') : arg;
            const err = B.chooseAction(b, uid, act);
            if (err) return notice(interaction, err);
            await interaction.deferUpdate();
            if (B.allChosen(b)) return advanceTurn(q);
            return requestRender(q, { image: true }); // 카드의 "선택 완료" 표시
        }
    }
    return notice(interaction, '지금은 쓸 수 없는 버튼이에요.');
}

async function handleQuestSelect(interaction) {
    const q = quests.get(interaction.channelId);
    if (!q || q.phase !== 'battle' || q.messageId !== interaction.message.id) return notice(interaction, '이미 끝났거나 아래로 옮겨진 퀘스트예요.');
    const err = B.setTarget(q.battle, interaction.user.id, interaction.values[0]);
    if (err) return notice(interaction, err);
    const part = B.MONSTERS[q.monster].parts.find(p => p.id === interaction.values[0]);
    return notice(interaction, `🎯 이제 **${part.name}**을(를) 노려요.`);
}

// 채팅이 올라오면 3초 모았다가 퀘스트 메시지를 맨 아래로
function noteChannelMessage(message) {
    const q = quests.get(message.channelId);
    if (!q || q.phase === 'ended' || message.author?.id === client.user?.id || q.bumpTimer) return;
    q.bumpTimer = setTimeout(() => { q.bumpTimer = null; if (quests.get(q.channelId) === q) requestRender(q, { immediate: true }); }, BUMP_DELAY_MS);
}

// 모집 중에 장비를 바꾸면 모집 화면에 반영
onLoadoutChange(userId => {
    const q = questOf(userId);
    if (!q || q.phase !== 'recruit') return;
    const mem = q.members.find(m => m.userId === userId);
    mem.loadout = { ...getHunter(userId).loadout };
    requestRender(q, { image: true });
});

// 봇이 켜질 때: 저장된 퀘스트 이어가기
function init(c) {
    client = c;
    for (const saved of Object.values(store.data)) {
        if (!B.MONSTERS[saved.monster]) { delete store.data[saved.channelId]; continue; }
        const q = { ...saved };
        quests.set(q.channelId, q);
        if (q.phase === 'recruit') scheduleRecruit(q);
        else if (q.phase === 'battle') {
            q.turnDeadline = Math.max(q.turnDeadline || 0, Date.now() + TURN_MS); // 재시작했으면 이번 턴은 다시 시간을 준다
            scheduleTurn(q);
            q.limitTimer = setTimeout(() => endQuest(q, 'timeout'), Math.max(TURN_MS, q.battleStartedAt + BATTLE_LIMIT_MS - Date.now()));
        }
        requestRender(q, { image: true, immediate: true });
    }
    if (quests.size) console.log(`[퀘스트 이어감] ${quests.size}개`);
}

module.exports = { init, openQuestBoard, handleQuestButton, handleQuestSelect, noteChannelMessage, isLockedForEquip, _quests: quests };
