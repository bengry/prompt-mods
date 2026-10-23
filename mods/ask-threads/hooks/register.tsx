import type { EngineInterface, ModelCompleteResult, Register } from 'claude-code';
import { atom, read, update } from 'claude-code';

import type { Exchange } from '../types';
import { askRequest, parseArgs } from './args';
import { describeFailure } from './failure';
import { forkPrompt, pulledContext } from './prompts';

const PANE = 'ask-threads';
const threads = atom({ plugin: 'ask-threads', key: 'threads' } as const, []);
const openId = atom({ plugin: 'ask-threads', key: 'openId' } as const, null);
const busy = atom({ plugin: 'ask-threads', key: 'busy' } as const, []);
const pulled = atom({ plugin: 'ask-threads', key: 'pulled' } as const, []);

const preview = (text: string, width: number): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > width ? `${line.slice(0, width - 1)}…` : line;
};

const show = async ($: EngineInterface, id: number | null): Promise<void> => {
  await update($, openId, () => id);
  await $.ui.open({ id: PANE, title: 'aside', focus: true });
};

// Adds the question to the thread and asks the fork, on a timer of its own so
// the answer lands even after the dispatch that asked has ended.
const ask = async ($: EngineInterface, id: number, question: string): Promise<void> => {
  const earlier = (await read($, threads)).find((t) => t.id === id)?.exchanges ?? [];
  await update($, threads, (all) => all.map((t) => (t.id === id ? { ...t, exchanges: [...t.exchanges, { question, answer: null }] } : t)));
  await update($, busy, (ids) => [...ids, id]);
  $.clock.after(0, () => void answer($, id, question, earlier));
};

// The main chat has nothing to fork until its first reply, so until then the question goes to the session's model on its own.
const askModel = async ($: EngineInterface, prompt: string): Promise<ModelCompleteResult> => {
  const forked = await $.model.fork({ prompt });

  if (forked.isAnswered || forked.reason !== 'nothing-to-fork') {
    return forked;
  }

  const model = await $.session.model();
  const completed = await $.model.complete({ model, prompt, maxTokens: 4096 });
  return completed;
};

const answer = async ($: EngineInterface, id: number, question: string, earlier: readonly Exchange[]): Promise<void> => {
  const reply = await askModel($, forkPrompt(earlier, question));
  const exchange: Exchange = reply.isAnswered ? { question, answer: reply.text } : { question, answer: null, error: describeFailure(reply) };
  await update($, threads, (all) => all.map((t) => (t.id === id ? { ...t, exchanges: [...t.exchanges.slice(0, -1), exchange] } : t)));
  await update($, busy, (ids) => ids.filter((one) => one !== id));
};

const startThread = async ($: EngineInterface, question: string): Promise<number> => {
  const list = await read($, threads);
  const id = list.reduce((max, t) => Math.max(max, t.id), 0) + 1;
  const startedAt = await $.clock.now();
  await update($, threads, (all) => [...all, { id, startedAt, exchanges: [] }]);
  await show($, id);
  await ask($, id, question);
  return id;
};

