import { createVertex } from '@ai-sdk/google-vertex';
import { streamText, tool } from 'ai';
import * as z from 'zod/v4';
import { run } from '../lib/run';

// Replay synthetic Vertex chunks without credentials or model variability.
const partialArgs = [
  { jsonPath: '$.id', stringValue: 'x', willContinue: true },
  { jsonPath: '$.id' },
  { jsonPath: '$.emptyArr[]' },
  { jsonPath: '$.emptyObj' },
  { jsonPath: '$.emptyStr', stringValue: '' },
  { jsonPath: '$.nested.tags[]' },
  { jsonPath: '$.zero', numberValue: 0 },
  { jsonPath: '$.no', boolValue: false },
  { jsonPath: '$.nil', nullValue: 'NULL_VALUE' },
];

run(async () => {
  for (const required of [false, true]) {
    const inputSchema = z.object({
      id: z.string(),
      emptyArr: z.array(z.string()),
      emptyObj: z.object({ a: z.string().optional() }),
      emptyStr: z.string(),
      nested: z.object({ tags: z.array(z.string()) }),
      zero: z.number(),
      no: z.boolean(),
      nil: z.null(),
    });
    const vertex = createVertex({
      apiKey: 'replay-only',
      fetch: async () => {
        const functionCalls = [
          { name: 't', willContinue: true },
          ...partialArgs.map(arg => ({
            partialArgs: [arg],
            willContinue: true,
          })),
          {},
        ];
        const chunks = functionCalls.map((functionCall, index) => ({
          candidates: [
            {
              content: { role: 'model', parts: [{ functionCall }] },
              ...(index === functionCalls.length - 1
                ? { finishReason: 'STOP' }
                : {}),
            },
          ],
        }));
        return new Response(
          chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });

    console.log(`Required fields: ${required}`);
    const result = streamText({
      model: vertex('gemini-3.1-pro-preview'),
      providerOptions: { google: { streamFunctionCallArguments: true } },
      tools: {
        t: tool({
          inputSchema: required ? inputSchema : inputSchema.partial(),
          execute: async input => {
            console.log('Executed:', JSON.stringify(input));
            return { ok: true };
          },
        }),
      },
      toolChoice: 'required',
      prompt:
        'Call t with exactly: id "x", emptyArr [], emptyObj {}, emptyStr "", nested {"tags": []}, zero 0, no false, nil null.',
    });

    for await (const part of result.stream) {
      if (part.type === 'tool-call') {
        console.log('Tool call:', JSON.stringify(part.input));
      } else if (part.type === 'tool-input-delta') {
        console.log('Input delta:', part.delta);
      } else if (part.type === 'tool-error') {
        console.error('Tool error:', part.error);
      } else if (part.type === 'error') {
        throw part.error;
      }
    }
  }
});
