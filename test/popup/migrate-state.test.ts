import { describe, it, expect } from 'vitest';
import { migrateState } from '../../lib/background/state.js';
import { makeState } from '../fixtures.js';

describe('migrateState', () => {
  it('migrates bare ID to scoped format', () => {
    const raw = makeState({ chainId: 1, favorites: ['42'] });
    const { state, changed } = migrateState(raw);
    expect(changed).toBe(true);
    expect(state.favorites).toEqual(['csm:1:42']);
  });

  it('leaves already-scoped ID unchanged', () => {
    const raw = makeState({ favorites: ['csm:1:42'] });
    const { state, changed } = migrateState(raw);
    expect(changed).toBe(false);
    expect(state.favorites).toEqual(['csm:1:42']);
  });

  it('handles mixed bare and scoped IDs', () => {
    const raw = makeState({ chainId: 1, favorites: ['42', 'csm:1:7'] });
    const { state, changed } = migrateState(raw);
    expect(changed).toBe(true);
    expect(state.favorites).toEqual(['csm:1:42', 'csm:1:7']);
  });

  it('adds missing moduleType', () => {
    const raw = { ...makeState(), moduleType: undefined } as any;
    const { state, changed } = migrateState(raw);
    expect(changed).toBe(true);
    expect(state.moduleType).toBe('csm');
  });

  it('adds missing addressLabels', () => {
    const raw = { ...makeState() } as any;
    delete raw.addressLabels;
    const { state, changed } = migrateState(raw);
    expect(changed).toBe(true);
    expect(state.addressLabels).toEqual({});
  });

  it('preserves existing addressLabels', () => {
    const labels = { '0xabc': 'Alice' };
    const raw = makeState({ addressLabels: labels });
    const { state, changed } = migrateState(raw);
    expect(changed).toBe(false);
    expect(state.addressLabels).toEqual(labels);
  });

  it('adds missing requireApproval', () => {
    const raw = { ...makeState() } as any;
    delete raw.requireApproval;
    const { state, changed } = migrateState(raw);
    expect(changed).toBe(true);
    expect(state.requireApproval).toBe(false);
  });

  it('preserves existing requireApproval', () => {
    const raw = makeState({ requireApproval: true });
    const { state, changed } = migrateState(raw);
    expect(changed).toBe(false);
    expect(state.requireApproval).toBe(true);
  });
});
