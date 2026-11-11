// 소식 감지 시뮬레이션 — 가짜 시계와 가짜 네트워크로 실제 코드를 시간 순서대로 돌려 본다.
// SIM_OUT=파일경로 를 주면 시나리오별 결과(JSON)를 저장한다(결과 그림용).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { createWatcher, buildSources, buildPayload } = require('../news/watcher');
const parse = require('../news/parse');

const T0 = Date.parse('2026-11-11T10:00:00+09:00');
const MIN = 60_000;
const results = [];

// ── 가짜 환경 ─────────────────────────────────────────────────
let clock, routes, calls, sent, sendFail;
const realFetch = global.fetch;
function kst(ms) { return new Date(ms + 9 * 3600e3).toISOString().slice(0, 19).replace('T', ' '); }

function flatten(c) {
    const out = [];
    const walk = x => {
        if (!x) return;
        if (typeof x.content === 'string') out.push(x.content);
        if (x.type === 11 || x.url) { /* 썸네일 */ }
        for (const v of [x.components, x.accessory].flat()) if (v) walk(v);
    };
    walk(c.toJSON());
    return out;
}

function setup({ youtube = true, init = {} } = {}) {
    clock = { t: T0 };
    calls = {};
    sent = [];
    sendFail = 0;
    routes = { official: officialHtml([['Ver.1.042.00.03', '2026년 10월 27일(화)', ['오류 수정'], ['PS5', 'Steam']]]), dc: dcHtml([]), yt: ytJson([]), gh: ghJson([]), dcView: {} };
    Object.assign(routes, init);
    global.fetch = async (url) => {
        url = String(url);
        const key = url.includes('store.steampowered.com') ? 'official'
            : url.includes('gall.dcinside.com') && url.includes('/view/') ? 'dcView'
            : url.includes('gall.dcinside.com') ? 'dc'
            : url.includes('googleapis.com') ? 'yt'
            : url.includes('api.github.com') ? 'gh' : 'other';
        calls[key] = (calls[key] ?? 0) + 1;
        let v = key === 'dcView' ? routes.dcView[url.match(/no=(\d+)/)[1]] : routes[key];
        if (typeof v === 'function') v = v();
        if (v === undefined) return new Response('not found', { status: 404 });
        if (typeof v === 'number') return new Response('err', { status: v });
        return new Response(v, { status: 200 });
    };
    const store = { data: structuredClone(init.__store ?? {}), save() {} };
    const sources = buildSources(youtube ? { YOUTUBE_API_KEY: 'test-key' } : {});
    const w = createWatcher({
        sources, store, now: () => clock.t,
        send: async (source, entry, verdict) => {
            if (sendFail > 0) { sendFail--; throw new Error('Missing Permissions'); }
            // 운영과 같은 조건: 봇 이모지가 등록돼 있어 모든 카드에 썸네일이 붙는다
            const payload = buildPayload(source, entry, verdict, { official: '1', dc: '2', youtube: '3', reframework: '4' });
            // 유튜브는 일반 메시지(링크 임베드), 나머지는 카드(컴포넌트 v2)
            const lines = payload.content !== undefined ? [payload.content] : flatten(payload.components[0]);
            const buttons = []; (function walk(x) { if (!x || typeof x !== 'object') return; if (x.url && x.label) buttons.push({ label: x.label, url: x.url }); Object.values(x).forEach(walk); })(payload.components?.[0]?.toJSON());
            sent.push({ buttons, heading: lines[1] ?? '', src: source.id, title: entry.title, kind: verdict.kind.label, emoji: verdict.kind.emoji, lines, button: verdict.button ?? '내용 보기', thumb: !!verdict.thumb, url: entry.url, plain: payload.content !== undefined, flags: payload.flags ?? 0 });
        },
        logInfo: m => (setup.logs ??= []).push(m),
        logFail: (s, e) => (setup.fails ??= []).push(`${s.id}:${e.message}`),
    });
    setup.logs = []; setup.fails = [];
    return { w, store };
}
async function run(w, minutes, step = 1) {
    for (let i = 0; i < minutes / step; i++) { clock.t += step * MIN; await w.tick(); }
}

