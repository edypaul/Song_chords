import { generateGuitarVoicings } from '../packages/shared/src/chord-engine/voicing-generator';
const v = generateGuitarVoicings('F', 10);
console.log('F (top 10):');
for (const x of v) console.log(`  [${x.frets.join(',')}]${x.barre ? ` BARRE:${x.barre.fromString}-${x.barre.toString}` : ''}`);
