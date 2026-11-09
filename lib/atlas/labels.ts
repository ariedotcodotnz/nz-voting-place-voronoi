/**
 * Greedy label decluttering in Web-Mercator pixel space. Relative label
 * positions depend only on zoom (not on panning), so the result for a zoom
 * level is stable while the map moves. Labels are placed in priority order
 * and skipped if their padded box overlaps one already placed.
 */
export interface LabelCandidate {
  text: string;
  lng: number;
  lat: number;
  priority: number;
  size: number;
  weight: number;
}

const TILE = 256;

export function project(lng: number, lat: number, zoom: number): [number, number] {
  const world = TILE * Math.pow(2, zoom);
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return [((lng + 180) / 360) * world, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world];
}

export function declutter<T extends LabelCandidate>(items: T[], zoom: number, measure: (text: string, size: number, weight: number) => number, padX = 6, padY = 3): T[] {
  const CELL = 128;
  const grid = new Map<string, [number, number, number, number][]>();
  const placed: T[] = [];
  const sorted = [...items].sort((a, b) => b.priority - a.priority);
  for (const it of sorted) {
    const [x, y] = project(it.lng, it.lat, zoom);
    const hw = measure(it.text, it.size, it.weight) / 2 + padX;
    const hh = (it.size * 1.25) / 2 + padY;
    const box: [number, number, number, number] = [x - hw, y - hh, x + hw, y + hh];
    const cx0 = Math.floor(box[0] / CELL);
    const cx1 = Math.floor(box[2] / CELL);
    const cy0 = Math.floor(box[1] / CELL);
    const cy1 = Math.floor(box[3] / CELL);
    let hit = false;
    for (let cx = cx0; cx <= cx1 && !hit; cx++) {
      for (let cy = cy0; cy <= cy1 && !hit; cy++) {
        for (const b of grid.get(`${cx}:${cy}`) ?? []) {
          if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) continue;
    placed.push(it);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const k = `${cx}:${cy}`;
        const list = grid.get(k);
        if (list) list.push(box);
        else grid.set(k, [box]);
      }
    }
  }
  return placed;
}