// ── 가짜 응답 만들기 ────────────────────────────────────────────
// 공식 패치노트는 스팀의 한국어 공지 목록으로 받는다. 호출부는 [버전, 날짜, 종류, 플랫폼] 목록 그대로 쓰고, 여기서 스팀 응답 모양으로 바꾼다.
// 버전이 'EN:' 으로 시작하면 한글 번역이 아직 없는 영문 제목으로 만든다.
const officialHtml = list => JSON.stringify({ events: list.map(([v, , kinds], i) => {
    const en = v.startsWith('EN:'); const unk = v.startsWith('UNK:'); const ver = v.replace('EN:', '').replace('UNK:', '');
    return { gid: String(parseInt(ver.replace(/\D/g, ''), 10)), event_name: unk ? `Hotfix Patch Notice (${ver})` : en ? `Update Summary (${ver})` : `업데이트 개요 (${ver})`,
        rtime32_start_time: Math.floor(((clock?.t ?? T0) - 60_000 - i * 3600_000) / 1000),
        announcement_body: { body: ['[h2][b]배포일[/b][/h2]', '[b]2026년 11월 11일(수)[/b]', '[list]', `[*] ${kinds.join(' / ')}`, '[/list] https://example.com/x'].join('\n') } };
}) });
const dcRow = (num, title, at) => `<tr class="ub-content us-post" data-no="${num}"> <td class="gall_num">${num}</td> <td class="gall_subject">🕊공식</td> <td class="gall_tit ub-word"> <a href="/mgallery/board/view/?id=capcommh&no=${num}&search_head=140&page=1" view-msg =""> <em class="icon_img icon_recomimg"></em>${title}</a> <a class="reply_numbox" href="#"><span class="reply_num">[3]</span></a> </td> <td class="gall_date" title="${kst(at)}">10:05</td> </tr>`;
const dcHtml = rows => `<table><tr class="ub-content "><td class="gall_num">-</td><td class="gall_subject"><b>설문</b></td><td class="gall_tit ub-word"><a href="javascript:;"><b>광고 줄</b></a></td></tr>${rows.map(r => dcRow(...r)).join('')}</table>`;
const dcView = text => `<div class="gallview"><div class="write_div" style="x"><div>${text}</div></div><div class="btn_recommend_box">추천</div><div id="comment_wrap">댓글: 와일즈 와일즈 와일즈 도배 댓글입니다</div></div>`;
const ytJson = list => JSON.stringify({ items: list.map(([id, title, at]) => ({ snippet: { title, publishedAt: new Date(at).toISOString(), resourceId: { videoId: id } } })) });
const ghJson = list => JSON.stringify(list.map(([id, name, tag, body, extra = {}]) => ({ id, name, tag_name: tag, html_url: `https://github.com/praydog/REFramework-nightly/releases/tag/${tag}`, published_at: new Date(clock?.t ?? T0).toISOString(), body, prerelease: true, draft: false, ...extra })));

function record(name, expectation, ok, detail = {}) {
    results.push({ name, expectation, ok, sent: sent.map(s => ({ src: s.src, kind: `${s.emoji} ${s.kind}`, title: s.title, lines: s.lines, button: s.button })), ...detail });
}

test.after(() => {
    global.fetch = realFetch;
    if (process.env.SIM_OUT) fs.writeFileSync(process.env.SIM_OUT, JSON.stringify(results, null, 1));
});

