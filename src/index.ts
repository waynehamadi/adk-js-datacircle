// Agent Development Kit (ADK) tools on Datacircle's open API: find the best GTM APIs. The API needs no key:
// https://api.datacircle.dev/v1 (its spec: https://api.datacircle.dev/v1/openapi.json). More at https://datacircle.dev

import { FunctionTool } from '@google/adk';
import { ApiError, BASE_URL, Client, VERSION, brief, briefPlans, clamp, objects, slugify } from './client.js';
import type { Answer, DatacircleOptions } from './client.js';

export { ApiError, BASE_URL, VERSION };
export type { Answer, DatacircleOptions };

const LIST_APIS_ABOUT = "Lists the GTM APIs on Datacircle's sheet (https://datacircle.dev). GTM means go-to-market. GTM APIs are the APIs sales and marketing teams use. Gives each API's slug, how many plans and providers it has and its best plan. Call it first to find an API's slug.";
const BEST_PLANS_ABOUT = "Gives an API's plans best first by their score out of 100 on Datacircle's benchmark (https://datacircle.dev), each with its rank, provider, plan, $ per 1,000 calls and its page. Call it for an API's best providers. perThousand is a plan's price of 1,000 items in dollars, pay the plan's whole price in its currency.";
const SEARCH_PLANS_ABOUT = "Searches every plan on Datacircle's sheet (https://datacircle.dev), or one API's, by provider or plan name, sorted by score, provider or price. Gives how many were found and up to limit of them. perThousand is a plan's price of 1,000 items in dollars, pay the plan's whole price in its currency.";
const PROVIDER_ABOUT = "Gives each API one provider sells and its rank on each on Datacircle's benchmark (https://datacircle.dev), with its best plan there, its best rank first. total is how many APIs it sells, ranked on how many of them it has a rank. For an API's best providers, call datacircle_best_plans.";

// Tells a model that sent a provider's name to an API's tool where a provider's plans are.
const FOR_PROVIDER = "A provider's plans: datacircle_search_plans with its name as query, like bright data, or datacircle_provider.";

// Tells a model that sent an API's slug to the provider's tool where an API's best providers are.
const FOR_API = "An API's best providers: datacircle_best_plans with the API's slug, like email-finder.";

// Each input's schema is a Gemini Schema, what the model is sent. ADK gives a tool the model's arguments as they came with
// such a schema, so the tool reads them itself: a model that sent a wrong one reads why, and can call again. A key left out
// or null is left out, and a key of its own is dropped. A number sent as a string is read as one, a fraction cut to its
// whole part. A limit or an offset out of its range takes the nearest bound, or its default below 1.
type Read = (value: unknown) => { value?: unknown; wrong?: string };
type Field = { schema: Record<string, unknown>; read: Read; needed?: boolean };

const count = (description: string, minimum: number, maximum?: number): Field => ({
  schema: { type: 'INTEGER', description, minimum, ...(maximum !== undefined ? { maximum } : {}) },
  read: (value) => {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) ? { value: Math.trunc(n) } : { wrong: `must be a whole number, not ${JSON.stringify(value)}` };
  },
});
const text = (description: string, needed = false): Field => ({
  schema: { type: 'STRING', description },
  needed,
  read: (value) => (typeof value === 'string' || typeof value === 'number' ? { value: String(value) } : { wrong: `must be text, not ${JSON.stringify(value)}` }),
});
const choice = (values: string[], description: string): Field => ({
  schema: { type: 'STRING', format: 'enum', enum: values, description },
  read: (value) => {
    const word = typeof value === 'string' ? value.trim().toLowerCase() : value;
    return typeof word === 'string' && values.includes(word) ? { value: word } : { wrong: `must be ${values.join(', ')}, not ${JSON.stringify(value)}` };
  },
});

