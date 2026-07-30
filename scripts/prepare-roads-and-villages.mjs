import { mkdir, writeFile } from "node:fs/promises";

const overpassEndpoint = "https://overpass-api.de/api/interpreter";
const userAgent = "HaixiUavMap/1.0 (lupenggis@gmail.com)";
const roadOutputUrl = new URL("../tmp/roads-unclipped.geojson", import.meta.url);
const villageOutputUrl = new URL(
  "../public/data/villages.geojson",
  import.meta.url,
);

await mkdir(new URL("../tmp/", import.meta.url), { recursive: true });

const latitudeBands = [
  [33.8, 36],
  [36, 38],
  [38, 39.3],
];
const longitudeBands = [
  [90.1, 92.6],
  [92.6, 95.1],
  [95.1, 97.6],
  [97.6, 100],
];
const cells = latitudeBands.flatMap(([south, north]) =>
  longitudeBands.map(([west, east]) => ({ south, west, north, east })),
);

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const requestOverpass = async (query, label) => {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(overpassEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": userAgent,
        },
        body: new URLSearchParams({ data: query }),
      });
      const text = await response.text();
      if (!response.ok || !text.trim().startsWith("{")) {
        throw new Error(`HTTP ${response.status} or busy response`);
      }
      const data = JSON.parse(text);
      if (!Array.isArray(data.elements)) {
        throw new Error("Missing elements");
      }
      return data.elements;
    } catch (error) {
      if (attempt === 4) throw error;
      console.log(`${label}: retry ${attempt}/3`);
      await sleep(15_000);
    }
  }
};

const roadsById = new Map();

for (const [index, cell] of cells.entries()) {
  const query = `
[out:json][timeout:90][maxsize:536870912];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)$"](${cell.south},${cell.west},${cell.north},${cell.east});
out geom tags;
`;
  const elements = await requestOverpass(
    query,
    `Road cell ${index + 1}/${cells.length}`,
  );
  elements.forEach((element) => roadsById.set(element.id, element));
  console.log(
    `Road cell ${index + 1}/${cells.length}: ${elements.length} ways, ${roadsById.size} unique`,
  );
  if (index < cells.length - 1) await sleep(8_000);
}

const roadFeatures = [...roadsById.values()]
  .map((element) => {
    const coordinates = (element.geometry ?? []).map(({ lon, lat }) => [
      lon,
      lat,
    ]);
    if (coordinates.length < 2) return null;

    const highway = element.tags?.highway ?? "unclassified";
    const roadClass = ["motorway", "trunk"].includes(highway)
      ? "national"
      : ["primary", "secondary"].includes(highway)
        ? "regional"
        : "local";

    return {
      type: "Feature",
      id: `osm-way-${element.id}`,
      geometry: {
        type: "LineString",
        coordinates,
      },
      properties: {
        roadClass,
        highway,
        name:
          element.tags?.["name:zh"] ??
          element.tags?.name ??
          element.tags?.["name:en"] ??
          "",
        ref: element.tags?.ref ?? "",
        surface: element.tags?.surface ?? "",
        source: "OpenStreetMap",
        osmId: element.id,
      },
    };
  })
  .filter(Boolean);

await writeFile(
  roadOutputUrl,
  `${JSON.stringify({
    type: "FeatureCollection",
    name: "海西州道路网络（裁剪前）",
    source: {
      dataset: "OpenStreetMap",
      license: "ODbL 1.0",
      attribution: "© OpenStreetMap contributors",
    },
    features: roadFeatures,
  })}\n`,
);

const villageQuery = `
[out:json][timeout:90];
area(3602707989)->.haixi;
(
  node["place"~"^(village|hamlet)$"](area.haixi);
  way["place"~"^(village|hamlet)$"](area.haixi);
  relation["place"~"^(village|hamlet)$"](area.haixi);
);
out center tags;
`;
const villageElements = await requestOverpass(villageQuery, "Village labels");
const villagesByNameAndCoordinate = new Map();

villageElements.forEach((element) => {
  const longitude = element.lon ?? element.center?.lon;
  const latitude = element.lat ?? element.center?.lat;
  const name = element.tags?.["name:zh"] ?? element.tags?.name;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !name) return;
  const key = `${name}|${longitude.toFixed(5)}|${latitude.toFixed(5)}`;
  villagesByNameAndCoordinate.set(key, {
    type: "Feature",
    id: `osm-${element.type}-${element.id}`,
    geometry: {
      type: "Point",
      coordinates: [longitude, latitude],
    },
    properties: {
      name,
      level: element.tags?.place === "village" ? "village" : "hamlet",
      source: "OpenStreetMap",
      osmId: element.id,
    },
  });
});

const villageFeatures = [...villagesByNameAndCoordinate.values()].sort((a, b) =>
  a.properties.name.localeCompare(b.properties.name, "zh-CN"),
);

await writeFile(
  villageOutputUrl,
  `${JSON.stringify({
    type: "FeatureCollection",
    name: "海西州村庄地名",
    source: {
      dataset: "OpenStreetMap",
      relation: 2707989,
      license: "ODbL 1.0",
      attribution: "© OpenStreetMap contributors",
    },
    features: villageFeatures,
  })}\n`,
);

console.log(
  `Prepared ${roadFeatures.length} road ways and ${villageFeatures.length} village labels.`,
);