// 기본 상태: 공식 1건 · 디시 기존 글 2개 · 유튜브 기존 영상 1개 · GitHub 기존 릴리즈 1개
const baseInit = () => ({
    dc: dcHtml([[100, '기존 와일즈 글', T0 - 3600e3], [99, '아웃랜더스 기존 글', T0 - 7200e3]]),
    yt: ytJson([['old1', '몬스터헌터 와일즈 어센던스 - 1st 트레일러', T0 - 86400e3]]),
    gh: ghJson([[1, 'Nightly 100', 'nightly-100', 'Old build']]),
});

test('01 처음 켤 때는 기존 글을 기억만 하고 아무것도 올리지 않는다', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 20);
    assert.equal(sent.length, 0);
    assert.ok(calls.official >= 1 && calls.dc >= 1 && calls.yt >= 1 && calls.gh >= 1);
    record('처음 켜기(기존 글 도배 방지)', '기존 글은 기억만, 카드 0개', true);
});

test('02 공식 새 버전이 올라오면 카드 1개, 다시 확인해도 중복 없음', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 12);
    routes.official = officialHtml([['Ver.1.042.00.04', '2026년 11월 11일(수)', ['주요 추가 요소 / 사양 변경', '오류 수정'], ['PS5', 'XSX|S', 'Steam']], ['Ver.1.042.00.03', '2026년 10월 27일(화)', ['오류 수정'], ['PS5', 'Steam']]]);
    await run(w, 40);
    const o = sent.filter(s => s.src === 'official');
    assert.equal(o.length, 1, `보낸 것 ${sent.length}개, 실패: ${JSON.stringify(setup.fails)}, 기록: ${JSON.stringify(setup.logs)}, 요청: ${JSON.stringify(calls)}`);
    assert.equal(o[0].title, '업데이트 개요 (Ver.1.042.00.04)');
    assert.ok(o[0].lines.join(' ').includes('주요 추가 요소'), o[0].lines.join(' | ')); // 본문 요약(서식 표시 제거)
    assert.ok(!o[0].lines.join(' ').includes('[h2]') && !o[0].lines.join(' ').includes('https://'));
    assert.ok(o[0].lines.join(' ').includes('배포일 2026년 11월 11일(수)'), o[0].lines.join(' | '));
    record('공식 패치노트 새 버전(스팀 한국어 공지)', '한글 카드 1개(배포일·본문 요약 포함), 재확인해도 중복 없음', true);
});

test('03 디시: 섞인 글 6개 중 와일즈 소식 2개만 올린다', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 12);
    const at = clock.t - 5 * MIN;
    routes.dcView = {
        '201': dcView('오늘부터 시작되는 파리 게임 위크 캡콤 프랑스 측 공식 일정 몬스터헌터 어센던스 개발자 프레젠테이션 진행자 안내'),
        '202': dcView('스트리트 파이터 대회 일정과 결승 진행 안내입니다 많이 시청해 주세요 감사합니다'),
        '203': dcView('<img src="a.jpg">'),
    };
    routes.dc = dcHtml([
        [206, '게임스컴 일정 (이미지만)', at], [205, '도쿄 게임쇼 라인업 안내', at], [204, '파리 게임 위크 공식 일정 안내.jpg', at],
        [203, '내일 오전 10시 와일즈 점검 및 패치 예정.jpg', at], [202, '아랜 11월 11일 무점검 패치 안내', at], [201, '와일즈 어센던스 2nd 트레일러 공개', at],
        [100, '기존 와일즈 글', T0 - 3600e3], [99, '아웃랜더스 기존 글', T0 - 7200e3],
    ]);
    routes.dcView = { '204': routes.dcView['201'], '205': routes.dcView['202'], '206': routes.dcView['203'] };
    await run(w, 10);
    const d = sent.filter(s => s.src === 'dc').map(s => s.title);
    assert.deepEqual(d.sort(), ['내일 오전 10시 와일즈 점검 및 패치 예정.jpg', '파리 게임 위크 공식 일정 안내.jpg'].sort());
    record('디시 분류(섞인 글 6개)', '점검 예고·와일즈 참여 행사만 2개 올림. 아웃랜더스·영상·불참 행사·이미지뿐인 행사는 제외', true);
});

