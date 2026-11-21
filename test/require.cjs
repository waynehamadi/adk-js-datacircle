// The package from CommonJS: require gives the same tools, and one call runs on the live API.
const { datacircleTools, bestPlans, VERSION } = require('@datacircle/adk');
const { LlmAgent } = require('@google/adk');

(async () => {
  const tools = datacircleTools();
  const answer = await tools[1].runAsync({ args: { slug: 'serp', limit: 2 }, toolContext: {} });
  const alone = await bestPlans({ slug: 'serp', limit: 1 });
  const agent = new LlmAgent({ name: 'gtm', model: 'gemini-2.5-flash', instruction: 'x', tools });
  const held = (await agent.canonicalTools()).length;
  const ok = answer.plans?.length === 2 && alone.plans?.length === 1 && held === 4 && VERSION === '0.1.0';
  console.log(`${ok ? 'ok  ' : 'FAIL'} require: ${tools.map((t) => t.name).join(',')}; serp ${answer.plans?.map((p) => p.provider).join(' / ')}; an LlmAgent holds ${held}`);
  process.exit(ok ? 0 : 1);
})();
