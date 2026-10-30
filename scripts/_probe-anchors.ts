/** 临时探针：打印城心坐标（用完即删） */
import { cityAnchors } from '../src/render/terrainGrid';
const ids = ['changan','hongnong','luoyang','wan','xuchang','chenliu','anding','jinyang','ye','shangdang','tianshui','hanzhong','zhangtong','langzhong','jiangzhou','shangyong','badong','wudu','mianzhu','chengdu','shouchun','pengcheng','guangling','xiapi','langya'];
const a = cityAnchors();
for (const id of ids) console.log(`${id}: ${a[id]?.col},${a[id]?.row}`);
