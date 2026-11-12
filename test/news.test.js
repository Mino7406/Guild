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

test('디시 제목 끝의 이미지 확장자(.jpg 등)를 뗀다', () => {
    assert.equal(p.cleanDcTitle('내일 오전 10시 와일즈 점검 및 패치 예정.jpg'), '내일 오전 10시 와일즈 점검 및 패치 예정');
    assert.equal(p.cleanDcTitle('Ver.1.043 패치노트 .PNG '), 'Ver.1.043 패치노트');
    assert.equal(p.cleanDcTitle('파일.jpeg.gif'), '파일.jpeg');
    assert.equal(p.cleanDcTitle('Ver.1.042 패치'), 'Ver.1.042 패치');   // 버전 번호의 점은 건드리지 않음
    const html = row('7', '공식', '몬헌 와일즈 사냥왕 결정전 챔피언십 우승자.jpg', '2026-11-11 10:05:05');
    assert.equal(p.parseDcList(html)[0].title, '몬헌 와일즈 사냥왕 결정전 챔피언십 우승자');
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

test('테스트 미리보기: 출처별 최근 알림 대상만 시간순으로 올리고, 운영 기록은 건드리지 않는다', async () => {
    const { previewRecent, collectRecent } = require('../news/watcher');
    const mkSrc = (id, label, entries, decide, fail = false) => ({ id, label, load: async () => { if (fail) throw new Error('HTTP 403'); return entries; }, decide });
    const kind = { id: 'patch', label: '패치노트' };
    const yes = () => ({ include: true, kind });
    const e = (key, title, at) => ({ key, title, url: 'https://x/' + key, at, tags: [], summary: '' });
    const a = mkSrc('official', 'A', [e('1', '가', 100), e('2', '나', 300), e('3', '다', 200), e('4', '라', 400)], ent => ent.key === '4' ? { include: false } : yes());
    const b = mkSrc('dc', 'B', [e('5', '마', 250)], yes);
    const c = mkSrc('reframework', 'C', [], yes, true);          // 읽기 실패
    const posts = [];
    const r = await previewRecent({ sources: [a, b, c], post: async p => { posts.push(p); }, perSource: 2 });
    // A: 가장 최근 대상 2개(나300, 다200), B: 1개(마250) → 시간순 다200, 마250, 나300
    assert.equal(r.posted, 3);
    assert.deepEqual(r.perSource, { official: 2, dc: 1, reframework: 0 });
    assert.deepEqual(r.errors, ['C: HTTP 403']);
    assert.equal(posts.length, 4);                              // 안내 1 + 카드 3
    assert.match(posts[0].content, /테스트 미리보기/);
    const titles = posts.slice(1).map(p => JSON.stringify(p.components[0].toJSON()).match(/### ([^"\\]+)/)[1]);
    assert.deepEqual(titles, ['다', '마', '나']);
    assert.equal((await collectRecent([a], 1)).length, 1);
});

test('테스트 미리보기: 모든 임베드 종류 샘플을 만들고(실제 판정 통과), 한 카드가 바뀌는 흐름도 보여 준다', async () => {
    const { previewSamples, buildSamples } = require('../news/watcher');
    const sources = buildSources({ YOUTUBE_API_KEY: 'sample' });
    const { samples } = await buildSamples(sources);
    const labels = samples.map(s => s.label);
    // 출처마다, 카드 종류마다 샘플이 있어야 한다
    for (const part of ['공식 · 패치노트', '공식 · 큰 업데이트', '공식 · 점검 안내', '공식 · 영문', '디시 · 점검 예고', '사진뿐', '공식 링크 확인', '행사 참여', '디시 · 신규 콘텐츠', '디시 · 일반 소식', '유튜브', '프리릴리즈', '정식']) {
        assert.ok(labels.some(l => l.includes(part)), `샘플 없음: ${part}`);
    }
    const posts = [], edits = [];
    const r = await previewSamples({ sources, post: async p => { posts.push(p); return 'm' + posts.length; }, edit: async (id, p) => { edits.push({ id, p }); }, wait: async () => {}, emojiIds: { official: '1', dc: '2', youtube: '3', reframework: '4' } });
    assert.equal(r.samples, samples.length + 2);              // 샘플 + 이모지 없는 기본 모양 + 흐름
    assert.equal(edits.length, 2);                            // 제보 → 공식 링크 → 스팀 상세
    assert.equal(edits[0].id, edits[1].id);                   // 같은 메시지를 수정
    // 안내 글과 카드가 번갈아 올라간다(안내는 일반 메시지, 카드는 컴포넌트 v2)
    const cards = posts.filter(p => p.components);
    const notes = posts.filter(p => p.content !== undefined);
    // 카드 = 샘플 전부(유튜브 포함) + 이모지 없는 기본 모양 + 흐름의 첫 카드
    assert.equal(cards.length, samples.length + 2);
    assert.ok(notes.length >= samples.length + 3);
    // 유튜브 샘플도 카드이고 영상 썸네일이 들어간다
    assert.ok(cards.some(p => JSON.stringify(p.components[0].toJSON()).includes('ytimg.com/vi/rVIKWBd_280/maxresdefault.jpg')));
    // 공식 링크 확인 샘플은 버튼이 공식 페이지로, 사진뿐 샘플은 디시 원글로 간다
    const btn = c => { const o = []; (function w(x) { if (!x || typeof x !== 'object') return; if (x.url && x.label) o.push(x); Object.values(x).forEach(w); })(c.components[0].toJSON()); return o[0]; };
    const byLabel = part => samples.findIndex(s => s.label.includes(part));
    const linkCard = buildPayload(samples[byLabel('공식 링크 확인')].source, samples[byLabel('공식 링크 확인')].entry, samples[byLabel('공식 링크 확인')].verdict, {});
    assert.match(btn(linkCard).url, /info\.monsterhunter\.com\/wilds\/update\/ko-kr\/Ver\.1\.042\.00\.03\.html/);
    const photoCard = buildPayload(samples[byLabel('사진뿐')].source, samples[byLabel('사진뿐')].entry, samples[byLabel('사진뿐')].verdict, {});
    assert.match(btn(photoCard).url, /gall\.dcinside\.com/);
    assert.equal(btn(photoCard).label, '🔗 내용 보기');
});

test('모든 카드의 버튼은 하나이고 이름은 "내용 보기"로 통일(디시 원글 버튼 없음)', () => {
    const sources = Object.fromEntries(buildSources({ YOUTUBE_API_KEY: 'k' }).map(s => [s.id, s]));
    const walkButtons = payload => { const out = []; (function walk(x) { if (!x || typeof x !== 'object') return; if (x.url && x.label) out.push(x); Object.values(x).forEach(walk); })(payload.components[0].toJSON()); return out; };
    const entry = { title: '제목', url: 'https://example.com/x', at: 1, tags: [], summary: '' };
    for (const id of ['official', 'dc', 'reframework']) {
        const b = walkButtons(buildPayload(sources[id], entry, { include: true, kind: { label: 'k' } }, { [id]: '1' }));
        assert.deepEqual(b.map(x => x.label), ['🔗 내용 보기'], id);
        assert.equal(b[0].url, 'https://example.com/x');
    }
    // 판정이 주소를 바꾼 경우(디시 글의 공식 링크)에도 버튼은 하나
    const b = walkButtons(buildPayload(sources.dc, entry, { include: true, kind: { label: 'k' }, url: 'https://info.monsterhunter.com/wilds/update/ko-kr/Ver.1.042.00.05.html', sourceLabel: 'Update Information', emojiSource: 'official' }, { official: '1' }));
    assert.deepEqual(b.map(x => [x.label, x.url]), [['🔗 내용 보기', 'https://info.monsterhunter.com/wilds/update/ko-kr/Ver.1.042.00.05.html']]);
});

test('출처 카드: 오른쪽 아이콘 없이 맨 윗줄에 출처 표기', () => {
    const sources = Object.fromEntries(buildSources({ YOUTUBE_API_KEY: 'k' }).map(s => [s.id, s]));
    // 이모지 이름과 PNG 파일은 다시 쓸 수 있게 남아 있다
    assert.deepEqual(EMOJI_NAMES, { official: 'news_wilds', dc: 'news_dcinside', youtube: 'news_youtube', reframework: 'news_github' });
    for (const name of Object.values(EMOJI_NAMES)) assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'emojis', `${name}.png`)), name);
    const ids = { official: '111', dc: '222', youtube: '333', reframework: '444' };
    const entry = { title: '제목', url: 'https://example.com/x', at: 1, kinds: [], platforms: [], summary: '' };
    for (const id of ['official', 'dc', 'dcbest', 'reframework', 'youtube']) {
        // 이모지가 등록돼 있어도, 썸네일 값이 있어도 오른쪽 아이콘(썸네일)은 붙지 않는다
        const v = { include: true, kind: { label: '패치노트' }, thumb: 'https://x/share.png', ...(id === 'youtube' ? { videoCard: true } : {}) };
        const json = buildPayload(sources[id], entry, v, ids).components[0].toJSON();
        assert.ok(!/emojis\/|share\.png/.test(JSON.stringify(json)), `${id}: 아이콘이 남아 있음`);
        assert.ok(json.components.every(c => !c.accessory), `${id}: 썸네일 섹션이 남아 있음`);
        // 출처는 맨 윗줄 '종류 · 출처'로 유지된다(이모지 없이)
        const head = json.components[0].content;
        assert.equal(head, `-# 패치노트 · ${sources[id].label}`, id);
    }
    // 공식 링크가 확인된 디시 글은 공식 출처 이름으로 표기된다
    const fan = buildPayload(sources.dc, entry, { include: true, kind: { label: '패치노트' }, sourceLabel: 'Update Information', emojiSource: 'official' }, ids).components[0].toJSON();
    assert.equal(fan.components[0].content, '-# 패치노트 · Update Information');
    // 유튜브 카드: 영상 썸네일(큰 이미지)이 들어간다
    const yt = buildPayload(sources.youtube, { ...entry, url: 'https://www.youtube.com/watch?v=ll0G8-nbT7o' }, { include: true, kind: { label: 'k' }, videoCard: true }, {});
    assert.match(JSON.stringify(yt.components[0].toJSON()), /i\.ytimg\.com\/vi\/ll0G8-nbT7o\/maxresdefault\.jpg/);
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
    assert.deepEqual(cls.map(c => c.include), [true, true, false, true, false]);
    assert.equal(cls[0].kind.id, 'patch');
    assert.equal(cls[1].kind.id, 'maintenance');
    // 영문 제목뿐인 "Update Summary"는 한글판이 끝내 안 나온 적이 있어서 기다리지 않고 한글 제목으로 바꿔 올린다
    assert.equal(cls[3].titleKo, '업데이트 개요 (Ver.1.042.00.05)');
    assert.equal(cls[3].englishOnly, true);
    assert.equal(cls[4].defer, undefined); // 영문이지만 패치와 무관
    // 처음 보는 영문 꼴은 한글판이 올라올 때까지 보류
    assert.equal(p.classifySteam('Hotfix Patch Notice').defer, true);
    assert.equal(p.classifySteam('Update Ver. 1.042 — Maintenance Notice').titleKo, '업데이트 Ver.1.042 점검 안내');
    // 본문 소제목에서 종류·변경 분야를 뽑는다
    const meta = p.parseSteamEvents(JSON.stringify({ events: [{ gid: '9', event_name: '업데이트 개요 (Ver.1.040)', rtime32_start_time: 1793000000, announcement_body: { body: ['[h2][b]주요 추가 요소 / 사양 변경[/b][/h2]', '[h2][b]오류 수정 / 게임 밸런스 조정 외[/b][/h2]', '[h3][b]【거점 / 시설 관련】[/b][/h3]', '[h3][b]【몬스터 관련】[/b][/h3]', '[h3][b]【플레이어 관련】[/b][/h3]'].join('\n') } }] }))[0];
    assert.deepEqual(meta.tags, ['주요 추가 요소', '사양 변경', '오류 수정', '밸런스 조정']);
    assert.deepEqual(meta.areas, ['거점·시설', '몬스터', '플레이어']);
    assert.equal(meta.summary, '변경 분야: 거점·시설 · 몬스터 · 플레이어');
    assert.deepEqual(p.parseSteamEvents('not json'), []);
});

test('디시 본문: 스크립트·스타일 블록은 글자로 읽지 않는다(사진뿐인 글은 빈 본문)', () => {
    const noise = '<script>if(window.OutLink){ var ck = get_cookie("x"); } // wilds 와일즈</script><style>.a{color:red}</style>';
    const imageOnly = `<div class="write_div"><div><img src="a.jpg"></div>${noise}</div><div class="btn_recommend_box"></div>`;
    assert.equal(p.parseDcBody(imageOnly), '');
    assert.equal(p.confirmBody(p.parseDcBody(imageOnly)).reason, '본문 확인 불가');
    const withText = `<div class="write_div"><div>와일즈 어센던스 일정 안내입니다 많이 시청해 주세요</div>${noise}</div><div class="btn_recommend_box"></div>`;
    assert.equal(p.parseDcBody(withText), '와일즈 어센던스 일정 안내입니다 많이 시청해 주세요');
});

test('디시 원글에서 공식 업데이트 페이지 링크와 버전을 찾는다', () => {
    const post = body => `<div class="write_div" style="x">${body}</div><div class="btn_recommend_box">추천</div><div id="comment_wrap">댓글 https://info.monsterhunter.com/wilds/update/ko-kr/Ver.9.9.9.9.html</div>`;
    const a = p.findOfficialUpdateLink(post('<p>패치노트 <a href="https://info.monsterhunter.com/wilds/update/ko-kr/Ver.1.042.00.04.html">링크</a></p>'));
    assert.deepEqual(a, { url: 'https://info.monsterhunter.com/wilds/update/ko-kr/Ver.1.042.00.04.html', version: '1.042.00.04' });
    // 일본어 페이지 링크도 한국어 페이지로 통일
    assert.equal(p.findOfficialUpdateLink(post('https://info.monsterhunter.com/wilds/update/ja-jp/Ver.1.042.00.04.html')).url, 'https://info.monsterhunter.com/wilds/update/ko-kr/Ver.1.042.00.04.html');
    assert.equal(p.findOfficialUpdateLink(post('<img src="a.jpg">')), null);          // 사진뿐
    assert.equal(p.findOfficialUpdateLink(post('https://example.com/Ver.1.042.html')), null); // 다른 사이트
    assert.deepEqual(p.versionsOf('Ver.1.042.00.03 / Ver.1.041 패치'), ['1.042.00.03', '1.041']);
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

test('와일즈 글자가 없어도 격투장·프리 챌린지·몽화의식·축제 예고와 와일즈 몬스터 챌린지는 와일즈 소식으로 본다', () => {
    const ok = (t, label) => { const c = p.classifyTitle(t); assert.equal(c.action, 'include', t); assert.equal(c.kind.label, label, t); };
    ok('프리 챌린지 격투장 퀘스트 배포 안내', '이벤트 퀘스트');
    ok('알슈베르도 챌린지 내일 종료 예정', '이벤트 퀘스트');
    ok('몽화의식 개최 예고', '축제 예고');
    for (const t of ['교류 축제[화무 의식] 개최 예고', '교류 축제[용화 의식] 안내', '교류 축제[몽화 의식] 시작', '교류 축제[축요 의식] 일정', '축요의식 언제부터냐', '교류축제 용화 의식 떴다']) ok(t, '축제 예고');
    // 다른 게임이거나 와일즈와 무관한 글은 그대로 제외
    assert.equal(p.classifyTitle('아랜 축제 이벤트 안내').action, 'skip');
    assert.equal(p.classifyTitle('스토리즈3 리오레우스 챌린지').action, 'skip');
    assert.equal(p.classifyTitle('오늘 점심 뭐먹지').action, 'skip');
});

// ── 개념글 점수(parse.dcNewsScore): 디시 몬갤 개념글 실제 글 기준 ──
const ev = (o = {}) => ({ official: false, links: [], media: false, video: false, imageCount: 0, textLen: 100, ...o });
test('개념글 점수: 공식 링크·점검·일정 글은 통과', () => {
    const pass = (t, e) => assert.equal(p.dcNewsScore(t, e).pass, true, `${t} → ${p.dcNewsScore(t, e).reasons.join(', ')}`);
    pass('내일 와일즈 점검한대', ev({ official: true, links: ['x.com'], imageCount: 2 }));
    pass('와일즈 콜라보 업데이트 대비 정기 점검 안내', ev({ imageCount: 3 }));
    pass('스위치2 와일즈 체험판 10월 20일 배포', ev({ imageCount: 7 }));
    pass('오늘부터 화무 축제 시작함.......', ev({ imageCount: 5 }));
    pass('와일즈 4월 이벤트 퀘스트 일정', ev({ imageCount: 4 }));
    pass('화무축제 아이루 인형 출시했우!!!!!', ev({ official: true, links: ['www.e-capcom.com'], imageCount: 3 }));   // 공식 링크가 있으면 말투 감점 없음
});
test('개념글 점수: 잡담·어그로·공략·팬 콘텐츠·근거 없는 글은 탈락', () => {
    const fail = (t, e) => assert.equal(p.dcNewsScore(t, e).pass, false, `${t} → ${p.dcNewsScore(t, e).reasons.join(', ')}`);
    fail('비상 !! 몬스터헌터 와일즈 사이퍼즈 콜라보 !!', ev({ imageCount: 11 }));
    fail('축제옷 그라비 24초', ev({ video: true, imageCount: 2 }));
    fail('12월 24일 나무통 굴리기 겨울축제코스 5번 공략', ev({ imageCount: 13 }));
    fail('이 버튼을 누르면 몬헌 와일즈가 바로 내일 발매됩니다', ev({ imageCount: 2 }));
    fail('와일즈 완충주 확정ㅋㅋㅋㅋ', ev({ imageCount: 2 }));
    fail('어센던스 신규 몬스터 공개', ev({ textLen: 5 }));   // 근거(사진·영상·링크) 없음 + 짧음
});
test('개념글 점수: 이유가 함께 나오고 기준 점수는 2점', () => {
    const r = p.dcNewsScore('와일즈 서버 점검 안내', ev({ imageCount: 1 }));
    assert.ok(r.reasons.some(x => x.includes('점검')));
    assert.equal(p.PASS_SCORE, 2);
});
