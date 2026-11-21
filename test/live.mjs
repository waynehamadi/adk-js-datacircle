// Each tool's own call on the live API, as ADK makes it: the model's arguments to the tool's runAsync, then its execute;
// and the answers a model's mistakes get. npm test
import { LlmAgent } from '@google/adk';
import { bestPlans, datacircleTools, listApis, providerRanks, searchPlans } from '@datacircle/adk';

const [listTool, bestTool, searchTool, providerTool] = datacircleTools();
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failed++;
};
// The tool's call as ADK's agent loop makes it: the arguments as the model sent them, and the call's context.
const run = async (t, args, abortSignal) => {
  const output = await t.runAsync({ args, toolContext: { abortSignal } });
  if (typeof output !== 'object' || output === null) throw new Error(`${t.name} gave ${typeof output}, not an object`);
  return output;
};

// What the model is sent of each tool: its name, its description and a Gemini Schema.
const declared = datacircleTools().map((t) => t._getDeclaration());
check('declarations', declared.every((d) => d.parameters?.type === 'OBJECT' && d.description.includes('https://datacircle.dev')) &&
  JSON.stringify(declared.map((d) => d.parameters.required ?? [])) === '[[],["slug"],[],["slug"]]',
  declared.map((d) => `${d.name}(${Object.keys(d.parameters.properties).join(',')})`).join(' '));

let r = await run(listTool, {});
check('list_apis', r.total > 100 && r.apis.length === 20 && r.apis[0].slug, `total ${r.total}, first ${r.apis[0]?.slug}`);
r = await run(listTool, { query: 'email', limit: '3' });
check('list_apis email, limit as a string', r.apis?.length === 3 && r.apis.every((a) => /email/i.test(a.api + a.slug)) && !r.note, r.apis?.map((a) => a.slug).join(', '));
r = await run(listTool, { query: 'Bright Data', limit: null });
check('list_apis provider name', typeof r.note === 'string' && r.note.includes('datacircle_search_plans'), r.note);

r = await run(bestTool, { slug: 'email-finder', limit: 3 });
check('best_plans', r.plans.length === 3 && r.plans[0].rank === 1 && typeof r.plans[0].score === 'number' && r.plans[0].page && !('aggregators' in r.plans[0]),
  `${r.api}: ${r.plans.map((p) => `${p.rank}. ${p.provider} ${p.score}`).join(' / ')}`);
r = await run(bestTool, { slug: 'Email Finder', limit: 99 });
check('best_plans name, limit 99', r.plans?.length >= 10 && r.slug === 'email-finder', `${r.plans?.length} plans`);
r = await run(bestTool, { slug: 'bright-data' });
check('best_plans unknown slug', r.error?.startsWith('no API has the slug bright-data') && r.error.includes('datacircle_search_plans'), r.error);
r = await run(bestTool, { limit: 2 });
check('best_plans no slug', r.error === "The input does not fit the tool's schema: slug: is needed", r.error);
r = await run(bestTool, { slug: 'serp', limit: 'many' });
check('best_plans limit not a number', /schema: limit: must be a whole number/.test(r.error ?? ''), r.error);
r = await run(bestTool, { slug: { name: 'serp' } });
check('best_plans slug an object', /schema: slug: must be text/.test(r.error ?? ''), r.error);

