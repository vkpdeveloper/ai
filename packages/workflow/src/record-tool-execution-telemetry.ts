import { createIdGenerator } from '@ai-sdk/provider-utils';
import type { TelemetryOptions, ToolExecutionEndEvent } from 'ai';
import { createTelemetryDispatcher } from 'ai/internal';

const generateCallId = createIdGenerator({ prefix: 'call', size: 24 });

/**
 * Global integrations live in Node, outside the workflow VM. Report both
 * events in one step so integrations can correlate them without retaining
 * process-local state across durable steps. The tool itself can be a step
 * and must execute in the workflow body, never nested inside this step.
 */
export async function recordToolExecutionTelemetry(
  telemetry: Pick<
    TelemetryOptions,
    'functionId' | 'recordInputs' | 'recordOutputs'
  >,
  startTime: number,
  event: Omit<ToolExecutionEndEvent, 'callId'>,
): Promise<void> {
  'use step';

  const dispatcher = createTelemetryDispatcher({ telemetry });
  const callId = generateCallId();
  await dispatcher.onToolExecutionStart?.({
    callId,
    startTime,
    toolCall: event.toolCall,
    messages: event.messages,
    toolContext: event.toolContext,
  });
  await dispatcher.onToolExecutionEnd?.({ ...event, callId });
}
