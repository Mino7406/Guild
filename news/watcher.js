// 몬스터 헌터 와일즈(어센던스 포함) 소식을 지켜보다가 새 소식이 올라오면 #와일즈_소식 채널에 카드로 올린다.
//
// 출처 세 곳
//  - official : 공식 패치노트·점검 공지(스팀 공개 공지 목록의 캡콤 한국어 공지; 공식 사이트는 서버 접속을 막아 쓰지 않음) — 10분마다
//  - reframework : REFramework-nightly GitHub 새 릴리즈 — 5분마다
//  - youtube  : 캡콤아시아 업로드 목록 (YouTube Data API, 키는 .env 의 YOUTUBE_API_KEY) — 5분마다
//  - dc       : 디시 몬갤 "공식" 말머리 글 중 와일즈 소식 — 5분마다 (제목으로 분류, 행사 글은 본문에서 와일즈 참여 확인)
//
// 호스팅(RAM 384MB / 1 vCPU)에 맞춘 설계:
//  - 추가 패키지 없음(Node 내장 fetch + 정규식/JSON).
//  - 출처를 동시에 읽지 않고 시작 시각을 엇갈리게 한 뒤 하나씩 차례로 읽는다. 응답은 읽고 바로 버린다(크기 제한 있음).
//  - 저장은 출처마다 '이미 본 글' 키 300개 + 최근 보낸 제목 30개뿐(수 KB).
//
// 도배·오작동 방지:
//  - 처음 보는 출처는 지금 올라와 있는 글을 전부 '이미 본 것'으로만 기억하고 올리지 않는다.
//  - 목록이 비어 읽히면 실패로 본다. 새 글이 한꺼번에 너무 많이 보이면 구조 변경으로 보고 기억만 한다.
//  - 전송에 성공한 글만 '알림 완료'로 기록한다. 읽기에 실패하면 간격을 점점 늘린다(최대 6배).
//  - 다른 출처가 같은 소식을 이미 올렸으면(제목이 많이 겹침, 24시간 안) 올리지 않는다.

