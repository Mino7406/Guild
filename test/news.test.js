const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../news/parse');
const { createWatcher, buildPayload, buildSources, EMOJI_NAMES } = require('../news/watcher');
const fs = require('fs');
const path = require('path');

const OFFICIAL_HTML = `<ul class="latest_update"><li class="latest_update_list Ver-1-042-00-03"><a href="./Ver.1.042.00.03.html"><p class="latest_update_list_ver">Ver.1.042.00.03</p><div><dl class="latest_update_list_date"><dt>배포일</dt><dd>2026년 10월 27일(화)</dd></dl><dl class="latest_update_list_detail"><dt>【주요】</dt><dd><ul><li>오류 수정</li></ul></dd></dl></div><ul class="latest_update_list_platform"><li class="PS5">PS5</li><li class="Steam">Steam</li></ul></a></li><li class="latest_update_list Ver-1-042-00-02"><a href="./Ver.1.042.00.02.html"><p class="latest_update_list_ver">Ver.1.042.00.02</p><div><dl class="latest_update_list_date"><dt>배포일</dt><dd>2026년 8월 14일(금)</dd></dl></div></a></li></ul>`;

test('공식 목록 파싱', () => {
    const r = p.parseOfficialList(OFFICIAL_HTML);
    assert.equal(r.length, 2);
    assert.equal(r[0].key, 'wilds-Ver.1.042.00.03');
    assert.equal(r[0].url, 'https://info.monsterhunter.com/wilds/update/ko-kr/Ver.1.042.00.03.html');
    assert.deepEqual(r[0].platforms, ['PS5', 'Steam']);
    assert.deepEqual(r[0].kinds, ['오류 수정']);
    assert.equal(new Date(r[0].at + 9 * 3600e3).toISOString().slice(0, 10), '2026-10-27');
});

// 실제 디시 목록 행 구조(말머리는 별도 td, 제목 링크 안에 <em> 아이콘)
const row = (num, subj, title, date) => `<tr class="ub-content us-post" data-no="${num}"> <td class="gall_num">${num}</td> <td class="gall_subject">${subj}</td> <td class="gall_tit ub-word"> <a href="/mgallery/board/view/?id=capcommh&no=${num}" view-msg =""> <em class="icon_img icon_recomimg"></em>${title}</a> <a class="reply_numbox" href="#"><span class="reply_num">[16]</span></a> </td> <td class="gall_date" title="${date}">10:05</td> </tr>`;
test('디시 목록 파싱: 광고·설문 줄 제외', () => {
    const html = row('-', 'AD', '광고', '26/03/05') + row('1536681', '공식', '내일 오전 10시 와일즈 점검', '2026-11-11 10:05:05');
    const r = p.parseDcList(html);
    assert.equal(r.length, 1);
    assert.equal(r[0].key, 'dc-1536681');
    assert.match(r[0].title, /와일즈 점검/);
    assert.equal(r[0].at, Date.parse('2026-11-11T10:05:05+09:00'));
});

test('디시 제목의 HTML 기호(10진수·16진수·&amp;)를 글자로 바꾼다', () => {
    const html = row('1', '공식', '&#x1f517;알슈베르도 &amp; 챌린지 &#128279;', '2026-11-11 10:05:05');
    assert.equal(p.parseDcList(html)[0].title, '🔗알슈베르도 & 챌린지 🔗');
});

test('디시 분류', () => {
    const c = t => p.classifyTitle(t);
    assert.equal(c('내일 오전 10시 와일즈 점검 및 패치 예정.jpg').action, 'include');
    assert.equal(c('내일 오전 10시 와일즈 점검 및 패치 예정.jpg').kind.id, 'maintenance');
    assert.equal(c('아랜 11월 11일 무점검 패치 안내').action, 'skip');
    assert.equal(c('아웃랜더스 오늘자 패치 내역.jpg').action, 'skip');
    assert.equal(c('몬헌 와일즈 어센던스 1st 트레일러').action, 'skip'); // 영상은 유튜브 담당
    assert.equal(c('파리 게임 위크 공식 일정 안내.jpg').action, 'checkBody');
    assert.equal(c('와일즈 게임스컴 참여 안내').kind.id, 'event');
    assert.equal(c('즈3 100만장 팔렸다고하네').action, 'skip');
    assert.equal(c('스위치2 와일즈 체험판 10월 20일 배포.jpg').action, 'include');
    // 버전 번호만 있어도 와일즈 패치 소식(팬이 올린 패치노트 글을 빨리 알리기 위해)
    assert.equal(c('Ver.1.043 패치노트 공개.jpg').action, 'include');
    assert.equal(c('Ver.1.043 패치노트 공개.jpg').kind.id, 'patch');
    assert.equal(c('1.043 업데이트 내역').action, 'include');
    assert.equal(c('아웃랜더스 Ver.1.043 패치 안내').action, 'skip'); // 다른 게임은 여전히 제외
    assert.equal(c('Ver.2.1 패치 안내').action, 'skip');            // 와일즈 버전 꼴이 아니면 제외
});

