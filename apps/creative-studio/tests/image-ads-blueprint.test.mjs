import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CREATIVE_BLUEPRINTS,
  blueprintForClass,
  validateBlueprint,
  regionsOverlap,
} from '../dist/imageAdBlueprint.js';

test('blueprints cover four supported creative treatments', () => {
  assert.equal(CREATIVE_BLUEPRINTS.length, 4);
  assert.equal(
    new Set(CREATIVE_BLUEPRINTS.map(b => b.classId)).size,
    4
  );
});

test('all blueprints respect spatial constraints', () => {
  for (const blueprint of CREATIVE_BLUEPRINTS) {
    assert.deepEqual(
      validateBlueprint(blueprint),
      [],
      blueprint.classId
    );
  }
});

test('all initial blueprints avoid fake embedded CTA buttons', () => {
  for (const blueprint of CREATIVE_BLUEPRINTS) {
    assert.equal(blueprint.embeddedCta, false);
  }
});

test('all blueprints protect product from text regions', () => {
  for (const blueprint of CREATIVE_BLUEPRINTS) {
    assert.equal(regionsOverlap(blueprint.headline, blueprint.product), false);
    assert.equal(regionsOverlap(blueprint.body, blueprint.product), false);
  }
});

test('lookup cannot mutate registry blueprints', () => {
  const a = blueprintForClass('OUTCOME_HERO');
  assert.ok(a);
  a.product.x = 0;
  assert.notEqual(
    blueprintForClass('OUTCOME_HERO').product.x,
    0
  );
});

test('invalid product bounds are rejected', () => {
  const blueprint = blueprintForClass('OUTCOME_HERO');
  blueprint.product.w = 2;
  assert.ok(validateBlueprint(blueprint).length > 0);
});