type Input = { schema: Record<string, unknown>; read: (raw: unknown) => { input?: Answer; error?: string } };
function input(fields: Record<string, Field>): Input {
  const keys = Object.keys(fields);
  const needed = keys.filter((key) => fields[key].needed);
  return {
    schema: {
      type: 'OBJECT',
      properties: Object.fromEntries(keys.map((key) => [key, fields[key].schema])),
      ...(needed.length > 0 ? { required: needed } : {}),
    },
    read: (raw) => {
      const given = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Answer) : {};
      const kept: Answer = {};
      const wrong: string[] = [];
      for (const key of keys) {
        const value = given[key];
        if (value === undefined || value === null || value === '') {
          if (fields[key].needed) wrong.push(`${key}: is needed`);
          continue;
        }
        const read = fields[key].read(value);
        if (read.wrong !== undefined) wrong.push(`${key}: ${read.wrong}`);
        else kept[key] = read.value;
      }
      return wrong.length > 0 ? { error: `The input does not fit the tool's schema: ${wrong.join('; ')}` } : { input: kept };
    },
  };
}

const listApisInput = input({
  query: text("Words of the API's name or slug, like email or linkedin profile: the APIs that hold the most of them come first. Leave it out for the sheet's order"),
  limit: count('How many APIs to give, 1 to 200. Leave it out for 20: the sheet has about 150', 1, 200),
});

const bestPlansInput = input({
  slug: text("The API's slug, like email-finder or linkedin-profile, as datacircle_list_apis gives it", true),
  limit: count('How many plans to give, 1 to 50. Leave it out for 10', 1, 50),
});

const searchPlansInput = input({
  api: text("Only this API's plans: its name or slug, like email-finder. A provider's name goes in query, never here. Leave it out for every API"),
  query: text("Words that must all appear in the provider's or plan's name, like bright data. Leave it out for every plan"),
  sort: choice(['score', 'provider', 'price'], 'score (best first, the default), provider (A to Z) or price ($ per 1,000, lowest first)'),
  limit: count('How many plans to give, 1 to 50. Leave it out for 10', 1, 50),
  offset: count('How many found plans to skip first. Leave it out for 0', 0),
});

const providerInput = input({
  slug: text("The provider's slug, like bright-data, or its name, like Bright Data: the name is made a slug", true),
});

/** datacircle_list_apis' input. */
export type ListApisInput = { query?: string | null; limit?: number | null };
/** datacircle_best_plans' input. */
export type BestPlansInput = { slug: string; limit?: number | null };
/** datacircle_search_plans' input. */
export type SearchPlansInput = { api?: string | null; query?: string | null; sort?: 'score' | 'provider' | 'price' | null; limit?: number | null; offset?: number | null };
/** datacircle_provider's input. */
export type ProviderInput = { slug: string };

/** A limit within the API's bounds, or undefined for the API's default. */
const bounded = (n: number | null | undefined, high: number) => (n === undefined || n === null || !(n >= 1) ? undefined : clamp(n, 1, high));

/** An answer of 4xx (an unknown slug, a wrong argument) is the tool's result as {error}, so that the model reads the API's words and can call again. */
function asResult(error: unknown): Answer {
  if (error instanceof ApiError) return { error: error.message };
  throw error;
}

async function listApisRun(client: Client, { query, limit }: ListApisInput, signal?: AbortSignal): Promise<Answer> {
  let apis: Answer[];
  try {
    apis = objects(await client.get<unknown>('/apis', {}, signal));
  } catch (error) {
    return asResult(error);
  }
  const words = (query ?? '').toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  const found = apis
    .map((api, order) => {
      const name = `${String(api.api ?? '')} ${String(api.slug ?? '').replace(/-/g, ' ')}`.toLowerCase();
      return { order, matched: words.filter((word) => name.includes(word)).length, api };
    })
    .filter(({ matched }) => matched > 0 || words.length === 0)
    // The most words matched first, the sheet's order within each.
    .sort((a, b) => b.matched - a.matched || a.order - b.order);
  const answer: Answer = {
    total: found.length,
    apis: found.slice(0, bounded(limit, 200) ?? 20)
      .map(({ api }) => brief(api, ['api', 'slug', 'plans', 'providers', 'best', 'bestPage', 'sheetPage'])),
  };
  if (words.length > 0 && (found.length === 0 || found[0].matched < words.length)) {
    // A provider's name sent as an API's, like Bright Data, whose data matches many APIs: where its plans are.
    answer.note = `No API's name holds every word of ${JSON.stringify(query)}. A provider's plans: datacircle_search_plans with its name as query, or datacircle_provider.`;
  }
  return answer;
}

