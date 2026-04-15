const { Client, GatewayIntentBits, Events, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// 💡 디스호스트의 환경변수(.env)에서 토큰을 가져옵니다.
const token = process.env.DISCORD_TOKEN;

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

// 쿨타임 저장소 (10초)
const cooldowns = new Collection();
const COOLDOWN_TIME = 10000;

// 💡 쿨타임 체크 함수
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

// 문자열 정규화
function normalize(str) {
    return str.replace(/ /g, "").toLowerCase();
}

// 공식 이름 찾기
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

// JSON 데이터 읽기
function getMonsterData(monsterName) {
    try {
        // 기존: path.join(__dirname, `${monsterName}.json`)
        // 변경: 'monsters' 폴더 경로를 중간에 추가
        const filePath = path.join(__dirname, 'monsters', `${monsterName}.json`);
        
        if (!fs.existsSync(filePath)) return null;
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(fileContent);
    } catch (e) {
        console.error("파일 읽기 오류:", e);
        return null;
    }
}

// 배열을 줄바꿈 문자열로 변환
function getArrayAsString(data, key) {
    if (!data[key]) return "정보가 없습니다.";
    if (Array.isArray(data[key])) return data[key].join("\n");
    return data[key];
}

// 임베드 생성 헬퍼
function createBaseEmbed(monsterName, monsterData) {
    const embed = new EmbedBuilder();
    if (monsterData.color) embed.setColor(monsterData.color);
    else embed.setColor(0xFFFFFF);
    if (monsterData.thumbnail) embed.setThumbnail(monsterData.thumbnail);
    return embed;
}

// 탭 버튼 생성
function getTabButtons(currentTab, monsterName, monsterData) {
    const row = new ActionRowBuilder();
    if (currentTab !== "basic" && monsterData.info)
        row.addComponents(new ButtonBuilder().setCustomId(`basic_${monsterName}`).setLabel("기본 정보").setEmoji("1492145251941482697").setStyle(ButtonStyle.Secondary));
    if (currentTab !== "hitzone" && monsterData.hitzone)
        row.addComponents(new ButtonBuilder().setCustomId(`hitzone_${monsterName}`).setLabel("육질 정보").setEmoji("1492145248795758602").setStyle(ButtonStyle.Primary));
    if (currentTab !== "drop" && (monsterData.drop || monsterData.drop_low || monsterData.drop_high))
        row.addComponents(new ButtonBuilder().setCustomId(`drop_${monsterName}`).setLabel("소재 정보").setEmoji("1492145247327617185").setStyle(ButtonStyle.Success));
    if (currentTab !== "status" && monsterData.status)
        row.addComponents(new ButtonBuilder().setCustomId(`status_${monsterName}`).setLabel("상태이상 정보").setEmoji("1492145250192331015").setStyle(ButtonStyle.Danger));
    return row.components.length > 0 ? [row] : [];
}

// 봇 켜질 때 전역 명령어 등록
client.once(Events.ClientReady, async c => {
    console.log(`✅ 봇 로그인 완료: ${c.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(token);
    try {
        await rest.put(Routes.applicationCommands(c.user.id), {
            body: [{
                name: '몬스터',
                description: '해당 몬스터의 정보를 확인합니다. (⚠️Beta - 현재 9성몹만 검색 가능합니다.)',
                options: [{
                    type: 3, // STRING type
                    name: '이름',
                    description: '검색할 몬스터의 이름을 입력하세요. [ ※ 별명이나 줄임말로도 검색 가능합니다. ]',
                    required: true,
                    autocomplete: true
                }]
            }]
        });
        console.log('✅ 전역 명령어 등록 완료!');
    } catch (error) {
        console.error(error);
    }
});

// 상호작용(명령어, 버튼, 자동완성) 처리
client.on(Events.InteractionCreate, async interaction => {
    // 💡 1. 자동완성 처리
    if (interaction.isAutocomplete()) {
        const currentInput = normalize(interaction.options.getFocused());
        const options = [];
        for (const officialName of monsterList) {
            let isMatch = normalize(officialName).includes(currentInput);
            if (!isMatch && monsterAliases[officialName]) {
                for (const alias of monsterAliases[officialName]) {
                    if (normalize(alias).includes(currentInput)) {
                        isMatch = true; break;
                    }
                }
            }
            if (isMatch) {
                options.push({ name: officialName, value: officialName });
                if (options.length >= 25) break;
            }
        }
        await interaction.respond(options);
        return;
    }

    // 💡 2. 슬래시 명령어 처리
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === '몬스터') {
            if (isCooldownActive(interaction)) return;
            const userInput = interaction.options.getString('이름').trim();
            const monsterName = resolveMonsterName(userInput);
            const monsterData = getMonsterData(monsterName);

            if (!monsterData) {
                return interaction.reply({ content: `<:X_:1493987174750748812> 데이터 없음: \`${userInput}\``, ephemeral: true });
            }

            const isHitzoneOnly = !monsterData.info && monsterData.hitzone;
            await sendPage(interaction, isHitzoneOnly ? "hitzone" : "basic", monsterName, monsterData);
        }
    }

    // 💡 3. 버튼 클릭 처리
    if (interaction.isButton()) {
        if (isCooldownActive(interaction)) return;
        const [action, monsterName] = interaction.customId.split('_');
        const monsterData = getMonsterData(monsterName);
        if (!monsterData) return;

        if (['dropLow', 'dropHigh'].includes(action)) {
            await sendDropPage(interaction, action === 'dropHigh' ? 'drop_high' : 'drop_low', monsterName, monsterData);
        } else {
            await sendPage(interaction, action, monsterName, monsterData);
        }
    }
});

