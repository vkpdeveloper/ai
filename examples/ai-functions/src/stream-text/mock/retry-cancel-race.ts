import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { run } from '../../lib/run';

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

async function reproduce(label: string, onError: () => Promise<void>) {
  let doStreamCalls = 0;
  const errors: string[] = [];
  const result = streamText({
    model: new MockLanguageModelV4({
      doStream: async () => ({
        stream: erroringStream(new Error(`provider error ${++doStreamCalls}`)),
      }),
    }),
    prompt: 'hi',
    streamRetries: 1,
    onError: async ({ error }) => {
      errors.push((error as Error).message);
      await onError();
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
  await reproduce('sync onError', async () => {});
  await reproduce(
    'onError awaiting setImmediate',
    () => new Promise(resolve => setImmediate(resolve)),
  );
});
