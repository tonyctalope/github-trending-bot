import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

describe('loadEnv — EXCLUDE', () => {
  it('defaults to an empty list when unset', () => {
    expect(loadEnv({}).EXCLUDE).toEqual([]);
  });

  it('splits a comma-separated list and trims each entry', () => {
    expect(loadEnv({ EXCLUDE: 'skill, skills ,mcp' }).EXCLUDE).toEqual(['skill', 'skills', 'mcp']);
  });

  it('also splits on newlines and drops blanks', () => {
    expect(loadEnv({ EXCLUDE: 'agent\n\nllm,  ,prompt' }).EXCLUDE).toEqual([
      'agent',
      'llm',
      'prompt',
    ]);
  });

  it('is an empty list, not [""], for an empty string', () => {
    expect(loadEnv({ EXCLUDE: '' }).EXCLUDE).toEqual([]);
  });
});
