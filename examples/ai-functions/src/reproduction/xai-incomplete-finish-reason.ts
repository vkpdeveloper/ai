import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { generateText, streamText } from 'ai';
import { run } from '../lib/run';

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

const sseFetch = (events: unknown[]) => async () =>
  new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });

const streamEvents = (response: ReturnType<typeof truncated>) => [
  {
    type: 'response.created',
    response: {
      ...response,
      status: 'in_progress',
      incomplete_details: null,
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
];

const show = (label: string, finishReason: string, raw: string | undefined) =>
  console.log(label, '| finishReason:', finishReason, '| raw:', raw);

run(async () => {
  for (const reason of [
    'max_output_tokens',
    'max_prompt_tokens',
    'max_time_limit',
  ]) {
    const response = truncated('grok-4', reason);
    const xai = createXai({ apiKey: 'test-key', fetch: jsonFetch(response) });
    const generated = await generateText({
      model: xai.responses('grok-4'),
      prompt: 'hi',
      maxOutputTokens: 16,
    });
    show(
      `xai generateText (${reason})`,
      generated.finishReason,
      generated.rawFinishReason,
    );

    const streamed = streamText({
      model: createXai({
        apiKey: 'test-key',
        fetch: sseFetch(streamEvents(response)),
      }).responses('grok-4'),
      prompt: 'hi',
      maxOutputTokens: 16,
    });
    show(
      `xai streamText (${reason})`,
      await streamed.finishReason,
      await streamed.rawFinishReason,
    );
  }

  const xai = createXai({
    apiKey: 'test-key',
    fetch: jsonFetch(truncated('grok-4')),
  });
  const defaultModel = await generateText({
    model: xai('grok-4'),
    prompt: 'hi',
    maxOutputTokens: 16,
  });
  show(
    'xai generateText (default model)',
    defaultModel.finishReason,
    defaultModel.rawFinishReason,
  );

  const completed = await generateText({
    model: createXai({
      apiKey: 'test-key',
      fetch: jsonFetch({
        ...truncated('grok-4'),
        status: 'completed',
        incomplete_details: null,
      }),
    }).responses('grok-4'),
    prompt: 'hi',
  });
  show(
    'xai generateText (completed)',
    completed.finishReason,
    completed.rawFinishReason,
  );

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
});
