import { describe, it, expect } from 'vitest';
import { parseRaceId } from '../src/livelaps.js';

describe('parseRaceId', () => {
  it('accepts a bare race ID', () => {
    expect(parseRaceId('79103')).toEqual({ id: 79103, isEvent: false });
  });

  it('trims whitespace around a bare race ID', () => {
    expect(parseRaceId('  79103  ')).toEqual({ id: 79103, isEvent: false });
  });

  it('parses a race/results/ URL', () => {
    expect(
      parseRaceId('https://www.livelaps.com/laravel/public/api/v1/livelaps/race/results/79103?page=1&size=1000')
    ).toEqual({ id: 79103, isEvent: false });
  });

  it('parses a race/filters/ URL', () => {
    expect(
      parseRaceId('https://www.livelaps.com/laravel/public/api/v1/livelaps/race/filters/79103')
    ).toEqual({ id: 79103, isEvent: false });
  });

  it('parses a race/config/ URL', () => {
    expect(
      parseRaceId('https://www.livelaps.com/laravel/public/api/v1/livelaps/race/config/79103')
    ).toEqual({ id: 79103, isEvent: false });
  });

  it('parses a bare race/ URL', () => {
    expect(parseRaceId('https://www.livelaps.com/livelaps/race/79103')).toEqual({ id: 79103, isEvent: false });
  });

  it('parses an eventScores/ URL and tags it as an event ID', () => {
    expect(parseRaceId('https://www.livelaps.com/livelaps/eventScores/23827')).toEqual({
      id: 23827,
      isEvent: true
    });
  });

  it('returns null for garbage input', () => {
    expect(parseRaceId('not a race id')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseRaceId('')).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(parseRaceId('   ')).toBeNull();
  });
});
