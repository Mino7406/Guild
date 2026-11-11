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
    ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder,
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
const RECENT_KEEP = 30;
const RECENT_WINDOW_MS = 24 * 60 * 60_000;
const ACCENT = 0xd9822b;
const OFFICIAL_THUMB = 'https://info.monsterhunter.com/wilds/update/assets/images/share.png';

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
                return { include: true, kind: c.kind, title: c.titleKo, detail: c.englishOnly ? null : e.summary, note, thumb: OFFICIAL_THUMB };
            },
        },
        {
            id: 'dc', pollMs: 2 * 60_000, maxFresh: 10, maxAgeMs: 36 * 60 * 60_000, label: '몬스터헌터 시리즈 갤러리 ⓜ',
            load: async () => parse.parseDcList(await fetchText(DC_LIST)),
            decide: async e => {
                const c = parse.classifyTitle(e.title);
                if (c.action === 'skip') return { include: false, reason: c.reason };
                const isPatch = c.action === 'include' && c.kind.id === 'patch';
                // 행사 글(와일즈 참여 확인)과 패치노트 글(공식 링크 확인)만 원글 본문을 읽는다
                const html = c.action === 'checkBody' || isPatch ? await fetchText(e.url) : null;
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
                            versions: [link.version], versionTier: 'official',
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
            kind: { id: 'release', label: '새 릴리즈', emoji: '🧩' },
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
                    ? { include: true, kind: { id: 'video', label: '새 영상', emoji: '▶️' }, plainLink: true }
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

// 출처별 봇 전용(애플리케이션) 이모지 — deploy/register-emojis.js 가 등록한 이름. 썸네일과 유튜브 머리말에 쓴다.
const EMOJI_NAMES = { official: 'news_wilds', dc: 'news_dcinside', youtube: 'news_youtube', reframework: 'news_github' };
const BUTTON_LABEL = '내용 보기';
const emojiThumb = id => `https://cdn.discordapp.com/emojis/${id}.png?size=128`;

// emojiIds: { 출처id: 이모지ID } — 아직 등록 전이면 비어 있고, 그러면 예전 방식(기본 이모지·공식 이미지)으로 보낸다.
function buildPayload(source, entry, verdict, emojiIds = {}) {
    const kind = verdict.kind;
    const emojiId = emojiIds[verdict.emojiSource ?? source.id];
    const sourceLabel = verdict.sourceLabel ?? source.label;   // 디시 글이라도 공식 링크가 확인되면 공식으로 표기
    const url = verdict.url ?? entry.url;
    // 유튜브는 카드(컴포넌트 v2) 대신 일반 메시지로 보낸다 — 링크가 디스코드 영상 임베드(재생 가능한 미리보기)로 펼쳐지도록.
    // (컴포넌트 v2 메시지에서는 임베드와 일반 본문을 쓸 수 없다)
    if (verdict.plainLink) {
        const icon = emojiId ? `<:${EMOJI_NAMES[source.id]}:${emojiId}>` : kind.emoji;
        return { content: `-# ${icon} ${kind.label} · ${source.label}\n${entry.url}`, allowedMentions: { parse: [] } };
    }
    const rawTitle = verdict.title ?? entry.title;
    const title = rawTitle.length > 200 ? `${rawTitle.slice(0, 199)}…` : rawTitle;
    const texts = [`-# ${kind.emoji} ${kind.label} · ${sourceLabel}`, `### ${title}`];
    const sub = [source.id === 'official' || verdict.sourceLabel ? null : dayText(entry.at), verdict.note].filter(Boolean).join(' · ');
    if (verdict.detail) texts.push(verdict.detail.slice(0, 300));
    if (sub) texts.push(`-# ${sub}`);

    const thumbUrl = emojiId ? emojiThumb(emojiId) : verdict.thumb;
    // 썸네일이 붙는 섹션은 텍스트를 3개까지만 넣을 수 있다(디스코드 규칙). 넘치면 제목 아래 줄들을 하나로 합친다.
    const parts = thumbUrl && texts.length > 3 ? [texts[0], texts[1], texts.slice(2).join('\n')] : texts;
    const lines = parts.map(t => new TextDisplayBuilder().setContent(t));

    const container = new ContainerBuilder().setAccentColor(ACCENT);
    if (thumbUrl) {
        const thumb = new ThumbnailBuilder().setURL(thumbUrl).setDescription(sourceLabel.slice(0, 100));
        container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(...lines).setThumbnailAccessory(thumb));
    } else {
        container.addTextDisplayComponents(...lines);
    }
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(BUTTON_LABEL).setURL(url),   // 모든 카드의 버튼 이름은 '내용 보기'로 통일
    ));
    return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