const {
    ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const parse = require('./parse');

const NEWS_CHANNEL_ID = '1241760636573323295'; // 몬스터헌터 와일즈 서버 #와일즈_소식

const TICK_MS = 30_000;   // 어느 출처가 확인할 차례인지 보는 주기(비교만 해서 거의 공짜). 알림이 최대 이만큼만 늦도록 짧게 둔다
const STAGGER_MS = 20_000;
const MAX_BACKOFF = 6;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 3_000_000;
const MAX_SEEN = 300;
const RECENT_KEEP = 300;                         // 보낸 제목 기억(한 건에 수십 바이트라 부담 없음)
const RECENT_WINDOW_MS = 14 * 24 * 60 * 60_000;  // 출처가 달라도 2주 안에 같은 소식이 다시 올라오면 올리지 않는다(다음날·며칠 뒤 재탕 방지)
const ACCENT = 0xd9822b;   // 공식(스팀 공지)
// 출처별 띠 색: 디시(디시인사이드 파랑)·유튜브(빨강)·깃허브(짙은 회색)
const ACCENTS = { official: ACCENT, dc: 0x3b4890, youtube: 0xff0000, reframework: 0x24292f };

class EmptyListError extends Error {}

// ── 가져오기 ───────────────────────────────────────────────────
const USER_AGENT = process.env.NEWS_USER_AGENT || 'Mozilla/5.0 (compatible; GuildBot/1.0)';
async function fetchText(url, headers = {}) {
    const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ko-KR,ko;q=0.9', ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
        // 원인을 로그에서 볼 수 있게 JSON 오류 사유(예: 구글 API의 "API key not valid")를 짧게 덧붙인다. 키 값은 응답에 들어 있지 않다.
        let detail = '';
        try { detail = String(JSON.parse((await res.text()).slice(0, 4000))?.error?.message ?? '').replace(/\s+/g, ' ').slice(0, 120); } catch { /* JSON 이 아니면 사유 없음 */ }
        const err = new Error(detail ? `HTTP ${res.status} (${detail})` : `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    if (Number(res.headers.get('content-length')) > MAX_BODY_CHARS) throw new Error('응답이 너무 큼');
    const text = await res.text();
    if (text.length > MAX_BODY_CHARS) throw new Error('응답이 너무 큼');
    return text;
}

// ── 출처 정의 ──────────────────────────────────────────────────
// load(): 글 목록. decide(entry): { include, kind?, note? } 또는 Promise. maxFresh: 한 번에 이보다 많은 새 글이 보이면 구조 변경으로 본다.
const DC_LIST = 'https://gall.dcinside.com/mgallery/board/lists/?id=capcommh&sort_type=N&search_head=140&page=1';

function buildSources(env = process.env) {
    const sources = [
        {
            // 공식 업데이트 사이트(info.monsterhunter.com)는 서버 접속을 403으로 막아서, 같은 공지를 스팀 공개 공지 목록(한국어)으로 받는다.
            id: 'official', pollMs: 3 * 60_000, maxFresh: 3, noDedup: true, maxAgeMs: 7 * 24 * 60 * 60_000, label: 'Update Information',
            load: async () => parse.parseSteamEvents(await fetchText(parse.STEAM_EVENTS_API)),
            decide: e => {
                const c = parse.classifySteam(e.title);
                if (!c.include) return { include: false, defer: c.defer, reason: c.reason };
                // 영문뿐인 공지는 한글 제목으로 바꿔 올리고 본문 요약은 싣지 않는다. 그 외에는 공식 사이트 목록과 같은 종류 표시(주요 추가 요소·오류 수정·밸런스 조정)를 붙인다
                const note = [e.dateText && `배포일 ${e.dateText}`, ...(c.englishOnly ? ['한글 본문 미제공(영문 공지)'] : e.tags)].filter(Boolean).join(' · ');
                return {
                    include: true, kind: c.kind, title: c.titleKo, detail: c.englishOnly ? null : e.summary, note,
                    // 이미 디시 기반으로 알린 버전이면 새 메시지 대신 그 카드를 상세 내용으로 고친다
                    versions: parse.versionsOf(c.titleKo ?? e.title), versionTier: 'official', merge: true, englishOnly: !!c.englishOnly,
                };
            },
        },
        {
            id: 'dc', pollMs: 2 * 60_000, maxFresh: 10, maxAgeMs: 36 * 60 * 60_000, label: '몬스터헌터 시리즈 갤러리 ⓜ',
            load: async () => parse.parseDcList(await fetchText(DC_LIST)),
            decide: async (e, io = {}) => {
                const getHtml = io.fetchText ?? fetchText;   // 테스트 미리보기에서는 가짜 본문을 넣어 같은 코드를 통과시킨다
                const c = parse.classifyTitle(e.title);
                if (c.action === 'skip') return { include: false, reason: c.reason };
                const isPatch = c.action === 'include' && c.kind.id === 'patch';
                // 행사 글(와일즈 참여 확인)과 패치노트 글(공식 링크 확인)만 원글 본문을 읽는다
                const html = c.action === 'checkBody' || isPatch ? await getHtml(e.url) : null;
                if (c.action === 'checkBody') {
                    const r = parse.confirmBody(parse.parseDcBody(html));
                    if (!r.include) return { include: false, reason: r.reason };
                }
                if (isPatch) {
                    // 원글에 공식 업데이트 페이지 링크가 있으면 공식으로 표기하고 버튼을 공식 페이지로 건다.
                    // (공식 사이트는 서버 접속이 막혀 내용을 읽어 올 수는 없다. 자세한 내용은 스팀 한국어 공지가 올라오면 이어서 알린다)
                    const link = parse.findOfficialUpdateLink(html);
                    if (link) {
                        return {
                            include: true, kind: c.kind, title: `업데이트 개요 (Ver.${link.version})`, sourceLabel: 'Update Information', emojiSource: 'official',
                            url: link.url, note: '디시 제보로 먼저 확인 · 공식 페이지 링크 포함',
                            versions: [link.version], versionTier: 'official', merge: true, mergeFrom: 'fan',
                        };
                    }
                    // 링크 없이 사진뿐이면 버튼(내용 보기)이 디시 원글로 간다
                    return { include: true, kind: c.kind, versions: parse.versionsOf(e.title), versionTier: 'fan' };
                }
                return { include: true, kind: c.kind };
            },
        },
    ];
    // REFramework 새 릴리즈: 와일즈 모드 도구라 새 빌드가 나오면 바로 알린다. 다른 출처와 겹칠 일이 없어 중복 검사는 하지 않는다.
    // (GitHub 무인증 한도는 시간당 60회 — 5분마다 확인하면 12회)
    sources.push({
        id: 'reframework', pollMs: 3 * 60_000, maxFresh: 5, noDedup: true, maxAgeMs: 3 * 24 * 60 * 60_000, label: 'REFramework (GitHub)',
        load: async () => parse.parseGithubReleases(await fetchText(parse.REFRAMEWORK_API, { Accept: 'application/vnd.github+json' })),
        decide: e => ({
            include: true,
            kind: { id: 'release', label: '새 릴리즈' },
            note: [e.tag && e.tag !== e.title ? e.tag : null, e.prerelease ? '프리릴리즈' : null].filter(Boolean).join(' · '),
            detail: e.summary,
        }),
    });
    // 붙여 넣을 때 딸려 온 줄바꿈·공백·따옴표가 키에 섞여도 동작하도록 키에 쓸 수 없는 글자는 뺀다(유튜브 API 키는 영문·숫자·_·- 만 쓴다)
    const ytKey = String(env.YOUTUBE_API_KEY ?? '').replace(/[^A-Za-z0-9_-]/g, '');
    if (ytKey) {
        sources.push({
            id: 'youtube', pollMs: 3 * 60_000, maxFresh: 5, maxAgeMs: 3 * 24 * 60 * 60_000, label: '캡콤아시아 유튜브',
            load: async () => parse.parseYoutubePlaylist(await fetchText(
                `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=10&playlistId=${parse.YT_UPLOADS_PLAYLIST}`,
                { 'x-goog-api-key': ytKey }, // 키는 주소가 아니라 헤더로 보낸다(오류 로그에 안 남도록)
            )),
            decide: e => {
                const c = parse.classifyYoutube(e.title);
                return c.include
                    ? { include: true, kind: { id: 'video', label: '새 영상' }, videoCard: true }
                    : { include: false, reason: c.reason };
            },
        });
    }
    return sources;
}

// ── 카드(컴포넌트 v2) ───────────────────────────────────────────
const KST_MS = parse.KST_MS;
function dayText(at) {
    if (at == null) return null;
    const d = new Date(at + KST_MS);
    return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

// 출처별 봇 전용(애플리케이션) 이모지 — deploy/register-emojis.js 가 등록한 이름. 카드 썸네일에 쓴다(맨 위 소제목 앞에는 이모지를 붙이지 않는다).
const EMOJI_NAMES = { official: 'news_wilds', dc: 'news_dcinside', youtube: 'news_youtube', reframework: 'news_github' };
const BUTTON_LABEL = '🔗 내용 보기';
const emojiThumb = id => `https://cdn.discordapp.com/emojis/${id}.png?size=128`;

// emojiIds: { 출처id: 이모지ID } — 아직 등록 전이면 비어 있고, 그러면 예전 방식(기본 이모지·공식 이미지)으로 보낸다.
function buildPayload(source, entry, verdict, emojiIds = {}) {
    const kind = verdict.kind;
    const emojiId = emojiIds[verdict.emojiSource ?? source.id];
    const sourceLabel = verdict.sourceLabel ?? source.label;   // 디시 글이라도 공식 링크가 확인되면 공식으로 표기
    const url = verdict.url ?? entry.url;
    const rawTitle = verdict.title ?? entry.title;
    const title = rawTitle.length > 200 ? `${rawTitle.slice(0, 199)}…` : rawTitle;
    const texts = [`-# ${kind.label} · ${sourceLabel}`, `### ${title}`];
    const sub = [source.id === 'official' || verdict.sourceLabel ? null : dayText(entry.at), verdict.note].filter(Boolean).join(' · ');
    if (verdict.detail) texts.push(verdict.detail.slice(0, 300));
    if (sub) texts.push(`-# ${sub}`);

    const thumbUrl = emojiId ? emojiThumb(emojiId) : verdict.thumb;
    // 썸네일이 붙는 섹션은 텍스트를 3개까지만 넣을 수 있다(디스코드 규칙). 넘치면 제목 아래 줄들을 하나로 합친다.
    const parts = thumbUrl && texts.length > 3 ? [texts[0], texts[1], texts.slice(2).join('\n')] : texts;
    const lines = parts.map(t => new TextDisplayBuilder().setContent(t));

    const container = new ContainerBuilder().setAccentColor(ACCENTS[verdict.emojiSource ?? source.id] ?? ACCENT);
    if (thumbUrl) {
        const thumb = new ThumbnailBuilder().setURL(thumbUrl).setDescription(sourceLabel.slice(0, 100));
        container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(...lines).setThumbnailAccessory(thumb));
    } else {
        container.addTextDisplayComponents(...lines);
    }
    // 유튜브 영상: 영상 썸네일을 카드 안에 크게 보여 준다(디스코드 영상 임베드는 카드에서 쓸 수 없다)
    const videoId = verdict.videoCard ? /[?&]v=([\w-]{11})/.exec(entry.url)?.[1] : null;
    if (videoId) {
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`).setDescription(title.slice(0, 100)),
        ));
    }
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(BUTTON_LABEL).setURL(url),   // 모든 카드의 버튼 이름은 '🔗 내용 보기'로 통일
    ));
    return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

// ── 감시 ───────────────────────────────────────────────────────
// deps: sources, store({ data, save() }), send(source, entry, verdict), now(), logFail(source, err), logInfo(msg) — 테스트에서 바꿔 끼운다.
function createWatcher({ sources, store, send, update, now = Date.now, logFail = () => {}, logInfo = () => {} }) {
    const state = store.data;
    state.recent ??= [];
    state.cards ??= {};      // 버전별로 먼저 나간 카드(메시지 id) — 나중에 스팀 상세로 고치기 위해
    state.versions ??= [];   // 이미 알린 패치 버전(디시에서 같은 버전을 여러 사람이 올려도 한 번만 알리기 위해)
    const runtime = new Map(sources.map((s, i) => [s.id, { nextAt: now() + i * STAGGER_MS, fails: 0 }]));

    // 다른 출처가 최근 2주 안에 올린 카드와 제목이 많이 겹치면 같은 소식으로 본다.
    // 같은 출처끼리는 비교하지 않는다(연속된 무기 소개 영상·연속된 패치 버전을 같은 소식으로 오인하지 않도록).
    // sameSource: 같은 출처끼리도 비교한다. 버전 번호가 없는 디시 글(같은 점검 예고를 여러 사람이 올리는 경우)에만 쓴다.
    // 제목에 버전 번호가 있으면 숫자만 다른 제목(Ver.1.042.00.01 / .02)을 같은 소식으로 오인하므로 버전 규칙으로만 판별한다.
    function isDuplicate(source, entry, sameSource = false) {
        const tokens = parse.tokenize(entry.title);
        const hasVer = parse.versionsOf(entry.title).length > 0;
        const t = now();
        return state.recent.some(r => (r.src !== source.id || (sameSource && !hasVer && !r.hasVer)) && t - r.at < RECENT_WINDOW_MS && parse.similarTitles(tokens, r.tokens));
    }
    function rememberSent(source, entry) {
        state.recent.push({ at: now(), src: source.id, hasVer: parse.versionsOf(entry.title).length > 0, tokens: parse.tokenize(entry.title) });
        state.recent = state.recent.slice(-RECENT_KEEP);
    }
    // 같은 업데이트인지: 버전이 정확히 같거나, 한쪽이 다른 쪽의 앞부분(1.042 와 1.042.00.05)이고 36시간 안이면 같은 업데이트로 본다.
    const FAMILY_WINDOW_MS = 36 * 60 * 60_000;
    function findCard(versions) {
        for (const v of versions) if (state.cards[v]) return state.cards[v];
        const t = now();
        for (const v of versions) {
            for (const [k, rec] of Object.entries(state.cards)) {
                if (t - (rec.at ?? 0) <= FAMILY_WINDOW_MS && (k.startsWith(`${v}.`) || v.startsWith(`${k}.`))) return rec;
            }
        }
        return null;
    }
    // 이미 알린 버전인가(공식 등급은 공식으로 알린 것만, 제보 등급은 제보든 공식이든 알렸으면)
    function knownVersion(v, official) {
        if (state.versions.includes(`o:${v}`) || (!official && state.versions.includes(`f:${v}`))) return true;
        const rec = findCard([v]);
        return !!rec && (rec.tier === 'official' || !official);
    }
    // 글 하나의 분류(decide)가 계속 실패하면(예: 지워진 글의 본문 요청이 404) 뒤의 새 글까지 막히므로 3번 실패하면 포기하고 넘어간다.
    const decideFails = new Map();
    const deferLogged = new Set();
    const MAX_DECIDE_FAILS = 3;

    // 출처 하나를 한 번 확인한다. 올린 개수를 돌려준다(처음 기억만 한 경우 0).
    async function checkSource(source) {
        const entries = await source.load();
        if (!entries.length) throw new EmptyListError('목록이 비어 있음(사이트 구조가 바뀌었을 수 있음)');
        const st = state[source.id] ??= { seeded: false, seen: [] };
        const seen = new Set(st.seen);
        if (!st.seeded) {
            st.seen = entries.map(e => e.key).slice(-MAX_SEEN);
            st.seeded = true;
            store.save();
            return 0;
        }
        const fresh = entries.filter(e => !seen.has(e.key)).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
        if (!fresh.length) return 0;
        const mark = e => { seen.add(e.key); st.seen = [...seen].slice(-MAX_SEEN); store.save(); };
        if (fresh.length > source.maxFresh) {
            fresh.forEach(mark);
            logInfo(`${source.label}: 새 글이 한꺼번에 ${fresh.length}개 보여 구조 변경으로 판단, 올리지 않고 기억만 함`);
            return 0;
        }
        let sent = 0;
        for (const e of fresh) {
            // 올라온 지 너무 오래된 글이 뒤늦게 목록에 나타난 경우(다른 말머리에서 옮겨 온 글 등)는 올리지 않는다
            if (source.maxAgeMs && e.at != null && now() - e.at > source.maxAgeMs) {
                logInfo(`${source.label}: 오래된 글이라 건너뜀 — ${e.title}`);
                mark(e);
                continue;
            }
            let verdict;
            try {
                verdict = await source.decide(e);
            } catch (err) {
                const n = (decideFails.get(e.key) ?? 0) + 1;
                decideFails.set(e.key, n);
                if (n < MAX_DECIDE_FAILS) throw err; // 다음 확인 때 다시 시도
                logInfo(`${source.label}: 분류가 ${n}번 실패해 건너뜀 — ${e.title} (${err.message})`);
                mark(e);
                continue;
            }
            if (verdict.defer) {
                // 한글 번역이 아직 없는 공지: '본 것'으로 기록하지 않고 다음 확인 때 다시 본다(오래되면 위의 나이 검사에서 포기)
                if (!deferLogged.has(e.key)) { deferLogged.add(e.key); logInfo(`${source.label}: 한글판을 기다리는 중 — ${e.title}`); }
                continue;
            }
            // 스팀 한국어 공지가 이미 디시 기반으로 알린 버전이면, 새 메시지를 보내지 않고 먼저 나간 카드를 상세 내용으로 고친다(같은 정보가 두 번 나가지 않게)
            let forceSend = false;
            let holdForKo = false;   // 영문뿐이라 나간 공지는 한글판이 올라올 때까지 '본 것'으로 닫지 않는다
            if (verdict.include && verdict.englishOnly && verdict.versions?.length) {
                // 같은 업데이트의 카드가 이미 있으면(디시 기반이든 영문 카드든) 영문 내용으로 덮지 않고 한글판을 기다린다
                const waiting = findCard(verdict.versions);
                if (waiting) {
                    if (waiting.merged) mark(e);   // 이미 한글 상세로 갱신됐으면 이 공지는 끝
                    continue;
                }
            }
            if (verdict.include && verdict.merge && verdict.versions?.length) {
                const rec = findCard(verdict.versions);
                if (rec?.merged) {
                    logInfo(`${source.label}: 이미 상세로 갱신한 버전이라 건너뜀 — ${e.title}`);
                    mark(e);
                    continue;
                }
                if (rec?.id && update && (verdict.mergeFrom !== 'fan' || rec.tier === 'fan')) {
                    try {
                        await update(source, e, verdict, rec);
                        if (verdict.mergeFrom === 'fan') { rec.tier = 'official'; rec.url = verdict.url ?? rec.url; }   // 제보 카드가 공식 카드로 바뀜(스팀 상세는 이후에 한 번 더 반영 가능)
                        else rec.merged = true;                                                                        // 스팀 상세 반영 완료
                        // 카드를 고친 경우에도 '공식으로 알린 버전'으로 기록한다(이후 같은 버전의 디시 글이 새 메시지로 나가지 않게)
                        state.versions = [...new Set([...state.versions, ...verdict.versions.map(v => `o:${v}`)])].slice(-60);
                        store.save();
                        logInfo(`${source.label}: 먼저 나간 카드를 ${verdict.mergeFrom === 'fan' ? '공식 카드로' : '상세 내용으로'} 갱신 — ${e.title}`);
                        mark(e);
                        sent++;
                        continue;
                    } catch (err) {
                        forceSend = true; // 먼저 나간 메시지가 지워졌거나 고칠 수 없으면 새 카드로 알린다
                        logInfo(`${source.label}: 카드 갱신 실패, 새 카드로 알림 — ${e.title} (${err.message})`);
                    }
                }
            }
            // 같은 버전은 한 번만 알린다. 단, 사진뿐인 제보(fan)가 먼저 나갔어도 뒤에 공식 링크(official)가 확인되면 그건 다시 알린다.
            const official = verdict.versionTier === 'official';
            if (!forceSend && verdict.include && verdict.versions?.length && verdict.versions.every(v => knownVersion(v, official))) {
                logInfo(`${source.label}: 이미 알린 버전이라 건너뜀 — ${e.title}`);
            } else if (verdict.include && !source.noDedup && isDuplicate(source, e, source.id === 'dc' && !verdict.versions?.length)) {
                logInfo(`${source.label}: 다른 출처가 이미 올린 소식과 겹쳐 건너뜀 — ${e.title}`);
            } else if (verdict.include) {
                const messageId = await send(source, e, verdict); // 실패하면 던져서 이 글은 '알림 완료'로 기록되지 않는다
                if (!source.noDedup) rememberSent(source, e);
                if (verdict.versions?.length) { state.versions = [...new Set([...state.versions, ...verdict.versions.map(v => `${official ? 'o' : 'f'}:${v}`)])].slice(-60); }
                for (const v of verdict.versions ?? []) state.cards[v] = { at: now(), id: messageId ?? null, url: verdict.url ?? null, tier: official ? 'official' : 'fan', merged: verdict.mergeFrom !== 'fan' && !!verdict.merge && !verdict.englishOnly };   // 영문뿐이라 나간 카드는 한글판이 올라오면 한 번 갱신한다
                const cardKeys = Object.keys(state.cards);
                for (const k of cardKeys.slice(0, Math.max(0, cardKeys.length - 30))) delete state.cards[k];
                if (verdict.englishOnly) holdForKo = true;
                sent++;
            }
            if (!holdForKo) mark(e);
        }
        return sent;
    }

    let running = false;
    async function tick() {
        if (running) return;
        running = true;
        try {
            for (const source of sources) {
                const rt = runtime.get(source.id);
                if (now() < rt.nextAt) continue;
                try { await checkSource(source); rt.fails = 0; } catch (err) { rt.fails++; logFail(source, err); }
                rt.nextAt = now() + (rt.fails ? source.pollMs * Math.min(MAX_BACKOFF, 2 ** (rt.fails - 1)) : source.pollMs);
            }
        } finally {
            running = false;
        }
    }
    return { checkSource, tick };
}

// 같은 오류가 계속 나도 로그를 도배하지 않게 출처별로 1시간에 한 번만 남긴다.
let timer = null;
function startNewsWatcher(client, store, isPaused = () => false) {
    if (timer) return;
    const sources = buildSources();
    if (!process.env.YOUTUBE_API_KEY) console.log('[소식] YOUTUBE_API_KEY 가 없어 유튜브 감지는 꺼져 있습니다.');
    const lastLog = new Map();
    // 봇의 애플리케이션 이모지를 이름으로 찾아 출처별 ID 표를 만든다. 아직 없으면 10분 뒤 보낼 때 다시 찾아본다(실패해도 알림은 나간다).
    let emojiIds = {};
    let emojiTriedAt = 0;
    const refreshEmojis = async () => {
        emojiTriedAt = Date.now();
        try {
            const list = await client.application.emojis.fetch();
            const byName = new Map([...list.values()].map(e => [e.name, e.id]));
            emojiIds = Object.fromEntries(Object.entries(EMOJI_NAMES).filter(([, name]) => byName.has(name)).map(([src, name]) => [src, byName.get(name)]));
        } catch (err) {
            console.error('[소식] 봇 이모지 조회 실패(기본 모양으로 올림):', err.message);
        }
    };
    refreshEmojis();
    const send = async (source, entry, verdict) => {
        if (Object.keys(emojiIds).length < Object.keys(EMOJI_NAMES).length && Date.now() - emojiTriedAt > 10 * 60_000) await refreshEmojis();
        const channel = await client.channels.fetch(NEWS_CHANNEL_ID);
        if (!channel?.isTextBased()) throw new Error(`소식 채널을 찾을 수 없음(${NEWS_CHANNEL_ID})`);
        const message = await channel.send(buildPayload(source, entry, verdict, emojiIds));
        console.log(`[소식] ${source.label} — ${entry.title}`);
        return message.id;
    };
    // 먼저 나간 카드를 스팀 상세 내용으로 고친다(버튼 주소는 먼저 나간 카드의 공식 링크가 있으면 그대로 유지)
    const update = async (source, entry, verdict, rec) => {
        const channel = await client.channels.fetch(NEWS_CHANNEL_ID);
        if (!channel?.isTextBased()) throw new Error(`소식 채널을 찾을 수 없음(${NEWS_CHANNEL_ID})`);
        const message = await channel.messages.fetch(rec.id);
        await message.edit(buildPayload(source, entry, { ...verdict, url: rec.url ?? verdict.url }, emojiIds));
        console.log(`[소식] ${source.label} — 카드 갱신: ${entry.title}`);
    };
    const watcher = createWatcher({
        sources, store, send, update,
        logFail: (source, err) => {
            const t = Date.now();
            if (t - (lastLog.get(source.id) ?? 0) < 60 * 60_000) return;
            lastLog.set(source.id, t);
            console.error(`[소식] ${source.label} 확인 실패:`, err.message);
        },
        logInfo: msg => console.log(`[소식] ${msg}`),
    });
    // 일시정지 중에는 확인도 알림도 하지 않는다(재개하면 그때부터 다시 확인)
    const run = () => { if (!isPaused()) watcher.tick().catch(e => console.error('[소식] 확인 오류:', e)); };
    timer = setInterval(run, TICK_MS);
    timer.unref?.();
    run();
}

// ── 테스트용 미리보기(임시) ─────────────────────────────────────────────────────
// 테스트 서버에서만 쓴다. 각 출처의 최근 소식 중 알림 대상인 것을 골라 실제와 같은 카드로 테스트 채널에 올린다.
// 운영 기록(알린 글·버전·카드)은 읽지도 쓰지도 않으므로 몇 번을 돌려도 실제 알림에 영향이 없다.
const NEWS_TEST_GUILD_ID = '1282694117255548960';
const NEWS_TEST_CHANNEL_ID = '1282694117255548963';

// 출처별로 가장 최근 소식 중 알림 대상(include)인 것을 최대 perSource개씩 모은다. 읽기에 실패한 출처는 error 로 남긴다.
async function collectRecent(sources, perSource = 3) {
    const items = [];
    for (const source of sources) {
        let entries;
        try { entries = await source.load(); } catch (err) { items.push({ source, error: err.message }); continue; }
        let n = 0;
        for (const entry of [...entries].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))) {
            if (n >= perSource) break;
            let verdict;
            try { verdict = await source.decide(entry); } catch { continue; }
            if (verdict?.include) { items.push({ source, entry, verdict }); n++; }
        }
    }
    return items;
}

// post(payload): 메시지 하나를 올리는 함수. 시간순(오래된 것 먼저)으로 올려 가장 최근 소식이 맨 아래에 오게 한다.
async function previewRecent({ sources, post, emojiIds = {}, perSource = 3 }) {
    const items = await collectRecent(sources, perSource);
    const cards = items.filter(i => i.entry).sort((a, b) => (a.entry.at ?? 0) - (b.entry.at ?? 0));
    const errors = items.filter(i => i.error);
    await post({ content: `-# 테스트 미리보기 · 출처별 최근 소식 ${cards.length}개 (실제 알림과 같은 모양, 운영 기록과 무관)`, allowedMentions: { parse: [] } });
    for (const { source, entry, verdict } of cards) await post(buildPayload(source, entry, verdict, emojiIds));
    return { posted: cards.length, errors: errors.map(e => `${e.source.label}: ${e.error}`), perSource: Object.fromEntries(sources.map(s => [s.id, cards.filter(c => c.source.id === s.id).length])) };
}

// 봇의 애플리케이션 이모지를 이름으로 찾아 { 출처id: 이모지ID } 표를 만든다(없으면 빈 표 → 기본 모양)
async function fetchEmojiIds(client) {
    try {
        const list = await client.application.emojis.fetch();
        const byName = new Map([...list.values()].map(e => [e.name, e.id]));
        return Object.fromEntries(Object.entries(EMOJI_NAMES).filter(([, name]) => byName.has(name)).map(([src, name]) => [src, byName.get(name)]));
    } catch { return {}; }
}

// 모든 카드 종류의 샘플. 실제 판정(decide)을 그대로 통과시켜 만들므로 실제 알림과 같은 모양이 나온다.
// sources 에는 유튜브를 포함한 buildSources({ YOUTUBE_API_KEY: 'sample' }) 결과를 넘긴다(샘플은 네트워크를 쓰지 않음).
async function buildSamples(sources, now = Date.now()) {
    const by = Object.fromEntries(sources.map(s => [s.id, s]));
    const samples = [];
    const add = async (label, id, entry, io) => {
        const source = by[id];
        if (!source) return null;
        const verdict = await source.decide(entry, io);
        if (!verdict?.include) return null;
        const sample = { label, source, entry, verdict };
        samples.push(sample);
        return sample;
    };
    const ago = m => now - m * 60_000;
    const DC_URL = 'https://gall.dcinside.com/mgallery/board/view/?id=capcommh&no=1522725'; // 실제 글(버튼을 눌러도 열리도록)
    const dcEntry = (title, mins) => ({ key: 'dc-sample', title: parse.cleanDcTitle(title), url: DC_URL, at: ago(mins), num: 1 });
    const dcHtml = inner => `<div class="write_div"><div>${inner}</div></div><div class="btn_recommend_box"></div>`;
    const io = html => ({ fetchText: async () => html });

    // 공식(스팀 한국어 공지)
    const ev = (gid, name, body, mins) => ({ gid, event_name: name, rtime32_start_time: Math.floor(ago(mins) / 1000), announcement_body: { body } });
    const steam = parse.parseSteamEvents(JSON.stringify({ events: [
        ev('s1', '업데이트 개요 (Ver.1.043.00.00)', ['[h2][b]배포일[/b][/h2]', '[b]2026년 11월 12일(목)[/b]', '[h2][b]주요 추가 요소 / 사양 변경[/b][/h2]', '[h2][b]오류 수정 / 게임 밸런스 조정 외[/b][/h2]', '[list]', '[*] 일부 AMD 그래픽 카드에서 강제 종료 현상을 개선했습니다', '[*] 일부 통신 환경에서 통신 오류를 개선했습니다', '[*] 일부 무기의 모션 값을 조정했습니다', '[/list]'].join('\n'), 30),
        ev('s2', '업데이트 개요 (Ver.1.044)', ['[h2][b]배포일[/b][/h2]', '[b]2026년 12월 3일(목)[/b]', '[h2][b]주요 추가 요소 / 사양 변경[/b][/h2]', '[h2][b]오류 수정 / 게임 밸런스 조정 외[/b][/h2]', '[h3][b]【거점 / 시설 관련】[/b][/h3]', '[h3][b]【몬스터 관련】[/b][/h3]', '[h3][b]【플레이어 관련】[/b][/h3]'].join('\n'), 60),
        ev('s3', '업데이트 Ver1.044 점검 안내', '점검 기간 2026년 12월 3일(목) 10:00 ~ 12:30', 90),
        ev('s4', 'Update Summary (Ver.1.043.00.01)', 'English only body', 120),
    ] }));
    await add('공식 · 패치노트 (수정 내용 목록)', 'official', steam[0]);
    await add('공식 · 큰 업데이트 (변경 분야 표시)', 'official', steam[1]);
    await add('공식 · 점검 안내', 'official', steam[2]);
    await add('공식 · 영문 공지를 한글 제목으로 (본문 없음)', 'official', steam[3]);

    // 디시(제목으로 분류하고, 패치노트·행사 글은 본문을 열어 확인)
    const OFF_LINK = 'https://info.monsterhunter.com/wilds/update/ko-kr/Ver.1.042.00.03.html';
    await add('디시 · 점검 예고', 'dc', dcEntry('내일 오전 10시 와일즈 점검 및 패치 예정.jpg', 45));
    await add('디시 · 패치노트 (사진뿐 → 디시 제보로 표기)', 'dc', dcEntry('Ver.1.043 패치노트.jpg', 40), io(dcHtml('<img src="a.jpg">')));
    const official = await add('디시 · 패치노트 (공식 링크 확인 → 공식으로 표기)', 'dc', dcEntry('Ver.1.042.00.03 패치노트 공개', 35), io(dcHtml(`공식 페이지 ${OFF_LINK} 입니다 확인해 보세요 감사합니다`)));
    await add('디시 · 행사 참여 (본문에서 와일즈·어센던스 참여 확인)', 'dc', dcEntry('파리 게임 위크 공식 일정 안내.jpg', 50), io(dcHtml('몬스터헌터 어센던스 보스 챌린지 진행자 안내 개발자 프레젠테이션 일정 정리입니다')));
    await add('디시 · 신규 콘텐츠', 'dc', dcEntry('어센던스 신규 소형몹 "간드론"', 55));
    await add('디시 · 일반 소식', 'dc', dcEntry('몬헌 와일즈 사냥왕 결정전 챔피언십 우승자.jpg', 65));

    // 유튜브(일반 메시지 + 영상 임베드)
    const yt = parse.parseYoutubePlaylist(JSON.stringify({ items: [{ snippet: { title: '몬스터헌터 와일즈 어센던스 - 무기 소개 영상: 건랜스', publishedAt: new Date(ago(20)).toISOString(), resourceId: { videoId: 'rVIKWBd_280' } } }] }));
    await add('유튜브 · 새 영상 (영상 임베드)', 'youtube', yt[0]);

    // REFramework
    const gh = parse.parseGithubReleases(JSON.stringify([
        { id: 11, name: 'REF Nightly 01438', tag_name: 'nightly-01438', html_url: 'https://github.com/praydog/REFramework-nightly/releases', published_at: new Date(ago(10)).toISOString(), prerelease: true, draft: false, body: '## Changes\n- Fix crash on RE Engine games\n- Update offsets' },
        { id: 12, name: 'REF Release 1.5.8', tag_name: 'v1.5.8', html_url: 'https://github.com/praydog/REFramework-nightly/releases', published_at: new Date(ago(15)).toISOString(), prerelease: false, draft: false, body: '' },
    ]));
    await add('REFramework · 새 릴리즈 (프리릴리즈, 변경 내용 있음)', 'reframework', gh[0]);
    await add('REFramework · 새 릴리즈 (정식, 설명 없음)', 'reframework', gh[1]);

    return { samples, officialSample: official, steamDetail: steam[0] ? { entry: steam[0], verdict: await by.official.decide(steam[0]) } : null };
}

// 모든 임베드 종류를 테스트 채널에 올린다. edit 가 있으면 "한 카드가 제보 → 공식 링크 → 스팀 상세로 바뀌는 흐름"도 보여 준다.
async function previewSamples({ sources, post, edit, emojiIds = {}, wait = ms => new Promise(r => setTimeout(r, ms)), now = Date.now() }) {
    const { samples, officialSample, steamDetail } = await buildSamples(sources, now);
    const fallback = samples.find(s => s.source.id === 'official');
    const canFlow = !!(edit && officialSample && steamDetail);
    const total = samples.length + (fallback ? 1 : 0) + (canFlow ? 1 : 0);
    await post({ content: `-# 테스트 미리보기 · 모든 알림 모양 샘플 (실제 판정 코드를 통과시켜 만든 가짜 소식, 운영 기록과 무관)`, allowedMentions: { parse: [] } });
    let n = 0;
    for (const s of samples) {
        n++;
        await post({ content: `-# 샘플 ${n}/${total} · ${s.label}`, allowedMentions: { parse: [] } });
        await post(buildPayload(s.source, s.entry, s.verdict, emojiIds));
    }
    // 봇 이모지가 없을 때(등록 전) 보이는 기본 모양
    if (fallback) {
        n++;
        await post({ content: `-# 샘플 ${n}/${total} · 봇 이모지가 없을 때의 기본 모양 (공식 카드)`, allowedMentions: { parse: [] } });
        await post(buildPayload(fallback.source, fallback.entry, fallback.verdict, {}));
    }
    // 한 카드가 단계적으로 바뀌는 흐름(같은 메시지를 수정)
    let lifecycle = false;
    if (canFlow) {
        n++;
        await post({ content: `-# 샘플 ${n}/${total} · 한 카드가 바뀌는 흐름: 제보 → 공식 링크 확인 → 스팀 상세 (같은 메시지를 4초 간격으로 수정)`, allowedMentions: { parse: [] } });
        const fan = { ...officialSample.verdict, title: undefined, sourceLabel: undefined, emojiSource: undefined, url: undefined, note: undefined };
        const id = await post(buildPayload(officialSample.source, { ...officialSample.entry, title: 'Ver.1.042.00.03 패치 예정.jpg' }, fan, emojiIds));
        await wait(4000);
        await edit(id, buildPayload(officialSample.source, officialSample.entry, officialSample.verdict, emojiIds));
        await wait(4000);
        const official = sources.find(s => s.id === 'official');
        await edit(id, buildPayload(official, steamDetail.entry, { ...steamDetail.verdict, url: officialSample.verdict.url }, emojiIds));
        lifecycle = true;
    }
    return { samples: samples.length + (fallback ? 1 : 0) + (lifecycle ? 1 : 0), labels: samples.map(s => s.label) };
}

module.exports = {
    startNewsWatcher, createWatcher, buildSources, buildPayload, NEWS_CHANNEL_ID, EMOJI_NAMES, EmptyListError,
    collectRecent, previewRecent, previewSamples, buildSamples, fetchEmojiIds, NEWS_TEST_GUILD_ID, NEWS_TEST_CHANNEL_ID,
};
