const test = require('node:test');
const assert = require('node:assert/strict');
const { LOCK_MS, decideAccess } = require('../card-lock');

const T = 1_000_000_000;
const post = (extra = {}) => ({ userId: 'A', at: T, clickedAt: T, ...extra });

test('요청자 본인은 언제나 owner', () => {
    assert.equal(decideAccess(post(), 'A', T + 1), 'owner');
    assert.equal(decideAccess(post(), 'A', T + LOCK_MS * 10), 'owner');
});
test('잠금 중 남이 누르면 locked', () => {
    assert.equal(decideAccess(post(), 'B', T + 1000), 'locked');
    assert.equal(decideAccess(post(), 'B', T + LOCK_MS - 1), 'locked');
});
test('정확히 5분이 지나면 takeover', () => {
    assert.equal(decideAccess(post(), 'B', T + LOCK_MS), 'takeover');
});
test('마지막 조작(lastAt) 기준으로 잠금이 연장된다', () => {
    const p = post({ lastAt: T + 4 * 60 * 1000 });
    assert.equal(decideAccess(p, 'B', T + 6 * 60 * 1000), 'locked'); // 소환 후 6분이어도 1분 전에 조작함
    assert.equal(decideAccess(p, 'B', T + 9 * 60 * 1000), 'takeover');
});
test('기록이 없으면(옛 메시지) takeover', () => {
    assert.equal(decideAccess(undefined, 'B', T), 'takeover');
    assert.equal(decideAccess({}, 'B', T), 'takeover');
});
test('lastAt/clickedAt 없이 at 만 있어도 동작', () => {
    assert.equal(decideAccess({ userId: 'A', at: T }, 'B', T + 1000), 'locked');
});
