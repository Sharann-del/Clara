import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiagramElement, DiagramState } from './api';
import { buildSteps, mergeOverride, planCreate, resolveElements, startStepIndex, stepBy } from './states';

const box = (id: string, x = 10): DiagramElement => ({
  id,
  type: 'rect',
  geometry: { x, y: 10, width: 100, height: 50 },
  style: { fill: '#ffffff' },
  zIndex: 1,
});

const state = (id: string, element_overrides: DiagramState['element_overrides'] = {}): DiagramState => ({
  id,
  diagram_id: 'd',
  name: id,
  order_index: 0,
  element_overrides,
});

/** Simulates what DiagramPage persists for a create inside `activeId`, then resolves every view. */
function createInState(base: DiagramElement[], states: DiagramState[], activeId: string | null, el: DiagramElement) {
  const { element, override } = planCreate(el, activeId);
  const nextStates = states.map((s) =>
    override && s.id === override.stateId
      ? { ...s, element_overrides: { ...s.element_overrides, [override.elementId]: override.value } }
      : s,
  );
  return { base: [...base, element], states: nextStates };
}

test('element created inside a state is visible only in that state, not Base or other states', () => {
  const circle = { ...box('c'), type: 'ellipse' as const };
  const { base, states } = createInState([box('a')], [state('current'), state('future')], 'future', circle);

  const visible = (s?: DiagramState) => resolveElements(base, s).filter((e) => !e.hidden).map((e) => e.id);
  assert.deepEqual(visible(undefined), ['a']);
  assert.deepEqual(visible(states[0]), ['a']);
  assert.deepEqual(visible(states[1]), ['a', 'c']);
});

test('element created with no state selected is a normal base element visible everywhere', () => {
  const { base, states } = createInState([], [state('future')], null, box('a'));
  assert.equal(base[0].style.baseHidden, undefined);
  assert.equal(resolveElements(base, undefined)[0].hidden, undefined);
  assert.equal(resolveElements(base, states[0])[0].hidden, undefined);
});

test('moving an existing element in a state yields an override and leaves the base element untouched', () => {
  const a = box('a');
  const o = mergeOverride(a, undefined, { geometry: { ...a.geometry, x: 200 } });
  assert.deepEqual(o, { geometry: { x: 200 } });
  assert.equal(a.geometry.x, 10);
  const future = state('future', { a: o! });
  assert.equal(resolveElements([a], future)[0].geometry.x, 200);
  assert.equal(resolveElements([a], undefined)[0].geometry.x, 10);
});

test('deleting in a state hides only there; un-hiding a state-created element clears or keeps override correctly', () => {
  const a = box('a');
  assert.deepEqual(mergeOverride(a, undefined, { hidden: true }), { hidden: true });
  assert.equal(mergeOverride(a, { hidden: true }, { hidden: false }), null);
  const c = { ...box('c'), style: { baseHidden: true } };
  assert.equal(mergeOverride(c, { hidden: false }, { hidden: true }), null);
});

test('connector to a state-only element is hidden outside that state', () => {
  const conn: DiagramElement = { id: 'k', type: 'connector', geometry: { fromId: 'a', toId: 'c' }, style: {}, zIndex: 0 };
  const { base, states } = createInState([box('a'), conn], [state('future')], 'future', box('c'));
  assert.equal(resolveElements(base, undefined).find((e) => e.id === 'k')!.hidden, true);
  assert.equal(resolveElements(base, states[0]).find((e) => e.id === 'k')!.hidden, undefined);
});

test('present walkthrough is Base first, then states in order, counting N+1 steps', () => {
  const states = [state('current'), state('interim'), state('future')];
  const steps = buildSteps(states);
  assert.deepEqual(steps.map((s) => s.name), ['Base', 'current', 'interim', 'future']);
  assert.equal(steps.length, states.length + 1);
  assert.equal(steps[0].state, undefined);
  assert.equal(steps[2].state, states[1]);
});

test('Base step shows base elements, not any state overrides', () => {
  const a = box('a');
  const states = [state('future', { a: { geometry: { x: 300 } } })];
  const [baseStep, futureStep] = buildSteps(states);
  assert.equal(resolveElements([a], baseStep.state)[0].geometry.x, 10);
  assert.equal(resolveElements([a], futureStep.state)[0].geometry.x, 300);
});

test('Prev on the first step does nothing; Next on the last does nothing', () => {
  assert.equal(stepBy(0, -1, 4), 0);
  assert.equal(stepBy(0, 1, 4), 1);
  assert.equal(stepBy(3, 1, 4), 3);
});

test('presenting starts on the selected state (Base when none)', () => {
  const states = [state('current'), state('future')];
  assert.equal(startStepIndex(states, null), 0);
  assert.equal(startStepIndex(states, 'future'), 2);
});
