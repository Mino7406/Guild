// 몬스터 헌터 와일즈 소식 파서 (순수 함수 — 네트워크 없음, 테스트 대상)
// 글 하나: { key, title, url, at(ms 또는 null), ... }

const KST_MS = 9 * 60 * 60_000;

const OFFICIAL_BASE = 'https://info.monsterhunter.com/wilds/update/ko-kr/';
const DC_VIEW = 'https://gall.dcinside.com/mgallery/board/view/?id=capcommh&no=';

const decodeEntities = s => s
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))) // &#x1f517; 같은 16진수 기호(디시 제목의 🔗 등)
    .replace(/&amp;/g, '&');
const stripTags = s => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// ── 공식 패치노트 목록 (info.monsterhunter.com/wilds/update/ko-kr/) ──────────────────
// <li class="latest_update_list Ver-..."><a href="./Ver.1.042.00.03.html">…배포일…업데이트 종류…플랫폼…</a></li>
function parseOfficialList(html) {
    const out = [];
    // 항목 안에도 <li>가 있어서(종류·플랫폼) 항목 시작 표식으로 나눈다
    for (const block of html.split('<li class="latest_update_list ').slice(1)) {
        const ver = block.match(/<p class="latest_update_list_ver">\s*([^<]+?)\s*<\/p>/)?.[1];
        const href = block.match(/<a href="([^"]+)"/)?.[1];
        if (!ver || !href) continue;
        const dateText = block.match(/latest_update_list_date">[\s\S]*?<dd>([^<]+)<\/dd>/)?.[1] ?? '';
        const dm = dateText.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
        const at = dm ? Date.UTC(+dm[1], +dm[2] - 1, +dm[3]) - KST_MS : null;
        const detail = block.match(/latest_update_list_detail">([\s\S]*?)<\/dl>/)?.[1] ?? '';
        const kinds = [...detail.matchAll(/<li>([^<]+)<\/li>/g)].map(x => decodeEntities(x[1]).trim()).filter(Boolean);
        const platforms = [...block.matchAll(/<li class="[^"]*">([^<]+)<\/li>/g)]
            .map(x => x[1].trim()).filter(p => /^(PS5|XSX\|S|XBOX|Steam)$/i.test(p));
        out.push({
            key: `wilds-${ver}`, title: ver, url: new URL(href, OFFICIAL_BASE).href, at,
            dateText: stripTags(dateText), kinds, platforms: [...new Set(platforms)],
        });
    }
    return out;
}

// ── 디시 몬갤 "공식" 말머리 목록 ────────────────────────────────────────────────
// 글 번호가 숫자가 아닌 줄(광고·설문·공지)은 뺀다.
// 디시 제목은 사진 파일 이름이 그대로 붙는 경우가 많다(예: "...예정.jpg"). 알림에는 확장자를 빼고 보여 준다.
const cleanDcTitle = t => String(t).replace(/\s*\.(?:jpe?g|png|gif|webp|bmp)\s*$/i, '').trim();
function parseDcList(html) {
    const out = [];
    // 행 시작 표식으로 나눈다(닫히지 않는 이상한 응답에서도 한 번만 훑도록 — 정규식으로 </tr>까지 찾으면 느려질 수 있음)
    for (const part of html.split('<tr class="ub-content').slice(1)) {
        const end = part.indexOf('</tr>');
        const row = end >= 0 ? part.slice(0, end) : part.slice(0, 20_000);
        const num = stripTags(row.match(/class="gall_num"[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '');
        if (!/^\d+$/.test(num)) continue;
        const a = row.match(/class="gall_tit[^"]*"[^>]*>[\s\S]*?<a [^>]*>([\s\S]*?)<\/a>/);
        const title = a ? cleanDcTitle(stripTags(a[1])) : '';
        if (!title) continue;
        const date = row.match(/class="gall_date"[^>]*title="([^"]+)"/)?.[1];
        const at = date ? Date.parse(date.replace(' ', 'T') + '+09:00') : NaN;
        out.push({ key: `dc-${num}`, title, url: DC_VIEW + num, at: Number.isNaN(at) ? null : at, num: Number(num) });
    }
    return out;
}

// 원글의 작성자 표식(고정닉이면 아이디, 유동이면 닉네임+IP 앞자리)과 본문 이미지 목록. 디시콘·로딩 아이콘은 제외한다.
// 이미지 주소는 디시가 다른 사이트의 직접 불러오기를 막아서(403) 봇이 직접 내려받아 첨부해야 한다. key 는 같은 파일을 알아보는 데 쓴다.
function dcPostInfo(html) {
    const w = html.match(/gall_writer[^>]*data-nick="([^"]*)"[^>]*data-uid="([^"]*)"[^>]*data-ip="([^"]*)"[^>]*data-loc="view"/);
    const author = w ? (w[2] ? `u:${w[2]}` : `n:${w[1]}${w[3]}`) : null;
    const images = [];
    for (const m of dcBodyHtml(html).matchAll(/<img[\s>][^>]*/gi)) {
        const tag = m[0];
        if (/written_dccon/.test(tag)) continue;
        const raw = tag.match(/data-original="([^"]+)"/)?.[1] ?? tag.match(/src="([^"]+)"/)?.[1];
        if (!raw || !/viewimage\.php/.test(raw)) continue;
        const url = raw.replace(/&amp;/g, '&');
        images.push({ url, key: url.match(/[?&]no=([0-9a-f]+)/)?.[1] ?? url });
    }
    return { author, images };
}

// 개념글 알림용: 어그로·잡담 제목 패턴(웃음·욕설·감탄 자음, 낚시성 단어, 의견·질문·토론 글)
const NOISE_TITLE_RE = /[ㅋㅎㄷㅠㅜㅗㅅㅂㅈ]{2,}|[!?]{2,}|\?|충격|실화|논란|떡밥|추측|예상|전망|미쳤|난리|대박|헐|ㅁㅊ|존나|씨발|병신|개웃|개쩌|레전드|ㅇㅈ|유출|루머|카더라|근황|싱글벙글|펌\)|\.{4,}|…{2,}|질문|궁금|뭐임|뭐냐|어떻게|어떡|고민|추천|후기|리뷰|건의|불만|징징|토론|투표|저격|팩폭|합의|인증/;
// 본문에 '근거'가 있는지: 외부 링크, 이미지·영상 첨부, 글자 수. 근거 없는 낚시·잡담 글을 거르는 데 쓴다.
function dcEvidence(html) {
    const body = dcBodyHtml(html);
    const links = [...body.matchAll(/https?:\/\/([^\/"'\s<>]+)/g)].map(m => m[1].toLowerCase()).filter(h => !/dcinside\.(com|co\.kr)$/.test(h));
    return { links: [...new Set(links)], media: /<img\b|<iframe\b|<video\b/i.test(body), textLen: stripTags(body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')).length };
}

// 글 본문 텍스트(댓글은 제외). 이미지뿐인 글은 빈 문자열에 가깝다.
function dcBodyHtml(html) {
    const start = html.indexOf('class="write_div"');
    if (start < 0) return '';
    const open = html.indexOf('>', start);
    let end = html.length;
    for (const marker of ['btn_recommend_box', 'id="comment_wrap', 'view_comment']) {
        const i = html.indexOf(marker, open);
        if (i >= 0 && i < end) end = i;
    }
    // 끝 표식은 태그 안(<div class="btn_recommend_box">)에 있어서, 그 태그의 앞부분(<div class=")이 본문 끝에 딸려 오지 않게 태그 시작까지 물린다
    const lt = html.lastIndexOf('<', end);
    if (lt > open && end - lt <= 60) end = lt;
    return html.slice(open + 1, Math.min(end, open + 60_000));
}
// 본문 영역 안에 이미지 뷰어용 <script>(수천 자)가 들어 있어서, 글자만 뽑기 전에 스크립트·스타일 블록을 먼저 지운다
function parseDcBody(html) { return stripTags(dcBodyHtml(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')); }

// 글 본문(링크 주소 포함)에서 공식 업데이트 페이지(info.monsterhunter.com ... /Ver.x.html) 주소를 찾는다. 댓글은 보지 않는다.
// 주소는 한국어 페이지로 통일해 돌려준다.
const OFFICIAL_UPDATE_URL_RE = /https?:\/\/info\.monsterhunter\.com\/wilds\/update\/[a-z-]+\/Ver\.(\d+(?:\.\d+){1,3})\.html/i;
function findOfficialUpdateLink(html) {
    const m = dcBodyHtml(html).match(OFFICIAL_UPDATE_URL_RE);
    return m ? { url: `https://info.monsterhunter.com/wilds/update/ko-kr/Ver.${m[1]}.html`, version: m[1] } : null;
}
// 제목 속 와일즈 버전 번호(1.042 / 1.042.00.03 꼴)
function versionsOf(text) {
    return [...new Set([...String(text).matchAll(/\bVer\.?\s*(1\.0\d{2}(?:\.\d{2}){0,2})/gi)].map(m => m[1]))];
}

// ── 분류 ─────────────────────────────────────────────────────────────────────
// 와일즈 소식만 올린다. 애매하면 올리지 않는다(놓치는 쪽이 잘못 올리는 쪽보다 낫다).
// 어센던스(Ascendance)는 와일즈의 확장팩이라 와일즈 소식으로 본다
const WILDS_RE = /와일즈|wilds|MHWs|어센던스|ascendance/i;
// 제목에 '와일즈'가 없어도 와일즈 소식으로 보는 말: 와일즈 고유 콘텐츠(격투장·프리 챌린지·몽화의식·축제), 그리고 와일즈 몬스터 이름 + 챌린지·격투장·퀘스트
const WILDS_HINT_RE = /격투장|프리\s*챌린지|몽화\s*의\s*식|몽화의식|축제|페스티벌|festival/i;
const WILDS_MONSTER_NAMES = (() => {
    try { return require('fs').readdirSync(require('path').join(__dirname, '..', 'monsters')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(n => n.length >= 3 && !/훈련/.test(n)); } catch { return []; }
})();
const MONSTER_CHALLENGE_RE = /챌린지|격투장|퀘스트/;
const hasWildsMonsterChallenge = title => MONSTER_CHALLENGE_RE.test(title) && WILDS_MONSTER_NAMES.some(n => title.includes(n));
const OTHER_GAME_RE = /아웃랜더|아랜|스토리즈|stories|outlanders/i;
const EVENT_RE = /게임\s*위크|게임위크|서머\s*게임|서머게임|게임\s*어워드|게임어워드|도쿄\s*게임\s*쇼|게임스컴|gamescom|지스타|쇼케이스|다이렉트|\bTGA\b|\bTGS\b|\bSGF\b|\bPAX\b|BitSummit/i;

// 종류(위에서부터 먼저 맞는 것)
const KINDS = [
    { id: 'maintenance', label: '점검 예고', re: /점검/ },
    { id: 'patch',       label: '패치·업데이트', re: /패치|업데이트|\bTU\b|(?<![가-힣])버전|Ver\.?\s*\d/i },
    { id: 'eventquest',  label: '이벤트 퀘스트', re: /이벤트\s*퀘|배포\s*퀘|챌린지|격투장/ },
    { id: 'festival',    label: '축제 예고', re: /축제|페스티벌|몽화\s*의?\s*식|festival/i },
    { id: 'content',     label: '신규 콘텐츠', re: /신규|신\s*몬스터|DLC|추가\s*몬스터|체험판|공개/i },
    { id: 'broadcast',   label: '방송·행사 일정', re: /방송|생방|라이브|프렌즈|발표|일정/ },
    { id: 'goods',       label: '판매량·굿즈', re: /판매량|굿즈|인형|피규어|콜라보|실적|\d+\s*만\s*장/ },
];
const EVENT_KIND = { id: 'event', label: '행사 참여' };
const GENERAL_KIND = { id: 'news', label: '일반 소식' };

function kindOf(title) {
    return KINDS.find(k => k.re.test(title)) ?? GENERAL_KIND;
}

// 영상(트레일러·무기 소개 등)은 캡콤아시아 유튜브가 맡으므로 디시 글에서는 뺀다(중복 방지)
const VIDEO_RE = /트레일러|티저|\bPV\b|영상|무기\s*소개|유튜브|youtube/i;

// 1단계: 제목만으로 판단. action = 'include' | 'skip' | 'checkBody'
// 와일즈 버전 번호(Ver.1.042 같은 1.0xx 꼴)가 제목에 있으면 '와일즈'라는 글자가 없어도 와일즈 패치 소식으로 본다(팬들이 올리는 패치노트 글을 놓치지 않으려고)
const WILDS_VER_RE = /\bVer\.?\s*1\.0\d{2}|(?:^|\s)1\.0[4-9]\d\s*(?:패치|업데이트)/i;
function classifyTitle(title) {
    const named = WILDS_RE.test(title);              // 제목에 와일즈·어센던스가 직접 있음
    const wilds = named || WILDS_VER_RE.test(title) || WILDS_HINT_RE.test(title) || hasWildsMonsterChallenge(title);  // 버전 번호 꼴·와일즈 고유 콘텐츠(축제·격투장 등)·와일즈 몬스터 챌린지도 와일즈 소식으로 본다
    if (OTHER_GAME_RE.test(title) && !named) return { action: 'skip', reason: '다른 게임' }; // 다른 게임 이름이 있으면 버전 번호만으로는 통과시키지 않는다
    if (EVENT_RE.test(title)) {
        // 행사 글은 제목에 와일즈가 없으면 본문에서 참여 여부를 확인한다
        return wilds ? { action: 'include', kind: EVENT_KIND } : { action: 'checkBody', kind: EVENT_KIND };
    }
    if (VIDEO_RE.test(title)) return { action: 'skip', reason: '영상(유튜브 담당)' };
    if (wilds) return { action: 'include', kind: kindOf(title) };
    return { action: 'skip', reason: '와일즈 언급 없음' };
}

// ── 유튜브(캡콤아시아 업로드 목록, YouTube Data API playlistItems) ───────────────────
const YT_CHANNEL_ID = 'UC02q4A9aCXUARMI51rFcl5A';
const YT_UPLOADS_PLAYLIST = 'UU' + YT_CHANNEL_ID.slice(2);
function parseYoutubePlaylist(jsonText) {
    let items;
    try { items = JSON.parse(jsonText)?.items; } catch { return []; }
    if (!Array.isArray(items)) return [];
    const out = [];
    for (const it of items) {
        const s = it?.snippet;
        const id = s?.resourceId?.videoId;
        if (!id || typeof s.title !== 'string' || s.title === 'Private video' || s.title === 'Deleted video') continue;
        const at = Date.parse(s.publishedAt ?? '');
        out.push({ key: `yt-${id}`, title: s.title.trim(), url: `https://www.youtube.com/watch?v=${id}`, at: Number.isNaN(at) ? null : at, thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` });
    }
    return out;
}
// 와일즈·어센던스 영상만(다른 게임 영상은 제외)
function classifyYoutube(title) {
    if (!WILDS_RE.test(title)) return { include: false, reason: '와일즈 언급 없음' };
    if (OTHER_GAME_RE.test(title) && !/와일즈|wilds|어센던스|ascendance/i.test(title)) return { include: false, reason: '다른 게임' };
    return { include: true };
}

// ── 스팀 공식 공지(캡콤이 올리는 업데이트 개요·점검 공지, 한국어판) ─────────────────────
// 공식 업데이트 사이트(info.monsterhunter.com)가 서버 접속을 막아서, 같은 공지를 스팀의 공개 이벤트·공지 목록(한국어, l=koreana)으로 받는다.
// 한글 번역이 아직 안 올라온 영문 공지는 올리지 않고 기다렸다가, 한글판이 올라오면 올린다(defer).
const STEAM_EVENTS_API = 'https://store.steampowered.com/events/ajaxgetpartnereventspageable/?clan_accountid=0&appid=2246340&offset=0&count=15&l=koreana&origin=https://store.steampowered.com';
const PATCH_KIND = { id: 'patch', label: '패치노트' };
const MAINT_KIND = { id: 'maintenance', label: '점검 예고' };
function cleanSteamText(s) {
    return String(s ?? '')
        .replace(/\[\/?[a-z0-9*]+[^\]]*\]/gi, ' ')   // [h3] [url=…] 같은 서식 표시
        .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, ' ').replace(/https?:\/\/\S+/g, ' ')
        .replace(/\s+/g, ' ').trim();
}
// 본문 요약: 목록 항목([*])이 있으면 앞의 3개(보통 수정·변경 내용), 없으면 본문 앞부분
// 본문 소제목에서 업데이트 종류와 변경 분야를 뽑는다(공식 사이트 목록의 "주요 추가 요소 / 오류 수정 / 게임 밸런스 조정"과 같은 정보)
function steamMeta(body) {
    const t = String(body ?? '');
    const tags = [];
    if (/주요\s*추가\s*요소/.test(t)) tags.push('주요 추가 요소');
    if (/사양\s*변경/.test(t)) tags.push('사양 변경');
    if (/오류\s*수정/.test(t)) tags.push('오류 수정');
    if (/게임\s*밸런스\s*조정/.test(t)) tags.push('밸런스 조정');
    const areas = [];
    if (/【\s*거점/.test(t)) areas.push('거점·시설');
    if (/【\s*몬스터/.test(t)) areas.push('몬스터');
    if (/【\s*플레이어/.test(t)) areas.push('플레이어');
    if (/【\s*시스템/.test(t)) areas.push('시스템');
    return { tags, areas };
}
function steamSummary(body, maxChars = 240, areas = []) {
    const items = String(body ?? '').split('[*]').slice(1)
        .map(x => cleanSteamText(x.split(/\[\/list\]/i)[0])).filter(Boolean).slice(0, 3);
    // 큰 업데이트는 목록 대신 분야별 소제목으로 되어 있어, 이 경우 변경 분야를 보여 준다
    const text = items.length ? items.join(' · ') : areas.length ? `변경 분야: ${areas.join(' · ')}` : cleanSteamText(body);
    return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}
function parseSteamEvents(jsonText) {
    let events;
    try { events = JSON.parse(jsonText)?.events; } catch { return []; }
    if (!Array.isArray(events)) return [];
    const out = [];
    for (const e of events) {
        if (!e || e.gid == null || typeof e.event_name !== 'string' || e.published === 0) continue;
        const body = String(e.announcement_body?.body ?? '');
        const at = Number(e.rtime32_start_time) * 1000;
        const { tags, areas } = steamMeta(body);
        out.push({
            tags, areas,
            key: `steam-${e.gid}`, title: e.event_name.trim(),
            url: `https://store.steampowered.com/news/app/2246340/view/${e.gid}?l=koreana`,
            at: Number.isFinite(at) && at > 0 ? at : null,
            dateText: body.match(/배포\s*일(?:시)?[\s\S]{0,30}?(\d{4}년\s*\d{1,2}월\s*\d{1,2}일(?:\([^)]*\))?)/)?.[1] ?? null,
            summary: steamSummary(body, 240, areas),
        });
    }
    return out;
}
// 패치·점검 공지만 올린다(영상·가격·행사 공지는 다른 출처가 맡는다). 제목에 한글이 있어야 올린다.
const KO_PATCH_RE = /업데이트|점검|패치|\bVer\.?\s*\d/;
const EN_PATCH_RE = /Update Summary|Title Update|\bVer\.?\s*\d|Maintenance|Patch/i;
// 한글 번역이 끝내 안 나온 공지가 과거에 있었다(Update Summary (Ver.1.040.01.00) 등 3건). 영문 제목이 알려진 꼴이면
// 기다리지 않고 바로 한글 제목으로 바꿔 올린다(본문은 영문뿐이라 요약을 싣지 않는다).
function translateSteamTitle(title) {
    const m = title.match(/^Update Summary\s*(\(.*\))\s*$/i);
    if (m) return `업데이트 개요 ${m[1]}`;
    const n = title.match(/^Update\s+(Ver\.?\s*[\d.]+).*Maintenance Notice/i);
    if (n) return `업데이트 ${n[1].replace(/\s+/g, '')} 점검 안내`;
    return null;
}
function classifySteam(title) {
    const hangul = /[가-힣]/.test(title);
    const kind = /점검|Maintenance/i.test(title) ? MAINT_KIND : PATCH_KIND;
    if (hangul && KO_PATCH_RE.test(title)) return { include: true, kind };
    if (!hangul && EN_PATCH_RE.test(title)) {
        const ko = translateSteamTitle(title);
        if (ko) return { include: true, kind, titleKo: ko, englishOnly: true };
        return { include: false, defer: true, reason: '한글 번역 대기' }; // 모르는 영문 꼴은 한글판이 올라올 때까지 보류
    }
    return { include: false, reason: '패치·점검 공지 아님' };
}

// ── GitHub 릴리즈(REFramework Nightly) ──────────────────────────────────────────
const REFRAMEWORK_API = 'https://api.github.com/repos/praydog/REFramework-nightly/releases?per_page=5';
// 릴리즈 본문의 앞부분만 짧게(마크다운 기호 정리, 최대 3줄·240자)
function summarizeMarkdown(body, maxChars = 240) {
    if (typeof body !== 'string') return '';
    const lines = body.split(/\r?\n/)
        .map(l => l.replace(/^[#>\s*\-+]+/, '').replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean).slice(0, 3);
    const text = lines.join(' · ');
    return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}
function parseGithubReleases(jsonText) {
    let list;
    try { list = JSON.parse(jsonText); } catch { return []; }
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const r of list) {
        if (!r || r.id == null || r.draft || typeof r.html_url !== 'string') continue;
        const title = String(r.name || r.tag_name || '').trim();
        if (!title) continue;
        const at = Date.parse(r.published_at ?? r.created_at ?? '');
        out.push({
            key: `gh-${r.id}`, title, url: r.html_url, at: Number.isNaN(at) ? null : at,
            tag: r.tag_name ?? null, prerelease: !!r.prerelease, summary: summarizeMarkdown(r.body),
        });
    }
    return out;
}

// ── 중복 판별(다른 출처가 같은 소식을 올렸는지) ─────────────────────────────────────
// 제목에서 흔한 말을 빼고 남은 낱말이 많이 겹치면 같은 소식으로 본다.
const STOPWORDS = new Set(['몬스터헌터', '몬헌', '와일즈', '어센던스', 'monster', 'hunter', 'wilds', 'ascendance', '공식', '영상', '공개', '소식', '안내', 'jpg', 'png']);
function tokenize(title) {
    return [...new Set(
        title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ')
            .filter(w => w.length >= 2 && !STOPWORDS.has(w)),
    )];
}
function similarTitles(a, b, threshold = 0.5) {
    if (a.length < 2 || b.length < 2) return false;
    const setB = new Set(b);
    const inter = a.filter(w => setB.has(w)).length;
    const union = new Set([...a, ...b]).size;
    return inter >= 2 && inter / union >= threshold;
}

// 2단계: 본문에 와일즈가 나오면 참여로 본다. 본문이 사실상 비어 있으면(이미지 글) 확인할 수 없으므로 올리지 않는다.
function confirmBody(body) {
    if (!body || body.length < 20) return { include: false, reason: '본문 확인 불가' };
    return WILDS_RE.test(body) ? { include: true } : { include: false, reason: '와일즈 불참' };
}

module.exports = {
    cleanDcTitle, parseOfficialList, parseDcList, parseDcBody, dcPostInfo, dcEvidence, NOISE_TITLE_RE, parseYoutubePlaylist, parseGithubReleases, REFRAMEWORK_API,
    parseSteamEvents, classifySteam, STEAM_EVENTS_API, findOfficialUpdateLink, versionsOf,
    classifyTitle, confirmBody, classifyYoutube, kindOf, tokenize, similarTitles,
    EVENT_KIND, GENERAL_KIND, OFFICIAL_BASE, YT_UPLOADS_PLAYLIST, KST_MS,
};
