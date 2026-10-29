import { cityAnchors, cityBlocks, tileKindAt, approachTileAt } from '../src/render/terrainGrid';
import { MAP } from '../src/data/tables/geography';
import { marchDaysOfTile } from '../src/data/tables/marchCost';

const anchor = cityAnchors()['tianshui'];
console.log('tianshui anchor', anchor, 'map', MAP.cols, MAP.rows);
const block = cityBlocks()['tianshui'];
console.log('block', block);
if (anchor) {
  for (let row = anchor.row - 6; row <= anchor.row + 6; row++) {
    let line = String(row).padStart(3) + ' ';
    for (let col = anchor.col - 8; col <= anchor.col + 8; col++) {
      const kind = tileKindAt(col, row);
      const ch = kind === 'mountain' ? 'M' : kind === 'hill' ? 'h' : kind === 'forest' ? 'f' : kind === 'river' ? '~' : kind === 'lake' ? 'L' : kind === 'marsh' ? 'm' : kind === 'desert' ? '.' : kind === 'plain' ? ' ' : kind === 'sea' ? 'S' : '?';
      line += ch;
    }
    console.log(line);
  }
}
