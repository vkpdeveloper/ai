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

run(async () => {
  for (const callback of [
    'sync onError',
    'async onError',
    'async onChunk',
    'callback retry',
  ]) {
    let doStreamCalls = 0;
    const errors: string[] = [];
    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: erroringStream(
            new Error(`provider error ${++doStreamCalls}`),
          ),
        }),
      }),
      prompt: 'hi',
      streamRetries: callback === 'callback retry' ? 0 : 1,
      onChunk: async ({ chunk }) => {
        if (callback === 'async onChunk' && chunk.type === 'error') {
          await setImmediate();
        }
      },
      onError: async ({ error }) => {
        errors.push(error instanceof Error ? error.message : String(error));
        if (callback === 'async onError' || callback === 'callback retry') {
          await setImmediate();
        }
        if (callback === 'callback retry') {
          return { retry: true };
        }
      },
    });
    const outcome = await result.text.then(
      () => 'resolved',
      error => `rejected: ${error.message}`,
    );
    console.log(
      `${callback}: doStream calls=${doStreamCalls}, onError=${JSON.stringify(errors)}, text ${outcome}`,
    );
  }
});
