import { createIdGenerator, type Context } from '@ai-sdk/provider-utils';
import type {
  TelemetryOptions,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
} from 'ai';
import { createTelemetryDispatcher, DefaultStepResult } from 'ai/internal';
import { buildModelStepResult } from './build-model-step-result.js';

const generateCallId = createIdGenerator({ prefix: 'call', size: 24 });

export async function recordToolExecutionTelemetry({
  telemetry,
  model,
  runtimeContext,
  stepNumber,
  startEvent,
  endEvent,
}: {
  telemetry: Pick<
    TelemetryOptions,
    | 'functionId'
    | 'recordInputs'
    | 'recordOutputs'
    | 'includeRuntimeContext'
    | 'includeToolsContext'
  >;
  model: { provider: string; modelId: string };
  runtimeContext: Context;
  stepNumber: number;
  startEvent: ToolExecutionStartEvent & { toolContext: Context };
  endEvent: ToolExecutionEndEvent & { toolContext: Context };
}): Promise<void> {
  'use step';

  // Keep the lifecycle in one worker: separate steps cannot share integration
  // state, and wrapping execution would nest the user's durable tool steps.
  const dispatcher = createTelemetryDispatcher({ telemetry });
  const callId = generateCallId();
  const toolsContext = {
    [startEvent.toolCall.toolName]: startEvent.toolContext,
  };
  const operation = {
    callId,
    ...model,
    messages: startEvent.messages,
    instructions: undefined,
    tools: undefined,
    toolChoice: undefined,
    activeTools: undefined,
    toolOrder: undefined,
    providerOptions: undefined,
    output: undefined,
    runtimeContext,
    toolsContext,
  };
  await dispatcher.onStart?.({
    ...operation,
    operationId: 'ai.workflowAgent.tool',
    maxRetries: 0,
    timeout: undefined,
    headers: undefined,
  });
  await dispatcher.onStepStart?.({
    ...operation,
    stepNumber,
    steps: [],
  });
  await dispatcher.onToolExecutionStart?.({ ...startEvent, callId });
  await dispatcher.onToolExecutionEnd?.({ ...endEvent, callId });

  const emptyStep = await buildModelStepResult(
    { content: [], reasoning: [] },
    [],
    undefined,
    new Map(),
    { callId, stepNumber, runtimeContext, toolsContext },
  );
  const step = new DefaultStepResult({
    ...emptyStep,
    ...model,
    content: [startEvent.toolCall, endEvent.toolOutput],
    finishReason: endEvent.toolOutput.type === 'tool-error' ? 'error' : 'stop',
    performance: {
      ...emptyStep.performance,
      stepTimeMs: endEvent.toolExecutionMs,
      toolExecutionMs: {
        [endEvent.toolCall.toolCallId]: endEvent.toolExecutionMs,
      },
    },
  });
  await dispatcher.onStepEnd?.(step);
  await dispatcher.onEnd?.(
    Object.assign(Object.create(Object.getPrototypeOf(step)), step, {
      finalStep: step,
      steps: [step],
      totalUsage: step.usage,
    }),
  );
}