test('행사 본문: 어센던스 언급은 참여, 없으면 불참, 이미지뿐이면 확인 불가', () => {
    assert.equal(p.confirmBody('몬스터헌터 어센던스 보스 챌린지 진행자 XABAB 그리고 개발자 프레젠테이션').include, true);
    assert.equal(p.confirmBody('스트리트 파이터 6 대회 일정과 결승 진행 안내입니다 많이 시청해 주세요').include, false);
    assert.equal(p.confirmBody('').include, false);
});

test('유튜브 파싱·분류', () => {
    const json = JSON.stringify({ items: [
        { snippet: { title: '몬스터헌터 와일즈 어센던스 - 무기 소개 영상: 활', publishedAt: '2026-09-05T07:00:00Z', resourceId: { videoId: 'abc' } } },
        { snippet: { title: 'Private video', resourceId: { videoId: 'x' } } },
        { snippet: { title: '스트리트 파이터 6 트레일러', resourceId: { videoId: 'sf6' } } },
    ] });
    const r = p.parseYoutubePlaylist(json);
    assert.equal(r.length, 2);
    assert.equal(r[0].url, 'https://www.youtube.com/watch?v=abc');
    assert.equal(p.classifyYoutube(r[0].title).include, true);
    assert.equal(p.classifyYoutube(r[1].title).include, false);
});

test('GitHub 릴리즈 파싱: 초안 제외, 본문 요약', () => {
    const json = JSON.stringify([
        { id: 11, name: 'Nightly 01234', tag_name: 'nightly-01234', html_url: 'https://github.com/praydog/REFramework-nightly/releases/tag/nightly-01234', published_at: '2026-11-11T01:00:00Z', prerelease: true, draft: false, body: '## Changes\n- Fix **crash** on [Wilds](https://x.y)\n- Update https://foo.bar offsets' },
        { id: 12, name: 'draft', tag_name: 'd', html_url: 'https://github.com/x', draft: true },
    ]);
    const r = p.parseGithubReleases(json);
    assert.equal(r.length, 1);
    assert.equal(r[0].key, 'gh-11');
    assert.equal(r[0].prerelease, true);
    assert.equal(r[0].summary, 'Changes · Fix crash on Wilds · Update offsets');
    assert.deepEqual(p.parseGithubReleases('not json'), []);
});

test('유튜브 키에 공백·줄바꿈·따옴표가 섞여도 정리해서 요청한다', async () => {
    let header;
    const realFetch = global.fetch;
    global.fetch = async (url, opts) => { header = opts.headers['x-goog-api-key']; return new Response('{"items":[]}', { status: 200 }); };
    try {
        const yt = buildSources({ YOUTUBE_API_KEY: ' "AbC-123_xyz"\r\n' }).find(s => s.id === 'youtube');
        await yt.load();
        assert.equal(header, 'AbC-123_xyz');
        assert.equal(buildSources({ YOUTUBE_API_KEY: ' \r\n' }).some(s => s.id === 'youtube'), false);
    } finally { global.fetch = realFetch; }
});

test('요청이 실패하면 오류 사유를 짧게 덧붙이고, JSON 이 아니면 상태 코드만 남긴다', async () => {
    const realFetch = global.fetch;
    try {
        const yt = buildSources({ YOUTUBE_API_KEY: 'AbC123' }).find(s => s.id === 'youtube');
        global.fetch = async () => new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }), { status: 400 });
        await assert.rejects(yt.load(), /HTTP 400 \(API key not valid/);
        global.fetch = async () => new Response('<html>Forbidden</html>', { status: 403 });
        await assert.rejects(buildSources({}).find(s => s.id === 'official').load(), err => err.message === 'HTTP 403' && err.status === 403);
    } finally { global.fetch = realFetch; }
});

