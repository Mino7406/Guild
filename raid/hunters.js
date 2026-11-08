// 헌터 정보: 장비(무기 종류·속성·방어구), 소재함, HR. data/hunters.json 에 저장.
const { createStore } = require('./store');
const { WEAPONS, ELEMENTS, ARMORS } = require('./weapons');

const store = createStore('hunters', {});

const DEFAULT_LOADOUT = { weapon: 'gs', element: 'none', armor: 'basic' };

function getHunter(userId) {
    let h = store.data[userId];
    if (!h) {
        h = store.data[userId] = { loadout: { ...DEFAULT_LOADOUT }, materials: {}, hrp: 0, hunts: 0 };
        store.save();
    }
    // 무기·속성 목록이 바뀌어 저장된 값이 없어졌으면 기본값으로
    if (!WEAPONS[h.loadout.weapon]) h.loadout.weapon = DEFAULT_LOADOUT.weapon;
    if (!ELEMENTS[h.loadout.element]) h.loadout.element = DEFAULT_LOADOUT.element;
    if (!ARMORS[h.loadout.armor]) h.loadout.armor = DEFAULT_LOADOUT.armor;
    return h;
}

function setLoadout(userId, patch) {
    const h = getHunter(userId);
    Object.assign(h.loadout, patch);
    store.save();
    return h.loadout;
}

// 보상 지급: materials = { '황뢰룡의 비늘+': 2, ... }
function grantRewards(userId, materials, hrp) {
    const h = getHunter(userId);
    for (const [name, n] of Object.entries(materials)) h.materials[name] = (h.materials[name] || 0) + n;
    h.hrp += hrp;
    h.hunts += 1;
    store.save();
}

// HR: 포인트가 쌓이면 오른다 (3단계에서 다듬는다)
const hrOf = hrp => 1 + Math.floor(hrp / 100);

module.exports = { getHunter, setLoadout, grantRewards, hrOf };
