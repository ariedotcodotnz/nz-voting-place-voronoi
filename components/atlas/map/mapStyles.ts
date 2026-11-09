/**
 * Muted roadmap styling for raster maps (used when no cloud Map ID is
 * configured). Election colours carry the meaning, so the basemap recedes:
 * low saturation, no points of interest, quiet roads, readable place names.
 * With NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID set, styling comes from the cloud
 * console instead and these rules are not applied.
 */
const MUTED_ROADMAP: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ saturation: -80 }, { lightness: 8 }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ saturation: -100 }, { lightness: 30 }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ saturation: -100 }, { lightness: 10 }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#cdd8e0" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#6f8796" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#f1f2f0" }] },
  { featureType: "administrative", elementType: "labels.text.fill", stylers: [{ color: "#3d4954" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.neighborhood", elementType: "labels.text.fill", stylers: [{ color: "#6b7782" }] },
];

/** Google's own town and suburb names sit underneath the election overlay.
 *  When the atlas draws its own place names on top, those are hidden so the
 *  same name is not shown twice at slightly different positions. */
const HIDE_PLACE_NAMES: google.maps.MapTypeStyle[] = [
  { featureType: "administrative.locality", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.neighborhood", elementType: "labels", stylers: [{ visibility: "off" }] },
];

export function basemapStyles(placeLabelsOnTop: boolean): google.maps.MapTypeStyle[] {
  return placeLabelsOnTop ? [...MUTED_ROADMAP, ...HIDE_PLACE_NAMES] : MUTED_ROADMAP;
}

export const NZ_BOUNDS = { north: -34.1, south: -47.5, west: 166.0, east: 178.9 };