test('출처별 이모지·썸네일 매칭', () => {
    const sources = Object.fromEntries(buildSources({ YOUTUBE_API_KEY: 'k' }).map(s => [s.id, s]));
    // 이모지 이름과 PNG 파일이 서로 맞는다
    assert.deepEqual(EMOJI_NAMES, { official: 'news_wilds', dc: 'news_dcinside', youtube: 'news_youtube', reframework: 'news_github' });
    for (const name of Object.values(EMOJI_NAMES)) assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'emojis', `${name}.png`)), name);
    const ids = { official: '111', dc: '222', youtube: '333', reframework: '444' };
    const entry = { title: '제목', url: 'https://example.com/x', at: 1, kinds: [], platforms: [], summary: '' };
    const thumbOf = (src) => {
        const e = sources[src];
        const v = { include: true, kind: { label: 'k', emoji: 'E' }, ...(src === 'youtube' ? { plainLink: true } : {}) };
        const payload = buildPayload(e, entry, v, ids);
        return payload.content ?? payload.components[0].toJSON().components[0].accessory.media.url;
    };
    assert.match(thumbOf('official'), /emojis\/111\.png/);
    assert.match(thumbOf('dc'), /emojis\/222\.png/);
    assert.match(thumbOf('reframework'), /emojis\/444\.png/);
    assert.match(thumbOf('youtube'), /<:news_youtube:333>/); // 유튜브는 임베드가 있어 머리말에 로고 이모지
    // 이모지가 아직 없으면 예전 방식으로 보낸다(공식은 공식 이미지, 유튜브는 기본 이모지)
    const off = buildPayload(sources.official, entry, { include: true, kind: { label: 'k', emoji: 'E' }, thumb: 'https://x/share.png' }, {});
    assert.equal(off.components[0].toJSON().components[0].accessory.media.url, 'https://x/share.png');
    assert.match(buildPayload(sources.youtube, entry, { include: true, kind: { label: 'k', emoji: 'E' }, plainLink: true }, {}).content, /^-# E k/);
});

test('스팀 한국어 공지 파싱·분류: 한글 패치·점검만 올리고, 영문만 있으면 한글판을 기다린다', () => {
    const ev = (gid, name, body, extra = {}) => ({ gid, event_name: name, rtime32_start_time: 1793000000, announcement_body: { body }, ...extra });
    const json = JSON.stringify({ events: [
        ev('1', '업데이트 개요 (Ver.1.042.00.03)', ['[h2][b]배포일[/b][/h2]', '[b]2026년 10월 27일(화)[/b]', '본문', '[list]', '[*] 일부 AMD 그래픽 카드에서 강제 종료 현상을 개선했습니다', '[*] 통신 오류를 개선했습니다', '[/list]'].join('\n')),
        ev('2', '업데이트 Ver1.042 점검 안내', '점검 안내 본문 https://x.y/z {STEAM_CLAN_IMAGE}/a.png'),
        ev('3', 'Monster Hunter Wilds: Ascendance에 푸루푸루 등장!', '영상'),
        ev('4', 'Update Summary (Ver.1.042.00.05)', 'English only'),
        ev('5', 'Fight alongside Wilds Monsters in Stories 3!', 'english'),
        ev('6', '숨겨진 공지 업데이트', 'x', { published: 0 }),
        { event_name: '번호 없음' },
    ] });
    const r = p.parseSteamEvents(json);
    assert.equal(r.length, 5);
    assert.equal(r[0].key, 'steam-1');
    assert.equal(r[0].url, 'https://store.steampowered.com/news/app/2246340/view/1?l=koreana');
    assert.equal(r[0].dateText, '2026년 10월 27일(화)');
    assert.equal(r[0].summary, '일부 AMD 그래픽 카드에서 강제 종료 현상을 개선했습니다 · 통신 오류를 개선했습니다');
    assert.equal(r[0].at, 1793000000 * 1000);
    assert.equal(r[1].summary, '점검 안내 본문');
    const cls = r.map(x => p.classifySteam(x.title));
    assert.deepEqual(cls.map(c => c.include), [true, true, false, false, false]);
    assert.equal(cls[0].kind.id, 'patch');
    assert.equal(cls[1].kind.id, 'maintenance');
    assert.equal(cls[3].defer, true);   // 영문 패치 공지 → 한글판 대기
    assert.equal(cls[4].defer, undefined); // 영문이지만 패치와 무관
    assert.deepEqual(p.parseSteamEvents('not json'), []);
});

