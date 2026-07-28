import { boundedInteger } from './topology-graph-cache.service';

describe('TopologyGraphCacheService configuration', () => {
  it('uses defaults and clamps integer environment values safely', () => {
    expect(boundedInteger(undefined, 300, 30, 3600)).toBe(300);
    expect(boundedInteger('invalid', 300, 30, 3600)).toBe(300);
    expect(boundedInteger('1', 300, 30, 3600)).toBe(30);
    expect(boundedInteger('7200', 300, 30, 3600)).toBe(3600);
    expect(boundedInteger('120.9', 300, 30, 3600)).toBe(120);
  });
});
