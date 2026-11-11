// 몬스터 헌터 와일즈 소식 파서 (순수 함수 — 네트워크 없음, 테스트 대상)
// 글 하나: { key, title, url, at(ms 또는 null), ... }

const KST_MS = 9 * 60 * 60_000;

const OFFICIAL_BASE = 'https://info.monsterhunter.com/wilds/update/ko-kr/';
const DC_VIEW = 'https://gall.dcinside.com/mgallery/board/view/?id=capcommh&no=';

const decodeEntities = s => s
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
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
function parseDcList(html) {
    const out = [];
    // 행 시작 표식으로 나눈다(닫히지 않는 이상한 응답에서도 한 번만 훑도록 — 정규식으로 </tr>까지 찾으면 느려질 수 있음)
    for (const part of html.split('<tr class="ub-content').slice(1)) {
        const end = part.indexOf('</tr>');
        const row = end >= 0 ? part.slice(0, end) : part.slice(0, 20_000);
        const num = stripTags(row.match(/class="gall_num"[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '');
        if (!/^\d+$/.test(num)) continue;
        const a = row.match(/class="gall_tit[^"]*"[^>]*>[\s\S]*?<a [^>]*>([\s\S]*?)<\/a>/);
        const title = a ? stripTags(a[1]) : '';
        if (!title) continue;
        const date = row.match(/class="gall_date"[^>]*title="([^"]+)"/)?.[1];
        const at = date ? Date.parse(date.replace(' ', 'T') + '+09:00') : NaN;
        out.push({ key: `dc-${num}`, title, url: DC_VIEW + num, at: Number.isNaN(at) ? null : at, num: Number(num) });
    }
    return out;
}

// 글 본문 텍스트(댓글은 제외). 이미지뿐인 글은 빈 문자열에 가깝다.
function parseDcBody(html) {
    const start = html.indexOf('class="write_div"');
    if (start < 0) return '';
    const open = html.indexOf('>', start);
    let end = html.length;
    for (const marker of ['btn_recommend_box', 'id="comment_wrap', 'view_comment']) {
        const i = html.indexOf(marker, open);
        if (i >= 0 && i < end) end = i;
    }
    return stripTags(html.slice(open + 1, Math.min(end, open + 60_000)));
}

// ── 분류 ─────────────────────────────────────────────────────────────────────
// 와일즈 소식만 올린다. 애매하면 올리지 않는다(놓치는 쪽이 잘못 올리는 쪽보다 낫다).
// 어센던스(Ascendance)는 와일즈의 확장팩이라 와일즈 소식으로 본다
const WILDS_RE = /와일즈|wilds|MHWs|어센던스|ascendance/i;
const OTHER_GAME_RE = /아웃랜더|아랜|스토리즈|stories|outlanders/i;
const EVENT_RE = /게임\s*위크|게임위크|서머\s*게임|서머게임|게임\s*어워드|게임어워드|도쿄\s*게임\s*쇼|게임스컴|gamescom|지스타|쇼케이스|다이렉트|\bTGA\b|\bTGS\b|\bSGF\b|\bPAX\b|BitSummit/i;

// 종류(위에서부터 먼저 맞는 것)
const KINDS = [
    { id: 'maintenance', label: '점검 예고', emoji: '🛠️', re: /점검/ },
    { id: 'patch',       label: '패치·업데이트', emoji: '📢', re: /패치|업데이트|\bTU\b|버전|Ver\.?\s*\d/i },
    { id: 'eventquest',  label: '이벤트 퀘스트', emoji: '🎯', re: /이벤트\s*퀘|배포\s*퀘|챌린지/ },
    { id: 'content',     label: '신규 콘텐츠', emoji: '🆕', re: /신규|신\s*몬스터|DLC|추가\s*몬스터|체험판|공개/i },
    { id: 'broadcast',   label: '방송·행사 일정', emoji: '📺', re: /방송|생방|라이브|프렌즈|발표|일정/ },
    { id: 'goods',       label: '판매량·굿즈', emoji: '🎁', re: /판매량|굿즈|인형|피규어|콜라보|실적|\d+\s*만\s*장/ },
];
const EVENT_KIND = { id: 'event', label: '행사 참여', emoji: '🎪' };
const GENERAL_KIND = { id: 'news', label: '일반 소식', emoji: '📰' };

function kindOf(title) {
    return KINDS.find(k => k.re.test(title)) ?? GENERAL_KIND;
}

// 영상(트레일러·무기 소개 등)은 캡콤아시아 유튜브가 맡으므로 디시 글에서는 뺀다(중복 방지)
const VIDEO_RE = /트레일러|티저|\bPV\b|영상|무기\s*소개|유튜브|youtube/i;

// 1단계: 제목만으로 판단. action = 'include' | 'skip' | 'checkBody'
function classifyTitle(title) {
    const wilds = WILDS_RE.test(title);
    if (OTHER_GAME_RE.test(title) && !wilds) return { action: 'skip', reason: '다른 게임' };
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
    parseOfficialList, parseDcList, parseDcBody, parseYoutubePlaylist, parseGithubReleases, REFRAMEWORK_API,
    classifyTitle, confirmBody, classifyYoutube, kindOf, tokenize, similarTitles,
    EVENT_KIND, GENERAL_KIND, OFFICIAL_BASE, YT_UPLOADS_PLAYLIST, KST_MS,
};
