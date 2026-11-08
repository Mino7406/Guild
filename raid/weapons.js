// 무기 14종과 속성. 1단계는 기본 공격만 무기마다 다르고, 무기 기술(고유 메커니즘)은 2단계에서 붙인다.
//  type: 육질 종류 — slash(절단) · strike(타격) · shot(탄)
//  power: 기본 공격 한 번의 위력(육질 100 기준 피해). 무기끼리 턴당 기대 피해가 비슷하게 맞춘다.
//  guard: true면 회피 대신 가드(막으면 받는 피해 크게 감소, 대신 완전 회피는 없음)
const WEAPONS = {
    gs:   { name: '대검',          type: 'slash',  power: 112 },
    ls:   { name: '태도',          type: 'slash',  power: 102 },
    sns:  { name: '한손검',        type: 'slash',  power: 94, guard: true },
    db:   { name: '쌍검',          type: 'slash',  power: 100 },
    hm:   { name: '해머',          type: 'strike', power: 108 },
    hh:   { name: '수렵피리',      type: 'strike', power: 92 },
    lance:{ name: '랜스',          type: 'slash',  power: 90, guard: true },
    gl:   { name: '건랜스',        type: 'slash',  power: 92, guard: true },
    sa:   { name: '슬래시액스',    type: 'slash',  power: 104 },
    cb:   { name: '차지액스',      type: 'slash',  power: 96, guard: true },
    ig:   { name: '조충곤',        type: 'slash',  power: 100 },
    lbg:  { name: '라이트보우건',  type: 'shot',   power: 96 },
    hbg:  { name: '헤비보우건',    type: 'shot',   power: 106 },
    bow:  { name: '활',            type: 'shot',   power: 100 },
};
const WEAPON_ORDER = Object.keys(WEAPONS);

// 속성: 무속성은 물리만, 속성 무기는 물리를 조금 낮추고 속성 피해(속성 육질 적용)를 더한다.
const ELEMENTS = {
    none:    { name: '무속성', emoji: '⚪' },
    fire:    { name: '불',     emoji: '<:Fire:1492113720451534899>' },
    water:   { name: '물',     emoji: '<:Water:1492113725434630155>' },
    thunder: { name: '번개',   emoji: '<:Thunder:1492113723635142707>' },
    ice:     { name: '얼음',   emoji: '<:Ice:1492113721881788476>' },
    dragon:  { name: '용',     emoji: '<:Dragon:1492113718954168410>' },
};
const ELEMENT_ORDER = Object.keys(ELEMENTS);
const ELEMENT_RAW_RATE = 0.8;  // 속성 무기의 물리 배율
const ELEMENT_POWER = 40;      // 속성 육질 100 기준 속성 피해

const TYPE_NAME = { slash: '절단', strike: '타격', shot: '탄' };

// 기본 방어구 (3단계 장비 제작 전까지 모두 같음)
const ARMORS = {
    basic: { name: '헌터 방어구', defense: 0 },
};

function weaponLabel(loadout) {
    const w = WEAPONS[loadout.weapon];
    const e = ELEMENTS[loadout.element];
    return `${w.name}${loadout.element !== 'none' ? ` ${e.emoji}` : ''}`;
}

module.exports = { WEAPONS, WEAPON_ORDER, ELEMENTS, ELEMENT_ORDER, ELEMENT_RAW_RATE, ELEMENT_POWER, TYPE_NAME, ARMORS, weaponLabel };
