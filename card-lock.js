// 공개 몬스터 카드의 버튼 조작 권한.
// 카드에 있는 🔒 잠금 버튼을 요청자(카드를 띄운 사람)가 누르면 잠금이 켜지고,
// 잠겨 있는 동안 다른 사람이 탭·페이지 버튼을 누르면 카드는 그대로 두고 그 사람에게만 보이는 사본을 띄운다.
// 잠금을 끄면(요청자가 다시 누름) 누구나 그 카드를 바꿀 수 있다.
//
// post: 카드 기록 { userId, locked? } 또는 없음(옛 메시지·기록 유실)
// 반환: 'open'   잠겨 있지 않음 → 누구나 그 자리에서 갱신
//       'owner'  잠금 중인데 요청자 본인 → 그 자리에서 갱신
//       'locked' 잠금 중에 남이 누름 → 나만 보는 사본
function decideAccess(post, userId) {
    if (!post || !post.locked) return 'open';
    return post.userId === userId ? 'owner' : 'locked';
}

// 잠금 버튼을 누를 수 있는 사람: 기록이 있는 카드의 요청자뿐
const canToggleLock = (post, userId) => !!post && post.userId === userId;

module.exports = { decideAccess, canToggleLock };
