require('dotenv').config();
const { Client, GatewayIntentBits, Events, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

const token = process.env.DISCORD_TOKEN;
// ✅ Intents 설정 확인 (v14 기준)
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// 몬스터 목록 및 별명 데이터
const monsterList = [
    "레 다우", "우드 투나", "누 이그드라", "진 다하드", "리오레우스", "조 시아", "알슈베르도", "고어 마가라",
    "타마미츠네", "라기아크루스", "셀레기오스", "오메가 플라네테스", "고그마지오스", "고양이 훈련 통 펀처"
];

const monsterAliases = {
    "레 다우": ["레다우", "레", "레황", "황뢰룡"],
    "우드 투나": ["우드", "우드투나", "참치", "나무참치", "나무 참치", "파의룡"],
    "누 이그드라": ["누", "누이그드라", "누따끄", "마따끄", "문어", "염옥소"],
    "진 다하드": ["찐따", "진다", "진다하드", "찐따하드", "이긴다 소프트", "동봉룡"],
    "리오레우스": ["레우스", "리오", "화룡"],
    "조 시아": ["바퀴벌레", "조시아", "백열룡"],
    "고어 마가라": ["고어마가라", "고어", "마가라", "고아", "흑식룡"],
    "알슈베르도": ["알슈", "뉴트리아", "나타", "쇄인룡"],
    "타마미츠네": ["타마", "미츠네", "여우", "거품", "포호룡"],
    "라기아크루스": ["라기", "라기아", "악어", "수중전", "해룡"],
    "셀레기오스": ["셀레기", "제트킥", "째트킥", "셀레", "칼날비늘", "천인룡"],
    "오메가 플라네테스": ["오메가", "파판", "파이널판타지", "파이널 판타지", "기계", "메카", "풍뎅이", "메카풍뎅이", "병신"],
    "고그마지오스": ["고그", "고그마", "고구마", "거극룡", "거극", "파룡포", "기름"],
    "고양이 훈련 통 펀처": ["펀처", "고양이 훈련 통", "훈련 통 펀처", "연습장", "연습", "훈련", "수련장", "수련"]
};

// 쿨타임 저장소
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
            interaction.reply({ content: `<:Timer:1493995200488669217> **${remainingSeconds}초** 후에 다시 시도해 주세요!`, ephemeral: true });
            return true;
        }
    }
    cooldowns.set(userId, currentTime);
    return false;
}

function normalize(str) { 
    return (str || "").replace(/ /g, "").toLowerCase(); 
}

function resolveMonsterName(input) {
    const normalizedInput = normalize(input);
    for (const official of monsterList) {
        if (normalize(official) === normalizedInput) return official;
    }
    for (const [key, aliases] of Object.entries(monsterAliases)) {
        for (const alias of aliases) {
            if (normalize(alias) === normalizedInput) return key;
        }
    }
    return input;
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

function createBaseEmbed(monsterName, monsterData) {
    const embed = new EmbedBuilder().setColor(monsterData.color || 0xFFFFFF);
    if (monsterData.thumbnail) embed.setThumbnail(monsterData.thumbnail);
    return embed;
}

function splitToEmbeds(monsterName, monsterData, fullDescription) {
    const embeds = [];
    const maxLength = 3800;
    let remainingText = fullDescription;
    while (remainingText.length > 0) {
        const embed = createBaseEmbed(monsterName, monsterData);
        if (remainingText.length <= maxLength) {
            embed.setDescription(remainingText);
            embeds.push(embed);
            break;
        }
        let splitIndex = remainingText.lastIndexOf('\n', maxLength);
        if (splitIndex === -1) splitIndex = maxLength;
        embed.setDescription(remainingText.substring(0, splitIndex));
        embeds.push(embed);
        remainingText = remainingText.substring(splitIndex).trim();
    }
    return embeds;
}

function getTabButtons(currentTab, monsterName, monsterData) {
    const row = new ActionRowBuilder();
    if (currentTab !== "basic" && monsterData.info) row.addComponents(new ButtonBuilder().setCustomId(`basic_${monsterName}`).setLabel("기본 정보").setEmoji("1492145251941482697").setStyle(ButtonStyle.Secondary));
    if (currentTab !== "hitzone" && monsterData.hitzone) row.addComponents(new ButtonBuilder().setCustomId(`hitzone_${monsterName}`).setLabel("육질 정보").setEmoji("1492145248795758602").setStyle(ButtonStyle.Primary));
    if (currentTab !== "drop" && (monsterData.drop || monsterData.drop_low || monsterData.drop_high)) row.addComponents(new ButtonBuilder().setCustomId(`drop_${monsterName}`).setLabel("소재 정보").setEmoji("1492145247327617185").setStyle(ButtonStyle.Success));
    if (currentTab !== "status" && monsterData.status) row.addComponents(new ButtonBuilder().setCustomId(`status_${monsterName}`).setLabel("상태이상 정보").setEmoji("1492145250192331015").setStyle(ButtonStyle.Danger));
    return row.components.length > 0 ? [row] : [];
}

client.once(Events.ClientReady, async c => {
    console.log(`✅ 봇 로그인 완료: ${c.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(token);
    try {
        // 명령어 등록 시 autocomplete: true 확인
        await rest.put(Routes.applicationCommands(c.user.id), {
            body: [{
                name: '몬스터',
                description: '해당 몬스터의 정보를 확인합니다.',
                options: [{
                    type: 3, 
                    name: '이름',
                    description: '검색할 몬스터의 이름을 입력하세요.',
                    required: true,
                    autocomplete: true
                }]
            }]
        });
        console.log('✅ 전역 명령어 등록 완료! (반영까지 최대 1시간 소요될 수 있습니다.)');
    } catch (error) { console.error(error); }
});

client.on(Events.InteractionCreate, async interaction => {
    // 💡 1. 자동완성 처리 보강
    if (interaction.isAutocomplete()) {
        const focusedValue = interaction.options.getFocused();
        const currentInput = normalize(focusedValue);
        
        const options = monsterList
            .filter(name => {
                const matchOfficial = normalize(name).includes(currentInput);
                const matchAlias = monsterAliases[name] && monsterAliases[name].some(a => normalize(a).includes(currentInput));
                return matchOfficial || matchAlias;
            })
            .slice(0, 25)
            .map(name => ({ name, value: name }));

        await interaction.respond(options);
        return;
    }

    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === '몬스터') {
            if (isCooldownActive(interaction)) return;
            const userInput = interaction.options.getString('이름').trim();
            const monsterName = resolveMonsterName(userInput);
            const monsterData = getMonsterData(monsterName);
            if (!monsterData) return interaction.reply({ content: `<:X_:1493987174750748812> 데이터 없음: \`${userInput}\``, ephemeral: true });
            await sendPage(interaction, !monsterData.info && monsterData.hitzone ? "hitzone" : "basic", monsterName, monsterData);
        }
    }

    if (interaction.isButton()) {
        const [action, monsterName] = interaction.customId.split('_');
        const monsterData = getMonsterData(monsterName);
        if (!monsterData) return;
        if (['dropLow', 'dropHigh'].includes(action)) await sendDropPage(interaction, action === 'dropHigh' ? 'drop_high' : 'drop_low', monsterName, monsterData);
        else await sendPage(interaction, action, monsterName, monsterData);
    }
});