test('04 유튜브: 연속된 무기 소개 영상은 둘 다 올리고, 다른 게임 영상은 제외', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 12);
    const base = [['old1', '몬스터헌터 와일즈 어센던스 - 1st 트레일러', T0 - 86400e3]];
    routes.yt = ytJson([['v2', '몬스터헌터 와일즈 어센던스 - 무기 소개 영상: 활(한글 자막)', clock.t - 6 * MIN], ...base]);
    await run(w, 5);
    routes.yt = ytJson([['v3', '몬스터헌터 와일즈 어센던스 - 무기 소개 영상: 태도(한글 자막)', clock.t - 1 * MIN], ['sf6', '스트리트 파이터 6 신규 트레일러', clock.t - 1 * MIN], ['v2', '몬스터헌터 와일즈 어센던스 - 무기 소개 영상: 활(한글 자막)', clock.t - 6 * MIN], ...base]);
    await run(w, 10);
    const y = sent.filter(s => s.src === 'youtube').map(s => s.title);
    assert.equal(y.length, 2, `영상 카드 ${y.length}개: ${y.join(' | ')}`);
    assert.ok(y.every(t => t.includes('무기 소개')));
    // 유튜브는 링크가 영상 임베드로 펼쳐지도록 일반 메시지(컴포넌트 v2 플래그 없음)에 영상 주소가 들어 있어야 한다
    for (const s of sent.filter(x => x.src === 'youtube')) {
        assert.equal(s.plain, true);
        assert.equal(s.flags, 0);
        assert.ok(s.lines[0].includes('https://www.youtube.com/watch?v='), s.lines[0]);
    }
    assert.ok(sent.filter(x => x.src !== 'youtube').every(x => !x.plain), '다른 출처는 카드로 보내야 함');
    record('유튜브 연속 영상(버그 수정 확인)', '무기 소개 영상 2개 모두 올림, 스트리트 파이터 영상 제외', true);
});

test('05 유튜브와 디시가 같은 소식을 올리면 먼저 온 것만 올린다', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 12);
    routes.yt = ytJson([['g1', '몬스터헌터 와일즈 어센던스 게임스컴 참여 일정 공개', clock.t - 1 * MIN], ['old1', '몬스터헌터 와일즈 어센던스 - 1st 트레일러', T0 - 86400e3]]);
    await run(w, 6);
    routes.dcView = { '301': dcView('게임스컴 어센던스 참여 일정 몬스터헌터 어센던스 방송 안내 시청 부탁드립니다 감사합니다') };
    routes.dc = dcHtml([[301, '와일즈 어센던스 게임스컴 참여 일정 안내', clock.t - 1 * MIN], [100, '기존 와일즈 글', T0 - 3600e3], [99, '아웃랜더스 기존 글', T0 - 7200e3]]);
    await run(w, 10);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].src, 'youtube');
    assert.ok(setup.logs.some(m => m.includes('겹쳐')));
    record('다른 출처 중복 제거', '같은 소식이면 유튜브 1개만 올리고 디시 글은 건너뜀', true);
});

test('06 사이트가 막혀도(403) 간격을 늘려 요청을 아끼고, 풀리면 새 글을 올린다', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 12);
    const before = calls.official;
    routes.official = 403;
    await run(w, 120);
    const during = calls.official - before;
    assert.ok(during <= 12, `120분 동안 요청 ${during}번(백오프 없으면 40번)`);
    assert.ok(setup.fails.some(f => f.startsWith('official:HTTP 403')));
    routes.official = officialHtml([['Ver.1.042.00.05', '2026년 11월 11일(수)', ['오류 수정'], ['Steam']], ['Ver.1.042.00.03', '2026년 10월 27일(화)', ['오류 수정'], ['PS5', 'Steam']]]);
    await run(w, 70);
    assert.equal(sent.filter(s => s.src === 'official').length, 1);
    record('사이트 차단/장애', `120분간 요청 ${during}번(제한 없으면 40번), 풀린 뒤 새 버전 정상 알림`, true, { during });
});

