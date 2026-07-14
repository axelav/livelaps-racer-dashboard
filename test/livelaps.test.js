import { describe, it, expect } from 'vitest';
import { parseRaceId, parseDuration, formatDuration } from '../src/livelaps.js';

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

describe('parseDuration', () => {
  it('parses an HH:MM:SS.mmm string into seconds', () => {
    expect(parseDuration('00:44:39.165')).toBeCloseTo(2679.165, 3);
  });

  it('parses a sub-minute gap', () => {
    expect(parseDuration('00:00:23.151')).toBeCloseTo(23.151, 3);
  });

  it('treats an empty string (no gap, e.g. the leader) as zero', () => {
    expect(parseDuration('')).toBe(0);
  });
});

describe('formatDuration', () => {
  it('formats minutes:seconds under an hour', () => {
    expect(formatDuration(2679.165)).toBe('44:39');
  });

  it('formats a second example matching the class-leader gap', () => {
    expect(formatDuration(1588.18)).toBe('26:28');
  });

  it('formats zero seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('formats an hour-plus duration with an hours segment', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
