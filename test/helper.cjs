const deepEqual = require('deep-equal');
const defined = require('defined');
const { Test } = require("tape");

// isMap and isSet used by deepEqual which is used by tape
// don't work with Map and Set proxy, handle that ourselves

Test.prototype.deepEqual
= Test.prototype.deepEquals
= Test.prototype.isEquivalent
= Test.prototype.same
= function(a, b, msg, extra) {
  if (arguments.length < 2) {
      throw new TypeError('two arguments must be provided to compare');
  }
  this._assert(isDeepEqual(a, b), {
      message: defined(msg, 'should be deeply equivalent'),
      operator: 'deepEqual',
      actual: a,
      expected: b,
      extra: extra
  });
}

Test.prototype.notDeepEqual
= Test.prototype.notDeepEquals
= Test.prototype.notEquivalent
= Test.prototype.notDeeply
= Test.prototype.notSame
= Test.prototype.isNotDeepEqual
= Test.prototype.isNotDeeply
= Test.prototype.isNotEquivalent
= Test.prototype.isInequivalent
= function(a, b, msg, extra) {
  if (arguments.length < 2) {
      throw new TypeError('two arguments must be provided to compare');
  }
  this._assert(!isDeepEqual(a, b), {
      message: defined(msg, 'should not be deeply equivalent'),
      operator: 'notDeepEqual',
      actual: a,
      expected: b,
      extra: extra
  });
}

function isDeepEqual(a, b) {
  const opts = { strict: true };
  if (a instanceof Map && b instanceof Map) {
    return deepEqual(new Map(a), new Map(b), opts);
  }
  if (a instanceof Set && b instanceof Set) {
    return deepEqual(new Set(a), new Set(b), opts);
  }
  return deepEqual(a, b, opts);
}