test('07 디스코드 전송이 실패하면 글을 잃지 않고 다시 시도해 정확히 1번만 올린다', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 12);
    sendFail = 2;
    routes.official = officialHtml([['Ver.1.042.00.04', '2026년 11월 11일(수)', ['오류 수정'], ['Steam']], ['Ver.1.042.00.03', '2026년 10월 27일(화)', ['오류 수정'], ['PS5', 'Steam']]]);
    await run(w, 90);
    assert.equal(sent.filter(s => s.src === 'official').length, 1);
    assert.ok(setup.fails.some(f => f.includes('Missing Permissions')));
    record('디스코드 전송 실패(권한 등)', '2번 실패 후 재시도해 정확히 1번 전송', true);
});

test('08 한꺼번에 새 글이 12개 보이면(구조 변경) 올리지 않고 기억만 한다', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 12);
    const rows = Array.from({ length: 12 }, (_, i) => [400 + i, `와일즈 점검 안내 ${i}`, clock.t - MIN]);
    routes.dc = dcHtml([...rows, [100, '기존 와일즈 글', T0 - 3600e3], [99, '아웃랜더스 기존 글', T0 - 7200e3]]);
    await run(w, 10);
    assert.equal(sent.filter(s => s.src === 'dc').length, 0);
    assert.ok(setup.logs.some(m => m.includes('구조 변경')));
    record('디시 구조 변경(새 글 12개 폭주)', '도배 방지: 카드 0개, 기억만 함', true);
});

test('09 오래전 글이 뒤늦게 목록에 나타나도(다른 말머리에서 이동) 올리지 않는다', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 12);
    routes.dc = dcHtml([[150, '와일즈 점검 및 패치 안내(3일 전 글)', clock.t - 3 * 86400e3], [100, '기존 와일즈 글', T0 - 3600e3], [99, '아웃랜더스 기존 글', T0 - 7200e3]]);
    await run(w, 10);
    assert.equal(sent.length, 0);
    assert.ok(setup.logs.some(m => m.includes('오래된 글')));
    record('오래된 글의 뒤늦은 등장', '3일 전 글은 올리지 않음', true);
});

test('10 본문 요청이 계속 실패하는 글(삭제 등)이 있어도 뒤의 새 글이 막히지 않는다', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 12);
    routes.dc = dcHtml([[502, '내일 오전 10시 와일즈 점검 예정', clock.t - MIN], [501, '파리 게임 위크 일정 (삭제된 글)', clock.t - MIN], [100, '기존 와일즈 글', T0 - 3600e3], [99, '아웃랜더스 기존 글', T0 - 7200e3]]);
    routes.dcView = {}; // 본문 404
    await run(w, 60, 5);
    assert.ok(setup.logs.some(m => m.includes('번 실패해 건너뜀')));
    assert.ok(sent.some(s => s.title.includes('점검 예정')), '뒤의 점검 글이 올라와야 함');
    record('본문을 못 읽는 글', '3번 실패 후 건너뛰고 뒤의 글은 정상 알림', true);
});

test('11 GitHub: 초안은 제외하고 새 릴리즈 2개는 시간순으로 올린다', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 12);
    routes.gh = JSON.stringify([
        { id: 4, name: 'draft', tag_name: 'd', html_url: 'https://github.com/x', draft: true },
        { id: 3, name: 'Nightly 102', tag_name: 'nightly-102', html_url: 'https://github.com/r/3', published_at: new Date(clock.t - MIN).toISOString(), prerelease: true, body: '## Changes\n- Fix crash on RE Engine games\n- Update offsets https://x.y' },
        { id: 2, name: 'Nightly 101', tag_name: 'nightly-101', html_url: 'https://github.com/r/2', published_at: new Date(clock.t - 3 * MIN).toISOString(), prerelease: true, body: 'Minor fixes' },
        { id: 1, name: 'Nightly 100', tag_name: 'nightly-100', html_url: 'https://github.com/r/1', published_at: new Date(T0 - 86400e3).toISOString(), prerelease: true, body: 'Old build' },
    ]);
    await run(w, 10);
    const g = sent.filter(s => s.src === 'reframework');
    assert.deepEqual(g.map(s => s.title), ['Nightly 101', 'Nightly 102']);
    record('REFramework 릴리즈 2개 + 초안', '초안 제외, 시간순으로 카드 2개', true);
});

