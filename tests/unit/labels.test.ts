import { describe, expect, it } from "vitest";
import { declutter, project } from "@/lib/atlas/labels";
import { labelZoomRange } from "@/components/atlas/map/placeLabels";

const measure = (text: string, size: number) => text.length * size * 0.6;
const L = (text: string, lng: number, lat: number, priority: number) => ({ text, lng, lat, priority, size: 12, weight: 500 });

describe("place-label decluttering", () => {
  it("never places two labels whose boxes overlap", () => {
    const items = Array.from({ length: 400 }, (_, k) => L(`Place ${k}`, 174.7 + (k % 20) * 0.004, -41.3 + Math.floor(k / 20) * 0.004, k % 7));
    const zoom = 12;
    const placed = declutter(items, zoom, measure);
    const boxes = placed.map((p) => {
      const [x, y] = project(p.lng, p.lat, zoom);
      const hw = measure(p.text, p.size) / 2 + 6;
      const hh = p.size * 0.625 + 3;
      return [x - hw, y - hh, x + hw, y + hh];
    });
    for (let a = 0; a < boxes.length; a++)
      for (let b = a + 1; b < boxes.length; b++) {
        const [A, B] = [boxes[a], boxes[b]];
        expect(A[0] < B[2] && A[2] > B[0] && A[1] < B[3] && A[3] > B[1]).toBe(false);
      }
    expect(placed.length).toBeGreaterThan(10);
  });
  it("keeps the higher-priority label when two collide", () => {
    const placed = declutter([L("Suburb", 174.7762, -41.2865, 3), L("Wellington", 174.7763, -41.2866, 1e6)], 12, measure);
    expect(placed.map((p) => p.text)).toEqual(["Wellington"]);
  });
  it("shows more labels as you zoom in", () => {
    const items = Array.from({ length: 100 }, (_, k) => L(`P${k}`, 174.7 + k * 0.002, -41.3, 1));
    expect(declutter(items, 14, measure).length).toBeGreaterThan(declutter(items, 10, measure).length);
  });
  it("reveals busier localities at lower zoom than small ones", () => {
    expect(labelZoomRange("locality", 20)[0]).toBeLessThan(labelZoomRange("locality", 1)[0]);
    expect(labelZoomRange("region", 0)[1]).toBeLessThanOrEqual(labelZoomRange("city", 0)[0]);
  });
});
