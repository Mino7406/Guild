// 서버 파일(data/*.json)에 저장하는 작은 저장소.
// 바뀌면 1초 모았다가 한 번에 쓰고(임시 파일 → 이름 바꾸기라 쓰다 꺼져도 안 깨짐),
// 봇이 꺼질 때(flushAll) 남은 변경을 바로 쓴다.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const stores = [];

function createStore(name, initial) {
    const file = path.join(DATA_DIR, `${name}.json`);
    let data;
    try {
        data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
        if (e.code !== 'ENOENT') console.error(`[저장소 불러오기 실패] ${name}:`, e.message);
        data = typeof initial === 'function' ? initial() : structuredClone(initial);
    }
    let timer = null;
    const store = {
        data,
        save() {
            if (timer) return;
            timer = setTimeout(() => { timer = null; store.flush(); }, 1000);
        },
        flush() {
            if (timer) { clearTimeout(timer); timer = null; }
            try {
                fs.mkdirSync(DATA_DIR, { recursive: true });
                const tmp = file + '.tmp';
                fs.writeFileSync(tmp, JSON.stringify(store.data), { mode: 0o600 });
                fs.renameSync(tmp, file);
            } catch (e) { console.error(`[저장 실패] ${name}:`, e.message); }
        },
    };
    stores.push(store);
    return store;
}

const flushAll = () => stores.forEach(s => s.flush());

module.exports = { createStore, flushAll };
