// MIT. Original provider guidance is selected from the advertised tool catalog.
import { MERCHANT_PROVIDER_REGISTRY } from './providers.mjs';

const coreSections = [
  {
    "prefix": null,
    "text": "Use merchant_sources, stage, inspect and compare to prepare a release. Activate with the current generation and exact digest. Start or restart explicitly.",
    "order": 230
  },
  {
    "prefix": null,
    "text": "Only this MCP process can stop its owned runtimes.",
    "order": 270
  },
  {
    "prefix": null,
    "text": "Payment verification and settlement remain in the original seller and configured facilitator.",
    "order": 440
  }
];

const sections = [...coreSections, ...Object.values(MERCHANT_PROVIDER_REGISTRY.providers).flatMap(provider => provider.instructions)]
  .sort((a, b) => a.order - b.order);

export function merchantInstructions(tools) {
  const names = tools.map(value => value.name), exact = new Set(names);
  return sections.filter(section => section.tool ? exact.has(section.tool) :
    section.prefix === null || names.some(name => name.startsWith(section.prefix)))
    .map(section => section.text).join(' ');
}