// 통합 페이지 전송 함수
async function sendPage(interaction, type, monsterName, monsterData) {
    const embed = createBaseEmbed(monsterName, monsterData);
    const icon = monsterData.icon ? `${monsterData.icon} ` : "";
    let description = `# ${icon}${monsterName}\n`;

    if (type === "basic") {
        if (monsterData.species) description += `**【 ${monsterData.species} 】**\n\n`;
        description += `${getArrayAsString(monsterData, "info")}\n\n`;
        if (monsterData.habitat) description += `**《 서식지 》**\n> ${monsterData.habitat}\n\n`;
        if (monsterData.threat_level) description += `**《 위험도 》**\n> ${monsterData.threat_level}\n\n`;
        
        ['breakable_parts', 'weak_point', 'element_weakness'].forEach((key, i) => {
            if (monsterData[key]) {
                const titles = ["**《 파괴 가능 부위 》**", "**《 약점 》**", "**《 추천 속성 》**"];
                description += `${titles[i]}\n`;
                monsterData[key].forEach(el => description += `> ${el.replace(/\n/g, "").trim()}\n`);
                description += `\n`;
            }
        });
    } else if (type === "hitzone") {
        description += getArrayAsString(monsterData, "hitzone");
    } else if (type === "drop") {
        const hasRankInfo = !!monsterData.drop_low;
        if (hasRankInfo) return sendDropPage(interaction, 'drop_low', monsterName, monsterData);
        description += getArrayAsString(monsterData, "drop");
    } else if (type === "status") {
        // 상태이상 로직 (기존 Java와 동일)
        if (monsterData.status) {
            const s3 = [], s2 = [], s1 = [], s0 = [];
            monsterData.status.forEach(el => {
                const clean = `> ${el.replace(/[　\s]*\(.*?\)/g, "").trim()}`;
                if (el.includes("<:Star_3:1493987178642935941>")) s3.push(clean);
                else if (el.includes("<:Star_2:1493987181176426629>")) s2.push(clean);
                else if (el.includes("<:Star_1:1493987182992691280>")) s1.push(clean);
                else s0.push(clean);
            });
            if (s3.length) description += `**《 <:Star_3:1493987178642935941> 매우 유효 》**\n${s3.join("\n")}\n\n`;
            if (s2.length) description += `**《 <:Star_2:1493987181176426629> 유효 》**\n${s2.join("\n")}\n\n`;
            if (s1.length) description += `**《 <:Star_1:1493987182992691280> 조금 유효 》**\n${s1.join("\n")}\n\n`;
            if (s0.length) description += `**《 <:X_:1493987174750748812> 효과 없음 》**\n${s0.join("\n")}\n\n`;
        }
        if (monsterData.special_attack) {
            description += `**《 <:Info_4:1492145251941482697> 몬스터의 특수 공격 》**\n`;
            monsterData.special_attack.forEach(el => description += `> ${el}\n`);
            description += `\n`;
        }
        if (monsterData.item) {
            const valid = [], invalid = [];
            monsterData.item.forEach(el => {
                const clean = `> ${el.replace(/[　\s]*\(.*?\)/g, "").trim()}`;
                if (el.includes("<:Check:1493987173194661919>")) valid.push(clean);
                else if (el.includes("<:X_:1493987174750748812>")) invalid.push(clean);
                else valid.push(clean);
            });
            if (valid.length) description += `**《 <:Check:1493987173194661919> 유효 아이템 》**\n${valid.join("\n")}\n\n`;
            if (invalid.length) description += `**《 <:X_:1493987174750748812> 무효 아이템 》**\n${invalid.join("\n")}\n\n`;
        }
    }

    embed.setDescription(description.trim().substring(0, 4096)); // 글자수 제한 안전장치
    const components = getTabButtons(type, monsterName, monsterData);

    if (interaction.isButton()) await interaction.update({ embeds: [embed], components });
    else await interaction.reply({ embeds: [embed], components });
}

// 상위/하위 드랍 정보 전송 함수
async function sendDropPage(interaction, rankKey, monsterName, monsterData) {
    const embed = createBaseEmbed(monsterName, monsterData);
    const icon = monsterData.icon ? `${monsterData.icon} ` : "";
    embed.setDescription(`# ${icon}${monsterName}\n\n${getArrayAsString(monsterData, rankKey)}`.substring(0, 4096));

    const rankRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`dropLow_${monsterName}`).setLabel("《 하위 》").setEmoji("1492424259262222356").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`dropHigh_${monsterName}`).setLabel("《 상위 》").setEmoji("1492424261032214589").setStyle(ButtonStyle.Success)
    );
    
    const components = [rankRow, ...getTabButtons("drop", monsterName, monsterData)];
    await interaction.update({ embeds: [embed], components });
}

if (!token) console.error("🚨 환경변수(DISCORD_TOKEN)가 없습니다!");
else client.login(token);