async function bestPlansRun(client: Client, { slug, limit }: BestPlansInput, signal?: AbortSignal): Promise<Answer> {
  const api = slugify(slug ?? '');
  if (api === '') return { error: `Give an API's slug, like email-finder: datacircle_list_apis gives every slug. ${FOR_PROVIDER}` };
  try {
    const answer = await client.get(`/apis/${api}/best`, { limit: bounded(limit, 50) }, signal);
    return { ...answer, plans: briefPlans(answer.plans) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      // A provider's name sent as the API's slug: the API's words, and where a provider's plans are.
      return { error: `${error.message}. datacircle_list_apis gives every API's slug. ${FOR_PROVIDER}` };
    }
    return asResult(error);
  }
}

async function searchPlansRun(client: Client, input: SearchPlansInput, signal?: AbortSignal): Promise<Answer> {
  const search = (api: string, query: string) =>
    client.get('/plans', {
      api: api.trim(),
      query: query.trim(),
      sort: input.sort ?? undefined,
      limit: bounded(input.limit, 50),
      offset: input.offset === undefined || input.offset === null || !(input.offset > 0) ? undefined : Math.trunc(input.offset),
    }, signal);
  let api = input.api ?? '';
  let query = input.query ?? '';
  const notes: string[] = [];
  try {
    let answer: Answer;
    try {
      answer = await search(api, query);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 400 && error.message.includes('api must be') && query.trim() === '')) throw error;
      // A provider's name sent as the API: the plans whose provider or plan name holds it.
      [api, query] = ['', api];
      answer = await search(api, query);
      notes.push(`No API is named ${JSON.stringify(input.api)}: these are the plans whose provider or plan name holds it.`);
    }
    if (answer.total === 0 && query.includes('-')) {
      // A slug sent as a name, like bright-data, which no name holds: its words, like bright data. A name with a
      // hyphen, like A-Leads, is found as it is first.
      const words = query.replace(/-/g, ' ').split(/\s+/).filter(Boolean).join(' ');
      try {
        answer = await search(api, words);
        notes.push(`No provider's or plan's name holds ${JSON.stringify(query)}: these are the plans whose name holds ${JSON.stringify(words)}.`);
      } catch {
        // The first answer stands.
      }
    }
    return { ...answer, plans: briefPlans(answer.plans), ...(notes.length > 0 ? { note: notes.join(' ') } : {}) };
  } catch (error) {
    return asResult(error);
  }
}

async function providerRun(client: Client, { slug }: ProviderInput, signal?: AbortSignal): Promise<Answer> {
  const provider = slugify(slug ?? '');
  if (provider === '') return { error: "Give a provider's slug or name, like bright-data or Bright Data" };
  let answer: Answer;
  try {
    answer = await client.get(`/providers/${provider}`, {}, signal);
  } catch (error) {
    // An API's slug sent as a provider's, like email-finder: the API's words, and where an API's best providers are.
    if (error instanceof ApiError && error.status === 404) return { error: `${error.message}. ${FOR_API}` };
    return asResult(error);
  }
  const apis = objects(answer.apis).map((entry) => {
    const plans = objects(entry.plans);
    const kept: Answer = { ...brief(entry, ['api', 'slug', 'rank', 'bestPage']), plans: plans.length };
    const best = bestPlan(plans);
    if (best) kept.best = brief(best, ['plan', 'score', 'perThousand', 'page']);
    return kept;
  });
  // Its best rank first, the APIs where it has none last, in the API's order.
  const rank = (api: Answer) => (typeof api.rank === 'number' ? api.rank : Infinity);
  apis.sort((a, b) => rank(a) - rank(b));
  return { ...answer, apis, total: apis.length, ranked: apis.filter((api) => typeof api.rank === 'number').length };
}

