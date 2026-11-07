// Répliques de marchandage, écrites à la main par trait (greedy / friendly / proud) et par événement.
// Choix déterministe (séance × manche) : variété sans hasard côté client, et aucun appel LLM nécessaire.
import type { HaggleEvent, HaggleTrait } from '@tokengo/shared';

type Lines = Record<HaggleEvent | 'deal' | 'deal-flat', string[]>;

const LINES: Record<HaggleTrait, Lines> = {
  greedy: {
    opened: ['Haggling? My favourite sport. Show me your cards.', 'Everything is negotiable. Almost.', 'Talk fast, runner — my prices only go up.'],
    'bulk-good': ['Now we are talking volume! I like volume.', 'A big order? My till is smiling.'],
    'bulk-meh': ['That is not bulk, that is a snack.', 'Bulk? Come back with a real pile.'],
    'regular-good': ['A regular, yes. Regulars keep my lights on.', 'I know your face. Fine, fine.'],
    'regular-doubt': ['Everyone says that. Nobody comes back.', 'Daily? I have never seen you before.'],
    'rival-true': ['{rival}? Ugh. Fine, I will not lose a sale to {rival}.', 'You checked {place}? Sharp. I can match… a bit.'],
    'rival-false': ['{rival}? Their price is worse, check your notes!', 'Nice try. I know exactly what {rival} charges.'],
    'bluff-works': ['Cheaper down the street? …I cannot risk it. Fine.', 'Hmph. I need this sale. Go on.'],
    'bluff-caught': ['Which shop? Name it. Thought so.', 'Bluffing a gambler? Bold. Wrong.'],
    'compliment-good': ['Flattery! I accept it. Grudgingly.'],
    'compliment-meh': ['Compliments do not pay rent.', 'Nice words. Got Flux?'],
    'lowball-good': ['Ouch… but I need the Flux. Deal-ish.', 'You found my weak spot. Do not tell anyone.'],
    'lowball-bad': ['Are you robbing me? With a smile?', 'That offer is an insult. A small one, but still.'],
    'walk-back': ['Wait, wait! Come back. One last offer.', 'Hey! Do not leave. Let us fix this.'],
    'walk-bye': ['Bye then. Someone else will pay.', 'Walk away, I have customers.'],
    sour: ['That is it, no more haggling. My prices just went up — for you.', 'Enough! Come back when you learn manners.'],
    deal: ['Deal! Pleasure doing business, shark.', 'Done. You drive a hard bargain.'],
    'deal-flat': ['Full price? You are my favourite customer.', 'Deal — at my price. Smart.'],
  },
  friendly: {
    opened: ['Oh, you want a little discount, dear? Let us see.', 'Haggling? How fun, sit down.', 'For you? Maybe. Convince me, sweetie.'],
    'bulk-good': ['That many! You will need a bigger bag, dear.', 'Bless you, a proper order.'],
    'bulk-meh': ['Not much of a bulk, love, but I appreciate it.'],
    'regular-good': ['Of course I remember you! My favourite runner.', 'You always stop by. That counts here.'],
    'regular-doubt': ['Every day? I will believe it when I see it, dear.', 'We will see, sweetie. Visit me first.'],
    'rival-true': ['{rival} is cheaper? Oh dear. I cannot let you go there.', 'Fine, fine — I will match {place}, more or less.'],
    'rival-false': ['{rival}? Oh no, love, they charge more than me.', 'Check again, dear — {rival} is not cheaper.'],
    'bluff-works': ['Cheaper elsewhere? Oh, I need the business… alright.', 'You would not leave me, would you? Here.'],
    'bluff-caught': ['Now now, fibbing to your elders?', 'I know every shop around here, dear. Nice try.'],
    'compliment-good': ['Oh stop it, you! Have a little something off.', 'You are too kind. That earns a discount.'],
    'compliment-meh': ['Sweet of you.'],
    'lowball-good': ['That low? Well… I do need to sell these.', 'You are lucky I am in a giving mood.'],
    'lowball-bad': ['That is very cheeky, sweetheart.', 'Goodness. No.'],
    'walk-back': ['Wait, dear! Do not go — let me see what I can do.', 'Come back! For you, a little extra.'],
    'walk-bye': ['Off you go then. Come back soon!', 'Alright, dear. My door is open.'],
    sour: ['I am a bit hurt, dear. No more bargains today.', 'That was not nice. Full price for a while.'],
    deal: ['Deal! Now wrap up warm.', 'There you go, my favourite runner.'],
    'deal-flat': ['Full price, you angel. Have a biscuit.', 'Thank you, dear. Come back soon.'],
  },
  proud: {
    opened: ['Haggling. How… common. Make your case.', 'My prices follow the rules. Persuade me otherwise.', 'You may present arguments. Briefly.'],
    'bulk-good': ['A serious order. That deserves consideration.', 'Volume is a sound argument.'],
    'bulk-meh': ['Three shards is not a bulk order.', 'Hardly a wholesale deal.'],
    'regular-good': ['A loyal client. Loyalty is the rarest shard.', 'You have earned some consideration.'],
    'regular-doubt': ['Promises are not data.', 'Come back daily first. Then we talk.'],
    'rival-true': ['{rival}? Hmph. Their quality is… fine. I will adjust.', 'Comparing me to {place}. Rude, but correct.'],
    'rival-false': ['{rival} charges more. Your data is wrong.', 'Footnote: {rival} is NOT cheaper.'],
    'bluff-works': ['Unverified claim… but I will not risk the sale.'],
    'bluff-caught': ['A bluff. How disappointing.', 'Citation needed.'],
    'compliment-good': ['Finally, someone who appreciates the craft.', 'You have taste. That deserves a small reward.'],
    'compliment-meh': ['Noted.'],
    'lowball-good': ['…The numbers do say I should sell. Very well.', 'Against my principles. But my stock agrees.'],
    'lowball-bad': ['An insult to the formula.', 'Absolutely not. Do not test me.'],
    'walk-back': ['One moment. A final, rational offer.', 'Wait. Let us be reasonable.'],
    'walk-bye': ['As you wish.', 'The door is behind you.'],
    sour: ['We are done here. My prices will reflect my mood.', 'I will remember this.'],
    deal: ['Agreed. A fair, documented deal.', 'Deal. Respect the craft.'],
    'deal-flat': ['The rules decide. Good choice.', 'At list price. Impeccable.'],
  },
};

export interface LineVars { rival?: string; place?: string }

/** Réplique déterministe pour (trait, événement), variée selon la graine. */
export function haggleLine(trait: HaggleTrait, event: HaggleEvent | 'deal' | 'deal-flat', seed: string, vars: LineVars = {}): string {
  const list = LINES[trait][event];
  let h = 7;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const t = list[h % list.length]!;
  return t.replaceAll('{rival}', vars.rival ?? 'my rival').replaceAll('{place}', vars.place ?? 'down the street');
}
