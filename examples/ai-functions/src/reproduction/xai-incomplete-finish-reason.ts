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

const jsonFetch = (body: unknown) => async () => Response.json(body);

const sseFetch = (response: ReturnType<typeof truncated>) => async () => {
  const events = [
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
  ];

  return new Response(
    events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
};

run(async () => {
  const response = truncated('grok-4');
  const xai = createXai({ apiKey: 'test-key', fetch: jsonFetch(response) });

  const generated = await generateText({
    model: xai.responses('grok-4'),
    prompt: 'hi',
    maxOutputTokens: 16,
  });
  console.log(
    'xai generateText:',
    generated.finishReason,
    generated.rawFinishReason,
  );

  const defaultModel = await generateText({
    model: xai('grok-4'),
    prompt: 'hi',
    maxOutputTokens: 16,
  });
  console.log(
    'xai default generateText:',
    defaultModel.finishReason,
    defaultModel.rawFinishReason,
  );

  const streamed = streamText({
    model: createXai({
      apiKey: 'test-key',
      fetch: sseFetch(response),
    }).responses('grok-4'),
    prompt: 'hi',
    maxOutputTokens: 16,
  });
  console.log(
    'xai streamText:',
    await streamed.finishReason,
    await streamed.rawFinishReason,
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
  console.log(
    'openai generateText:',
    sibling.finishReason,
    sibling.rawFinishReason,
  );

  const completed = await generateText({
    model: createXai({
      apiKey: 'test-key',
      fetch: jsonFetch({
        ...response,
        status: 'completed',
        incomplete_details: null,
      }),
    }).responses('grok-4'),
    prompt: 'hi',
  });
  console.log(
    'xai generateText, completed:',
    completed.finishReason,
    completed.rawFinishReason,
  );

  const promptLimit = streamText({
    model: createXai({
      apiKey: 'test-key',
      fetch: sseFetch(truncated('grok-4', 'max_prompt_tokens')),
    }).responses('grok-4'),
    prompt: 'hi',
  });
  console.log(
    'xai streamText, max_prompt_tokens:',
    await promptLimit.finishReason,
    await promptLimit.rawFinishReason,
  );
});
