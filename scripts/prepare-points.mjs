import { readFile, writeFile } from "node:fs/promises";

const sourceUrl = new URL(
  "../../无人机需求点位_SHP_20260729/无人机需求点位_完整属性.geojson",
  import.meta.url,
);
const outputUrl = new URL("../public/data/points.geojson", import.meta.url);

const source = JSON.parse(await readFile(sourceUrl, "utf8"));

const cleanUnitName = (value) =>
  String(value ?? "")
    .replace(/[（(]\d+[）)]$/, "")
    .trim();

const enabled = (value) => value === 1 || value === "1" || value === true;

const features = source.features.map((feature, index) => {
  const p = feature.properties ?? {};
  const network = [
    enabled(p["网络接入：拉专线"]) && "专线",
    enabled(p["网络计入：移动流量卡"]) && "移动流量卡",
  ].filter(Boolean);
  const uavTypes = [
    enabled(p["大气监测无人机"]) && "大气监测无人机",
    enabled(p["水监测无人机"]) && "水监测无人机",
    enabled(p["常规无人机"]) && "常规无人机",
  ].filter(Boolean);

  return {
    type: "Feature",
    id: index + 1,
    geometry: feature.geometry,
    properties: {
      id: index + 1,
      unit: cleanUnitName(p["单位名称"]),
      area: String(p["拟补充的无人机部署区域"] ?? "").trim(),
      mode: String(p["部署模式"] ?? "").trim(),
      quantity: Number(p["数量"]) || 1,
      scope: String(
        p[
          "监测范围（监测周边环境，监控面积，主要的环境污染源，周边涉及哪些重点污染企业等）"
        ] ?? "",
      ).trim(),
      function: String(p["功能需求"] ?? "").trim(),
      network,
      uavTypes,
    },
  };
});

await writeFile(
  outputUrl,
  `${JSON.stringify({ type: "FeatureCollection", features })}\n`,
);

console.log(`Prepared ${features.length} public point features.`);
