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
    locality: 'Halasuru, central Bengaluru',
    description: 'Also called Halasuru Lake. Its shoreline is mapped here in four reporting sectors.',
    reference: 'https://cpcb.nic.in/wqm/WQMN_list.pdf',
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
    locality: 'Malleshwaram area, north Bengaluru',
    description: 'An urban tank near Malleshwaram, included in the Central Pollution Control Board station list.',
    reference: 'https://cpcb.nic.in/wqm/WQMN_list.pdf',
    gpsRadius: 650,
    zones: [
      { id: 'sankey-north', name: 'North sector', latitude: 13.0106, longitude: 77.5745 },
      { id: 'sankey-east', name: 'East sector', latitude: 13.0084, longitude: 77.5761 },
      { id: 'sankey-south', name: 'South sector', latitude: 13.0065, longitude: 77.5736 },
      { id: 'sankey-west', name: 'West sector', latitude: 13.0087, longitude: 77.5724 },
    ],
  },
  {
    id: 'agara-lake',
    name: 'Agara Lake',
    kind: 'geographic',
    center: [12.9210, 77.6412],
    gpsRadius: 650,
    locality: 'Near HSR Layout, southeast Bengaluru',
    description: 'A lake in the Koramangala–Challaghatta valley, next to the northern side of HSR Layout.',
    reference: 'https://wgbis.ces.iisc.ac.in/energy/water/paper/ETR101/ETR101_wetlands_treasure-P.pdf',
    zones: [
      { id: 'agara-north', name: 'North sector', latitude: 12.9234, longitude: 77.6410 },
      { id: 'agara-east', name: 'East sector', latitude: 12.9210, longitude: 77.6432 },
      { id: 'agara-south', name: 'South sector', latitude: 12.9188, longitude: 77.6411 },
      { id: 'agara-west', name: 'West sector', latitude: 12.9209, longitude: 77.6389 },
    ],
  },
  {
    id: 'madiwala-lake',
    name: 'Madiwala Lake',
    kind: 'geographic',
    center: [12.9082, 77.6177],
    gpsRadius: 1100,
    shorePickRadius: 420,
    locality: 'BTM Layout, south Bengaluru',
    description: 'A lake near BTM Layout, also written Madivala Lake.',
    reference: 'https://www.openstreetmap.org/relation/2310417',
    zones: [
      { id: 'madiwala-north', name: 'North sector', latitude: 12.9140, longitude: 77.6175 },
      { id: 'madiwala-east', name: 'East sector', latitude: 12.9083, longitude: 77.6218 },
      { id: 'madiwala-south', name: 'South sector', latitude: 12.9025, longitude: 77.6183 },
      { id: 'madiwala-west', name: 'West sector', latitude: 12.9086, longitude: 77.6130 },
    ],
  },
  {
    id: 'bellandur-lake',
    name: 'Bellandur Lake',
    kind: 'geographic',
    center: [12.9360, 77.6720],
    gpsRadius: 3300,
    shorePickRadius: 780,
    locality: 'Bellandur area, southeast Bengaluru',
    description: 'A large urban lake in southeast Bengaluru that drains downstream toward Varthur Lake.',
    reference: 'https://data-opencity.sgp1.cdn.digitaloceanspaces.com/Documents/Recent/Bengaluru-Bellandur-Lake-Inspection-report-31-May-2018.pdf',
    zones: [
      { id: 'bellandur-north', name: 'North sector', latitude: 12.9431, longitude: 77.6659 },
      { id: 'bellandur-east', name: 'East sector', latitude: 12.9362, longitude: 77.6803 },
      { id: 'bellandur-south', name: 'South sector', latitude: 12.9287, longitude: 77.6691 },
      { id: 'bellandur-west', name: 'West sector', latitude: 12.9350, longitude: 77.6453 },
    ],
  },
];

export function findLake(id) {
  return lakes.find(lake => lake.id === id);
}
