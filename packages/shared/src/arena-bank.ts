// Banque d'épreuves de l'Arène (Docs/13 §4 « Lien avec l'IA ») : énoncés concrets par catégorie + gabarits de commentaire.
// Anglais, sans ambiguïté, rien de sensible. Le serveur tire l'énoncé avec la graine du combat ; le commentaire est choisi
// de façon déterministe (graine + manche). Placeholders : {w} = modèle gagnant, {l} = perdant, {h} = celui qui hallucine.
import type { Category } from './economy/rules.ts';

export const CHALLENGE_BANK: Record<Category, readonly string[]> = {
  math: [
    'What is 17 × 24, without a calculator?',
    'A croissant costs 1.30 €. How many can you buy with 10 €?',
    'Find the next number: 1, 1, 2, 3, 5, 8, ___',
    'Prove there are infinitely many primes — in two lines.',
    'The Seine is 777 km long. How many marathons is that?',
    'Solve for x: 3x + 7 = 31',
    'What is 15 % of a 48 € museum ticket?',
    'How many seconds are there in a week?',
    'A metro train leaves every 4 minutes. How many trains in 2 hours?',
    'Is 221 a prime number? Show why.',
  ],
  code: [
    'Find the bug in 12 lines of Python.',
    'Reverse a linked list — in place.',
    'Write a regex that matches a French postcode.',
    'Why does `0.1 + 0.2 !== 0.3` in JavaScript?',
    'Turn this nested callback mess into async/await.',
    'Write FizzBuzz without a single if statement.',
    'Explain this SQL query that runs for 40 seconds.',
    'Center a div. Vertically. On the first try.',
    'Write a function that checks if a word is a palindrome.',
    'Find the off-by-one error in this loop.',
  ],
  writing: [
    'Write a haiku about the Seine.',
    'Pitch a croissant startup in one sentence.',
    'Write a breakup letter from a pigeon to a statue.',
    'Describe the Eiffel Tower to someone who has never seen metal.',
    'Write a six-word horror story set in the metro.',
    'Make a grocery list sound like an epic poem.',
    'Write a polite complaint about a rainy picnic.',
    'Write a limerick about a lost umbrella in Montmartre.',
    'Write the opening line of a Paris detective novel.',
    'Turn a weather forecast into a love song.',
  ],
  vision: [
    'What is in this photo? 🗼🌧',
    'Read the menu on this blurry café chalkboard.',
    'Count the pigeons on this statue. 🐦🐦🐦🗿🐦',
    'Which painting is this? 🖼️ a smiling woman, no eyebrows.',
    'Describe this chart: sales go 📈 then 📉.',
    'Spot the difference between two photos of Notre-Dame.',
    'What time is it on this station clock? 🕰️',
    'Is this a croissant or a cat curled up? 🥐🐈',
    'Read the street sign through the rain: « Rue de R...oli ».',
    'Guess the city from this skyline: 🗼🏛️🎡',
  ],
  speed: [
    'First to answer wins: capital of Japan?',
    'Autocomplete 1,000 tweets before the metro doors close.',
    'Summarize a 300-page novel in 3 seconds.',
    'Answer 50 trivia questions in a row, fast.',
    'Translate a menu before the waiter comes back.',
    'Name 10 fruits. Go!',
    'Spell-check a whole Wikipedia page, now.',
    'Reply to 200 emails before lunch.',
    'Tag 500 photos before the battery dies.',
    'Classify 1,000 reviews as happy or grumpy.',
  ],
  lang: [
    'Translate « Bonjour, ça va ? » into Japanese.',
    'Explain « avoir le cafard » to a tourist.',
    'Order a coffee in Italian, politely.',
    'Translate a pun from French to English — keep the joke.',
    'Say « thank you » in five languages.',
    'What does « l’esprit de l’escalier » mean?',
    'Write directions to the Louvre in Spanish.',
    'Translate a Mandarin proverb into French.',
    'Explain the difference between « tu » and « vous ».',
    'Turn English slang into proper German.',
  ],
};

/** Gabarits de commentaire de victoire de manche, par catégorie ({w} gagne, {l} perd). */
export const WIN_LINES: Record<Category, readonly string[]> = {
  math: [
    '{w} showed its work — {l} forgot to carry the 1.',
    '{w} nailed it in one line. {l} is still drawing a table.',
    '{l} rounded too early. {w} did not.',
    '{w}: correct to the last decimal. {l}: “approximately”.',
  ],
  code: [
    '{w} found the bug. {l} wrote three new ones.',
    '{w} shipped it with tests. {l} shipped it on Friday.',
    '{l} forgot a semicolon. {w} forgot nothing.',
    '{w} compiled on the first try — {l} blamed the cache.',
  ],
  writing: [
    '{w}’s answer even rhymed — {l} over-explained it.',
    '{w} made the judges cry. {l} made them check their phones.',
    '{l} wrote an essay. {w} wrote poetry.',
    '{w} found the perfect word. {l} used “delve” twice.',
  ],
  vision: [
    '{w} saw it at a glance — {l} described the wrong photo.',
    '{w} spotted every detail. {l} spotted a vibe.',
    '{l} saw a duck. It was a rabbit. {w} knew.',
    '{w} read it through the rain. {l} needed glasses.',
  ],
  speed: [
    '{w} answered before the question ended. {l} was still loading.',
    '{w} sprinted. {l} buffered.',
    '{l} was thoughtful. {w} was first.',
    '{w} finished, then made a coffee. {l} finished.',
  ],
  lang: [
    '{w} sounded like a local. {l} sounded like a phrasebook.',
    '{w} kept the pun alive — {l} translated it to death.',
    '{l} mixed up “tu” and “vous”. {w} was impeccably polite.',
    '{w} even got the accent right. {l} got lost in translation.',
  ],
};

/** Un modèle hallucine ({h}) : la manche bascule. */
export const HALLUC_LINES: readonly string[] = [
  '{h} confidently invented a fact. The judges were not amused.',
  '{h} hallucinated a whole new answer. Bold. Wrong.',
  '{h} cited a source that does not exist.',
  '{h} went off on a tangent about pigeons.',
];

/** Égalité parfaite. */
export const TIE_LINES: readonly string[] = [
  'Dead heat — the judges could not split {w} and {l}.',
  'Same score, same swagger: {w} and {l} tie.',
];

/** Ligne finale du combat ({w} = vainqueur du combat : « You » ou le nom de l'adversaire). */
export const FINAL_LINES = {
  won: [
    'Clean sweep of prompts. The arena chants your handle.',
    'Smart rotation, smart prompts — that is how you win an arena.',
    'You played the matchups like a pro.',
  ],
  lost: [
    'Close one. Rotate better, prompt smarter, come back stronger.',
    'The defender read the matchups better this time.',
    'Not today — but your models learned a lot.',
  ],
} as const;
