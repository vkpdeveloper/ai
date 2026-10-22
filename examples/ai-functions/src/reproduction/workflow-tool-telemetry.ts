/**
 * Run from examples/ai-functions:
 *   pnpm tsx src/reproduction/workflow-tool-telemetry.ts
 *
 * Build workspace packages first. Uses the workflow package's local harness
 * and echo workflow so the reproduction crosses a real workflow/step boundary
 * without a server, API key, or test runner.
 * Expected per run: two chat spans and one execute_tool echo span.
 */
import { OpenTelemetry } from '@ai-sdk/otel';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { registerTelemetry } from 'ai';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from 'workflow/api';
import {
  buildWorkflowTests,
  getWorkflowRef,
  setupWorkflowTests,
  teardownWorkflowTests,
} from '../../../../packages/workflow/node_modules/@workflow/vitest/dist/index.js';
import { run } from '../lib/run';

run(async () => {
  const cwd = fileURLToPath(
    new URL('../../../../packages/workflow', import.meta.url),
  );
  const originalCwd = process.cwd();
  process.chdir(cwd);
  const rootDir = await mkdtemp(join(cwd, '.workflow-reproduction-'));
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();
  const events: string[] = [];
  registerTelemetry(new OpenTelemetry(), {
    onToolExecutionStart: () => {
      events.push('start');
    },
    onToolExecutionEnd: () => {
      events.push('end');
    },
  });

  try {
    await buildWorkflowTests({ cwd, rootDir });
    await setupWorkflowTests({ cwd, rootDir });
    for (const mode of ['stream', 'generate']) {
      exporter.reset();
      events.length = 0;
      const execution = await start(
        getWorkflowRef('agentToolWithGlobalTelemetry'),
        [mode],
      );
      console.log(mode, await execution.returnValue);
      console.log('Tool telemetry events:', events);
      console.table(
        exporter
          .getFinishedSpans()
          .filter(span => span.instrumentationScope.name === 'gen_ai')
          .map(span => ({
            name: span.name,
            durationMs: span.duration[0] * 1000 + span.duration[1] / 1e6,
            output: span.attributes['gen_ai.tool.call.result'],
          })),
      );
    }
  } finally {
    await teardownWorkflowTests();
    await provider.shutdown();
    await rm(rootDir, { recursive: true, force: true });
    process.chdir(originalCwd);
  }
});
