const test = require('node:test');
const assert = require('node:assert/strict');
const { decideAccess, canToggleLock } = require('../card-lock');

test('잠기지 않은 카드는 누구나 open', () => {
    assert.equal(decideAccess({ userId: 'A' }, 'A'), 'open');
    assert.equal(decideAccess({ userId: 'A', locked: false }, 'B'), 'open');
});
test('기록이 없으면(옛 메시지) open', () => {
    assert.equal(decideAccess(undefined, 'B'), 'open');
});
test('잠금 중: 요청자는 owner, 남은 locked', () => {
    assert.equal(decideAccess({ userId: 'A', locked: true }, 'A'), 'owner');
    assert.equal(decideAccess({ userId: 'A', locked: true }, 'B'), 'locked');
});
test('잠금 버튼은 요청자만, 기록 없는 카드는 아무도', () => {
    assert.equal(canToggleLock({ userId: 'A' }, 'A'), true);
    assert.equal(canToggleLock({ userId: 'A' }, 'B'), false);
    assert.equal(canToggleLock(undefined, 'A'), false);
});
