/**
 * Integration tests for WorkflowAgent telemetry with globally registered
 * integrations (https://github.com/vercel/ai/issues/22378).
 *
 * Run with: pnpm test:integration
 */
import { OpenTelemetry } from '@ai-sdk/otel';
import { trace } from '@opentelemetry/api';
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
  hydrateResourceIO,
  observabilityRevivers,
} from 'workflow/observability';
import { getWorld } from 'workflow/runtime';
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
const toolStarts: ToolExecutionStartEvent[] = [];
const toolEnds: ToolExecutionEndEvent[] = [];
const spanContexts: unknown[] = [];
const eventContexts: unknown[] = [];
const callIds = new Set<string>();
const tracingChannelEvents: string[] = [];

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
  toolStarts.length = 0;
  toolEnds.length = 0;
  events.length = 0;
  spanContexts.length = 0;
  eventContexts.length = 0;
  callIds.clear();
  tracingChannelEvents.length = 0;
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

describe('WorkflowAgent tool telemetry with global integrations', () => {
  it.each(['stream', 'generate'] as const)(
    '%s: exports a tool span with actual execution timing',
    async mode => {
      const run = await start(agentToolWithGlobalTelemetry, [mode]);
      const result = await run.returnValue;
      expect(result.text).toBe('Done');
      expect(toolStarts).toHaveLength(1);
      expect(toolEnds).toHaveLength(1);
      expect(toolStarts[0]).toMatchObject({
        toolCall: { toolName: 'echo', input: { text: 'hello' } },
        toolContext: {},
      });
      expect(toolEnds[0]).toMatchObject({
        callId: toolStarts[0].callId,
        toolOutput: { type: 'tool-result', output: { text: 'hello' } },
      });
      const span = exporter
        .getFinishedSpans()
        .find(span => span.name === 'execute_tool echo');
      expect(span).toBeDefined();
      const output = result.output?.output as {
        startedAt: number;
        finishedAt: number;
      };
      const spanStart = span!.startTime[0] * 1000 + span!.startTime[1] / 1e6;
      const spanEnd = span!.endTime[0] * 1000 + span!.endTime[1] / 1e6;
      expect(spanStart).toBeLessThanOrEqual(output.startedAt);
      expect(spanEnd).toBeGreaterThanOrEqual(output.finishedAt);
      expect(span!.attributes['gen_ai.execute_tool.duration']).toBe(
        toolEnds[0].toolExecutionMs / 1000,
      );
      expect(toolEnds[0].toolExecutionMs).toBeGreaterThanOrEqual(40);
      expect(
        getAiSpanNames().filter(name => name.startsWith('chat ')),
      ).toHaveLength(2);
    },
  );

  it.each(['stream', 'generate'] as const)(
    '%s: exports failed tool executions',
    async mode => {
      const run = await start(agentToolWithGlobalTelemetry, [mode, 'fail']);
      expect((await run.returnValue).text).toBe('Done');
      expect(toolEnds).toHaveLength(1);
      expect(toolEnds[0]).toMatchObject({
        toolOutput: {
          type: 'tool-error',
          error: expect.stringContaining('echo failed'),
        },
      });
      const span = exporter
        .getFinishedSpans()
        .find(span => span.name === 'execute_tool echo');
      expect(span?.status.code).toBe(2);
    },
  );

  it('respects telemetry opt-out', async () => {
    const run = await start(agentToolWithGlobalTelemetry, [
      'generate',
      'hello',
      false,
    ]);
    expect((await run.returnValue).text).toBe('Done');
    expect(toolStarts).toEqual([]);
    expect(toolEnds).toEqual([]);
    expect(getAiSpanNames()).toEqual([]);
  });

  it('only passes opted-in tool context to integrations', async () => {
    const run = await start(agentToolWithGlobalTelemetry, [
      'generate',
      'hello',
      true,
      true,
    ]);
    await run.returnValue;
    expect(toolStarts[0].toolContext).toEqual({ requestId: 'request-1' });
    expect(toolEnds[0].toolContext).toEqual({ requestId: 'request-1' });
    expect(JSON.stringify([toolStarts, toolEnds])).not.toContain('tool-secret');
  });

  it.each(['stream', 'generate'] as const)(
    '%s: reports tools resumed after approval',
    async mode => {
      const run = await start(agentToolWithGlobalTelemetry, [
        mode,
        'hello',
        true,
        false,
        true,
      ]);
      expect((await run.returnValue).text).toBe('Done');
      expect(toolStarts).toHaveLength(1);
      expect(toolEnds).toHaveLength(1);
      expect(toolEnds[0]).toMatchObject({
        toolCall: { toolCallId: 'approved-call' },
        toolOutput: { type: 'tool-result' },
      });
      expect(getAiSpanNames()).toContain('execute_tool echo');
    },
  );

  it('isolates concurrent runs that reuse a provider tool call ID', async () => {
    const runs = await Promise.all([
      start(agentToolWithGlobalTelemetry, ['generate', 'first']),
      start(agentToolWithGlobalTelemetry, ['generate', 'second']),
    ]);
    await Promise.all(runs.map(run => run.returnValue));
    expect(toolStarts).toHaveLength(2);
    expect(new Set(toolStarts.map(event => event.callId)).size).toBe(2);
    expect(toolEnds.map(event => event.callId).sort()).toEqual(
      toolStarts.map(event => event.callId).sort(),
    );
    const spans = exporter
      .getFinishedSpans()
      .filter(span => span.name === 'execute_tool echo');
    expect(spans).toHaveLength(2);
    expect(
      spans.map(span => span.attributes['gen_ai.tool.call.result']),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('first'),
        expect.stringContaining('second'),
      ]),
    );
  });

  it('does not cross the telemetry step boundary with unselected tool context', async () => {
    const run = await start(agentToolWithGlobalTelemetry, [
      'generate',
      'hello',
      true,
      true,
    ]);
    await run.returnValue;
    const steps = await (
      await getWorld()
    ).steps.list({ runId: run.runId, resolveData: 'all' });
    const telemetrySteps = steps.data.filter(step =>
      step.stepName.includes('recordToolExecutionTelemetry'),
    );
    expect(telemetrySteps).toHaveLength(1);
    const input = hydrateResourceIO(
      telemetrySteps[0],
      observabilityRevivers,
    ).input;
    expect(JSON.stringify(input)).toContain('request-1');
    expect(JSON.stringify(input)).not.toContain('tool-secret');
  });

  it('respects explicit per-call integration overrides', async () => {
    const run = await start(agentToolWithGlobalTelemetry, [
      'generate',
      'hello',
      true,
      false,
      false,
      true,
    ]);
    expect((await run.returnValue).text).toBe('Done');
    expect(toolStarts).toEqual([]);
    expect(toolEnds).toEqual([]);
    expect(getAiSpanNames()).toEqual([]);
    const steps = await (await getWorld()).steps.list({ runId: run.runId });
    expect(
      steps.data.some(step =>
        step.stepName.includes('recordToolExecutionTelemetry'),
      ),
    ).toBe(false);
  });

  it('exports tool telemetry from the built package inside a durable workflow', async () => {
    const run = await start(agentToolWithGlobalTelemetry, [
      'generate',
      'hello',
      true,
      false,
      false,
      false,
      true,
    ]);
    expect((await run.returnValue).text).toBe('Done');
    expect(toolStarts).toHaveLength(1);
    expect(toolEnds).toHaveLength(1);
    expect(getAiSpanNames()).toContain('execute_tool echo');
    expect(
      getAiSpanNames().filter(name => name.startsWith('chat ')),
    ).toHaveLength(2);
  });
});
