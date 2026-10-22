import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { generateText, streamText } from 'ai';
import { run } from '../lib/run';

// Deterministic Responses API payloads; no API key or network required.
const truncated = (model: string, reason = 'max_output_tokens') => ({
  id: 'resp_123',
  object: 'response',
  created_at: 1760000000,
  model,
  status: 'incomplete',
  incomplete_details: { reason },
  output: [
    {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      status: 'incomplete',
      content: [
        { type: 'output_text', text: 'The answer is', annotations: [] },
      ],
    },
  ],
  usage: { input_tokens: 12, output_tokens: 16, total_tokens: 28 },
});

const jsonFetch = (body: unknown) => async () => Response.json(body);

const sseFetch = (response: ReturnType<typeof truncated>) => async () =>
  new Response(
    [
      {
        type: 'response.created',
        response: {
          ...response,
          status: 'in_progress',
          output: [],
          usage: undefined,
        },
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        content_index: 0,
        delta: 'The answer is',
      },
      { type: 'response.incomplete', response },
    ]
      .map(event => `data: ${JSON.stringify(event)}\n\n`)
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );

function show(label: string, finishReason: string, raw: string | undefined) {
  console.log(label, '| finishReason:', finishReason, '| raw:', raw);
}

run(async () => {
  const xai = createXai({
    apiKey: 'test-key',
    fetch: jsonFetch(truncated('grok-4')),
  });

  for (const [label, model] of [
    ['xai generateText (responses)', xai.responses('grok-4')],
    ['xai generateText (default)', xai('grok-4')],
  ] as const) {
    const result = await generateText({
      model,
      prompt: 'hi',
      maxOutputTokens: 16,
    });
    show(label, result.finishReason, result.rawFinishReason);
  }

  for (const reason of [
    'max_output_tokens',
    'max_prompt_tokens',
    'max_time_limit',
  ]) {
    const provider = createXai({
      apiKey: 'test-key',
      fetch: sseFetch(truncated('grok-4', reason)),
    });
    const result = streamText({
      model: provider.responses('grok-4'),
      prompt: 'hi',
      maxOutputTokens: 16,
    });
    show(
      `xai streamText (${reason})`,
      await result.finishReason,
      await result.rawFinishReason,
    );
  }

  const openai = createOpenAI({
    apiKey: 'test-key',
    fetch: jsonFetch(truncated('gpt-5')),
  });
  const sibling = await generateText({
    model: openai.responses('gpt-5'),
    prompt: 'hi',
    maxOutputTokens: 16,
  });
  show('openai generateText', sibling.finishReason, sibling.rawFinishReason);

  const completed = createXai({
    apiKey: 'test-key',
    fetch: jsonFetch({
      ...truncated('grok-4'),
      status: 'completed',
      incomplete_details: null,
    }),
  });
  const control = await generateText({
    model: completed.responses('grok-4'),
    prompt: 'hi',
  });
  show(
    'xai generateText (completed)',
    control.finishReason,
    control.rawFinishReason,
  );
});
