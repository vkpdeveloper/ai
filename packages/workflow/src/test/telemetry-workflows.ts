/**
 * Integration test workflows for WorkflowAgent telemetry.
 */
import { tool } from 'ai';
import { createHook, FatalError, getWritable } from 'workflow';
import { z } from 'zod/v4';
import { mockSequenceModel, mockTextModel } from '../providers/mock.js';
import { WorkflowAgent } from '../workflow-agent.js';

async function echoStep({ text }: { text: string }) {
  'use step';
  if (text === 'fail') throw new FatalError('echo failed');
  const startedAt = Date.now();
  await new Promise(resolve => setTimeout(resolve, 50));
  return { text, startedAt, endedAt: Date.now() };
}

export async function agentWithToolTelemetry(
  mode: 'stream' | 'generate',
  outcome: 'success' | 'error' | 'suspend' | 'output-error' = 'success',
  includeContext = false,
  isEnabled?: boolean,
  recordContents = true,
  localIntegrations = false,
) {
  'use workflow';
  const callbacks: string[] = [];
  const agent = new WorkflowAgent({
    model: mockSequenceModel([
      {
        type: 'tool-call',
        toolName: 'echo',
        input: outcome === 'error' ? '{"text":"fail"}' : '{"text":"hello"}',
      },
      { type: 'text', text: 'Done.' },
    ]),
    tools: {
      echo: tool({
        inputSchema: z.object({ text: z.string() }),
        contextSchema: z.object({ visible: z.string(), secret: z.string() }),
        toModelOutput:
          outcome === 'output-error'
            ? () => {
                throw new Error('output conversion failed');
              }
            : undefined,
        execute:
          outcome === 'suspend'
            ? async input => {
                using hook = createHook<string>();
                await hook;
                return echoStep(input);
              }
            : echoStep,
      }),
    },
    telemetry: {
      isEnabled,
      functionId: 'tool-telemetry-test',
      recordInputs: recordContents,
      recordOutputs: recordContents,
      includeRuntimeContext: { visible: includeContext },
      includeToolsContext: { echo: { visible: includeContext } },
      ...(localIntegrations ? { integrations: [] } : {}),
    },
    runtimeContext: { visible: 'runtime-value', secret: 'secret-runtime' },
    toolsContext: { echo: { visible: 'tool-value', secret: 'secret-tool' } },
    onToolExecutionStart: () => {
      callbacks.push('start');
    },
    onToolExecutionEnd: event => {
      callbacks.push(event.success ? 'success' : 'error');
    },
  });
  const result =
    mode === 'stream'
      ? await agent.stream({ prompt: 'hello', writable: getWritable() })
      : await agent.generate({ prompt: 'hello' });
  return { text: result.steps.at(-1)?.text, callbacks };
}

async function getGlobalTelemetryIntegrationCount(): Promise<number | null> {
  'use step';
  return globalThis.AI_SDK_TELEMETRY_INTEGRATIONS?.length ?? null;
}

export async function agentStreamWithGlobalTelemetry(
  prompt: string,
  includeTraceIdentity?: boolean,
) {
  'use workflow';
  const agent = new WorkflowAgent({
    model: mockTextModel(`Echo: ${prompt}`),
    telemetry: {
      functionId: 'telemetry-test',
      includeRuntimeContext:
        includeTraceIdentity == null
          ? undefined
          : { traceIdentity: includeTraceIdentity },
    },
    runtimeContext: {
      traceIdentity: { sessionId: 'chat_1', userId: 'user_1' },
      secret: 'must not cross the model-step boundary',
    },
  });
  const result = await agent.stream({
    messages: [{ role: 'user', content: prompt }],
    writable: getWritable(),
  });

  return {
    text: result.steps.at(-1)?.text,
    integrationsInWorkflow:
      globalThis.AI_SDK_TELEMETRY_INTEGRATIONS?.length ?? null,
    integrationsInStep: await getGlobalTelemetryIntegrationCount(),
  };
}

export async function agentGenerateWithGlobalTelemetry(
  prompt: string,
  includeTraceIdentity?: boolean,
) {
  'use workflow';
  const agent = new WorkflowAgent({
    model: mockTextModel(`Echo: ${prompt}`),
    telemetry: {
      functionId: 'telemetry-test',
      includeRuntimeContext:
        includeTraceIdentity == null
          ? undefined
          : { traceIdentity: includeTraceIdentity },
    },
    runtimeContext: {
      traceIdentity: { sessionId: 'chat_1', userId: 'user_1' },
      secret: 'must not cross the model-step boundary',
    },
  });
  const result = await agent.generate({
    messages: [{ role: 'user', content: prompt }],
  });
  return { text: result.text };
}
