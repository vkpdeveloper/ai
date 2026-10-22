import { createGoogleVertex } from '@ai-sdk/google-vertex';
import { streamText, tool } from 'ai';
import { readFileSync } from 'node:fs';
import { z } from 'zod/v4';
import { run } from '../lib/run';

// Synthetic Vertex responses make this reproduction deterministic and runnable
// without credentials. The streaming response uses value-less container paths.
const partialResponse = readFileSync(
  new URL(
    '../../../../packages/google/src/__fixtures__/google-stream-tool-call-empty-containers.chunks.txt',
    import.meta.url,
  ),
  'utf8',
)
  .trim()
  .split('\n')
  .map(line => `data: ${line}\n\n`)
  .join('');

const input = {
  id: 'x',
  emptyArr: [],
  emptyObj: {},
  emptyStr: '',
  nested: { tags: [] },
  zero: 0,
  no: false,
  nil: null,
};

const inputSchema = z.object({
  id: z.string(),
  emptyArr: z.array(z.string()).optional(),
  emptyObj: z.object({ a: z.string().optional() }).optional(),
  emptyStr: z.string().optional(),
  nested: z.object({ tags: z.array(z.string()) }).optional(),
  zero: z.number().optional(),
  no: z.boolean().optional(),
  nil: z.null().optional(),
});

run(async () => {
  for (const required of [false, true]) {
    for (const streamFunctionCallArguments of [true, false]) {
      console.log({ required, streamFunctionCallArguments });

      const vertex = createGoogleVertex({
        apiKey: 'test-api-key',
        fetch: async () =>
          new Response(
            streamFunctionCallArguments
              ? partialResponse
              : `data: ${JSON.stringify({
                  candidates: [
                    {
                      content: {
                        role: 'model',
                        parts: [{ functionCall: { name: 't', args: input } }],
                      },
                      finishReason: 'STOP',
                    },
                  ],
                })}\n\n`,
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      });

      const result = streamText({
        model: vertex('gemini-3.8-flash'),
        providerOptions: { google: { streamFunctionCallArguments } },
        tools: {
          t: tool({
            inputSchema: required ? inputSchema.required() : inputSchema,
            execute: async () => ({ ok: true }),
          }),
        },
        toolChoice: 'required',
        stopWhen: () => true,
        prompt: `Call t with exactly: ${JSON.stringify(input)}`,
      });

      let streamedInput = '';
      for await (const part of result.fullStream) {
        if (part.type === 'tool-input-delta') {
          streamedInput += part.delta;
        } else if (part.type === 'tool-call') {
          console.log('tool-call:', JSON.stringify(part.input));
          if (part.invalid) console.log('validation error:', part.error);
        } else if (part.type === 'error') {
          console.error(part.error);
        }
      }
      console.log('tool-input-delta:', streamedInput);
    }
  }
});