r = await run(searchTool, { query: 'bright data', sort: 'price', limit: 5 });
check('search_plans', r.total > 0 && r.plans.length === 5 && r.plans.every((p) => /bright data/i.test(p.provider)), `total ${r.total}, cheapest ${r.plans[0]?.perThousand}`);
r = await run(searchTool, { api: 'email-finder', limit: 2, offset: 1 });
check('search_plans api offset', r.plans.length === 2 && r.plans[0].rank === 2, r.plans.map((p) => `${p.rank}. ${p.provider}`).join(' / '));
r = await run(searchTool, { api: 'Bright Data' });
check('search_plans provider as api', r.total > 0 && r.note?.startsWith('No API is named'), `total ${r.total}: ${r.note}`);
r = await run(searchTool, { query: 'bright-data' });
check('search_plans slug as query', r.total > 0 && r.note?.includes('"bright data"'), `total ${r.total}: ${r.note}`);
r = await run(searchTool, { offset: -3, limit: 0, extra: 'dropped' });
check('search_plans out of range, a key of its own: the defaults', r.plans?.length === 10 && r.offset === 0, `${r.plans?.length} plans`);
r = await run(searchTool, { api: null, query: 'emelia', sort: null, limit: null, offset: null });
check('search_plans nulls', r.total > 0 && r.plans.every((p) => /emelia/i.test(p.provider + p.plan)), `total ${r.total}`);
r = await run(searchTool, { sort: 'Price', limit: 1 });
check('search_plans sort in capitals', r.plans?.length === 1 && !r.error, JSON.stringify(r.plans?.[0]?.perThousand));
r = await run(searchTool, { sort: 'cheapest' });
check('search_plans bad sort', /schema: sort: must be score, provider, price/.test(r.error ?? ''), r.error);

r = await run(providerTool, { slug: 'Bright Data' });
check('provider', r.slug === 'bright-data' && r.total > 10 && r.ranked > 0 && r.apis[0].rank <= r.apis[1].rank && r.apis[0].best?.plan,
  `${r.provider}: ${r.total} APIs, ranked on ${r.ranked}, best ${r.apis[0].api} #${r.apis[0].rank}`);
r = await run(providerTool, { slug: 'nobody-x' });
check('provider unknown', r.error?.startsWith('no provider has the slug nobody-x'), r.error);
r = await run(providerTool, { slug: 'email-finder' });
check("provider: an API's slug", r.error?.startsWith('no provider has the slug email-finder') && r.error.includes('datacircle_best_plans'), r.error);

// The same calls without an agent.
for (const [name, call] of [['listApis', () => listApis({ limit: 1 })], ['bestPlans', () => bestPlans({ slug: 'serp', limit: 1 })],
  ['searchPlans', () => searchPlans({ limit: 1 })], ['providerRanks', () => providerRanks({ slug: 'bright-data' })]]) {
  r = await call();
  check(name, !r.error && (r.apis ?? r.plans)?.length > 0, Object.keys(r).join(','));
}

// An LlmAgent takes the tools, and resolves them as the four it calls by name.
const agent = new LlmAgent({ name: 'gtm', model: 'gemini-2.5-flash', instruction: 'You find the best GTM APIs.', tools: datacircleTools() });
const held = (await agent.canonicalTools()).map((t) => t.name).join(',');
check("an LlmAgent's tools", held === 'datacircle_list_apis,datacircle_best_plans,datacircle_search_plans,datacircle_provider', held);

// Each call's User-Agent, through a fetch of the app's own.
const seen = [];
const [, traced] = datacircleTools({ fetch: (url, init) => (seen.push([String(url), init.headers['User-Agent']]), fetch(url, init)) });
await run(traced, { slug: 'serp', limit: 1 });
check('fetch option', seen.length === 1 && seen[0][0] === 'https://api.datacircle.dev/v1/apis/serp/best?limit=1' && seen[0][1] === 'datacircle-adk-js/0.1.0', seen.flat().join(' '));

// A network failure throws, and ADK gives the model its message.
const [, down] = datacircleTools({ baseURL: 'http://127.0.0.1:9/v1' });
r = await run(down, { slug: 'serp' }).then((answer) => answer, (error) => error);
check('network down: thrown', r instanceof Error && /Error in tool 'datacircle_best_plans': datacircle: fetch failed/.test(r.message), r.message);

// The run's abort signal stops the call.
const controller = new AbortController();
controller.abort(new Error('stopped'));
r = await run(bestTool, { slug: 'serp' }, controller.signal).then((answer) => answer, (error) => error);
check('abort signal', r instanceof Error && /stopped|abort/i.test(r.message), String(r?.message ?? JSON.stringify(r)));

console.log(failed === 0 ? 'ALL OK' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