const pull = async ($: EngineInterface, id: number): Promise<void> => {
  const ids = await update($, pulled, (all) => (all.includes(id) ? all : [...all, id]));
  $.ui.status(`aside ${ids.map((one) => `#${one}`).join(' ')} attached to your next message`);
};

// A pulled thread rides along with the next prompt, unseen in the transcript.
const takePulled = async ($: EngineInterface): Promise<string[]> => {
  const ids = await read($, pulled);
  if (ids.length === 0) {
    return [];
  }

  const all = await read($, threads);
  const context = all.filter((t) => ids.includes(t.id)).map(pulledContext);
  await update($, pulled, () => []);
  $.ui.status(undefined);
  $.ui.log(`▸ aside ${ids.map((id) => `#${id}`).join(' ')} sent along with this message`);
  return context;
};

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'aside',
      description: 'Side question that stays out of the main conversation; /aside list to reopen one',
      argumentHint: '[<question> | list | N <follow-up> | pull N | drop N]',
      immediate: true,
    });

    return next(e);
  });

  on('command.run', { command: 'aside' }, async ($, e) => {
    const action = parseArgs(e.args);
    const list = await read($, threads);

    if (action.kind === 'toggle') {
      const isOpen = (await $.ui.panes()).some((pane) => pane.id === PANE);
      await (isOpen ? $.ui.close({ id: PANE }) : $.ui.open({ id: PANE, title: 'aside', focus: true }));
      return {};
    }

    if (action.kind === 'list') {
      await show($, null);
      return {};
    }

    if (action.kind === 'ask') {
      await startThread($, action.question);
      return {};
    }

    const thread = list.find((t) => t.id === action.id);
    if (thread === undefined) {
      return { text: `No aside thread #${action.id}. /aside list shows them.` };
    }

    switch (action.kind) {
      case 'open':
        await show($, thread.id);
        return {};
      case 'follow':
        await show($, thread.id);
        await ask($, thread.id, action.question);
        return {};
      case 'pull':
        await pull($, thread.id);
        return { text: `aside #${thread.id} goes to Claude with your next message.` };
      case 'drop':
        await update($, threads, (all) => all.filter((t) => t.id !== thread.id));
        await update($, pulled, (ids) => ids.filter((one) => one !== thread.id));
        await update($, openId, (id) => (id === thread.id ? null : id));
        return { text: `Dropped aside #${thread.id}.` };
    }
  });

  on('prompt.submit', async ($, e, next) => {
    const isTyped = e.command === undefined && e.isMeta === undefined;
    const question = isTyped ? askRequest(e.text) : null;
    if (question !== null) {
      const id = await startThread($, question);
      return { drop: `Asked on the side as #${id} · /aside list shows it` };
    }

    const context = await takePulled($);
    if (context.length === 0) {
      return next(e);
    }

    return next({ ...e, context: [...(e.context ?? []), ...context] });
  });

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e);
    const { Box, Text, Button, Markdown } = elements;
    // Mobile draws no field: the follow-up is typed as /aside N there.
    const Input = 'Input' in elements ? elements.Input : null;
    const all = await read($, threads);
    const id = await read($, openId);
    const waiting = await read($, busy);
    const attached = await read($, pulled);
    const thread = all.find((t) => t.id === id);
    const width = Math.max(20, (e.viewport?.columns ?? 80) - 16);

    if (thread === undefined) {
      return (
        <Box flexDirection="column">
          {all.length === 0 && <Text dimColor>No side questions yet. /aside &lt;question&gt; asks one.</Text>}
          {all.map((t) => {
            const question = preview(t.exchanges[0]?.question ?? '', width);
            const attachedMark = attached.includes(t.id) ? '  ✓ attached' : '';

            return (
              <Button
                key={`t${t.id}`}
                plain
                label={`#${t.id}  ${question}  (${t.exchanges.length})${attachedMark}`}
                onPress={() => update($, openId, () => t.id)}
              />
            );
          })}
          {all.length > 0 && <Text dimColor>/aside N &lt;follow-up&gt; · /aside pull N · /aside drop N</Text>}
        </Box>
      );
    }

    const isBusy = waiting.includes(thread.id);
    const isAttached = attached.includes(thread.id);

    return (
      <Box flexDirection="column">
        <Box>
          <Button key="back" plain hotkey="t" label="‹ threads" onPress={() => update($, openId, () => null)} />
          <Text dimColor> / #{thread.id}</Text>
        </Box>
        {thread.exchanges.map((x, i) => (
          <Box key={`x${i}`} flexDirection="column" marginBottom={1}>
            <Text bold>› {x.question}</Text>
            {x.answer !== null && <Markdown text={x.answer} />}
            {x.answer === null && x.error !== undefined && <Text color="red">No answer: {x.error}</Text>}
            {x.answer === null && x.error === undefined && <Text dimColor>thinking…</Text>}
          </Box>
        ))}
        {!isBusy && Input === null && <Text dimColor>/aside {thread.id} &lt;follow-up&gt; to continue</Text>}
        {!isBusy && Input !== null && (
          <Input
            key="follow"
            placeholder={`Follow up on #${thread.id}…`}
            autoFocus
            onSubmit={(value: string) => {
              const question = value.trim();
              if (question !== '') {
                void ask($, thread.id, question);
              }
            }}
          />
        )}
        {isAttached ? (
          <Text color="green">✓ attached to your next message</Text>
        ) : (
          <Button key="pull" label="Send to main chat" onPress={() => void pull($, thread.id)} />
        )}
      </Box>
    );
  });
};
