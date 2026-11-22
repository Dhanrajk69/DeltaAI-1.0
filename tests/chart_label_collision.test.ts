import assert from 'node:assert/strict';
import { resolveVerticalLabelCollisions } from '../src/utils/chartLabelCollision.ts';

let passed = 0;

function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ PASS: ${name}`);
}

console.log('RUNNING CHART ANTI-COLLISION LABEL ENGINE TESTS');

test('Enforces >= 16px vertical gap for clumped labels', () => {
  const input = [
    { id: 'sl', rawY: 150, priority: 95 },
    { id: 'entry', rawY: 152, priority: 96 },
    { id: 'h3', rawY: 154, priority: 72 },
    { id: 'gp', rawY: 155, priority: 84 },
    { id: 'tp1', rawY: 158, priority: 94 },
  ];

  const resolved = resolveVerticalLabelCollisions(input, 16, 12, 338);
  assert.equal(resolved.length, 5);

  for (let i = 1; i < resolved.length; i++) {
    assert.ok(
      resolved[i].resolvedY - resolved[i - 1].resolvedY >= 15.99,
      `Expected >= 16px gap between ${resolved[i - 1].id} and ${resolved[i].id}`
    );
  }
  for (const item of resolved) {
    assert.ok(item.resolvedY >= 12 && item.resolvedY <= 338);
  }
});

test('Clamps top-edge and bottom-edge labels inside viewport without overlap', () => {
  const input = [
    { id: 'top-1', rawY: 1, priority: 80 },
    { id: 'top-2', rawY: 3, priority: 70 },
    { id: 'top-3', rawY: 6, priority: 60 },
    { id: 'bot-1', rawY: 344, priority: 80 },
    { id: 'bot-2', rawY: 347, priority: 70 },
    { id: 'bot-3', rawY: 350, priority: 90 },
  ];

  const resolved = resolveVerticalLabelCollisions(input, 16, 12, 338);
  assert.equal(resolved.length, 6);
  assert.ok(resolved[0].resolvedY >= 12);
  assert.ok(resolved[resolved.length - 1].resolvedY <= 338);

  for (let i = 1; i < resolved.length; i++) {
    assert.ok(resolved[i].resolvedY - resolved[i - 1].resolvedY >= 15.99);
  }
});

test('Preserves exact rawY when labels are already well-spaced', () => {
  const input = [
    { id: 'a', rawY: 40, priority: 90 },
    { id: 'b', rawY: 120, priority: 80 },
    { id: 'c', rawY: 260, priority: 70 },
  ];

  const resolved = resolveVerticalLabelCollisions(input, 16, 12, 338);
  assert.deepEqual(
    resolved.map((r) => r.resolvedY),
    [40, 120, 260]
  );
});

console.log(`CHART COLLISION TEST SUMMARY: ${passed}/${passed} TESTS PASSED`);
