// Run: pnpm tsx src/reproduction/workflow-tool-telemetry.ts
// Exercises WorkflowAgent directly; the durable workflow VM boundary is covered
// by packages/workflow/src/workflow-agent-telemetry.integration.test.ts.
import { OpenTelemetry } from '@ai-sdk/otel';
import { WorkflowAgent } from '@ai-sdk/workflow';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { registerTelemetry, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import * as z from 'zod/v4';
import { run } from '../lib/run';

async function echoStep({ text }: { text: string }) {
  'use step';
  return text;
}

run(async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();
  registerTelemetry(new OpenTelemetry());

  const agent = new WorkflowAgent({
    model: new MockLanguageModelV4({
      doGenerate: async ({ prompt }) => {
        const callTool = !prompt.some(message => message.role === 'tool');
        return {
          content: callTool
            ? [
                {
                  type: 'tool-call',
                  toolCallId: 'echo-1',
                  toolName: 'echo',
                  input: '{"text":"hello"}',
                },
              ]
            : [{ type: 'text', text: 'Done' }],
          finishReason: {
            unified: callTool ? 'tool-calls' : 'stop',
            raw: undefined,
          },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        };
      },
    }),
    tools: {
      echo: tool({
        inputSchema: z.object({ text: z.string() }),
        execute: echoStep,
      }),
    },
  });
  const result = await agent.generate({ prompt: 'Echo hello' });
  await provider.forceFlush();
  console.log('Result:', result.text);
  console.log(
    'Spans:',
    exporter.getFinishedSpans().map(span => span.name),
  );
  console.log('Expected: one execute_tool echo span.');
  await provider.shutdown();
});
