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

async function runCase(label: string, onError: () => Promise<void>) {
  let doStreamCalls = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => {
      doStreamCalls += 1;
      return {
        stream: erroringStream(new Error(`provider error ${doStreamCalls}`)),
      };
    },
  });
  const errors: string[] = [];
  const result = streamText({
    model,
    prompt: 'hi',
    streamRetries: 1,
    onError: async ({ error }) => {
      errors.push(error instanceof Error ? error.message : String(error));
      await onError();
    },
  });
  const outcome = await result.text.then(
    () => 'resolved',
    (error: Error) => `rejected: ${error.message}`,
  );
  console.log(
    `${label}: doStream calls=${doStreamCalls}, onError=${JSON.stringify(errors)}, text ${outcome}`,
  );
}

run(async () => {
  await runCase('sync onError', async () => {});
  await runCase('onError awaiting setImmediate', () => setImmediate());
});
