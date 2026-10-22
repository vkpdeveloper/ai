/**
 * Integration test workflows for WorkflowAgent telemetry.
 */
import { tool } from 'ai';
import { FatalError, getWritable } from 'workflow';
import { z } from 'zod/v4';
import { mockSequenceModel, mockTextModel } from '../providers/mock.js';
import { WorkflowAgent } from '../workflow-agent.js';

async function echoStep({ text }: { text: string }) {
  'use step';
  await new Promise(resolve => setTimeout(resolve, 30));
  if (text === 'fail') throw new FatalError('echo failed');
  return text;
}

export async function agentToolWithGlobalTelemetry(
  mode: 'stream' | 'generate',
  options: {
    fail?: boolean;
    disabled?: boolean;
    local?: boolean;
    private?: boolean;
  } = {},
) {
  'use workflow';
  const callbacks: string[] = [];
  const localEvents: string[] = [];
  const agent = new WorkflowAgent({
    model: mockSequenceModel([
      {
        type: 'tool-call',
        toolName: 'echo',
        input: JSON.stringify({ text: options.fail ? 'fail' : 'hello' }),
      },
      { type: 'text', text: 'done' },
    ]),
    tools: {
      echo: tool({
        inputSchema: z.object({ text: z.string() }),
        contextSchema: z.object({ visible: z.string(), secret: z.string() }),
        execute: echoStep,
      }),
    },
    toolsContext: { echo: { visible: 'included', secret: 'excluded' } },
    telemetry: {
      isEnabled: !options.disabled,
      functionId: 'tool-telemetry-test',
      recordInputs: !options.private,
      recordOutputs: !options.private,
      includeToolsContext: { echo: { visible: !options.private } },
      integrations: options.local
        ? {
            onToolExecutionStart: event => {
              localEvents.push(
                `start:${event.callId}:${event.toolCall.toolName}`,
              );
            },
            onToolExecutionEnd: event => {
              localEvents.push(`end:${event.toolOutput.type}`);
            },
          }
        : undefined,
    },
    onToolExecutionStart: () => {
      callbacks.push('start');
    },
    onToolExecutionEnd: event => {
      callbacks.push(event.success ? 'success' : 'error');
    },
  });
  const result =
    mode === 'stream'
      ? await agent.stream({ prompt: 'echo hello', writable: getWritable() })
      : await agent.generate({ prompt: 'echo hello' });
  return { text: result.steps.at(-1)?.text, callbacks, localEvents };
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
