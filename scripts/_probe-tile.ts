import { lonLatToTile } from '../src/data/tables/geography';
for (const [lon, lat] of [[114.0,37.9],[111.0,33.72],[108.15,34.92],[105.9,31.9],[110.25,34.6],[113.2,34.85],[111.55,34.62],[106.6,31.3],[112.92,34.3],[104.9,32.55],[105.55,32.3],[107.0,34.0],[106.2,33.45],[105.5,33.95]]) {
  const t = lonLatToTile(lon!, lat!);
  console.log(`${lon},${lat} -> ${Math.floor(t.col)},${Math.floor(t.row)}`);
}
