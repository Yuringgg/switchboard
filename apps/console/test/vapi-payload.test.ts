import { describe, expect, it } from 'vitest';

import { toolArgsOf, toolNameOf } from '../src/lib/voice/payload';

/**
 * Reading a tool call out of Vapi's payload.
 *
 * ⚠ These tests exist because of a real evening lost. Vapi's docs show a flat
 * `{ id, name, arguments }`; the live API sends OpenAI's
 * `{ id, type, function: { name, arguments: "<json string>" } }`.
 *
 * The route read the documented shape, so `name` was `undefined` and the
 * allowlist rejected EVERY tool identically — and the caller heard the same
 * sentence they would have heard if the database were down. Nothing else was
 * wrong: signature verified, tenant resolved, data present.
 *
 * Both shapes are pinned here so the next payload change fails a test instead
 * of a phone call.
 */

describe('toolNameOf', () => {
  it('reads the nested name the live API actually sends', () => {
    // The shape that was broken. This is the one that matters.
    expect(
      toolNameOf({
        id: 'call_1',
        type: 'function',
        function: { name: 'get_recent_messages', arguments: '{}' },
      }),
    ).toBe('get_recent_messages');
  });

  it('reads the flat name from the documented shape', () => {
    expect(toolNameOf({ id: 'call_1', name: 'get_attention_items' })).toBe(
      'get_attention_items',
    );
  });

  it('prefers the nested name when a payload carries both', () => {
    // Nested is what the live API sends, so it wins. Preferring the documented
    // field would pick the wrong one on a payload carrying both.
    expect(
      toolNameOf({
        id: 'call_1',
        name: 'stale',
        function: { name: 'get_recent_messages' },
      }),
    ).toBe('get_recent_messages');
  });

  it('returns an empty string when no name is present', () => {
    /*
     * ⚠ The exact observation that found the bug. An empty name recorded in
     * `voice_call_sessions.last_tool_name` is what said "the payload shape
     * changed", where a missing row would have said nothing at all.
     */
    expect(toolNameOf({ id: 'call_1' })).toBe('');
  });

  it('trims a padded name rather than failing the allowlist on whitespace', () => {
    expect(toolNameOf({ id: 'call_1', function: { name: ' search_messages ' } })).toBe(
      'search_messages',
    );
  });
});

describe('toolArgsOf', () => {
  it('parses arguments sent as a JSON string', () => {
    // The second half of the same bug: even with the right name, every argument
    // would have read as empty.
    expect(
      toolArgsOf({
        id: 'call_1',
        function: { name: 'search_messages', arguments: '{"query":"deadline"}' },
      }),
    ).toEqual({ query: 'deadline' });
  });

  it('accepts arguments already given as an object', () => {
    expect(
      toolArgsOf({ id: 'call_1', name: 'search_messages', arguments: { query: 'deadline' } }),
    ).toEqual({ query: 'deadline' });
  });

  it('returns an empty object when there are no arguments', () => {
    // get_attention_items takes none, and that is not an error.
    expect(toolArgsOf({ id: 'call_1', function: { name: 'get_attention_items' } })).toEqual({});
  });

  it('degrades to no arguments on malformed JSON instead of throwing', () => {
    /*
     * ⚠ A throw here would fail the whole batch and leave the caller in
     * silence, which is the worst outcome available on a voice call. Empty lets
     * the tool say what it needs.
     */
    expect(
      toolArgsOf({ id: 'call_1', function: { name: 'search_messages', arguments: '{not json' } }),
    ).toEqual({});
  });

  it('refuses a JSON array, which is not an argument object', () => {
    expect(
      toolArgsOf({ id: 'call_1', function: { name: 'search_messages', arguments: '["a","b"]' } }),
    ).toEqual({});
  });

  it('refuses a JSON scalar', () => {
    expect(
      toolArgsOf({ id: 'call_1', function: { name: 'search_messages', arguments: '"deadline"' } }),
    ).toEqual({});
  });
});
