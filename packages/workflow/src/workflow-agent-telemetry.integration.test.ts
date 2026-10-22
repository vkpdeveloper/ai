/**
 * Integration tests for WorkflowAgent telemetry with globally registered
 * integrations (https://github.com/vercel/ai/issues/22378).
 *
 * Run with: pnpm test:integration
 */
import { OpenTelemetry } from '@ai-sdk/otel';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  AI_SDK_TELEMETRY_TRACING_CHANNEL,
  registerTelemetry,
  type ToolExecutionStartEvent,
  type ToolExecutionEndEvent,
} from 'ai';
import { tracingChannel } from 'node:diagnostics_channel';
import { beforeEach, describe, expect, it } from 'vitest';
import { start } from 'workflow/api';
import {
  agentGenerateWithGlobalTelemetry,
  agentStreamWithGlobalTelemetry,
  agentToolWithGlobalTelemetry,
} from './test/telemetry-workflows.js';

const exporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  }),
);

const events: string[] = [];
const spanContexts: unknown[] = [];
const eventContexts: unknown[] = [];
const callIds = new Set<string>();
const tracingChannelEvents: string[] = [];
const toolStarts: ToolExecutionStartEvent[] = [];
const toolEnds: ToolExecutionEndEvent[] = [];

registerTelemetry(
  new OpenTelemetry({
    enrichSpan: ({ runtimeContext }) => {
      spanContexts.push(runtimeContext);
      return undefined;
    },
  }),
  {
    onStart: event => {
      events.push('onStart');
      eventContexts.push(
        'runtimeContext' in event ? event.runtimeContext : undefined,
      );
      callIds.add(event.callId);
    },
    onStepStart: event => {
      events.push('onStepStart');
      eventContexts.push(
        'runtimeContext' in event ? event.runtimeContext : undefined,
      );
    },
    onLanguageModelCallStart: () =>
      void events.push('onLanguageModelCallStart'),
    onLanguageModelCallEnd: () => void events.push('onLanguageModelCallEnd'),
    onToolExecutionStart: event => {
      events.push('onToolExecutionStart');
      toolStarts.push(event);
    },
    onToolExecutionEnd: event => {
      events.push('onToolExecutionEnd');
      toolEnds.push(event);
    },
    onStepEnd: event => {
      events.push('onStepEnd');
      eventContexts.push(
        'runtimeContext' in event ? event.runtimeContext : undefined,
      );
    },
    onEnd: event => {
      events.push('onEnd');
      eventContexts.push(
        'runtimeContext' in event ? event.runtimeContext : undefined,
      );
    },
    executeLanguageModelCall: ({ execute }) => {
      events.push('executeLanguageModelCall');
      return execute();
    },
  },
);

tracingChannel(AI_SDK_TELEMETRY_TRACING_CHANNEL).subscribe({
  start: message =>
    void tracingChannelEvents.push((message as { type: string }).type),
  end: () => {},
  asyncStart: () => {},
  asyncEnd: () => {},
  error: () => {},
});

beforeEach(() => {
  exporter.reset();
  events.length = 0;
  spanContexts.length = 0;
  eventContexts.length = 0;
  callIds.clear();
  tracingChannelEvents.length = 0;
  toolStarts.length = 0;
  toolEnds.length = 0;
});

function getAiSpanNames() {
  return exporter
    .getFinishedSpans()
    .filter(span => span.instrumentationScope.name === 'gen_ai')
    .map(span => span.name);
}

const expectedEvents = [
  'onStart',
  'onStepStart',
  'onLanguageModelCallStart',
  'executeLanguageModelCall',
  'onLanguageModelCallEnd',
  'onStepEnd',
  'onEnd',
];

const expectedSpans = [
  'chat workflow-test-model',
  'step 1',
  'ai.workflowAgent.stream workflow-test-model',
];

