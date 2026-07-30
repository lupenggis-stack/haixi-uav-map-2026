"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CircleMarker,
  Layer,
  Map as LeafletMap,
  TileLayer,
} from "leaflet";

type PointProperties = {
  id: number;
  unit: string;
  area: string;
  mode: string;
  quantity: number;
  scope: string;
  function: string;
  network: string[];
  uavTypes: string[];
};

type PointFeature = {
  type: "Feature";
  id: number;
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: PointProperties;
};

type PointCollection = {
  type: "FeatureCollection";
  features: PointFeature[];
};

type BoundaryCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: GeoJSON.Geometry;
    properties: Record<string, string>;
  }>;
};

type PlaceFeature = {
  type: "Feature";
  id: string;
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    name: string;
    level: "primary" | "town";
    place: string;
  };
};

type PlaceCollection = {
  type: "FeatureCollection";
  features: PlaceFeature[];
};

type RoadFeature = {
  type: "Feature";
  geometry: GeoJSON.Geometry;
  properties: {
    roadClass: "national" | "regional" | "local";
    highway: string;
    name: string;
    ref: string;
  };
};

type RoadCollection = {
  type: "FeatureCollection";
  features: RoadFeature[];
};

type VillageFeature = {
  type: "Feature";
  id: string;
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    name: string;
    level: "village" | "hamlet";
  };
};

type VillageCollection = {
  type: "FeatureCollection";
  features: VillageFeature[];
};

type OverlayKey =
  | "points"
  | "places"
  | "villages"
  | "roads"
  | "counties"
  | "cities"
  | "provinces";
type BaseMapKey = "bing" | "osm";

const INITIAL_BOUNDS: [[number, number], [number, number]] = [
  [32.6083676652, 88.4191897207],
  [39.9929591529, 100.7585357259],
];

const LAYER_INFO: Array<{
  key: OverlayKey;
  label: string;
  detail: string;
  color: string;
}> = [
  {
    key: "points",
    label: "无人机需求点位",
    detail: "64 个已定位点位",
    color: "#ff174b",
  },
  {
    key: "places",
    label: "地名标注",
    detail: "7 处市县驻地 · 31 处乡镇",
    color: "#dfd855",
  },
  {
    key: "villages",
    label: "村庄名称",
    detail: "124 处村庄与居民点",
    color: "#f8eed2",
  },
  {
    key: "roads",
    label: "道路网络",
    detail: "国省干线 · 县乡道路",
    color: "#f0b45c",
  },
  {
    key: "counties",
    label: "县级行政区",
    detail: "海西州 7 个县级行政区",
    color: "#f9dfad",
  },
  {
    key: "cities",
    label: "市级行政区",
    detail: "全国市级边界",
    color: "#f8f8f8",
  },
  {
    key: "provinces",
    label: "省级行政区",
    detail: "全国省级边界",
    color: "#e5b636",
  },
];

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const compactList = (items: string[]) =>
  items.length ? items.join("、") : "未注明";

