// 공개 몬스터 카드의 버튼 조작 권한.
// 카드를 띄운 사람(요청자)이 마지막으로 조작한 뒤 LOCK_MS 동안은 요청자만 그 카드를 바꿀 수 있고,
// 다른 사람이 누르면 카드는 그대로 둔 채 그 사람에게만 보이는 사본을 띄운다.
// 잠금이 풀린 뒤에는 누구든 누르면 그 카드를 바꾸고, 누른 사람이 새 요청자가 된다.
const LOCK_MS = 5 * 60 * 1000;

// post: 카드 기록 { userId, lastAt?, clickedAt?, at? } 또는 없음(옛 메시지·기록 유실)
// 반환: 'owner'    요청자 본인 → 그 자리에서 갱신
//       'locked'   남이 잠금 중에 누름 → 나만 보는 사본
//       'takeover' 잠금이 풀렸거나 기록이 없음 → 그 자리에서 갱신하고 누른 사람이 요청자가 됨
function decideAccess(post, userId, now = Date.now(), lockMs = LOCK_MS) {
    if (!post || !post.userId) return 'takeover';
    if (post.userId === userId) return 'owner';
    const last = post.lastAt ?? post.clickedAt ?? post.at ?? 0;
    return now - last < lockMs ? 'locked' : 'takeover';
}

module.exports = { LOCK_MS, decideAccess };
