import { describe, it, expect, vi } from 'vitest';
vi.mock('../../utils/tables', () => ({ getCapacity: vi.fn(() => 8) }));
describe('AppContext capacity dependency', () => {
  it('imports without ReferenceError when getCapacity is correctly imported', async () => {
    const mod = await import('../AppContext');
    expect(mod).toBeTruthy();
  });
});