// 턴제 전투 규칙 (디스코드와 무관한 순수 계산). 상태는 평범한 객체라 그대로 JSON 저장·복원할 수 있다.
const fs = require('fs');
const path = require('path');
const { WEAPONS, ELEMENT_RAW_RATE, ELEMENT_POWER } = require('./weapons');

const HUNTER_MAX_HP = 150;
const POTION_HEAL = 60;
const MAX_CARTS = 3;                 // 파티 합계 이만큼 쓰러지면 실패(수레)
const CART_TURNS = 1;                // 쓰러지면 이 턴 수만큼 쉬었다가 체력 가득 차서 복귀
const GUARD_RATE = 0.25;             // 가드 무기로 막으면 받는 피해 배율
const GUARD_ATTACK_RATE = 0;         // 가드한 턴의 공격(1단계: 공격 안 함)
const PARTY_HP_RATE = { 1: 0.15, 2: 0.45, 3: 0.72, 4: 1 };
const PARTY_ALL_DAMAGE_RATE = { 1: 1, 2: 0.9, 3: 0.82, 4: 0.75 }; // 전원 공격은 인원이 많을수록 한 명당 약하게(수레는 파티 공용이라)
const HP_SCALE = 0.55;               // 키라니코 체력 × 이 값 × 인원 배율 — 4인 약 15턴 목표
const PART_BREAK_SCALE = 0.6;        // 부위 내구도 × 이 값을 넘게 때리면 부위 파괴

const ACTIONS = {
    attack: { name: '공격', emoji: '⚔️' },
    skill:  { name: '무기 기술', emoji: '✨' },
    evade:  { name: '회피', emoji: '💨' },
    guard:  { name: '가드', emoji: '🛡️' },
    potion: { name: '회복약', emoji: '🧪' },
};

// ── 몬스터 정의 불러오기 ──
const ROOT = path.join(__dirname, '..');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf-8').replace(/^﻿/, ''));

