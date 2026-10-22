import { createIdGenerator } from '@ai-sdk/provider-utils';
import type { TelemetryOptions, ToolExecutionEndEvent } from 'ai';
import { createTelemetryDispatcher } from 'ai/internal';

const generateCallId = createIdGenerator({ prefix: 'call', size: 24 });

/**
 * Dispatch both events in one step: integrations are invisible in the workflow
 * VM, and separate steps need not run in the same process. The tool itself must
 * run outside this step because its execute function may already be a step.
 */
export async function recordToolExecutionTelemetry({
  telemetry,
  event,
  startTime,
}: {
  telemetry: Pick<
    TelemetryOptions,
    'functionId' | 'recordInputs' | 'recordOutputs'
  >;
  event: Omit<ToolExecutionEndEvent, 'callId'>;
  startTime: Date;
}): Promise<void> {
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
