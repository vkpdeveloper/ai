import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { setImmediate } from 'node:timers/promises';
import { run } from '../lib/run';

function erroringStream(error: Error) {
  let sent = false;
  return new ReadableStream<LanguageModelV4StreamPart>(
    {
      pull(controller) {
        if (sent) {
          controller.error(error);
          return;
        }
        sent = true;
        controller.enqueue({ type: 'error', error });
      },
    },
    { highWaterMark: 0 },
  );
}

async function runCase(
  label: string,
  {
    streamRetries = 1,
    delayOnError = false,
    delayOnChunk = false,
    requestRetry = false,
  } = {},
) {
  let doStreamCalls = 0;
  const errors: string[] = [];
  const result = streamText({
    model: new MockLanguageModelV4({
      doStream: async () => ({
        stream: erroringStream(new Error(`provider error ${++doStreamCalls}`)),
      }),
    }),
    prompt: 'hi',
    streamRetries,
    onChunk: async ({ chunk }) => {
      if (delayOnChunk && chunk.type === 'error') {
        await setImmediate();
      }
    },
    onError: async ({ error }) => {
      errors.push(error instanceof Error ? error.message : String(error));
      if (delayOnError) {
        await setImmediate();
      }
      if (requestRetry) {
        return { retry: true };
      }
    },
  });
  const outcome = await result.text.then(
    () => 'resolved',
    error => `rejected: ${error.message}`,
  );
  console.log(
    `${label}: doStream calls=${doStreamCalls}, onError=${JSON.stringify(errors)}, text ${outcome}`,
  );
}

run(async () => {
  // Every case should make two provider calls and report both errors.
  await runCase('sync onError');
  await runCase('onError awaiting setImmediate', { delayOnError: true });
  await runCase('async onError requesting retry', {
    streamRetries: 0,
    delayOnError: true,
    requestRetry: true,
  });
  await runCase('onChunk awaiting setImmediate', { delayOnChunk: true });
});
