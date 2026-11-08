// 퀘스트 패널 그림(PNG): 몬스터 아이콘·체력·부위, 파티 카드, 수레.
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { request } = require('undici');
const { WEAPONS, ELEMENTS } = require('./weapons');
const { MONSTERS, HUNTER_MAX_HP, MAX_CARTS } = require('./battle');

GlobalFonts.registerFromPath(path.join(__dirname, '..', 'assets', 'fonts', 'NanumGothic-Bold.ttf'), 'Nanum');
const FONT = size => `${size}px Nanum`;

const W = 800, H = 430;
const ELEMENT_COLOR = { fire: '#ff6b3d', water: '#3da5ff', thunder: '#ffd43d', ice: '#9be7ff', dragon: '#b46bff' };

const iconCache = new Map();
async function monsterIcon(m) {
    const url = m.dex.thumbnail;
    if (!url) return null;
    if (iconCache.has(url)) return iconCache.get(url);
    try {
        const res = await request(url);
        const img = await loadImage(Buffer.from(await res.body.arrayBuffer()));
        iconCache.set(url, img);
        return img;
    } catch (e) {
        console.error('[퀘스트 아이콘 불러오기 실패]', e.message);
        return null;
    }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function bar(ctx, x, y, w, h, ratio, color) {
    roundRect(ctx, x, y, w, h, h / 2); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
    if (ratio > 0) { roundRect(ctx, x, y, Math.max(h, w * ratio), h, h / 2); ctx.fillStyle = color; ctx.fill(); }
}

// phase: 'recruit' | 'battle' | 'ended'
async function renderPanel(q) {
    const m = MONSTERS[q.monster];
    const b = q.battle;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // 배경
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, b?.rage ? '#3a1414' : '#2a2418');
    bg.addColorStop(1, '#14110c');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // 몬스터
    const icon = await monsterIcon(m);
    if (icon) ctx.drawImage(icon, 24, 20, 150, 150);
    ctx.fillStyle = '#f3e6c8'; ctx.font = FONT(34); ctx.fillText(m.name, 196, 62);
    if (b?.rage) { ctx.font = FONT(34); const nw = ctx.measureText(m.name).width; ctx.font = FONT(20); ctx.fillStyle = '#ff5a4a'; ctx.fillText(' 분노!', 196 + nw + 6, 60); }

    if (b) {
        // 체력 (몬헌처럼 숫자는 숨기고 막대만)
        bar(ctx, 196, 80, 560, 18, b.hp / b.maxHp, b.rage ? '#e8453c' : '#d9a93f');
        // 부위
        ctx.font = FONT(17);
        let px = 196, py = 128;
        for (const part of m.parts) {
            const st = b.parts[part.id];
            const label = `${part.name}${st.broken ? ' 파괴' : ''}`;
            const tw = ctx.measureText(label).width + 20;
            if (px + tw > 770) { px = 196; py += 32; }
            roundRect(ctx, px, py - 19, tw, 26, 8);
            ctx.fillStyle = st.broken ? '#6b2a2a' : part.breakable ? '#3b3424' : '#2a2a2a'; ctx.fill();
            ctx.fillStyle = st.broken ? '#ffb4a8' : '#e8dcc0'; ctx.fillText(label, px + 10, py);
            px += tw + 8;
        }
        // 수레
        ctx.font = FONT(16); ctx.fillStyle = '#c9b88f'; ctx.fillText('수레', 24, 196);
        for (let i = 0; i < MAX_CARTS; i++) {
            roundRect(ctx, 70 + i * 34, 181, 26, 20, 5);
            ctx.fillStyle = i < b.carts ? '#e8453c' : 'rgba(255,255,255,0.15)'; ctx.fill();
        }
        ctx.fillStyle = '#c9b88f'; ctx.fillText(`${b.turn}턴`, 182, 196);
    } else {
        ctx.font = FONT(20); ctx.fillStyle = '#c9b88f';
        ctx.fillText('파티 모집 중', 196, 100);
    }

    // 파티 카드 4칸
    const members = b ? b.hunters : q.members;
    const cw = 182, ch = 190, cy = 222;
    for (let i = 0; i < 4; i++) {
        const x = 24 + i * (cw + 8);
        roundRect(ctx, x, cy, cw, ch, 12);
        const mem = members[i];
        ctx.fillStyle = mem ? 'rgba(255,240,200,0.08)' : 'rgba(255,255,255,0.03)'; ctx.fill();
        if (!mem) { ctx.font = FONT(16); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillText('빈 자리', x + 60, cy + 100); continue; }
        const lo = mem.loadout;
        ctx.font = FONT(19); ctx.fillStyle = '#f3e6c8';
        let name = mem.name;
        while (ctx.measureText(name).width > cw - 24 && name.length > 1) name = name.slice(0, -1);
        if (name !== mem.name) name = name.slice(0, -1) + '…';
        ctx.fillText(name, x + 12, cy + 32);
        ctx.font = FONT(16); ctx.fillStyle = '#d9c9a0';
        ctx.fillText(WEAPONS[lo.weapon].name, x + 12, cy + 60);
        if (lo.element !== 'none') {
            ctx.fillStyle = ELEMENT_COLOR[lo.element] || '#fff';
            ctx.fillText(`${ELEMENTS[lo.element].name} 속성`, x + 12, cy + 84);
        }
        if (b) {
            const hpRatio = mem.hp / HUNTER_MAX_HP;
            bar(ctx, x + 12, cy + 104, cw - 24, 14, hpRatio, hpRatio > 0.5 ? '#5fd068' : hpRatio > 0.25 ? '#e8c43c' : '#e8453c');
            ctx.font = FONT(14); ctx.fillStyle = '#c9b88f'; ctx.fillText(`${mem.hp} / ${HUNTER_MAX_HP}`, x + 12, cy + 138);
            ctx.font = FONT(16);
            const status = mem.down > 0 ? ['캠프 이송 중', '#e8453c'] : mem.action ? ['선택 완료', '#5fd068'] : ['고르는 중…', '#c9b88f'];
            ctx.fillStyle = status[1]; ctx.fillText(status[0], x + 12, cy + 170);
        } else if (q.hostId === mem.userId) {
            ctx.font = FONT(15); ctx.fillStyle = '#d9a93f'; ctx.fillText('방장', x + 12, cy + 170);
        }
    }
    return canvas.encode('png');
}

module.exports = { renderPanel };
