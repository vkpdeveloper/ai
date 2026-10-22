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
  type Telemetry,
} from 'ai';
import { waitForHook } from '@workflow/vitest';
import { tracingChannel } from 'node:diagnostics_channel';
import { beforeEach, describe, expect, it } from 'vitest';
import { resumeHook, start } from 'workflow/api';
import {
  hydrateResourceIO,
  observabilityRevivers,
} from 'workflow/observability';
import { getWorld } from 'workflow/runtime';
import {
  agentGenerateWithGlobalTelemetry,
  agentStreamWithGlobalTelemetry,
  agentWithToolTelemetry,
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
const toolStarts: Parameters<
  NonNullable<Telemetry['onToolExecutionStart']>
>[0][] = [];
const toolEnds: Parameters<NonNullable<Telemetry['onToolExecutionEnd']>>[0][] =
  [];

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
      toolStarts.push(event);
    },
    onToolExecutionEnd: event => {
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
    '%s: exports a span for a durable tool execution',
    async mode => {
      const run = await start(agentWithToolTelemetry, [mode]);
      expect(await run.returnValue).toEqual({
        text: 'Done.',
        callbacks: ['start', 'success'],
      });
      const spans = exporter.getFinishedSpans();
      const toolSpans = spans.filter(span => span.name === 'execute_tool echo');
      expect(toolSpans).toHaveLength(1);
      expect(
        spans.filter(span => span.name === 'chat workflow-test-model'),
      ).toHaveLength(2);
      expect(toolStarts).toHaveLength(1);
      expect(toolEnds).toHaveLength(1);
      const [startEvent] = toolStarts;
      const [endEvent] = toolEnds;
      expect(startEvent.callId).toBe(endEvent.callId);
      expect(startEvent.callId).toMatch(/^call-/);
      expect(endEvent.toolExecutionMs).toBeGreaterThanOrEqual(50);
      expect(endEvent.toolOutput).toMatchObject({
        type: 'tool-result',
        output: { text: 'hello' },
      });
      expect(startEvent.toolContext).toEqual({});
      expect(endEvent.toolContext).toEqual({});
      const [span] = toolSpans;
      const toMs = ([seconds, nanos]: [number, number]) =>
        seconds * 1000 + nanos / 1e6;
      expect(toMs(span.duration)).toBeCloseTo(endEvent.toolExecutionMs, 3);
      expect(toMs(span.startTime)).toBeCloseTo(
        startEvent.timestamp!.getTime(),
        3,
      );
      expect(toMs(span.endTime)).toBeCloseTo(endEvent.timestamp!.getTime(), 3);
      expect(span.attributes['gen_ai.execute_tool.duration']).toBe(
        endEvent.toolExecutionMs / 1000,
      );
      expect(span.attributes['gen_ai.tool.call.arguments']).toBe(
        '{"text":"hello"}',
      );
      expect(
        JSON.parse(span.attributes['gen_ai.tool.call.result'] as string),
      ).toMatchObject({ text: 'hello' });
    },
  );

  it.each(['stream', 'generate'] as const)(
    '%s: records failed tools and continues generation',
    async mode => {
      const run = await start(agentWithToolTelemetry, [mode, 'error']);
      expect(await run.returnValue).toEqual({
        text: 'Done.',
        callbacks: ['start', 'error'],
      });
      expect(toolEnds).toHaveLength(1);
      expect(toolEnds[0].toolOutput).toMatchObject({
        type: 'tool-error',
        error: expect.stringContaining('echo failed'),
      });
      const span = exporter
        .getFinishedSpans()
        .find(span => span.name === 'execute_tool echo');
      expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    },
  );

  it.each([false, true])(
    'filters context before persisting tool telemetry (include: %s)',
    async includeContext => {
      const run = await start(agentWithToolTelemetry, [
        'generate',
        'success',
        includeContext,
      ]);
      await run.returnValue;
      const expectedContext = includeContext ? { visible: 'tool-value' } : {};
      expect(toolStarts[0].toolContext).toEqual(expectedContext);
      expect(toolEnds[0].toolContext).toEqual(expectedContext);
      const page = await (
        await getWorld()
      ).steps.list({ runId: run.runId, resolveData: 'all' });
      const telemetryStep = page.data.find(step =>
        step.stepName.includes('recordToolExecutionTelemetry'),
      )!;
      expect(telemetryStep).toBeDefined();
      const persisted = hydrateResourceIO(telemetryStep, observabilityRevivers);
      const input = (
        persisted.input as unknown as { args: [{ runtimeContext: unknown }] }
      ).args[0];
      expect(input.runtimeContext).toEqual(
        includeContext ? { visible: 'runtime-value' } : {},
      );
      expect(JSON.stringify(input)).not.toContain('secret-runtime');
      expect(JSON.stringify(input)).not.toContain('secret-tool');
    },
  );

  it.each(['disabled', 'local'] as const)(
    'respects %s telemetry settings',
    async setting => {
      const run = await start(agentWithToolTelemetry, [
        'generate',
        'success',
        false,
        setting === 'disabled' ? false : undefined,
        true,
        setting === 'local',
      ]);
      expect(await run.returnValue).toEqual({
        text: 'Done.',
        callbacks: ['start', 'success'],
      });
      expect(toolStarts).toEqual([]);
      expect(toolEnds).toEqual([]);
      expect(getAiSpanNames()).toEqual([]);
      const page = await (await getWorld()).steps.list({ runId: run.runId });
      expect(
        page.data.some(step =>
          step.stepName.includes('recordToolExecutionTelemetry'),
        ),
      ).toBe(false);
    },
  );

  it('respects input and output recording opt-outs', async () => {
    const run = await start(agentWithToolTelemetry, [
      'generate',
      'success',
      false,
      undefined,
      false,
    ]);
    await run.returnValue;
    const span = exporter
      .getFinishedSpans()
      .find(span => span.name === 'execute_tool echo');
    expect(span).toBeDefined();
    expect(span!.attributes['gen_ai.tool.call.arguments']).toBeUndefined();
    expect(span!.attributes['gen_ai.tool.call.result']).toBeUndefined();
  });

  it('reports a suspended tool once after resuming the workflow', async () => {
    const run = await start(agentWithToolTelemetry, ['generate', 'suspend']);
    const hook = await waitForHook(run);
    expect(toolEnds).toEqual([]);
    await resumeHook(hook.token, 'continue');
    expect(await run.returnValue).toEqual({
      text: 'Done.',
      callbacks: ['start', 'success'],
    });
    expect(toolStarts).toHaveLength(1);
    expect(toolEnds).toHaveLength(1);
    expect(
      getAiSpanNames().filter(name => name === 'execute_tool echo'),
    ).toHaveLength(1);
  });

  it('closes the tool span when output conversion throws', async () => {
    const run = await start(agentWithToolTelemetry, [
      'generate',
      'output-error',
    ]);
    await expect(run.returnValue).rejects.toThrow('output conversion failed');
    expect(toolEnds).toHaveLength(1);
    expect(toolEnds[0].toolOutput).toMatchObject({
      type: 'tool-error',
      error: { message: 'output conversion failed' },
    });
    const span = exporter
      .getFinishedSpans()
      .find(span => span.name === 'execute_tool echo');
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('isolates telemetry for concurrent runs with the same model tool call ID', async () => {
    const runs = await Promise.all([
      start(agentWithToolTelemetry, ['generate']),
      start(agentWithToolTelemetry, ['generate']),
    ]);
    await Promise.all(runs.map(run => run.returnValue));
    expect(toolStarts).toHaveLength(2);
    expect(toolEnds).toHaveLength(2);
    expect(new Set(toolStarts.map(event => event.callId)).size).toBe(2);
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
