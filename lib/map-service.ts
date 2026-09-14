export type MapPoint = {
  lat: number;
  lng: number;
  address: string;
  placeId?: string;
};
export interface MapProvider {
  searchUrl(address: string): string;
  previewUrl(point: MapPoint): string;
  directionsUrl(point: MapPoint): string;
}
// Provider URLs stay here. No provider-specific fields enter the snapshot.
export const mapProvider: MapProvider = {
  searchUrl: (address) =>
    `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`,
  previewUrl: ({ lat, lng }) =>
    `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.008},${lat - 0.006},${lng + 0.008},${lat + 0.006}&layer=mapnik&marker=${lat},${lng}`,
  directionsUrl: ({ lat, lng }) =>
    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
};
export function validCoordinates(lat?: number, lng?: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat!) <= 90 &&
    Math.abs(lng!) <= 180
  );
}