test('12 봇을 재시작해도(저장 기록 유지) 같은 소식을 다시 올리지 않는다', async () => {
    const { w, store } = setup({ init: baseInit() });
    await run(w, 12);
    routes.official = officialHtml([['Ver.1.042.00.04', '2026년 11월 11일(수)', ['오류 수정'], ['Steam']], ['Ver.1.042.00.03', '2026년 10월 27일(화)', ['오류 수정'], ['PS5', 'Steam']]]);
    await run(w, 12);
    assert.equal(sent.length, 1);
    // 재시작: 같은 저장 기록으로 새 감시자 생성
    const snapshot = structuredClone(store.data);
    const again = setup({ init: { ...baseInit(), official: routes.official, __store: snapshot } });
    routes.official = officialHtml([['Ver.1.042.00.04', '2026년 11월 11일(수)', ['오류 수정'], ['Steam']], ['Ver.1.042.00.03', '2026년 10월 27일(화)', ['오류 수정'], ['PS5', 'Steam']]]);
    await run(again.w, 30);
    assert.equal(sent.length, 0, '재시작 후 중복 전송 없어야 함');
    record('봇 재시작', '저장 기록 덕분에 같은 소식을 다시 올리지 않음', true);
});

test('13 유튜브 키가 없으면 유튜브만 꺼지고 나머지는 정상', async () => {
    const { w } = setup({ youtube: false, init: baseInit() });
    await run(w, 12);
    routes.official = officialHtml([['Ver.1.042.00.04', '2026년 11월 11일(수)', ['오류 수정'], ['Steam']], ['Ver.1.042.00.03', '2026년 10월 27일(화)', ['오류 수정'], ['PS5', 'Steam']]]);
    await run(w, 12);
    assert.equal(calls.yt ?? 0, 0);
    assert.equal(sent.length, 1);
    record('유튜브 키 없음', '유튜브 요청 0번, 공식 알림은 정상', true);
});

test('14 성능: 큰 응답·이상한 응답도 빠르고 가볍게 처리한다', () => {
    const rows = Array.from({ length: 60 }, (_, i) => dcRow(1000 + i, `와일즈 점검 ${i}`, T0));
    const big = dcHtml([]) + rows.join('') + 'x'.repeat(220_000);
    let t = process.hrtime.bigint();
    const heap0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20; i++) assert.equal(parse.parseDcList(big).length, 60);
    const dcMs = Number(process.hrtime.bigint() - t) / 1e6 / 20;
    const junk = '<tr class="ub-content ">'.repeat(2000) + '<li class="latest_update_list '.repeat(2000) + 'a'.repeat(3_000_000);
    t = process.hrtime.bigint();
    parse.parseDcList(junk); parse.parseOfficialList(junk); parse.parseDcBody(junk); parse.parseGithubReleases(junk); parse.parseYoutubePlaylist(junk);
    const junkMs = Number(process.hrtime.bigint() - t) / 1e6;
    const heapMB = (process.memoryUsage().heapUsed - heap0) / 1048576;
    assert.ok(dcMs < 50, `디시 목록 파싱 ${dcMs.toFixed(1)}ms`);
    assert.ok(junkMs < 1500, `비정상 3MB 응답 처리 ${junkMs.toFixed(0)}ms`);
    record('성능', `디시 목록(약 300KB) 파싱 ${dcMs.toFixed(1)}ms · 비정상 3MB 응답 ${junkMs.toFixed(0)}ms · 힙 증가 ${heapMB.toFixed(1)}MB`, true, { dcMs, junkMs, heapMB });
});

