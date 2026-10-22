import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { generateText, streamText } from 'ai';
import { run } from '../lib/run';

// Mocked responses from the issue: no API keys or network access needed.
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

const jsonFetch = (body: unknown) => async () =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });

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
        type: 'response.output_item.added',
        output_index: 0,
        item: { ...response.output[0], status: 'in_progress', content: [] },
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

const show = (label: string, finishReason: string, raw: string | undefined) =>
  console.log(
    label.padEnd(44),
    'finishReason:',
    finishReason.padEnd(7),
    '| raw:',
    raw,
  );

run(async () => {
  const response = truncated('grok-4');
  const xai = createXai({ apiKey: 'test-key', fetch: jsonFetch(response) });

  for (const [label, model] of [
    ['xai generateText, responses', xai.responses('grok-4')],
    ['xai generateText, default', xai('grok-4')],
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
    const streamingXai = createXai({
      apiKey: 'test-key',
      fetch: sseFetch(truncated('grok-4', reason)),
    });
    const result = streamText({
      model: streamingXai.responses('grok-4'),
      prompt: 'hi',
      maxOutputTokens: 16,
    });
    await result.consumeStream();
    show(
      `xai streamText, ${reason}`,
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

  const completedXai = createXai({
    apiKey: 'test-key',
    fetch: jsonFetch({
      ...response,
      status: 'completed',
      incomplete_details: null,
    }),
  });
  const completed = await generateText({
    model: completedXai.responses('grok-4'),
    prompt: 'hi',
  });
  show(
    'xai generateText, completed',
    completed.finishReason,
    completed.rawFinishReason,
  );
});