/** A provider's best plan on an API: its lowest rank, the first when none has a rank. */
function bestPlan(plans: Answer[]): Answer | undefined {
  const ranked = plans.filter((plan) => typeof plan.rank === 'number');
  if (ranked.length === 0) return plans[0];
  return ranked.reduce((best, plan) => ((plan.rank as number) < (best.rank as number) ? plan : best));
}

/** A tool of ours: an ADK FunctionTool, its answer an object the model reads. */
export type DatacircleTool<Name extends string = string> = FunctionTool<any> & { readonly name: Name };

// The call stops when the run is aborted (the runner's abortSignal). A network failure throws, and ADK gives the model
// its message as {error}.
function define<In, Name extends string>(
  name: Name,
  description: string,
  schema: Input,
  run: (input: In, signal?: AbortSignal) => Promise<Answer>,
): DatacircleTool<Name> {
  return new FunctionTool({
    name,
    description,
    parameters: schema.schema as never,
    execute: async (raw: unknown, context?: { abortSignal?: AbortSignal }) => {
      const read = schema.read(raw);
      return read.input !== undefined ? run(read.input as In, context?.abortSignal) : { error: read.error };
    },
  }) as DatacircleTool<Name>;
}

/** The four tools, in this order. Their answers name each other by these names. */
export type DatacircleTools = [
  DatacircleTool<'datacircle_list_apis'>,
  DatacircleTool<'datacircle_best_plans'>,
  DatacircleTool<'datacircle_search_plans'>,
  DatacircleTool<'datacircle_provider'>,
];

/**
 * The four tools, for an LlmAgent's tools: datacircle_list_apis (GET /apis), datacircle_best_plans (GET /apis/{slug}/best),
 * datacircle_search_plans (GET /plans) and datacircle_provider (GET /providers/{slug}).
 */
export function datacircleTools(options?: DatacircleOptions): DatacircleTools {
  const client = new Client(options);
  return [
    define<ListApisInput, 'datacircle_list_apis'>('datacircle_list_apis', LIST_APIS_ABOUT, listApisInput,
      (input, signal) => listApisRun(client, input, signal)),
    define<BestPlansInput, 'datacircle_best_plans'>('datacircle_best_plans', BEST_PLANS_ABOUT, bestPlansInput,
      (input, signal) => bestPlansRun(client, input, signal)),
    define<SearchPlansInput, 'datacircle_search_plans'>('datacircle_search_plans', SEARCH_PLANS_ABOUT, searchPlansInput,
      (input, signal) => searchPlansRun(client, input, signal)),
    define<ProviderInput, 'datacircle_provider'>('datacircle_provider', PROVIDER_ABOUT, providerInput,
      (input, signal) => providerRun(client, input, signal)),
  ];
}

// The same calls without an agent: each gives the answer the model would read, as an object.

/** GET /apis: the APIs, as datacircle_list_apis gives them. */
export const listApis = (input: ListApisInput = {}, options?: DatacircleOptions) => listApisRun(new Client(options), input);

/** GET /apis/{slug}/best: an API's plans best first, as datacircle_best_plans gives them. */
export const bestPlans = (input: BestPlansInput, options?: DatacircleOptions) => bestPlansRun(new Client(options), input);

/** GET /plans: the plans found, as datacircle_search_plans gives them. */
export const searchPlans = (input: SearchPlansInput = {}, options?: DatacircleOptions) => searchPlansRun(new Client(options), input);

/** GET /providers/{slug}: where a provider ranks, as datacircle_provider gives it. */
export const providerRanks = (input: ProviderInput, options?: DatacircleOptions) => providerRun(new Client(options), input);