test('15 영문뿐인 패치 공지는 기다리지 않고 한글 제목으로 바로 올리고, 한글판이 나와도 다시 올리지 않는다', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 12);
    const list = v => [[v, '', ['오류 수정'], ['Steam']], ['Ver.1.042.00.03', '', ['오류 수정'], ['Steam']]];
    routes.official = officialHtml(list('EN:Ver.1.042.00.07'));
    await run(w, 10);
    let o = sent.filter(s => s.src === 'official');
    assert.equal(o.length, 1, '영문뿐이어도 한글 제목으로 바로 올려야 함');
    assert.equal(o[0].heading, '### 업데이트 개요 (Ver.1.042.00.07)');
    assert.ok(o[0].lines.join(' ').includes('한글 본문 미제공'));
    assert.ok(!/Update Summary|Release Date|\[h2\]|\[list\]/.test(o[0].lines.join(' ')), '영문 본문·서식이 카드에 나오면 안 됨');
    routes.official = officialHtml(list('Ver.1.042.00.07')); // 같은 번호의 한글판이 뒤늦게 나와도
    await run(w, 30);
    assert.equal(sent.filter(s => s.src === 'official').length, 1, '다시 올리면 안 됨');
    record('영문뿐인 패치 공지', '한글 제목으로 바로 1개 올림(본문 영문은 싣지 않음), 한글판이 나와도 중복 없음', true);
});

test('15b 처음 보는 영문 꼴은 한글판이 올라올 때까지 보류했다가 한 번만 올린다', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 12);
    const list = v => [[v, '', ['오류 수정'], ['Steam']], ['Ver.1.042.00.03', '', ['오류 수정'], ['Steam']]];
    routes.official = officialHtml(list('UNK:Ver.1.042.00.08'));
    await run(w, 30);
    assert.equal(sent.filter(s => s.src === 'official').length, 0);
    assert.ok(setup.logs.some(m => m.includes('한글판을 기다리는 중')));
    routes.official = officialHtml(list('Ver.1.042.00.08'));
    await run(w, 30);
    const o = sent.filter(s => s.src === 'official');
    assert.equal(o.length, 1);
    assert.equal(o[0].heading, '### 업데이트 개요 (Ver.1.042.00.08)');
    record('한글 번역 대기(모르는 영문 꼴)', '보류했다가 한글판이 올라오면 1개만 올림', true);
});

test('16 디시 패치노트 글에 공식 페이지 링크가 있으면 공식으로 표기하고 버튼을 공식 페이지로 건다', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 12);
    const OFF = 'https://info.monsterhunter.com/wilds/update/ko-kr/Ver.1.042.00.05.html';
    routes.dcView = {
        '601': dcView('이번 패치노트 공식 페이지 ' + OFF + ' 정리해서 올립니다 확인해 보세요 감사합니다'),
        '602': dcView('같은 패치노트 또 올림 ' + OFF + ' 중복 글입니다 확인해 보세요 감사합니다'),
    };
    routes.dc = dcHtml([[602, 'Ver.1.042.00.05 패치노트 또 올림', clock.t - MIN], [601, 'Ver.1.042.00.05 패치노트 공개.jpg', clock.t - 2 * MIN], [100, '기존 와일즈 글', T0 - 3600e3], [99, '아웃랜더스 기존 글', T0 - 7200e3]]);
    await run(w, 10);
    const d = sent.filter(s => s.src === 'dc');
    assert.equal(d.length, 1, '같은 버전은 한 번만');
    assert.equal(d[0].heading, '### 업데이트 개요 (Ver.1.042.00.05)');
    assert.ok(d[0].lines[0].includes('Update Information'), d[0].lines[0]);
    assert.ok(d[0].lines.join(' ').includes('디시 제보로 먼저 확인'));
    assert.deepEqual(d[0].buttons.map(b => b.label), ['공식 패치노트 보기', '디시 원글']);
    assert.equal(d[0].buttons[0].url, OFF);
    assert.match(d[0].buttons[1].url, /gall.dcinside.com.*no=601/);
    assert.ok(setup.logs.some(m => m.includes('이미 알린 버전')));
    // 뒤늦게 스팀 한국어 공지가 올라오면 자세한 내용으로 이어서 알린다
    routes.official = officialHtml([['Ver.1.042.00.05', '', ['오류 수정'], ['Steam']], ['Ver.1.042.00.03', '', ['오류 수정'], ['Steam']]]);
    await run(w, 10);
    assert.equal(sent.filter(s => s.src === 'official').length, 1);
    record('디시 패치노트(공식 링크 있음)', '공식으로 표기, 버튼=공식 페이지·디시 원글, 같은 버전 중복 글은 건너뜀, 뒤이어 스팀 상세 공지', true);
});