async function sendPage(interaction, type, monsterName, monsterData) {
    const icon = monsterData.icon ? `${monsterData.icon} ` : "";
    let description = `# ${icon}${monsterName}\n`;

    if (type === "basic") {
        if (monsterData.species) description += `**【 ${monsterData.species} 】**\n\n`;
        description += `${getArrayAsString(monsterData, "info")}\n\n`;
        if (monsterData.habitat) description += `**《 서식지 》**\n> ${monsterData.habitat}\n\n`;
        if (monsterData.threat_level) description += `**《 위험도 》**\n> ${monsterData.threat_level}\n\n`;
        [['breakable_parts', '파괴 가능 부위'], ['weak_point', '약점'], ['element_weakness', '추천 속성']].forEach(([key, title]) => {
            if (monsterData[key]) {
                description += `**《 ${title} 》**\n${monsterData[key].map(el => `> ${el.trim()}`).join("\n")}\n\n`;
            }
        });
    } else if (type === "hitzone") description += getArrayAsString(monsterData, "hitzone");
    else if (type === "drop") {
        if (monsterData.drop_low) return sendDropPage(interaction, 'drop_low', monsterName, monsterData);
        description += getArrayAsString(monsterData, "drop");
    } else if (type === "status") {
        if (monsterData.status) {
            const groups = { s3: [], s2: [], s1: [], s0: [] };
            monsterData.status.forEach(el => {
                const clean = `> ${el.trim()}`;
                if (el.includes("Star_3")) groups.s3.push(clean);
                else if (el.includes("Star_2")) groups.s2.push(clean);
                else if (el.includes("Star_1")) groups.s1.push(clean);
                else if (el.includes("X_")) groups.s0.push(clean);
                else groups.s2.push(clean);
            });
            if (groups.s3.length) description += `**《 매우 유효 》**\n${groups.s3.join("\n")}\n\n`;
            if (groups.s2.length) description += `**《 유효 》**\n${groups.s2.join("\n")}\n\n`;
            if (groups.s1.length) description += `**《 조금 유효 》**\n${groups.s1.join("\n")}\n\n`;
            if (groups.s0.length) description += `**《 효과 없음 》**\n${groups.s0.join("\n")}\n\n`;
        }
        if (monsterData.item) {
            const valid = [], invalid = [];
            monsterData.item.forEach(el => {
                const clean = `> ${el.trim()}`;
                if (el.includes("X_")) invalid.push(clean);
                else valid.push(clean);
            });
            if (valid.length) description += `**《 유효 아이템 》**\n${valid.join("\n")}\n\n`;
            if (invalid.length) description += `**《 무효 아이템 》**\n${invalid.join("\n")}\n\n`;
        }
        if (monsterData.special_attack) description += `**《 특수 공격 》**\n${monsterData.special_attack.map(el => `> ${el}`).join("\n")}\n\n`;
    }

    const embeds = splitToEmbeds(monsterName, monsterData, description);
    const components = getTabButtons(type, monsterName, monsterData);
    if (interaction.isButton()) await interaction.update({ embeds, components });
    else await interaction.reply({ embeds, components });
}

async function sendDropPage(interaction, rankKey, monsterName, monsterData) {
    const icon = monsterData.icon ? `${monsterData.icon} ` : "";
    const description = `# ${icon}${monsterName}\n\n${getArrayAsString(monsterData, rankKey)}`;
    const embeds = splitToEmbeds(monsterName, monsterData, description);
    const rankRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`dropLow_${monsterName}`).setLabel("《 하위 》").setEmoji("1492424259262222356").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`dropHigh_${monsterName}`).setLabel("《 상위 》").setEmoji("1492424261032214589").setStyle(ButtonStyle.Success)
    );
    const components = [rankRow, ...getTabButtons("drop", monsterName, monsterData)];
    await interaction.update({ embeds, components });
}

client.login(token);