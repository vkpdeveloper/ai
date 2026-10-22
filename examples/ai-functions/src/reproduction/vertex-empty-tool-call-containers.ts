import { createGoogleVertex } from '@ai-sdk/google-vertex';
import { streamText, tool } from 'ai';
import { z } from 'zod/v4';
import { run } from '../lib/run';

// Synthetic Vertex SSE replay: no credentials or live provider calls required.
// A value-less path closes an object; a path ending in [] closes an array.
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

const expectedInput = {
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
  // Pass --required to also exercise validation with required empty containers.
  const required = process.argv.includes('--required');
  console.log('Required fields:', required);
  console.log('Expected input:', JSON.stringify(expectedInput));

  for (const streamFunctionCallArguments of [true, false]) {
    const vertex = createGoogleVertex({
      apiKey: 'replay-only',
      fetch: async () => {
        const functionCalls = streamFunctionCallArguments
          ? [
              { name: 't', willContinue: true },
              ...partialArgs.map((arg, index) => ({
                partialArgs: [arg],
                willContinue: index < partialArgs.length - 1,
              })),
            ]
          : [{ name: 't', args: expectedInput }];

        const chunks = [
          ...functionCalls.map(functionCall => ({
            candidates: [
              { content: { role: 'model', parts: [{ functionCall }] } },
            ],
          })),
          { candidates: [{ finishReason: 'STOP' }] },
        ];

        return new Response(
          chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
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
      prompt:
        'Call t with exactly: id "x", emptyArr [], emptyObj {}, emptyStr "", nested {"tags": []}, zero 0, no false, nil null.',
    });

    for await (const part of result.stream) {
      if (part.type === 'tool-call') {
        if (part.invalid) throw part.error;
        console.log(
          `streamFunctionCallArguments=${streamFunctionCallArguments}`,
          JSON.stringify(part.input),
        );
      } else if (part.type === 'error') {
        throw part.error;
      }
    }
  }
});
