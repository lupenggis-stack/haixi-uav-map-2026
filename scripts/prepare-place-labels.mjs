import { writeFile } from "node:fs/promises";

const outputUrl = new URL("../public/data/places.geojson", import.meta.url);
const overpassUrl = new URL("https://overpass-api.de/api/interpreter");
const haixiAreaId = 3602707989;

const query = `
[out:json][timeout:60];
area(${haixiAreaId})->.haixi;
(
  node["place"~"city|town"](area.haixi);
  way["place"~"city|town"](area.haixi);
  relation["place"~"city|town"](area.haixi);
);
out center tags;
`;

overpassUrl.searchParams.set("data", query);

const response = await fetch(overpassUrl, {
  headers: {
    "User-Agent": "HaixiUavMap/1.0 (lupenggis@gmail.com)",
  },
});

if (!response.ok) {
  throw new Error(`Overpass request failed: ${response.status}`);
}

const data = await response.json();

const primaryLabels = new Map([
  [244083618, "德令哈市"],
  [315046176, "格尔木市"],
  [4483299030, "茫崖市"],
  [3298702148, "乌兰县"],
  [244078648, "都兰县"],
  [8907111711, "天峻县"],
  [8376113305, "大柴旦"],
]);

// These town labels coincide with a city/county-seat label and would overlap it.
const redundantSeatLabels = new Set([
  415979857, // 花土沟镇 / 茫崖市
  8125230793, // 察汗乌苏镇 / 都兰县
  13366599991, // 希里沟镇 / 乌兰县
  3227554720, // 新源镇 / 天峻县
]);

const features = data.elements
  .map((element) => {
    const longitude = element.lon ?? element.center?.lon;
    const latitude = element.lat ?? element.center?.lat;
    const sourceName = element.tags?.["name:zh"] ?? element.tags?.name;
    const primaryName = primaryLabels.get(element.id);

    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      (!sourceName && !primaryName) ||
      redundantSeatLabels.has(element.id)
    ) {
      return null;
    }

    return {
      type: "Feature",
      id: `osm-${element.type}-${element.id}`,
      geometry: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
      properties: {
        name: primaryName ?? sourceName,
        level: primaryName ? "primary" : "town",
        place: element.tags?.place ?? "town",
        source: "OpenStreetMap",
        osmId: element.id,
      },
    };
  })
  .filter(Boolean)
  .sort((a, b) => {
    if (a.properties.level !== b.properties.level) {
      return a.properties.level === "primary" ? -1 : 1;
    }
    return a.properties.name.localeCompare(b.properties.name, "zh-CN");
  });

const collection = {
  type: "FeatureCollection",
  name: "海西州市县驻地与乡镇地名",
  source: {
    dataset: "OpenStreetMap",
    relation: 2707989,
    license: "ODbL 1.0",
    attribution: "© OpenStreetMap contributors",
  },
  features,
};

await writeFile(outputUrl, `${JSON.stringify(collection)}\n`);

const primaryCount = features.filter(
  (feature) => feature.properties.level === "primary",
).length;
const townCount = features.length - primaryCount;
console.log(
  `Prepared ${primaryCount} primary labels and ${townCount} town labels.`,
);