test('16b 사진뿐인 제보가 먼저 나가도, 같은 버전의 공식 링크 글이 뒤에 올라오면 공식 카드로 다시 알린다', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 12);
    const OFF = 'https://info.monsterhunter.com/wilds/update/ko-kr/Ver.1.042.00.09.html';
    routes.dcView = { '801': dcView('<img src="a.jpg">'), '802': dcView('공식 페이지 ' + OFF + ' 입니다 확인해 보세요 감사합니다 많이 봐 주세요') };
    const base = [[100, '기존 와일즈 글', T0 - 3600e3], [99, '아웃랜더스 기존 글', T0 - 7200e3]];
    routes.dc = dcHtml([[801, 'Ver.1.042.00.09 패치 예정.jpg', clock.t - MIN], ...base]);
    await run(w, 6);
    routes.dc = dcHtml([[802, 'Ver.1.042.00.09 패치노트 공개', clock.t - MIN], [801, 'Ver.1.042.00.09 패치 예정.jpg', clock.t - 7 * MIN], ...base]);
    await run(w, 6);
    const d = sent.filter(s => s.src === 'dc');
    assert.equal(d.length, 2, d.map(x => x.heading).join(' | '));
    assert.ok(d[0].lines[0].includes('몬스터헌터 시리즈 갤러리 ⓜ'));   // 먼저: 제보
    assert.ok(d[1].lines[0].includes('Update Information'));          // 뒤에: 공식 링크 확인
    assert.equal(d[1].buttons[0].url, OFF);
    record('제보 → 공식 링크 확인', '사진뿐인 제보가 먼저 나가고, 공식 링크 글이 뒤에 오면 공식 카드로 한 번 더 알림', true);
});

test('17 디시 패치노트 글에 링크 없이 사진뿐이면 디시 제보로 표기하고 버튼을 디시 원글로 건다', async () => {
    const { w } = setup({ init: baseInit() });
    await run(w, 12);
    routes.dcView = { '701': dcView('<img src="a.jpg">') };
    routes.dc = dcHtml([[701, 'Ver.1.042.00.06 패치노트.jpg', clock.t - MIN], [100, '기존 와일즈 글', T0 - 3600e3], [99, '아웃랜더스 기존 글', T0 - 7200e3]]);
    await run(w, 10);
    const d = sent.filter(s => s.src === 'dc');
    assert.equal(d.length, 1);
    assert.ok(d[0].lines[0].includes('몬스터헌터 시리즈 갤러리 ⓜ'), d[0].lines[0]);
    assert.deepEqual(d[0].buttons.map(b => b.label), ['디시 원글 보기']);
    assert.match(d[0].buttons[0].url, /gall.dcinside.com.*no=701/);
    record('디시 패치노트(사진뿐)', '디시 제보로 표기, 버튼=디시 원글', true);
});
