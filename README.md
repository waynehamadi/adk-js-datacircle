# Datacircle tools for ADK TypeScript

Find the best GTM APIs. We benchmark all the GTM APIs and we put the results on our website.

Our website: https://datacircle.dev

This package gives the [Agent Development Kit for TypeScript](https://github.com/google/adk-js) four function tools that call Datacircle's open API, https://api.datacircle.dev/v1. You need no key and no account.

| Tool | What the tool gives | Call |
| --- | --- | --- |
| `datacircle_list_apis` | Every GTM API on Datacircle, with the API's slug, number of plans, number of providers and best plan | `GET /apis` |
| `datacircle_best_plans` | One API's plans, sorted by score out of 100, best first. Each plan comes with a rank and a price per 1,000 calls | `GET /apis/{slug}/best` |
| `datacircle_search_plans` | Plans that match a provider or plan name, on all APIs or on one API. You can sort them by score, provider or price | `GET /plans` |
| `datacircle_provider` | The APIs a provider sells, and the provider's rank on each API | `GET /providers/{slug}` |

## Install

```bash
npm install @datacircle/adk @google/adk
```

The package works with `@google/adk` 2.x. It works from ESM and from CommonJS.

## Use the tools

Give the tools to an agent:

```ts
import { InMemoryRunner, LlmAgent } from '@google/adk';
import { datacircleTools } from '@datacircle/adk';

const agent = new LlmAgent({
  name: 'gtm_assistant',
  model: 'gemini-2.5-flash',
  instruction: 'You find the best GTM APIs for the user.',
  tools: datacircleTools(),
});

const runner = new InMemoryRunner({ agent, appName: 'gtm' });
const session = await runner.sessionService.createSession({ appName: 'gtm', userId: 'me' });
for await (const event of runner.runAsync({
  userId: 'me',
  sessionId: session.id,
  newMessage: { role: 'user', parts: [{ text: 'Who are the 3 best providers for the email-finder API?' }] },
})) {
  for (const part of event.content?.parts ?? []) if (part.text) console.log(part.text);
}
```

The Gemini model reads `GEMINI_API_KEY`. Any model ADK runs works. The tools also work in `adk web`, `adk run` and `adk api_server`: export the agent as `rootAgent` from your agent's file.

To give an agent only some of the tools, filter them by name: `datacircleTools().filter((t) => t.name !== 'datacircle_provider')`.

You can also make each call without an agent. You get the answer the model would read, as an object:

```ts
import { bestPlans } from '@datacircle/adk';

const answer = await bestPlans({ slug: 'email-finder', limit: 3 });
console.log(answer.plans);
```

The other calls are `listApis()`, `searchPlans()` and `providerRanks()`.

Each tool gives the model an object. Each plan comes with a rank, provider, plan, score, price per 1,000 (`perThousand`, in dollars) and a page on datacircle.dev. That page lists every field. When the API gives no data, for example for an unknown slug, the tool returns `{"error": "..."}` with the API's message. When an argument is wrong, the tool returns `{"error": "..."}` that names each wrong argument. The model can then call again. If the network fails, the tool throws, and ADK gives the model the error's message.

`datacircleTools({ fetch })` sets the `fetch` the tools use, for example to add a proxy or a timeout. Each call without an agent takes the same options as its second argument.

## Network

Each tool call makes one HTTPS GET request to https://api.datacircle.dev/v1 and nothing else. The request holds only the tool's own arguments: no key and nothing from your chats. The API takes up to 60 calls a minute from one IP address. The tool waits once, for a minute at most, when the API asks the tool to wait. The package depends only on `@google/adk`, and stores nothing.

## Links

- Datacircle: https://datacircle.dev
- The API: https://datacircle.dev/api
- The API's spec: https://api.datacircle.dev/v1/openapi.json
- What each key means: https://datacircle.dev/fields

MIT license.
