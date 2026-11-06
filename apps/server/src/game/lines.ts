// Phrases préécrites des marchands (repli quand le LLM n'est pas disponible ou hors budget).
import type { MerchantState } from '@tokengo/shared';

const LINES: Record<string, string[]> = {
  gambler: ['Feeling lucky? Prices move faster than pigeons here.', 'I bet you walked here for a bargain.', 'Double or nothing… just kidding, prices are fixed. Mostly.', 'Spin the city, catch the shards.', 'Odds are, someone sells cheaper. Odds are wrong.', 'High risk, high shine.'],
  hoarder: ['Ooh, shards. I collect shards. All of them.', 'Bring me shards and I will keep them forever. Well, until you buy.', 'My shelves are never full enough.', 'Everything has a price. Mine is a bit higher.', 'Have you seen my GPT pile? Beautiful.', 'I never throw anything away.'],
  scholar: ['A fine specimen. The ring timing was impeccable, I presume.', 'Prices follow scarcity — I footnote everything.', 'Claude shards pair well with old books.', 'Supply, demand, and a little philosophy.', 'Every trade is a data point.', 'Read the price breakdown. It is all rules, no magic.'],
  hustler: ['Quick trade, quick walk, quick profit. Go!', 'Buy here, sell at Bastille. You did not hear it from me.', 'Time is Flux, runner.', 'Spread is tight today. Move fast.', 'I know a guy who knows a forge.', 'Next!'],
  grandma: ['Come in, dear, you look tired from all that walking.', 'Have a biscuit. Then sell me a shard.', 'Back in my day, compute came in floppy disks.', 'Prices are fair here, I promise on my knitting.', 'Wrap up warm, the Seine is windy.', 'Such a good runner. Your mother must be proud.'],
  purist: ['Only clean shards, please. No smudges.', 'I price by the rules. The rules are beautiful.', 'Quality over quantity.', 'A shard is a shard. Unless it is a Claude.', 'No haggling. The formula decides.', 'Respect the craft.'],
  trendchaser: ['Everyone wants Gemini today. Or was it GPT? Both!', 'The forges are hyped, prices are spicy.', 'Whatever is hot, I have it. Or I want it.', 'Did you see the Pulse? Wild day.', 'New day, new recipes, new vibes.', 'Trending: you, walking in here.'],
  nightowl: ['Ah, a fellow wanderer of the late hours.', 'The best trades happen when the city sleeps.', 'Shh. The shards glow brighter at night.', 'Coffee, compute, repeat.', 'I never close. Unless I go bankrupt.', 'The moon sets the prices. Kidding. The rules do.'],
};

/** Salutation stable 10 min par marchand × joueur. */
export function greetingFor(m: MerchantState, userId: string, now: number): string {
  if (m.status === 'closed') return 'My till is empty. Sell me nothing, invest in me everything.';
  if (m.status === 'closing') return "Times are tough. I'm selling cheap — and I could use an investor.";
  if (m.mood) return m.mood;
  const list = LINES[m.archetype] ?? LINES.purist!;
  let h = Math.floor(now / 600_000);
  for (const c of userId + m.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length]!;
}
