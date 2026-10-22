import { createGoogleVertex } from '@ai-sdk/google-vertex';
import { streamText, tool } from 'ai';
import { z } from 'zod/v4';
import { run } from '../lib/run';

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

// Synthetic Vertex responses exercise the local provider without credentials.
// Value-less paths close containers; [] identifies an array.
const partialArgs = [
  { jsonPath: '$.id', stringValue: 'x' },
  { jsonPath: '$.emptyArr[]' },
  { jsonPath: '$.emptyObj' },
  { jsonPath: '$.emptyStr', stringValue: '' },
  { jsonPath: '$.nested.tags[]' },
  { jsonPath: '$.nested' },
  { jsonPath: '$.zero', numberValue: 0 },
  { jsonPath: '$.no', boolValue: false },
  { jsonPath: '$.nil', nullValue: 'NULL_VALUE' },
];

run(async () => {
  for (const required of [false, true]) {
    for (const streamFunctionCallArguments of [true, false]) {
      const vertex = createGoogleVertex({
        apiKey: 'test-key',
        fetch: async () => {
          const functionCalls = streamFunctionCallArguments
            ? [
                { name: 't', willContinue: true },
                ...partialArgs.map((arg, index) => ({
                  partialArgs: [arg],
                  willContinue: index < partialArgs.length - 1,
                })),
              ]
            : [{ name: 't', args: input }];

          return new Response(
            functionCalls
              .map((functionCall, index) =>
                JSON.stringify({
                  candidates: [
                    {
                      content: { role: 'model', parts: [{ functionCall }] },
                      ...(index === functionCalls.length - 1 && {
                        finishReason: 'STOP',
                      }),
                    },
                  ],
                }),
              )
              .map(chunk => `data: ${chunk}\n\n`)
              .join(''),
            { headers: { 'content-type': 'text/event-stream' } },
          );
        },
      });

      const result = streamText({
        model: vertex('gemini-3.8-flash'),
        providerOptions: { vertex: { streamFunctionCallArguments } },
        tools: {
          t: tool({
            inputSchema: required ? inputSchema.required() : inputSchema,
            execute: async () => ({ ok: true }),
          }),
        },
        toolChoice: 'required',
        stopWhen: () => true,
        prompt:
          'Call t with exactly: id "x", emptyArr [], emptyObj {}, emptyStr "", nested {"tags": []}, zero 0, no false, nil null.',
      });

      console.log({ required, streamFunctionCallArguments });
      let deltas = '';
      for await (const part of result.stream) {
        if (part.type === 'tool-input-delta') deltas += part.delta;
        if (part.type === 'tool-call') {
          console.log('tool-call:', JSON.stringify(part.input));
          console.log('invalid:', part.invalid ?? false);
        }
        if (part.type === 'tool-result')
          console.log('tool-result:', part.output);
        if (part.type === 'error') console.error(part.error);
      }
      console.log('tool-input-deltas:', deltas);
    }
  }
});
