// /장비 — 본인만 보는 장비 창. 무기 종류·속성을 고르면 저장되고, 퀘스트 "참가"는 이 장비로 참가한다.
// 퀘스트 모집 화면의 "장비" 버튼도 같은 창을 띄운다.
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder,
    StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { WEAPONS, WEAPON_ORDER, ELEMENTS, ELEMENT_ORDER, TYPE_NAME, ARMORS } = require('./weapons');
const { getHunter, setLoadout, hrOf } = require('./hunters');

const ACCENT = 0xC9A227;
const listeners = []; // 장비가 바뀌면 알려 줄 곳(모집 화면 갱신)
const onLoadoutChange = fn => listeners.push(fn);

const elementEmoji = key => {
    const m = ELEMENTS[key].emoji.match(/^<:(\w+):(\d+)>$/);
    return m ? { name: m[1], id: m[2] } : { name: ELEMENTS[key].emoji };
};

function buildEquipmentView(userId, note) {
    const h = getHunter(userId);
    const { weapon, element, armor } = h.loadout;
    const w = WEAPONS[weapon];
    const mats = Object.entries(h.materials).sort((a, b) => b[1] - a[1]);
    const matText = mats.length
        ? mats.slice(0, 8).map(([n, c]) => `> ${n} ×${c}`).join('\n') + (mats.length > 8 ? `\n-# 외 ${mats.length - 8}종` : '')
        : '> 아직 없어요. 퀘스트로 몬스터를 토벌하면 소재를 얻어요.';

    const container = new ContainerBuilder().setAccentColor(ACCENT)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            '# 내 장비',
            `**HR ${hrOf(h.hrp)}** · 토벌 ${h.hunts}회`,
            '',
            `**《 무기 》** ${w.name} (${TYPE_NAME[w.type]}${w.guard ? ' · 가드' : ''})`,
            `**《 속성 》** ${ELEMENTS[element].emoji} ${ELEMENTS[element].name}`,
            `**《 방어구 》** ${ARMORS[armor].name}`,
            '',
            '**《 소재함 》**',
            matText,
            note ? `\n-# ${note}` : '',
        ].join('\n')))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('eq:weapon').setPlaceholder('무기 종류 바꾸기')
                .addOptions(WEAPON_ORDER.map(k => ({ label: WEAPONS[k].name, value: k, description: `${TYPE_NAME[WEAPONS[k].type]}${WEAPONS[k].guard ? ' · 가드' : ''}`, default: k === weapon })))),
            new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('eq:element').setPlaceholder('속성 바꾸기')
                .addOptions(ELEMENT_ORDER.map(k => ({ label: ELEMENTS[k].name, value: k, emoji: elementEmoji(k), default: k === element })))),
        )
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# 퀘스트 "참가"를 누르면 이 장비로 참가해요. 모집 중에는 바꿀 수 있고, 전투가 시작되면 고정돼요.'));
    return container;
}

// /장비 명령 또는 모집 화면의 "장비" 버튼 → 본인만 보는 새 창
async function openEquipment(interaction) {
    await interaction.reply({ components: [buildEquipmentView(interaction.user.id)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

// 장비 창의 선택 메뉴
async function handleEquipmentSelect(interaction, locked) {
    const field = interaction.customId === 'eq:weapon' ? 'weapon' : 'element';
    const value = interaction.values[0];
    const valid = field === 'weapon' ? WEAPONS[value] : ELEMENTS[value];
    let note;
    if (locked(interaction.user.id)) note = '⚔️ 전투 중인 퀘스트가 있어서 지금은 바꿀 수 없어요.';
    else if (valid) {
        setLoadout(interaction.user.id, { [field]: value });
        note = '✅ 저장했어요.';
        for (const fn of listeners) { try { fn(interaction.user.id); } catch (e) { console.error('[장비 변경 알림 오류]', e.message); } }
    }
    await interaction.update({ components: [buildEquipmentView(interaction.user.id, note)], flags: MessageFlags.IsComponentsV2 });
}

module.exports = { openEquipment, handleEquipmentSelect, onLoadoutChange };
