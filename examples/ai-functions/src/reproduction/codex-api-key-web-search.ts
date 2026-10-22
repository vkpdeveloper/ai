import { HarnessAgent, type HarnessAgentSession } from '@ai-sdk/harness/agent';
import { createCodex } from '@ai-sdk/harness-codex';
import { createVercelNetworkSandboxSession } from '@ai-sdk/sandbox-vercel';
import { run } from '../lib/run';

// Requires OPENAI_API_KEY and Vercel Sandbox credentials.
run(async () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Set OPENAI_API_KEY to run this reproduction.');
  }

  const agent = new HarnessAgent({
    harness: createCodex({
      auth: { OPENAI_API_KEY: apiKey },
      webSearch: true,
    }),
    id: 'web-search-repro',
    model: process.env.MODEL ?? 'gpt-6.1-sol',
  });
  const sandboxSession = await createVercelNetworkSandboxSession({
    runtime: 'node24',
    ports: [4000],
    template: await agent.getSandboxTemplate(),
  });
  let session: HarnessAgentSession | undefined;
  try {
    session = await agent.createSession({ sandboxSession });
    const result = await agent.generate({
      session,
      prompt:
        "Use web search to find today's top headline on reuters.com. Do not use the shell.",
    });
    console.log(
      result.steps.flatMap(step =>
        (step.toolCalls ?? []).map(call => call.toolName),
      ),
    );
    console.log(result.text);
  } finally {
    await session?.destroy();
    await sandboxSession.destroy();
  }
});