test('제목 유사도', () => {
    const a = p.tokenize('몬스터헌터 와일즈 어센던스 게임스컴 참여 일정');
    assert.equal(p.similarTitles(a, p.tokenize('게임스컴 어센던스 참여 일정 안내')), true);
    assert.equal(p.similarTitles(a, p.tokenize('와일즈 점검 및 패치 예정')), false);
});

function fakeSource(id, lists, decide) {
    let i = 0;
    return { id, label: id, pollMs: 1000, maxFresh: 3, load: async () => lists[Math.min(i++, lists.length - 1)], decide };
}
const entry = (key, title) => ({ key, title, url: 'https://x/' + key, at: 1 });
const mk = (sources, sent) => createWatcher({ sources, store: { data: {}, save() {} }, send: async (s, e) => { sent.push(`${s.id}:${e.title}`); } });

test('처음에는 기억만 하고 올리지 않는다, 이후 새 글만 올린다', async () => {
    const sent = [];
    const src = fakeSource('a', [[entry('1', '기존')], [entry('1', '기존'), entry('2', '새 소식 하나')]], () => ({ include: true, kind: p.GENERAL_KIND }));
    const w = mk([src], sent);
    assert.equal(await w.checkSource(src), 0);
    assert.equal(await w.checkSource(src), 1);
    assert.deepEqual(sent, ['a:새 소식 하나']);
});

test('한꺼번에 새 글이 너무 많으면 올리지 않고 기억만 한다', async () => {
    const sent = [];
    const many = ['2', '3', '4', '5'].map(k => entry(k, '글 ' + k));
    const src = fakeSource('a', [[entry('1', '기존')], [entry('1', '기존'), ...many]], () => ({ include: true, kind: p.GENERAL_KIND }));
    const w = mk([src], sent);
    await w.checkSource(src);
    assert.equal(await w.checkSource(src), 0);
    assert.deepEqual(sent, []);
});

test('목록이 비면 오류', async () => {
    const src = fakeSource('a', [[]], () => ({ include: true, kind: p.GENERAL_KIND }));
    await assert.rejects(mk([src], []).checkSource(src), /비어/);
});

test('전송 실패한 글은 기억되지 않아 다음에 다시 시도한다', async () => {
    let fail = true; const sent = [];
    const src = fakeSource('a', [[entry('1', '기존')], [entry('1', '기존'), entry('2', '새 글 내용')]], () => ({ include: true, kind: p.GENERAL_KIND }));
    const w = createWatcher({ sources: [src], store: { data: {}, save() {} }, send: async (s, e) => { if (fail) throw new Error('x'); sent.push(e.title); } });
    await w.checkSource(src);
    await assert.rejects(w.checkSource(src));
    fail = false;
    assert.equal(await w.checkSource(src), 1);
    assert.deepEqual(sent, ['새 글 내용']);
});

test('다른 출처가 같은 소식을 올렸으면 건너뛴다', async () => {
    const sent = [];
    const yes = () => ({ include: true, kind: p.GENERAL_KIND });
    const yt = fakeSource('yt', [[entry('y0', '기존 영상')], [entry('y0', '기존 영상'), entry('y1', '어센던스 게임스컴 참여 일정 공개')]], yes);
    const dc = fakeSource('dc', [[entry('d0', '기존 글')], [entry('d0', '기존 글'), entry('d1', '게임스컴 어센던스 참여 일정 안내')]], yes);
    const w = mk([yt, dc], sent);
    await w.checkSource(yt); await w.checkSource(dc);
    await w.checkSource(yt); await w.checkSource(dc);
    assert.deepEqual(sent, ['yt:어센던스 게임스컴 참여 일정 공개']);
});
