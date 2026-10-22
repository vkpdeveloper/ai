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
import { AI_SDK_TELEMETRY_TRACING_CHANNEL, registerTelemetry } from 'ai';
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
const toolEvents: Array<{
  callId: string;
  toolCall: { toolCallId: string };
}> = [];

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
    onToolExecutionStart: event => {
      events.push('onToolExecutionStart');
      toolEvents.push(event);
    },
    onToolExecutionEnd: event => {
      events.push('onToolExecutionEnd');
      toolEvents.push(event);
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
  toolEvents.length = 0;
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
    '%s: exports a tool span with the measured execution interval',
    async mode => {
      const run = await start(agentToolWithGlobalTelemetry, [mode]);
      const result = await run.returnValue;
      expect(result).toMatchObject({
        text: 'done',
        callbacks: ['start', 'success'],
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(30);
      expect(events).toEqual([
        ...expectedEvents,
        'onToolExecutionStart',
        'onToolExecutionEnd',
        ...expectedEvents,
      ]);
      expect(toolEvents).toEqual([
        expect.objectContaining({
          callId: expect.any(String),
          startTime: expect.any(Number),
          toolCall: expect.objectContaining({
            toolName: 'echo',
            input: { text: 'hello' },
          }),
          toolContext: { public: 'visible' },
          functionId: 'tool-telemetry-test',
        }),
        expect.objectContaining({
          callId: expect.any(String),
          toolExecutionMs: result.durationMs,
          toolOutput: expect.objectContaining({
            type: 'tool-result',
            output: 'hello',
          }),
          toolContext: { public: 'visible' },
        }),
      ]);
      expect(toolEvents[0].callId).toBe(toolEvents[1].callId);
      expect(toolEvents[0].callId).toMatch(/^call-/);
      const spans = exporter
        .getFinishedSpans()
        .filter(span => span.name === 'execute_tool echo');
      expect(spans).toHaveLength(1);
      const span = spans[0];
      const toMs = ([seconds, nanos]: [number, number]) =>
        seconds * 1000 + nanos / 1e6;
      expect(toMs(span.duration)).toBeCloseTo(result.durationMs, 3);
      expect(toMs(span.startTime)).toBeGreaterThanOrEqual(result.before);
      expect(span.attributes).toMatchObject({
        'gen_ai.tool.call.arguments': '{"text":"hello"}',
        'gen_ai.tool.call.result': '"hello"',
        'gen_ai.execute_tool.duration': result.durationMs / 1000,
      });
    },
  );

  it.each(['stream', 'generate'] as const)(
    '%s: records failed tool execution and lets the agent recover',
    async mode => {
      const run = await start(agentToolWithGlobalTelemetry, [mode, 'fail']);
      const result = await run.returnValue;
      expect(result).toMatchObject({
        text: 'done',
        callbacks: ['start', 'error'],
      });
      expect(toolEvents).toHaveLength(2);
      expect(toolEvents[1]).toMatchObject({
        toolExecutionMs: result.durationMs,
        toolOutput: { type: 'tool-error', error: 'FatalError: echo failed' },
      });
      const spans = exporter
        .getFinishedSpans()
        .filter(span => span.name === 'execute_tool echo');
      expect(spans).toHaveLength(1);
      expect(spans[0].status).toMatchObject({ code: SpanStatusCode.ERROR });
    },
  );

  it.each(['disabled', 'local'] as const)(
    'does not dispatch global tool telemetry when telemetry is %s',
    async telemetryMode => {
      const run = await start(agentToolWithGlobalTelemetry, [
        'generate',
        'hello',
        telemetryMode,
      ]);
      expect(await run.returnValue).toMatchObject({
        text: 'done',
        callbacks: ['start', 'success'],
      });
      expect(events).toEqual([]);
      expect(getAiSpanNames()).toEqual([]);
    },
  );

  it('honors input and output recording settings for tool spans', async () => {
    const run = await start(agentToolWithGlobalTelemetry, [
      'generate',
      'hello',
      'redacted',
    ]);
    await run.returnValue;
    const span = exporter
      .getFinishedSpans()
      .find(span => span.name === 'execute_tool echo');
    expect(span).toBeDefined();
    expect(span!.attributes['gen_ai.tool.call.arguments']).toBeUndefined();
    expect(span!.attributes['gen_ai.tool.call.result']).toBeUndefined();
  });

  it('separates concurrent invocations that reuse model tool-call IDs', async () => {
    const runs = await Promise.all([
      start(agentToolWithGlobalTelemetry, ['generate', 'first']),
      start(agentToolWithGlobalTelemetry, ['generate', 'second']),
    ]);
    await Promise.all(runs.map(run => run.returnValue));
    expect(toolEvents).toHaveLength(4);
    expect(new Set(toolEvents.map(event => event.callId)).size).toBe(2);
    expect(
      new Set(toolEvents.map(event => event.toolCall.toolCallId)).size,
    ).toBe(1);
    const spans = exporter
      .getFinishedSpans()
      .filter(span => span.name === 'execute_tool echo');
    expect(
      spans.map(span => span.attributes['gen_ai.tool.call.result']).sort(),
    ).toEqual(['"first"', '"second"']);
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
