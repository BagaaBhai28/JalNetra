// The real lake locations are checked against CPCB station records and OpenStreetMap.
export const lakes = [
  {
    id: 'demo-lake',
    name: 'Demo Lake',
    kind: 'illustrative',
    zones: [
      { id: 'north-inlet', name: 'North Inlet', markerX: .45, markerY: .24 },
      { id: 'east-shore', name: 'East Shore', markerX: .73, markerY: .45 },
      { id: 'south-bank', name: 'South Bank', markerX: .46, markerY: .75 },
    ],
  },
  {
    id: 'ulsoor-lake',
    name: 'Ulsoor Lake',
    kind: 'geographic',
    center: [12.9837, 77.6200],
    gpsRadius: 700,
    zones: [
      { id: 'ulsoor-north', name: 'North sector', latitude: 12.9860, longitude: 77.6200 },
      { id: 'ulsoor-east', name: 'East sector', latitude: 12.9837, longitude: 77.6232 },
      { id: 'ulsoor-south', name: 'South sector', latitude: 12.9813, longitude: 77.6197 },
      { id: 'ulsoor-west', name: 'West sector', latitude: 12.9838, longitude: 77.6174 },
    ],
  },
  {
    id: 'sankey-tank',
    name: 'Sankey Tank',
    kind: 'geographic',
    center: [13.0085, 77.5741],
    gpsRadius: 650,
    zones: [
      { id: 'sankey-north', name: 'North sector', latitude: 13.0106, longitude: 77.5745 },
      { id: 'sankey-east', name: 'East sector', latitude: 13.0084, longitude: 77.5761 },
      { id: 'sankey-south', name: 'South sector', latitude: 13.0065, longitude: 77.5736 },
      { id: 'sankey-west', name: 'West sector', latitude: 13.0087, longitude: 77.5724 },
    ],
  },
];

export function findLake(id) {
  return lakes.find(lake => lake.id === id);
}
