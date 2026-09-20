/**
 * KNITCAT V2 — care instructions (spec §3.2 CareInstructions, §3.8 care).
 *
 * Turns behaviour scores + a fibre list into a concrete, printable care label and the standard
 * laundry symbol codes knitters recognise. The care block on a finished pattern ("hand wash
 * cool, dry flat, do not tumble") is generated from the fibre, never typed — so swapping to a
 * superwash merino updates the label automatically. DOM-free.
 *
 * @module yarn/care
 */

import { normalizeFiber, behaviourFor } from './behavior.js';

/** ISO 3758-style care symbols (as short tokens the UI maps to glyphs). */
export const CARE_SYMBOLS = Object.freeze({
  washHand: 'W1', washGentle: 'W2', washMachine: 'W', doNotWash: 'WF',
  bleachOk: 'B', doNotBleach: 'B̶',
  tumbleLow: 'T1', tumbleMed: 'T2', doNotTumble: 'TF',
  dryFlat: 'D—', lineDry: 'D⌐', doNotWring: 'DW',
  ironLow: 'I1', ironMed: 'I2', ironHigh: 'I3', doNotIron: 'IF',
  dryClean: 'P', dryCleanAny: 'F'
});

/**
 * Build a structured {@link CareInstructions} object for a fibre composition.
 * @param {Array|object|string} fiber @param {object} [behaviour] precomputed behaviourFor()
 * @returns {{wash:string, washTempC:number, bleach:boolean, dry:string, tumble:boolean, iron:string, dryClean:boolean, symbols:string[], text:string}}
 */
export function careInstructions(fiber, behaviour) {
  const b = behaviour || behaviourFor(fiber);
  const names = normalizeFiber(fiber).map(f => f.name);
  const animal = names.some(n => ['wool', 'merino', 'alpaca', 'cashmere', 'mohair', 'angora', 'yak', 'qiviut', 'possum'].includes(n));
  const superwash = names.includes('superwash') || /superwash/i.test(String(fiber));
  const silk = names.includes('silk');
  const plant = names.some(n => ['cotton', 'linen', 'hemp', 'bamboo', 'tencel'].includes(n));

  let wash, washTempC;
  if (animal && !superwash) { wash = 'hand wash cool'; washTempC = 20; }
  else if (superwash) { wash = 'machine wash gentle'; washTempC = 30; }
  else if (silk) { wash = 'hand wash cold'; washTempC = 20; }
  else { wash = 'machine wash'; washTempC = 40; }

  const dry = (animal || b.recovery < 0.6) ? 'dry flat' : (plant ? 'tumble low or line dry' : 'line dry');
  const tumble = !!(plant && !animal && names.includes('acrylic'));
  const iron = plant ? (names.includes('linen') || names.includes('hemp') ? 'high' : 'low') : 'none';
  const dryClean = b.felting > 0.6 && b.drape > 0.75;

  const symbols = [];
  symbols.push(animal && !superwash ? CARE_SYMBOLS.washHand : CARE_SYMBOLS.washMachine);
  symbols.push(CARE_SYMBOLS.doNotBleach);
  symbols.push(tumble ? CARE_SYMBOLS.tumbleLow : CARE_SYMBOLS.doNotTumble);
  symbols.push(dry === 'dry flat' ? CARE_SYMBOLS.dryFlat : CARE_SYMBOLS.lineDry);
  symbols.push(iron === 'none' ? CARE_SYMBOLS.doNotIron : (iron === 'high' ? CARE_SYMBOLS.ironHigh : CARE_SYMBOLS.ironLow));
  if (dryClean) symbols.push(CARE_SYMBOLS.dryCleanAny);

  const text = `${cap(wash)} at ${washTempC}°C. Do not bleach. ${cap(dry)}.`
    + (tumble ? ' Tumble dry low.' : ' Do not tumble dry.')
    + (iron === 'none' ? ' Do not iron.' : ` Iron on ${iron}.`)
    + (dryClean ? ' Dry cleanable.' : '');

  return { wash, washTempC, bleach: false, dry, tumble, iron, dryClean, symbols, text };
}

/**
 * A human care label for the finished pattern, one clause per line, as knitters pin them.
 * @param {Array|object|string} fiber @returns {string[]}
 */
export function careLabel(fiber) {
  const c = careInstructions(fiber);
  return [
    `Wash: ${c.wash} (${c.washTempC}°C)`,
    `Bleach: no`,
    `Dry: ${c.dry}`,
    `Tumble: ${c.tumble ? 'low' : 'no'}`,
    `Iron: ${c.iron}`,
    c.dryClean ? `Dry clean: okay` : `Dry clean: not needed`
  ];
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