// ── 감시 ───────────────────────────────────────────────────────
// deps: sources, store({ data, save() }), send(source, entry, verdict), now(), logFail(source, err), logInfo(msg) — 테스트에서 바꿔 끼운다.
function createWatcher({ sources, store, send, now = Date.now, logFail = () => {}, logInfo = () => {} }) {
    const state = store.data;
    state.recent ??= [];
    state.versions ??= [];   // 이미 알린 패치 버전(디시에서 같은 버전을 여러 사람이 올려도 한 번만 알리기 위해)
    const runtime = new Map(sources.map((s, i) => [s.id, { nextAt: now() + i * STAGGER_MS, fails: 0 }]));

    // 다른 출처가 최근 24시간 안에 올린 카드와 제목이 많이 겹치면 같은 소식으로 본다.
    // 같은 출처끼리는 비교하지 않는다(연속된 무기 소개 영상·연속된 패치 버전을 같은 소식으로 오인하지 않도록).
    function isDuplicate(source, entry) {
        const tokens = parse.tokenize(entry.title);
        const t = now();
        return state.recent.some(r => r.src !== source.id && t - r.at < RECENT_WINDOW_MS && parse.similarTitles(tokens, r.tokens));
    }
    function rememberSent(source, entry) {
        state.recent.push({ at: now(), src: source.id, tokens: parse.tokenize(entry.title) });
        state.recent = state.recent.slice(-RECENT_KEEP);
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
            // 같은 버전은 한 번만 알린다. 단, 사진뿐인 제보(fan)가 먼저 나갔어도 뒤에 공식 링크(official)가 확인되면 그건 다시 알린다.
            const official = verdict.versionTier === 'official';
            if (verdict.include && verdict.versions?.length && verdict.versions.every(v => state.versions.includes(`o:${v}`) || (!official && state.versions.includes(`f:${v}`)))) {
                logInfo(`${source.label}: 이미 알린 버전이라 건너뜀 — ${e.title}`);
            } else if (verdict.include && !source.noDedup && isDuplicate(source, e)) {
                logInfo(`${source.label}: 다른 출처가 이미 올린 소식과 겹쳐 건너뜀 — ${e.title}`);
            } else if (verdict.include) {
                await send(source, e, verdict); // 실패하면 던져서 이 글은 '알림 완료'로 기록되지 않는다
                if (!source.noDedup) rememberSent(source, e);
                if (verdict.versions?.length) { state.versions = [...new Set([...state.versions, ...verdict.versions.map(v => `${official ? 'o' : 'f'}:${v}`)])].slice(-60); }
                sent++;
            }
            mark(e);
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
function startNewsWatcher(client, store) {
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
        await channel.send(buildPayload(source, entry, verdict, emojiIds));
        console.log(`[소식] ${source.label} — ${entry.title}`);
    };
    const watcher = createWatcher({
        sources, store, send,
        logFail: (source, err) => {
            const t = Date.now();
            if (t - (lastLog.get(source.id) ?? 0) < 60 * 60_000) return;
            lastLog.set(source.id, t);
            console.error(`[소식] ${source.label} 확인 실패:`, err.message);
        },
        logInfo: msg => console.log(`[소식] ${msg}`),
    });
    timer = setInterval(() => { watcher.tick().catch(e => console.error('[소식] 확인 오류:', e)); }, TICK_MS);
    timer.unref?.();
    watcher.tick().catch(e => console.error('[소식] 확인 오류:', e));
}

module.exports = { startNewsWatcher, createWatcher, buildSources, buildPayload, NEWS_CHANNEL_ID, EMOJI_NAMES, EmptyListError };