const pointPopup = (feature: PointFeature) => {
  const p = feature.properties;
  const [longitude, latitude] = feature.geometry.coordinates;
  const rows = [
    ["所属单位", p.unit],
    ["部署模式", p.mode || "未注明"],
    ["数量", `${p.quantity} 套`],
    ["无人机类型", compactList(p.uavTypes)],
    ["功能需求", p.function || "未注明"],
    ["网络接入", compactList(p.network)],
    ["监测范围", p.scope || "未注明"],
    ["坐标", `${longitude.toFixed(5)}, ${latitude.toFixed(5)}`],
  ];

  return `
    <article class="map-popup">
      <div class="popup-kicker">需求点位 ${String(p.id).padStart(2, "0")}</div>
      <h3>${escapeHtml(p.area || "未命名点位")}</h3>
      <dl>
        ${rows
          .map(
            ([label, value]) =>
              `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
          )
          .join("")}
      </dl>
    </article>
  `;
};

const tileToQuadKey = (x: number, y: number, zoom: number) => {
  let quadKey = "";
  for (let i = zoom; i > 0; i -= 1) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((x & mask) !== 0) digit += 1;
    if ((y & mask) !== 0) digit += 2;
    quadKey += digit;
  }
  return quadKey;
};

export default function Home() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRefs = useRef<Partial<Record<OverlayKey, Layer>>>({});
  const baseLayerRefs = useRef<Partial<Record<BaseMapKey, TileLayer>>>({});
  const markerRefs = useRef<Map<number, CircleMarker>>(new Map());
  const [points, setPoints] = useState<PointFeature[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [query, setQuery] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [baseMap, setBaseMap] = useState<BaseMapKey>("bing");
  const [overlays, setOverlays] = useState<Record<OverlayKey, boolean>>({
    points: true,
    places: true,
    villages: true,
    roads: true,
    counties: true,
    cities: false,
    provinces: false,
  });

  const filteredPoints = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return points;
    return points.filter((point) => {
      const p = point.properties;
      return [p.area, p.unit, p.mode, p.function, ...p.uavTypes]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(keyword);
    });
  }, [points, query]);

  const unitCount = useMemo(
    () => new Set(points.map((point) => point.properties.unit)).size,
    [points],
  );

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    let cancelled = false;

    const initializeMap = async () => {
      try {
        const [
          L,
          pointResponse,
          placeResponse,
          villageResponse,
          roadResponse,
          countyResponse,
          cityResponse,
          provinceResponse,
        ] = await Promise.all([
          import("leaflet"),
          fetch("/data/points.geojson"),
          fetch("/data/places.geojson"),
          fetch("/data/villages.geojson"),
          fetch("/data/roads.geojson"),
          fetch("/data/counties.geojson"),
          fetch("/data/cities.geojson"),
          fetch("/data/provinces.geojson"),
        ]);

        if (
          !pointResponse.ok ||
          !placeResponse.ok ||
          !villageResponse.ok ||
          !roadResponse.ok ||
          !countyResponse.ok ||
          !cityResponse.ok ||
          !provinceResponse.ok
        ) {
          throw new Error("地图数据读取失败");
        }

        const [
          pointData,
          placeData,
          villageData,
          roadData,
          countyData,
          cityData,
          provinceData,
        ] = (await Promise.all([
          pointResponse.json(),
          placeResponse.json(),
          villageResponse.json(),
          roadResponse.json(),
          countyResponse.json(),
          cityResponse.json(),
          provinceResponse.json(),
        ])) as [
          PointCollection,
          PlaceCollection,
          VillageCollection,
          RoadCollection,
          BoundaryCollection,
          BoundaryCollection,
          BoundaryCollection,
        ];

        if (cancelled || !mapContainerRef.current) return;

        setPoints(pointData.features);

        const map = L.map(mapContainerRef.current, {
          zoomControl: false,
          attributionControl: true,
          preferCanvas: true,
          minZoom: 3,
          maxZoom: 18,
        });
        map.fitBounds(INITIAL_BOUNDS, { padding: [22, 22] });
        mapRef.current = map;

        L.control.zoom({ position: "topright" }).addTo(map);
        L.control
          .scale({
            position: "bottomright",
            imperial: false,
            metric: true,
            maxWidth: 120,
          })
          .addTo(map);

        const bing = L.tileLayer("", {
          minZoom: 1,
          maxZoom: 18,
          maxNativeZoom: 18,
          attribution:
            "影像 © Microsoft Bing · 道路与地名 © OpenStreetMap contributors",
          crossOrigin: true,
        });
        bing.getTileUrl = ({ x, y, z }) => {
          const quadKey = tileToQuadKey(x, y, z);
          const subdomain = Math.abs((x + y) % 4);
          return `https://ecn.t${subdomain}.tiles.virtualearth.net/tiles/a${quadKey}.jpeg?g=0&dir=dir_n`;
        };

        const osm = L.tileLayer(
          "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            maxZoom: 19,
            attribution: "© OpenStreetMap contributors",
          },
        );
        baseLayerRefs.current = { bing, osm };
        bing.addTo(map);

        const provinces = L.geoJSON(provinceData as GeoJSON.GeoJsonObject, {
          style: {
            color: "#e5b636",
            weight: 1.4,
            opacity: 0.9,
            fillOpacity: 0,
          },
          onEachFeature: (feature, layer) => {
            layer.bindTooltip(feature.properties?.pr_name ?? "省级行政区", {
              sticky: true,
              className: "boundary-hover-label",
            });
          },
        });

        const cities = L.geoJSON(cityData as GeoJSON.GeoJsonObject, {
          style: {
            color: "#f8f8f8",
            weight: 1.6,
            opacity: 0.82,
            fillOpacity: 0,
          },
          onEachFeature: (feature, layer) => {
            layer.bindTooltip(feature.properties?.ct_name ?? "市级行政区", {
              sticky: true,
              className: "boundary-hover-label",
            });
          },
        });

        const counties = L.geoJSON(countyData as GeoJSON.GeoJsonObject, {
          style: {
            color: "#f9dfad",
            weight: 3,
            opacity: 0.98,
            fillColor: "#8d5a99",
            fillOpacity: 0.06,
          },
          onEachFeature: (feature, layer) => {
            layer.bindTooltip(feature.properties?.dt_name ?? "县级行政区", {
              permanent: true,
              direction: "center",
              className: "district-label",
              opacity: 1,
            });
          },
        });

        map.createPane("roads");
        const roadPane = map.getPane("roads");
        if (roadPane) {
          roadPane.style.zIndex = "360";
          roadPane.style.pointerEvents = "none";
        }

        const createRoadPair = (
          roadClass: RoadFeature["properties"]["roadClass"],
          casingStyle: { color: string; weight: number; opacity: number },
          surfaceStyle: { color: string; weight: number; opacity: number },
        ) => {
          const filter = (feature?: GeoJSON.Feature) =>
            feature?.properties?.roadClass === roadClass;
          const casing = L.geoJSON(roadData as GeoJSON.GeoJsonObject, {
            pane: "roads",
            interactive: false,
            filter,
            style: casingStyle,
          });
          const surface = L.geoJSON(roadData as GeoJSON.GeoJsonObject, {
            pane: "roads",
            interactive: false,
            filter,
            style: surfaceStyle,
          });
          return L.layerGroup([casing, surface]);
        };

        const nationalRoads = createRoadPair(
          "national",
          { color: "#4d3e26", weight: 4.2, opacity: 0.78 },
          { color: "#f0b45c", weight: 2.5, opacity: 0.95 },
        );
        const regionalRoads = createRoadPair(
          "regional",
          { color: "#504934", weight: 3.1, opacity: 0.66 },
          { color: "#eadb9f", weight: 1.7, opacity: 0.9 },
        );
        const localRoads = createRoadPair(
          "local",
          { color: "#3f4439", weight: 2.1, opacity: 0.46 },
          { color: "#f2ead3", weight: 1, opacity: 0.72 },
        );
        const roadLayers = L.layerGroup([nationalRoads]);

        map.createPane("placeLabels");
        const placePane = map.getPane("placeLabels");
        if (placePane) {
          placePane.style.zIndex = "635";
          placePane.style.pointerEvents = "none";
        }

        const primaryPlaceLabels = L.layerGroup();
        const townPlaceLabels = L.layerGroup();

        placeData.features.forEach((feature) => {
          const [longitude, latitude] = feature.geometry.coordinates;
          const level = feature.properties.level;
          const icon = L.divIcon({
            className: "place-label-icon",
            html: `
              <span class="place-label place-label-${level}">
                <i aria-hidden="true"></i>
                <b>${escapeHtml(feature.properties.name)}</b>
              </span>
            `,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          });
          const marker = L.marker([latitude, longitude], {
            icon,
            pane: "placeLabels",
            interactive: false,
            keyboard: false,
          });
          marker.addTo(
            level === "primary" ? primaryPlaceLabels : townPlaceLabels,
          );
        });

        const placeLabels = L.layerGroup([primaryPlaceLabels]);

        const villageLabels = L.layerGroup();
        const hamletLabels = L.layerGroup();

        villageData.features.forEach((feature) => {
          const [longitude, latitude] = feature.geometry.coordinates;
          const level = feature.properties.level;
          const icon = L.divIcon({
            className: "village-label-icon",
            html: `
              <span class="village-label village-label-${level}">
                <i aria-hidden="true"></i>
                <b>${escapeHtml(feature.properties.name)}</b>
              </span>
            `,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          });
          const marker = L.marker([latitude, longitude], {
            icon,
            pane: "placeLabels",
            interactive: false,
            keyboard: false,
          });
          marker.addTo(level === "village" ? villageLabels : hamletLabels);
        });

        const villageLayer = L.layerGroup();

        const pointMarkers = L.geoJSON(pointData as GeoJSON.GeoJsonObject, {
          pointToLayer: (feature, latlng) => {
            const marker = L.circleMarker(latlng, {
              radius: 6,
              fillColor: "#ff174b",
              color: "#ffffff",
              weight: 2,
              opacity: 1,
              fillOpacity: 0.95,
              bubblingMouseEvents: false,
            });
            const point = feature as unknown as PointFeature;
            markerRefs.current.set(point.properties.id, marker);
            return marker;
          },
          onEachFeature: (feature, layer) => {
            const point = feature as unknown as PointFeature;
            layer.bindPopup(pointPopup(point), {
              maxWidth: 380,
              minWidth: 300,
              className: "detail-popup-shell",
            });
            layer.bindTooltip(point.properties.area || "无人机需求点位", {
              permanent: true,
              direction: "top",
              offset: [0, -7],
              className: "point-label",
            });
          },
        });

        layerRefs.current = {
          points: pointMarkers,
          places: placeLabels,
          villages: villageLayer,
          roads: roadLayers,
          counties,
          cities,
          provinces,
        };
        roadLayers.addTo(map);
        counties.addTo(map);
        placeLabels.addTo(map);
        villageLayer.addTo(map);
        pointMarkers.addTo(map);

        const updateLabelVisibility = () => {
          const zoom = map.getZoom();
          const container = map.getContainer();
          container.classList.toggle("show-primary-place-labels", zoom >= 7);
          container.classList.toggle("show-point-labels", zoom >= 10);
          if (zoom >= 6 && !roadLayers.hasLayer(regionalRoads)) {
            roadLayers.addLayer(regionalRoads);
          }
          if (zoom < 6 && roadLayers.hasLayer(regionalRoads)) {
            roadLayers.removeLayer(regionalRoads);
          }
          if (zoom >= 8 && !roadLayers.hasLayer(localRoads)) {
            roadLayers.addLayer(localRoads);
          }
          if (zoom < 8 && roadLayers.hasLayer(localRoads)) {
            roadLayers.removeLayer(localRoads);
          }
          if (zoom >= 8 && !placeLabels.hasLayer(townPlaceLabels)) {
            placeLabels.addLayer(townPlaceLabels);
          }
          if (zoom < 8 && placeLabels.hasLayer(townPlaceLabels)) {
            placeLabels.removeLayer(townPlaceLabels);
          }
          if (zoom >= 9 && !villageLayer.hasLayer(villageLabels)) {
            villageLayer.addLayer(villageLabels);
          }
          if (zoom < 9 && villageLayer.hasLayer(villageLabels)) {
            villageLayer.removeLayer(villageLabels);
          }
          if (zoom >= 10 && !villageLayer.hasLayer(hamletLabels)) {
            villageLayer.addLayer(hamletLabels);
          }
          if (zoom < 10 && villageLayer.hasLayer(hamletLabels)) {
            villageLayer.removeLayer(hamletLabels);
          }
        };
        updateLabelVisibility();
        map.on("zoomend", updateLabelVisibility);

        setMapReady(true);
      } catch (error) {
        console.error(error);
        setMapError("地图暂时无法载入，请刷新页面重试。");
      }
    };

    void initializeMap();

    return () => {
      cancelled = true;
      markerRefs.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (Object.keys(overlays) as OverlayKey[]).forEach((key) => {
      const layer = layerRefs.current[key];
      if (!layer) return;
      const isVisible = map.hasLayer(layer);
      if (overlays[key] && !isVisible) layer.addTo(map);
      if (!overlays[key] && isVisible) layer.removeFrom(map);
    });
    map
      .getContainer()
      .classList.toggle("place-layer-enabled", overlays.places);
  }, [mapReady, overlays]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (Object.keys(baseLayerRefs.current) as BaseMapKey[]).forEach((key) => {
      const layer = baseLayerRefs.current[key];
      if (!layer) return;
      const isVisible = map.hasLayer(layer);
      if (key === baseMap && !isVisible) layer.addTo(map);
      if (key !== baseMap && isVisible) layer.removeFrom(map);
    });
  }, [baseMap, mapReady]);

  const focusPoint = (point: PointFeature) => {
    const map = mapRef.current;
    const marker = markerRefs.current.get(point.properties.id);
    if (!map || !marker) return;
    const [longitude, latitude] = point.geometry.coordinates;
    map.flyTo([latitude, longitude], Math.max(map.getZoom(), 11), {
      duration: 0.8,
    });
    marker.openPopup();
    setPanelOpen(false);
  };

  const resetView = () => {
    mapRef.current?.fitBounds(INITIAL_BOUNDS, { padding: [22, 22] });
  };

  return (
    <main className="map-app">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <div>
            <p>海西州生态安全数智化中心（一期）</p>
            <h1>无人机需求点位分布</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="status-chip">
            <i aria-hidden="true" />
            数据已载入
          </span>
          <button className="reset-button" type="button" onClick={resetView}>
            回到全图
          </button>
          <button
            className="panel-button"
            type="button"
            aria-label={panelOpen ? "关闭地图面板" : "打开地图面板"}
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((value) => !value)}
          >
            {panelOpen ? "关闭" : "图层"}
          </button>
        </div>
      </header>

      <section className="map-stage" aria-label="无人机需求点位交互地图">
        <div
          ref={mapContainerRef}
          className="map-canvas"
          role="application"
          aria-label="可缩放、平移并查看点位详情的地图"
        />

        {!mapReady && !mapError && (
          <div className="map-loading" role="status">
            <span className="loading-ring" aria-hidden="true" />
            <strong>正在加载地图</strong>
            <small>行政区边界与点位数据载入中</small>
          </div>
        )}

        {mapError && (
          <div className="map-loading map-error" role="alert">
            <strong>地图载入失败</strong>
            <small>{mapError}</small>
          </div>
        )}

        <aside className={`map-panel ${panelOpen ? "is-open" : ""}`}>
          <div className="panel-scroll">
            <div className="panel-intro">
              <span className="eyebrow">项目空间分布</span>
              <h2>需求点位总览</h2>
              <p>
                展示无人机及机巢拟部署位置、道路网络、行政区边界与卫星影像。点击点位可查看需求详情。
              </p>
            </div>

            <div className="stat-grid">
              <div>
                <strong>{points.length || "—"}</strong>
                <span>需求点位</span>
              </div>
              <div>
                <strong>{unitCount || "—"}</strong>
                <span>需求单位</span>
              </div>
              <div>
                <strong>7</strong>
                <span>县级行政区</span>
              </div>
            </div>

            <section className="panel-section">
              <div className="section-heading">
                <h3>底图</h3>
                <span>单选</span>
              </div>
              <div className="base-map-switch" role="radiogroup" aria-label="底图选择">
                <button
                  type="button"
                  role="radio"
                  aria-checked={baseMap === "bing"}
                  className={baseMap === "bing" ? "active" : ""}
                  onClick={() => setBaseMap("bing")}
                >
                  <span className="satellite-swatch" aria-hidden="true" />
                  必应卫星影像
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={baseMap === "osm"}
                  className={baseMap === "osm" ? "active" : ""}
                  onClick={() => setBaseMap("osm")}
                >
                  <span className="street-swatch" aria-hidden="true" />
                  标准地图
                </button>
              </div>
            </section>

            <section className="panel-section">
              <div className="section-heading">
                <h3>图层</h3>
                <span>可多选</span>
              </div>
              <div className="layer-list">
                {LAYER_INFO.map((layer) => (
                  <label key={layer.key} className="layer-row">
                    <input
                      type="checkbox"
                      checked={overlays[layer.key]}
                      onChange={(event) =>
                        setOverlays((current) => ({
                          ...current,
                          [layer.key]: event.target.checked,
                        }))
                      }
                    />
                    <span
                      className={`layer-swatch ${layer.key}`}
                      style={{ "--swatch-color": layer.color } as React.CSSProperties}
                      aria-hidden="true"
                    />
                    <span className="layer-copy">
                      <b>{layer.label}</b>
                      <small>{layer.detail}</small>
                    </span>
                    <span className="switch-ui" aria-hidden="true" />
                  </label>
                ))}
              </div>
            </section>

            <section className="panel-section search-section">
              <div className="section-heading">
                <h3>查找点位</h3>
                <span>
                  {query ? `${filteredPoints.length} 条结果` : "按名称或单位"}
                </span>
              </div>
              <label className="search-box">
                <span aria-hidden="true">⌕</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索部署区域、单位、功能……"
                  aria-label="搜索部署区域、单位或功能"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="清空搜索"
                    onClick={() => setQuery("")}
                  >
                    ×
                  </button>
                )}
              </label>
              <div className="result-list" aria-live="polite">
                {filteredPoints.slice(0, 12).map((point) => (
                  <button
                    key={point.properties.id}
                    type="button"
                    className="result-row"
                    onClick={() => focusPoint(point)}
                  >
                    <span className="result-index">
                      {String(point.properties.id).padStart(2, "0")}
                    </span>
                    <span>
                      <b>{point.properties.area || "未命名点位"}</b>
                      <small>{point.properties.unit}</small>
                    </span>
                    <i aria-hidden="true">›</i>
                  </button>
                ))}
                {filteredPoints.length === 0 && (
                  <p className="empty-result">没有找到匹配点位</p>
                )}
                {filteredPoints.length > 12 && (
                  <p className="more-result">
                    还有 {filteredPoints.length - 12} 个结果，请继续输入关键词缩小范围
                  </p>
                )}
              </div>
            </section>
          </div>
          <footer className="panel-footer">
            <span>WGS 84 · 道路/地名 © OpenStreetMap</span>
            <span>边界仅供项目展示参考</span>
          </footer>
        </aside>

        <div className="map-caption">
          <span className="caption-dot" aria-hidden="true" />
          <div>
            <b>当前视图</b>
            <span>青海省海西蒙古族藏族自治州及周边</span>
          </div>
        </div>
      </section>
    </main>
  );
}