// 도감 소재 줄 → [{ name, methods: { '타겟 보수': 20, ... } }]
// 이름 옆에 [역전·역전왕 표시]가 붙은 소재는 그 개체 전용이라 퀘스트 보상에서 뺀다.
function parseDrops(lines = []) {
    const items = [];
    let skipping = false;
    for (const line of lines) {
        const name = line.match(/^(?:<a?:\w+:\d+>\s*)?\*\*(.+?)\*\*/);
        if (name && !line.startsWith('>')) {
            skipping = /\[\s*<a?:Rank/.test(name[1]);
            if (!skipping) items.push({ name: name[1].replace(/　.*$/, '').trim(), methods: {} });
            continue;
        }
        const cur = items[items.length - 1];
        if (!cur || skipping) continue;
        for (const m of line.matchAll(/([^>|:`]+?):\s*`(\d+)%`/g)) cur.methods[m[1].trim()] = +m[2];
    }
    return items;
}

const MONSTERS = {};
for (const f of fs.readdirSync(path.join(__dirname, 'monsters')).filter(f => f.endsWith('.json'))) {
    const key = f.slice(0, -5);
    try {
        const def = readJson(path.join(__dirname, 'monsters', f));
        const data = readJson(path.join(__dirname, 'data', `${key}.json`));
        const dex = readJson(path.join(ROOT, 'monsters', `${key}.json`));
        if (!def.moves?.[def.smash]) throw new Error('smash 기술이 moves에 없음');
        MONSTERS[key] = { key, ...def, ...data, dex, drops: parseDrops(dex.drop_high || dex.drop) };
    } catch (e) { console.error(`[퀘스트 몬스터 불러오기 실패] ${key}:`, e.message); }
}

// ── 전투 만들기 ──
function createBattle(monsterKey, members) {
    const m = MONSTERS[monsterKey];
    const maxHp = Math.round(m.baseHp * HP_SCALE * PARTY_HP_RATE[Math.min(4, Math.max(1, members.length))]);
    const b = {
        monster: monsterKey,
        hp: maxHp, maxHp,
        rage: false,
        turn: 1,
        carts: 0,
        lastSmashTurn: -99,
        parts: Object.fromEntries(m.parts.map(p => [p.id, { dmg: 0, broken: false }])),
        hunters: members.map(mem => ({
            userId: mem.userId, name: mem.name, loadout: { ...mem.loadout },
            hp: HUNTER_MAX_HP, down: 0, target: defaultTarget(m), action: null, dealt: 0, carts: 0,
        })),
        intent: null,
        log: [],
        outcome: null,
    };
    b.intent = pickIntent(b);
    return b;
}

// 처음 노릴 부위: 머리(없으면 첫 부위)
const defaultTarget = m => (m.parts.find(p => p.head) || m.parts[0]).id;

function pickIntent(b) {
    const m = MONSTERS[b.monster];
    const weights = { ...(b.rage ? m.weights.rage : m.weights.normal) };
    if (b.turn === 1 || b.turn - b.lastSmashTurn < m.smashGap) delete weights[m.smash];
    const entries = Object.entries(weights).filter(([k, w]) => w > 0 && m.moves[k]);
    let roll = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
    let key = entries[0][0];
    for (const [k, w] of entries) { if ((roll -= w) < 0) { key = k; break; } }
    const move = m.moves[key];
    const alive = b.hunters.filter(h => h.down === 0);
    const target = move.target === 'single' && alive.length ? alive[Math.floor(Math.random() * alive.length)].userId : null;
    if (key === m.smash) b.lastSmashTurn = b.turn;
    return { key, target };
}

function telegraphText(b) {
    const m = MONSTERS[b.monster];
    const move = m.moves[b.intent.key];
    const target = b.hunters.find(h => h.userId === b.intent.target);
    return move.telegraph.replace('{target}', target ? target.name : '누군가');
}

const isSmashIntent = b => b.intent?.key === MONSTERS[b.monster].smash;
const activeHunters = b => b.hunters.filter(h => h.down === 0);
const allChosen = b => activeHunters(b).every(h => h.action);

// 선택 (전투 상태만 바꾼다. 잘못된 선택이면 사유 문자열)
function chooseAction(b, userId, action) {
    const h = b.hunters.find(x => x.userId === userId);
    if (!h) return '이 퀘스트의 파티원이 아니에요.';
    if (h.down > 0) return '캠프로 이송 중이라 이번 턴은 쉬어요.';
    if (!ACTIONS[action]) return '알 수 없는 행동이에요.';
    if (action === 'skill') return '무기 기술은 다음 업데이트에서 열려요.';
    if (action === 'guard' && !WEAPONS[h.loadout.weapon].guard) return '가드할 수 없는 무기예요.';
    if (action === 'evade' && WEAPONS[h.loadout.weapon].guard) return '가드 무기는 회피 대신 가드를 써요.';
    if (action === 'potion' && h.hp >= HUNTER_MAX_HP) return '체력이 가득 차 있어요.';
    h.action = action;
    return null;
}

function setTarget(b, userId, partId) {
    const h = b.hunters.find(x => x.userId === userId);
    if (!h) return '이 퀘스트의 파티원이 아니에요.';
    if (!MONSTERS[b.monster].parts.some(p => p.id === partId)) return '알 수 없는 부위예요.';
    h.target = partId;
    return null;
}

const rand = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));

function attackDamage(b, h) {
    const m = MONSTERS[b.monster];
    const part = m.parts.find(p => p.id === h.target) || m.parts[0];
    const w = WEAPONS[h.loadout.weapon];
    const hasElement = h.loadout.element !== 'none';
    const raw = w.power * (hasElement ? ELEMENT_RAW_RATE : 1) * part.hz[w.type] / 100;
    const ele = hasElement ? ELEMENT_POWER * (part.hz[h.loadout.element] || 0) / 100 : 0;
    const variance = 0.9 + Math.random() * 0.2;
    return { part, dmg: Math.max(1, Math.round((raw + ele) * variance)) };
}

// 한 턴 처리 → b.log 에 이번 턴 기록, 끝났으면 b.outcome = 'win' | 'fail'
function resolveTurn(b) {
    const m = MONSTERS[b.monster];
    const log = [];
    // 못 고른 사람은 공격
    for (const h of activeHunters(b)) if (!h.action) h.action = 'attack';

    // 1) 헌터 행동
    for (const h of activeHunters(b)) {
        if (h.action === 'attack') {
            const { part, dmg } = attackDamage(b, h);
            b.hp = Math.max(0, b.hp - dmg);
            h.dealt += dmg;
            const ps = b.parts[part.id];
            ps.dmg += dmg;
            log.push(`⚔️ **${h.name}** → ${part.name} **${dmg}**`);
            if (part.breakable && !ps.broken && ps.dmg >= part.hp * PART_BREAK_SCALE) {
                ps.broken = true;
                log.push(`💥 **${part.name}** 부위 파괴!`);
            }
        } else if (h.action === 'potion') {
            const before = h.hp;
            h.hp = Math.min(HUNTER_MAX_HP, h.hp + POTION_HEAL);
            log.push(`🧪 **${h.name}** 회복 +${h.hp - before}`);
        }
    }
    if (b.hp <= 0) { b.outcome = 'win'; log.push(`🏆 **${m.name}** 토벌 성공!`); b.log = log; return b; }

    // 2) 몬스터 행동
    const move = m.moves[b.intent.key];
    const rate = (b.rage ? m.rage.damageRate : 1) * (move.target === 'all' ? PARTY_ALL_DAMAGE_RATE[Math.min(4, b.hunters.length)] : 1);
    const targets = move.target === 'all' ? activeHunters(b) : activeHunters(b).filter(h => h.userId === b.intent.target);
    log.push(`🐉 **${move.name}**!`);
    for (const h of targets) {
        let dmg = Math.round(rand(move.damage) * rate);
        if (h.action === 'evade') { log.push(`💨 **${h.name}** 회피 성공`); continue; }
        if (h.action === 'guard') dmg = Math.round(dmg * GUARD_RATE);
        h.hp = Math.max(0, h.hp - dmg);
        log.push(`${h.action === 'guard' ? '🛡️' : '💢'} **${h.name}** -${dmg}${h.hp === 0 ? ' — 쓰러졌다!' : ''}`);
        if (h.hp === 0) { b.carts += 1; h.carts += 1; h.down = CART_TURNS + 1; }
    }
    if (b.carts >= MAX_CARTS) { b.outcome = 'fail'; log.push(`🛒 수레 ${MAX_CARTS}회 — 퀘스트 실패`); b.log = log; return b; }

    // 3) 분노
    if (!b.rage && b.hp <= b.maxHp * m.rage.hpRatio) { b.rage = true; log.push(m.rage.message); }

    // 4) 다음 턴 준비: 쓰러진 사람 복귀, 선택 초기화, 다음 행동 예고
    for (const h of b.hunters) {
        h.action = null;
        if (h.down > 0) {
            h.down -= 1;
            if (h.down === 0) { h.hp = HUNTER_MAX_HP; log.push(`🏕️ **${h.name}** 캠프에서 복귀`); }
        }
    }
    b.turn += 1;
    b.intent = pickIntent(b);
    b.log = log;
    return b;
}

// ── 보상 ──
function weightedPick(entries) {
    let roll = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of entries) if ((roll -= w) < 0) return k;
    return entries.length ? entries[entries.length - 1][0] : null;
}

const TARGET_REWARD_ROLLS = 3;
const CARVE_ROLLS = 2;
const CLEAR_HRP = 50;

// 파티원 한 명의 보상: { materials: { 이름: 개수 }, hrp }
function rollRewards(b) {
    const m = MONSTERS[b.monster];
    const out = {};
    const add = name => { if (name) out[name] = (out[name] || 0) + 1; };
    const byMethod = test => m.drops.map(d => [d.name, Object.entries(d.methods).filter(([k]) => test(k)).reduce((s, [, v]) => s + v, 0)]).filter(([, w]) => w > 0);
    const target = byMethod(k => k === '타겟 보수');
    const carve = byMethod(k => k === '갈무리');
    for (let i = 0; i < TARGET_REWARD_ROLLS; i++) add(weightedPick(target));
    for (let i = 0; i < CARVE_ROLLS; i++) add(weightedPick(carve));
    for (const part of m.parts) {
        if (!b.parts[part.id]?.broken) continue;
        const brk = byMethod(k => k.endsWith('파괴') && k !== '상처 파괴' && (k.includes(part.name) || (part.head && /뿔|머리/.test(k))));
        add(weightedPick(brk));
    }
    return { materials: out, hrp: CLEAR_HRP };
}

module.exports = {
    MONSTERS, ACTIONS, HUNTER_MAX_HP, MAX_CARTS,
    createBattle, chooseAction, setTarget, allChosen, resolveTurn, telegraphText, isSmashIntent, activeHunters, rollRewards, parseDrops,
};
