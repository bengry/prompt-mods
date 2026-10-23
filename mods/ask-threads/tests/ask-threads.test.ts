import { describe, expect, mock, test } from 'claude-code/testing';

import { askRequest, parseArgs } from '../hooks/args';
import { describeFailure } from '../hooks/failure';
import { forkPrompt } from '../hooks/prompts';

describe('parseArgs', () => {
  test('reads list, ask, open, follow-up, pull and drop', () => {
    expect(parseArgs('')).toEqual({ kind: 'list' });
    expect(parseArgs('list')).toEqual({ kind: 'list' });
    expect(parseArgs('why is the sky blue?')).toEqual({ kind: 'ask', question: 'why is the sky blue?' });
    expect(parseArgs('3')).toEqual({ kind: 'open', id: 3 });
    expect(parseArgs('#3 and at night?')).toEqual({ kind: 'follow', id: 3, question: 'and at night?' });
    expect(parseArgs('pull 2')).toEqual({ kind: 'pull', id: 2 });
    expect(parseArgs('drop #2')).toEqual({ kind: 'drop', id: 2 });
  });

  test('a question that starts with a verb is still a question', () => {
    expect(parseArgs('pull requests: how many are open?').kind).toBe('ask');
    expect(parseArgs('list the TODOs')).toEqual({ kind: 'ask', question: 'list the TODOs' });
  });
});

test('a message ending in /aside is a side question', () => {
  expect(askRequest('why is the cache cold /aside')).toBe('why is the cache cold');
  expect(askRequest('why is the cache cold?\n/aside  ')).toBe('why is the cache cold?');
  expect(askRequest('what does /aside do in this repo?')).toBe(null);
  expect(askRequest('see mods/aside')).toBe(null);
  expect(askRequest('/aside')).toBe(null);
});

test('a follow-up carries the thread so far', () => {
  const prompt = forkPrompt([{ question: 'what is X?', answer: 'X is Y.' }], 'and Z?');
  expect(prompt).toContain('Q: what is X?\nA: X is Y.');
  expect(prompt).toContain('Follow-up: and Z?');
});

const composer = { kind: 'composer' } as const;
const presentation = { layout: 'main', columns: 100 } as never;
const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

test('/aside asks the fork, files the answer, and opens the pane', async ($, on) => {
  const clock = mock.clock(on);
  const asked: string[] = [];
  const opened: string[] = [];
  on('model.fork', ($, e) => {
    asked.push(e.prompt);
    return { value: { isAnswered: true, text: 'Because of Rayleigh scattering.', usage } };
  });
  on('ui.open', ($, e) => {
    opened.push(e.id);
    return { value: { isPlaced: true as const } };
  });

  const ran = await $.command.run({ command: 'aside', args: 'why is the sky blue?', origin: composer, presentation });
  await clock.settle();

  expect(ran.text).toBe(undefined);
  expect(opened).toEqual(['ask-threads']);
  expect(asked[0]).toContain('why is the sky blue?');
});

test('a pulled thread rides along with the next prompt', async ($, on) => {
  const clock = mock.clock(on);
  const contexts: (readonly string[] | undefined)[] = [];
  on('model.fork', () => ({ value: { isAnswered: true, text: 'Blue.', usage } }));
  on('ui.open', () => ({ value: { isPlaced: true as const } }));
  on('prompt.submit', ($, e) => {
    contexts.push(e.context);
    return { text: e.text };
  });

  await $.command.run({ command: 'aside', args: 'sky colour?', origin: composer, presentation });
  await clock.settle();
  await $.command.run({ command: 'aside', args: 'pull 1', origin: composer, presentation });
  await $.prompt.submit({ text: 'go on', wait: false, origin: composer });
  await $.prompt.submit({ text: 'and again', wait: false, origin: composer });

  expect(contexts[0]?.[0]).toContain('side thread #1');
  expect(contexts[1]).toBe(undefined);
});

test('an unknown thread number says so', async ($) => {
  const ran = await $.command.run({ command: 'aside', args: '9 more?', origin: composer, presentation });
  expect(ran.text).toBe('No aside thread #9. /aside list shows them.');
});

test('before the main chat has replied, /aside is answered by the session model without the transcript', async ($, on) => {
  const clock = mock.clock(on);
  const completed: { model: string; prompt: string }[] = [];
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' as const } }));
  on('session.model', () => ({ value: 'claude-opus-5-5' }));
  on('model.complete', ($, e) => {
    completed.push({ model: e.model, prompt: e.prompt });
    return { value: { isAnswered: true, text: 'Yes, I am working.', usage } };
  });
  on('ui.open', () => ({ value: { isPlaced: true as const } }));

  await $.command.run({ command: 'aside', args: 'are you working', origin: composer, presentation });
  await clock.settle();

  expect(completed).toHaveLength(1);
  expect(completed[0]?.model).toBe('claude-opus-5-5');
  expect(completed[0]?.prompt).toContain('are you working');
});

test('a failed answer names its cause in words', () => {
  expect(describeFailure({ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage })).toBe(
    'the API returned 529 (overloaded)',
  );
  expect(describeFailure({ isAnswered: false, reason: 'api-error', status: null, error: 'unknown', usage })).toBe(
    'no response from the API (unknown)',
  );
  expect(describeFailure({ isAnswered: false, reason: 'empty-reply', usage })).toBe('the model replied without any text');
  expect(describeFailure({ isAnswered: false, reason: 'aborted', usage })).toBe('the request was cancelled');
});

test('a message ending in /aside goes to a side thread, not the main chat', async ($, on) => {
  const clock = mock.clock(on);
  const asked: string[] = [];
  let sent = 0;
  on('model.fork', ($, e) => {
    asked.push(e.prompt);
    return { value: { isAnswered: true, text: 'Cold start.', usage } };
  });
  on('ui.open', () => ({ value: { isPlaced: true as const } }));
  on('prompt.submit', ($, e) => {
    sent += 1;
    return { text: e.text };
  });

  const result = await $.prompt.submit({ text: 'why is the cache cold /aside', wait: false, origin: composer });
  await clock.settle();

  expect(result.drop).toBe('Asked on the side as #1 · /aside list shows it');
  expect(sent).toBe(0);
  expect(asked[0]).toContain('why is the cache cold');

  await $.prompt.submit({ text: 'what does /aside do?', wait: false, origin: composer });
  expect(sent).toBe(1);
});
