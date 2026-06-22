import { describe, it, expect } from 'vitest';
import { coordinatePipeline } from './coordinator';

describe('LiberateJS Core Pipeline', () => {
  it('exports coordinatePipeline', () => {
    expect(coordinatePipeline).toBeDefined();
  });
});
