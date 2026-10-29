import { MAP } from '../src/data/tables/geography';
import { cityAnchors, isWaterKind, tileKindAt } from '../src/render/terrainGrid';
const N = MAP.cols * MAP.rows;
const isLandStep = (c:number,r:number):boolean => c>=0&&r>=0&&c<MAP.cols&&r<MAP.rows&&!isWaterKind(tileKindAt(c,r))&&tileKindAt(c,r)!=='mountain';
const dist = new Float64Array(N).fill(Infinity);
const q:number[]=[]; let head=0;
for (const a of Object.values(cityAnchors())) { const i=a.row*MAP.cols+a.col; if(!isLandStep(a.col,a.row))continue; dist[i]=0; q.push(i); }
while(head<q.length){const i=q[head++];const c=i%MAP.cols,r=(i-c)/MAP.cols;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const){const nc=c+dx,nr=r+dy;if(!isLandStep(nc,nr))continue;const ni=nr*MAP.cols+nc;if(dist[ni]!>dist[i]!+1){dist[ni]=dist[i]!+1;q.push(ni);}}}
const cd=(p:any)=>dist[p.row*MAP.cols+p.col];
function detour(a:any,b:any,cap:number){const mark=new Uint8Array(N);const s=a.row*MAP.cols+a.col,t=b.row*MAP.cols+b.col;mark[s]=1;let f=[s];for(let d=1;d<=cap;d++){const nx:number[]=[];for(const i of f){const c=i%MAP.cols,r=(i-c)/MAP.cols;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const){const nc=c+dx,nr=r+dy;if(!isLandStep(nc,nr))continue;const ni=nr*MAP.cols+nc;if(mark[ni])continue;if(ni===t)return d;mark[ni]=1;nx.push(ni);}}if(!nx.length)break;f=nx;}return -1;}
const checks: any[] = [
  ['xiakou diag', {col:318,row:231}, {col:332,row:245}, 13],
  ['xiakou NS', {col:329,row:245}, {col:329,row:221}, 23],
  ['xiakou NS center328', {col:328,row:245}, {col:328,row:221}, 23],
];
for (const [name,a,b,len] of checks) console.log(name, 'cityDist', cd(a), cd(b), 'detour', detour(a,b,len*4+24));