describe('WorkflowAgent telemetry with global integrations', () => {
  it.each(['stream', 'generate'] as const)(
    '%s: exports telemetry for a durable tool',
    async mode => {
      const run = await start(agentToolWithGlobalTelemetry, [mode]);
      expect(await run.returnValue).toEqual({
        text: 'done',
        callbacks: ['start', 'success'],
        localEvents: [],
      });
      expect(events.filter(event => event.startsWith('onTool'))).toEqual([
        'onToolExecutionStart',
        'onToolExecutionEnd',
      ]);
      expect(getAiSpanNames()).toContain('execute_tool echo');
      expect(
        getAiSpanNames().filter(name => name.startsWith('chat ')),
      ).toHaveLength(2);
      expect(toolStarts).toHaveLength(1);
      expect(toolEnds).toHaveLength(1);
      expect(toolStarts[0].callId).toBe(toolEnds[0].callId);
      expect(toolStarts[0].callId).not.toBe('workflow-agent');
      expect(toolStarts[0].toolContext).toEqual({ visible: 'included' });
      expect(toolEnds[0].toolContext).toEqual({ visible: 'included' });
      expect(toolEnds[0].toolOutput).toMatchObject({
        type: 'tool-result',
        output: 'hello',
      });
      const span = exporter
        .getFinishedSpans()
        .find(span => span.name === 'execute_tool echo')!;
      const startMs = span.startTime[0] * 1000 + span.startTime[1] / 1e6;
      const durationMs = span.duration[0] * 1000 + span.duration[1] / 1e6;
      expect(startMs).toBe(toolStarts[0].startTime!.getTime());
      expect(durationMs).toBeCloseTo(toolEnds[0].toolExecutionMs, 3);
      expect(durationMs).toBeGreaterThanOrEqual(30);
      expect(span.attributes['gen_ai.tool.call.result']).toBe('"hello"');
      expect(events.indexOf('onToolExecutionEnd')).toBeLessThan(
        events.lastIndexOf('onLanguageModelCallStart'),
      );
    },
  );

  it.each(['stream', 'generate'] as const)(
    '%s: reports a failed durable tool',
    async mode => {
      const run = await start(agentToolWithGlobalTelemetry, [
        mode,
        { fail: true },
      ]);
      expect(await run.returnValue).toEqual({
        text: 'done',
        callbacks: ['start', 'error'],
        localEvents: [],
      });
      expect(toolEnds).toHaveLength(1);
      expect(toolEnds[0].toolOutput).toMatchObject({
        type: 'tool-error',
        error: 'FatalError: echo failed',
      });
      const span = exporter
        .getFinishedSpans()
        .find(span => span.name === 'execute_tool echo')!;
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
    },
  );

  it.each(['stream', 'generate'] as const)(
    '%s: respects disabled and local integrations',
    async mode => {
      for (const options of [{ disabled: true }, { local: true }]) {
        const run = await start(agentToolWithGlobalTelemetry, [mode, options]);
        expect(await run.returnValue).toEqual({
          text: 'done',
          callbacks: ['start', 'success'],
          localEvents:
            'local' in options
              ? ['start:workflow-agent:echo', 'end:tool-result']
              : [],
        });
        expect(toolStarts).toEqual([]);
        expect(toolEnds).toEqual([]);
        expect(getAiSpanNames()).toEqual([]);
      }
    },
  );

  it('respects recording and context inclusion settings', async () => {
    const run = await start(agentToolWithGlobalTelemetry, [
      'stream',
      { private: true },
    ]);
    await run.returnValue;
    expect(toolStarts[0].toolContext).toEqual({});
    expect(toolEnds[0].toolContext).toEqual({});
    const span = exporter
      .getFinishedSpans()
      .find(span => span.name === 'execute_tool echo')!;
    expect(span.attributes['gen_ai.tool.call.arguments']).toBeUndefined();
    expect(span.attributes['gen_ai.tool.call.result']).toBeUndefined();
  });

  it('keeps concurrent workflow tool calls separate', async () => {
    const runs = await Promise.all([
      start(agentToolWithGlobalTelemetry, ['stream']),
      start(agentToolWithGlobalTelemetry, ['generate']),
    ]);
    await Promise.all(runs.map(run => run.returnValue));
    expect(toolEnds).toHaveLength(2);
    expect(new Set(toolEnds.map(event => event.callId)).size).toBe(2);
    expect(
      getAiSpanNames().filter(name => name === 'execute_tool echo'),
    ).toHaveLength(2);
  });

  it('stream: dispatches model call telemetry from the model step', async () => {
    const run = await start(agentStreamWithGlobalTelemetry, ['hello']);

    expect(await run.returnValue).toEqual({
      text: 'Echo: hello',
      // the workflow body runs in an isolated realm without the registry
      integrationsInWorkflow: null,
      integrationsInStep: 2,
    });
    expect(events).toEqual(expectedEvents);
    expect([...callIds][0]).toMatch(/^call-/);
    expect(tracingChannelEvents).toContain('languageModelCall');
    expect(getAiSpanNames()).toEqual(expectedSpans);
  });

  it('generate: dispatches model call telemetry from the model step', async () => {
    const run = await start(agentGenerateWithGlobalTelemetry, ['hello']);

    expect(await run.returnValue).toEqual({ text: 'Echo: hello' });
    expect(events).toEqual(expectedEvents);
    expect(tracingChannelEvents).toContain('languageModelCall');
    expect(getAiSpanNames()).toEqual(expectedSpans);
  });

  it.each(['stream', 'generate'] as const)(
    '%s: includes only opted-in runtime context in model-step telemetry',
    async mode => {
      for (const includeTraceIdentity of [undefined, false, true]) {
        spanContexts.length = 0;
        eventContexts.length = 0;
        const run =
          mode === 'stream'
            ? await start(agentStreamWithGlobalTelemetry, [
                'hello',
                includeTraceIdentity,
              ])
            : await start(agentGenerateWithGlobalTelemetry, [
                'hello',
                includeTraceIdentity,
              ]);
        await run.returnValue;

        const expectedContext = includeTraceIdentity
          ? { traceIdentity: { sessionId: 'chat_1', userId: 'user_1' } }
          : {};
        expect(spanContexts).toEqual(Array(3).fill(expectedContext));
        expect(eventContexts).toEqual(Array(4).fill(expectedContext));
      }
    },
  );
});
