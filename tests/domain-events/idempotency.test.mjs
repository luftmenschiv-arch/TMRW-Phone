import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalJson } from '../../domain/events/idempotency.mjs';

function captureCanonicalError(value) {
  try {
    canonicalJson(value);
  } catch (error) {
    return error;
  }
  assert.fail('canonicalJson was expected to reject the value');
}

function assertSafeDiagnostic(error, expected) {
  assert.equal(error instanceof TypeError, true);
  assert.equal(error.code, 'TMRW_NON_JSON_VALUE');
  assert.deepEqual(error.tmrwNonJsonDiagnostic, expected);
  assert.equal(Object.isFrozen(error.tmrwNonJsonDiagnostic), true);
  assert.equal(JSON.stringify(error.tmrwNonJsonDiagnostic).includes('sentinel-member'), false);
}

test('canonicalJson keeps normal Array/plain JSON behavior unchanged', () => {
  assert.equal(canonicalJson({ b: 2, a: [1, true, null, 'ok'] }), '{"a":[1,true,null,"ok"],"b":2}');
  assert.equal(canonicalJson(['z', { b: 2, a: 1 }]), '["z",{"a":1,"b":2}]');
});

test('canonicalJson rejects Set with the same message and safe type metadata', () => {
  const value = new Set(['sentinel-member']);
  const error = captureCanonicalError(value);
  assert.equal(error.message, 'value must be JSON-serializable data');
  assertSafeDiagnostic(error, {
    path: 'value', tag: '[object Set]', constructor: 'Set', array: false,
    typeof: 'object', iterable: true, plain: false,
  });
  assert.equal(value.size, 1);
  assert.equal(value.has('sentinel-member'), true);
});

test('canonicalJson rejects Map with the same message and safe type metadata', () => {
  const value = new Map([['sentinel-member', true]]);
  const error = captureCanonicalError(value);
  assert.equal(error.message, 'value must be JSON-serializable data');
  assertSafeDiagnostic(error, {
    path: 'value', tag: '[object Map]', constructor: 'Map', array: false,
    typeof: 'object', iterable: true, plain: false,
  });
  assert.equal(value.size, 1);
  assert.equal(value.get('sentinel-member'), true);
});

test('canonicalJson diagnostic checks iterable capability without invoking iterator or mutating input', () => {
  let iteratorCalls = 0;
  const prototype = Object.create(Object.prototype);
  const value = Object.create(prototype);
  Object.defineProperty(value, Symbol.iterator, {
    value() {
      iteratorCalls += 1;
      throw new Error('iterator must never be invoked');
    },
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(value, 'sentinel', { value: 'sentinel-member', enumerable: true, configurable: true });
  const keysBefore = Reflect.ownKeys(value);
  const prototypeBefore = Object.getPrototypeOf(value);

  const error = captureCanonicalError(value);
  assert.equal(error.message, 'value must be JSON-serializable data');
  assert.equal(iteratorCalls, 0);
  assert.deepEqual(Reflect.ownKeys(value), keysBefore);
  assert.strictEqual(Object.getPrototypeOf(value), prototypeBefore);
  assertSafeDiagnostic(error, {
    path: 'value', tag: '[object Object]', constructor: 'Object', array: false,
    typeof: 'object', iterable: true, plain: false,
  });
});

test('prototype-null object remains rejected and is classified without widening acceptance', () => {
  const value = Object.create(null);
  value.sentinel = 'sentinel-member';
  const error = captureCanonicalError(value);
  assert.equal(error.message, 'value must be JSON-serializable data');
  assertSafeDiagnostic(error, {
    path: 'value', tag: '[object Object]', constructor: 'unknown', array: false,
    typeof: 'object', iterable: false, plain: true,
  });
  assert.equal(value.sentinel, 'sentinel-member');
});
