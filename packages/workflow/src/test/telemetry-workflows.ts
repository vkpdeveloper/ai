/**
 * Integration test workflows for WorkflowAgent telemetry.
 */
import { WorkflowAgent as PackagedWorkflowAgent } from '@ai-sdk/workflow';
import { tool } from 'ai';
import { FatalError, getWritable } from 'workflow';
import * as z from 'zod/v4';
import { mockSequenceModel, mockTextModel } from '../providers/mock.js';
import { WorkflowAgent } from '../workflow-agent.js';

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

async function echoStep({ text }: { text: string }) {
  'use step';
  const startedAt = Date.now();
  await new Promise(resolve => setTimeout(resolve, 40));
  if (text === 'fail') throw new FatalError('echo failed');
  return { text, startedAt, finishedAt: Date.now() };
}

export async function agentToolWithGlobalTelemetry(
  mode: 'stream' | 'generate',
  text = 'hello',
  isEnabled?: boolean,
  includeContext = false,
  approved = false,
  overrideIntegrations = false,
  fromPackage = false,
) {
  'use workflow';
  const Agent = fromPackage ? PackagedWorkflowAgent : WorkflowAgent;
  const agent = new Agent({
    model: mockSequenceModel([
      { type: 'tool-call', toolName: 'echo', input: JSON.stringify({ text }) },
      { type: 'text', text: 'Done' },
    ]),
    tools: {
      echo: tool({
        inputSchema: z.object({ text: z.string() }),
        contextSchema: z.object({ requestId: z.string(), secret: z.string() }),
        execute: echoStep,
        needsApproval: approved,
      }),
    },
    toolsContext: { echo: { requestId: 'request-1', secret: 'tool-secret' } },
    telemetry: {
      isEnabled,
      integrations: overrideIntegrations ? [] : undefined,
      functionId: 'tool-telemetry-test',
      includeToolsContext: includeContext
        ? { echo: { requestId: true } }
        : undefined,
    },
  });
  const prompt = approved
    ? {
        messages: [
          { role: 'user' as const, content: text },
          {
            role: 'assistant' as const,
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: 'approved-call',
                toolName: 'echo',
                input: { text },
              },
              {
                type: 'tool-approval-request' as const,
                approvalId: 'approval-1',
                toolCallId: 'approved-call',
              },
            ],
          },
          {
            role: 'tool' as const,
            content: [
              {
                type: 'tool-approval-response' as const,
                approvalId: 'approval-1',
                approved: true,
              },
            ],
          },
        ],
      }
    : { prompt: text };
  const result =
    mode === 'stream'
      ? await agent.stream({ ...prompt, writable: getWritable() })
      : await agent.generate(prompt);
  return {
    output: result.steps[0].content.find(part => part.type === 'tool-result'),
    text: result.steps.at(-1)?.text,
  };
}
