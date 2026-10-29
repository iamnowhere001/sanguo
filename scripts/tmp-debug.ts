import { createGame } from '../src/data/tables/scenarios';
import { routeForArmy } from '../src/systems/army';
import { gateSiteAt } from '../src/render/gateGrid';
const s = createGame({ scenarioId: 'chibi', playerFactionId: 'liubei', aiEnabled: false });
console.log('liubei', s.factions.liubei.cityIds, 'jiangxia', s.cities.jiangxia?.ownerId, 'xiangyang', s.cities.xiangyang?.ownerId);
for (const [from,to] of [['jiangxia','xiangyang'],['jiangling','xiangyang']] as const) {
  const r = routeForArmy(s, 'liubei', from, to);
  if (!r) { console.log(from,'→',to,'no route'); continue; }
  const gates = new Set<string>();
  for (const p of r.path) { const site = gateSiteAt(p.col,p.row); if(site) gates.add(site.gate.name); }
  console.log(from,'→',to,'days',Math.round(r.days),'path',r.path.length,'gates',[...gates].join(','));
}
