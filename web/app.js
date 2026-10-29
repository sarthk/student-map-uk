"use strict";

const POSTCODE_API = "https://api.postcodes.io/postcodes";
const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const INITIAL_CENTRE = [-3.4, 54.8];
const MAX_PLACES = 1200;
const PAGE_SIZE = 40;

const CATEGORIES = {
  all: { label: "Everything", short: "All", icon: "✦", colour: "#5b3cc4" },
  study: { label: "Study & supplies", short: "Study", icon: "📚", colour: "#5b3cc4" },
  food: { label: "Food & coffee", short: "Food", icon: "☕", colour: "#d65b42" },
  groceries: { label: "Groceries", short: "Groceries", icon: "🥦", colour: "#27815e" },
  health: { label: "Health", short: "Health", icon: "✚", colour: "#c4455d" },
  fitness: { label: "Fitness & outdoors", short: "Fitness", icon: "🏃", colour: "#167a9b" },
  transport: { label: "Transport", short: "Travel", icon: "🚉", colour: "#315fa8" },
  essentials: { label: "Shops & errands", short: "Errands", icon: "🧺", colour: "#a26116" },
  personal: { label: "Personal care", short: "Care", icon: "✂️", colour: "#a94d90" },
  fun: { label: "Social & culture", short: "Fun", icon: "🎭", colour: "#7b4bb3" },
  housing: { label: "Housing help", short: "Housing", icon: "🏠", colour: "#6c6545" },
};
const CATEGORY_ORDER = Object.keys(CATEGORIES).filter((key) => key !== "all");

const SETS = {
  studyAmenity: new Set(["library", "university", "college", "language_school", "music_school", "coworking_space"]),
  studyShop: new Set(["books", "stationery", "copyshop"]),
  foodAmenity: new Set(["cafe", "restaurant", "fast_food", "food_court", "ice_cream"]),
  groceryShop: new Set(["supermarket", "convenience", "greengrocer", "bakery", "butcher", "deli", "health_food", "organic"]),
  healthAmenity: new Set(["pharmacy", "doctors", "dentist", "clinic", "hospital"]),
  healthHealthcare: new Set(["doctor", "clinic", "pharmacy", "dentist", "hospital", "physiotherapist", "optometrist"]),
  fitnessLeisure: new Set(["fitness_centre", "sports_centre", "sports_hall", "park", "pitch", "track", "climbing"]),
  transportAmenity: new Set(["bus_station", "bicycle_rental", "bicycle_parking", "car_sharing", "charging_station", "fuel"]),
  transportRailway: new Set(["station", "halt", "tram_stop", "subway_entrance"]),
  essentialAmenity: new Set(["bank", "atm", "post_office", "parcel_locker", "toilets", "drinking_water", "recycling"]),
  essentialShop: new Set(["mobile_phone", "laundry", "dry_cleaning", "charity", "second_hand", "variety_store", "hardware", "bicycle", "computer", "electronics"]),
  personalShop: new Set(["hairdresser", "beauty", "cosmetics", "chemist", "optician"]),
  funAmenity: new Set(["cinema", "theatre", "arts_centre", "nightclub", "community_centre", "pub", "bar"]),
  funLeisure: new Set(["bowling_alley", "amusement_arcade", "escape_game", "miniature_golf"]),
  funTourism: new Set(["museum", "gallery", "attraction"]),
};

const OVERPASS_KEY_PATTERN = "^(amenity|shop|leisure|tourism|healthcare|office|railway|public_transport|residential|building)$";
const OVERPASS_VALUE_PATTERN = "^(university|college|library|language_school|music_school|coworking_space|cafe|restaurant|fast_food|food_court|ice_cream|pharmacy|doctors|dentist|clinic|hospital|bank|atm|post_office|parcel_locker|toilets|drinking_water|recycling|bus_station|bicycle_rental|bicycle_parking|car_sharing|charging_station|fuel|cinema|theatre|arts_centre|nightclub|community_centre|pub|bar|supermarket|convenience|greengrocer|bakery|butcher|deli|health_food|organic|books|stationery|copyshop|mobile_phone|laundry|dry_cleaning|charity|second_hand|variety_store|hardware|bicycle|computer|electronics|hairdresser|beauty|cosmetics|chemist|optician|video_games|music|fitness_centre|sports_centre|sports_hall|park|pitch|track|climbing|bowling_alley|amusement_arcade|escape_game|miniature_golf|museum|gallery|attraction|hostel|doctor|physiotherapist|optometrist|estate_agent|coworking|station|halt|tram_stop|subway_entrance|dormitory)$";

let map;
let mapReady = false;
let searchContext = null;
let places = [];
let activeCategory = "all";
let placeFilter = "";
let sortMode = "distance";
let selectedId = null;
let savedIds = new Set();
let showingPlan = false;
let visibleLimit = PAGE_SIZE;
let searchSequence = 0;
let activeController = null;
let apiFailed = false;
const queryCache = new Map();

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
})[character]);

function safeHttpUrl(value) {
  if (!value) return null;
  try {
    const source = /^https?:\/\//i.test(String(value)) ? String(value) : `https://${String(value)}`;
    const url = new URL(source);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch (_) {
    return null;
  }
}

function setStatus(message, isError = false) {
  const status = $("#search-status");
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function plural(number, singular, pluralForm = `${singular}s`) {
  return `${number.toLocaleString("en-GB")} ${number === 1 ? singular : pluralForm}`;
}

function humanise(value) {
  return String(value || "place").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDistance(metres) {
  if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

function haversine(lat1, lon1, lat2, lon2) {
  const radius = 6_371_000;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalisePostcode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function validCoordinate(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= 49 && latitude <= 61.5 && longitude >= -9 && longitude <= 2.5;
}

function categoriesFor(tags) {
  const categories = [];
  const add = (category, condition) => { if (condition && !categories.includes(category)) categories.push(category); };
  add("housing", tags.building === "dormitory" || tags.residential === "university" || tags.office === "estate_agent" || tags.tourism === "hostel");
  add("study", SETS.studyAmenity.has(tags.amenity) || SETS.studyShop.has(tags.shop) || tags.office === "coworking");
  add("food", SETS.foodAmenity.has(tags.amenity));
  add("groceries", SETS.groceryShop.has(tags.shop));
  add("health", SETS.healthAmenity.has(tags.amenity) || SETS.healthHealthcare.has(tags.healthcare));
  add("fitness", SETS.fitnessLeisure.has(tags.leisure));
  add("transport", SETS.transportAmenity.has(tags.amenity) || SETS.transportRailway.has(tags.railway) || tags.public_transport === "station");
  add("essentials", SETS.essentialAmenity.has(tags.amenity) || SETS.essentialShop.has(tags.shop));
  add("personal", SETS.personalShop.has(tags.shop));
  add("fun", SETS.funAmenity.has(tags.amenity) || SETS.funLeisure.has(tags.leisure) || SETS.funTourism.has(tags.tourism) || ["video_games", "music"].includes(tags.shop));
  return categories;
}

function specificType(tags) {
  const value = tags.amenity || tags.shop || tags.leisure || tags.tourism || tags.healthcare
    || tags.office || tags.railway || tags.public_transport || tags.building || tags.residential;
  return humanise(value);
}

function unnamedLabel(category, type) {
  const usefulType = type && type !== "Place" ? type.toLowerCase() : CATEGORIES[category].label.toLowerCase();
  return `Unnamed ${usefulType}`;
}

function addressFromTags(tags) {
  if (tags["addr:full"]) return tags["addr:full"];
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const locality = tags["addr:city"] || tags["addr:town"] || tags["addr:place"];
  return [street, locality, tags["addr:postcode"]].filter(Boolean).join(", ") || null;
}

function normaliseElement(element, context) {
  const latitude = Number(element.lat ?? element.center?.lat);
  const longitude = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const tags = element.tags || {};
  const categories = categoriesFor(tags);
  if (!categories.length) return null;
  const primaryCategory = CATEGORY_ORDER.find((category) => categories.includes(category)) || categories[0];
  const type = specificType(tags);
  const name = String(tags.name || tags.brand || tags.operator || unnamedLabel(primaryCategory, type));
  return {
    id: `${element.type}/${Number(element.id)}`,
    osmType: element.type,
    osmId: Number(element.id),
    latitude,
    longitude,
    categories,
    primaryCategory,
    name,
    type,
    distance: haversine(context.latitude, context.longitude, latitude, longitude),
    address: addressFromTags(tags),
    openingHours: tags.opening_hours || null,
    wheelchair: tags.wheelchair || null,
    website: safeHttpUrl(tags.website || tags["contact:website"]),
    fee: tags.fee || null,
    cuisine: tags.cuisine ? humanise(tags.cuisine) : null,
    operator: tags.operator || null,
    access: tags.access || null,
  };
}

function deduplicatePlaces(items) {
  const byId = new Map();
  const seenNamedLocations = new Set();
  for (const place of items.sort((a, b) => a.distance - b.distance)) {
    if (byId.has(place.id)) continue;
    const duplicateKey = `${place.primaryCategory}|${place.name.trim().toLowerCase()}|${place.latitude.toFixed(4)}|${place.longitude.toFixed(4)}`;
    if (seenNamedLocations.has(duplicateKey)) continue;
    seenNamedLocations.add(duplicateKey);
    byId.set(place.id, place);
  }
  return [...byId.values()];
}

function makeOverpassQuery(context, radius) {
  const latitude = Number(context.latitude);
  const longitude = Number(context.longitude);
  const safeRadius = Number(radius);
  if (!validCoordinate(latitude, longitude) || ![600, 1200, 2000].includes(safeRadius)) {
    throw new Error("Invalid map search coordinates or radius.");
  }
  const around = `(around:${safeRadius},${latitude.toFixed(6)},${longitude.toFixed(6)})`;
  return `[out:json][timeout:25];\nnwr${around}[~"${OVERPASS_KEY_PATTERN}"~"${OVERPASS_VALUE_PATTERN}"];\nout center qt;`;
}

async function fetchJson(url, options = {}, timeout = 15_000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

async function queryOverpass(query, sequence) {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (sequence !== searchSequence) throw new DOMException("Superseded", "AbortError");
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    const timer = window.setTimeout(() => controller.abort(), 28_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Overpass returned HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.elements)) throw new Error("Overpass returned an unexpected response.");
      return payload;
    } catch (error) {
      if (sequence !== searchSequence) throw new DOMException("Superseded", "AbortError");
      lastError = error;
    } finally {
      window.clearTimeout(timer);
      if (activeController === controller) activeController = null;
    }
  }
  throw lastError || new Error("No OpenStreetMap query service responded.");
}

function mapStyle() {
  return {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: ["https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=cb1_4xp4_1_afea85ef12636303f799ee60"],
        tileSize: 256,
        attribution: "© CARTO · © OpenStreetMap contributors",
      },
    },
    layers: [{ id: "carto", type: "raster", source: "carto", minzoom: 0, maxzoom: 20 }],
  };
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

function circlePolygon(latitude, longitude, radius, points = 72) {
  const coordinates = [];
  const earthRadius = 6_371_000;
  const latRadians = latitude * Math.PI / 180;
  const lonRadians = longitude * Math.PI / 180;
  const angular = radius / earthRadius;
  for (let index = 0; index <= points; index += 1) {
    const bearing = (index / points) * Math.PI * 2;
    const resultLat = Math.asin(Math.sin(latRadians) * Math.cos(angular)
      + Math.cos(latRadians) * Math.sin(angular) * Math.cos(bearing));
    const resultLon = lonRadians + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(latRadians),
      Math.cos(angular) - Math.sin(latRadians) * Math.sin(resultLat),
    );
    coordinates.push([resultLon * 180 / Math.PI, resultLat * 180 / Math.PI]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coordinates] } };
}

function categoryColourExpression() {
  const expression = ["match", ["get", "category"]];
  for (const key of CATEGORY_ORDER) expression.push(key, CATEGORIES[key].colour);
  expression.push(CATEGORIES.all.colour);
  return expression;
}

function initialiseMap() {
  if (typeof maplibregl === "undefined") {
    showMapError("The map library could not load", "Check your connection and reload the page.");
    return;
  }
  map = new maplibregl.Map({
    container: "map",
    style: mapStyle(),
    center: INITIAL_CENTRE,
    zoom: 5,
    minZoom: 4,
    maxZoom: 18,
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

  map.on("load", () => {
    mapReady = true;
    map.addSource("search-radius", { type: "geojson", data: emptyFeatureCollection() });
    map.addSource("search-centre", { type: "geojson", data: emptyFeatureCollection() });
    map.addSource("student-places", {
      type: "geojson",
      data: emptyFeatureCollection(),
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 48,
    });
    map.addLayer({ id: "radius-fill", type: "fill", source: "search-radius", paint: { "fill-color": "#5b3cc4", "fill-opacity": .055 } });
    map.addLayer({ id: "radius-line", type: "line", source: "search-radius", paint: { "line-color": "#5b3cc4", "line-opacity": .55, "line-width": 1.5, "line-dasharray": [2, 2] } });
    map.addLayer({
      id: "place-clusters", type: "circle", source: "student-places", filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#17a393", 20, "#087f72", 80, "#075a54"],
        "circle-radius": ["step", ["get", "point_count"], 17, 20, 22, 80, 28],
        "circle-stroke-width": 3, "circle-stroke-color": "rgba(255,255,255,.92)",
      },
    });
    map.addLayer({
      id: "cluster-count", type: "symbol", source: "student-places", filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11 },
      paint: { "text-color": "#ffffff" },
    });
    map.addLayer({
      id: "place-points", type: "circle", source: "student-places", filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": categoryColourExpression(), "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 14, 8, 17, 11],
        "circle-stroke-width": 2, "circle-stroke-color": "#ffffff", "circle-opacity": .94,
      },
    });
    map.addLayer({
      id: "selected-place", type: "circle", source: "student-places", filter: ["==", ["get", "id"], "__none__"],
      paint: { "circle-radius": 14, "circle-color": "rgba(255,255,255,.25)", "circle-stroke-width": 4, "circle-stroke-color": "#171523" },
    });
    map.addLayer({
      id: "search-halo", type: "circle", source: "search-centre",
      paint: { "circle-radius": 12, "circle-color": "rgba(229,103,79,.2)", "circle-stroke-width": 1, "circle-stroke-color": "rgba(229,103,79,.3)" },
    });
    map.addLayer({
      id: "search-point", type: "circle", source: "search-centre",
      paint: { "circle-radius": 6, "circle-color": "#e5674f", "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" },
    });

    map.on("click", "place-clusters", async (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      try {
        const zoom = await map.getSource("student-places").getClusterExpansionZoom(feature.properties.cluster_id);
        map.easeTo({ center: feature.geometry.coordinates, zoom });
      } catch (_) { /* best-effort map interaction */ }
    });
    map.on("click", "place-points", (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (id) selectPlace(id, false);
    });
    ["place-clusters", "place-points"].forEach((layer) => {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    });
    hideMapLoading();
  });
  map.on("error", (event) => {
    if (event.error) console.warn("Students Map UK map warning:", event.error.message || event.error);
  });
}

function showMapLoading(title, detail) {
  const loading = $("#map-loading");
  loading.classList.remove("is-hidden", "is-error");
  loading.classList.add("is-querying");
  $("#loading-title").textContent = title;
  $("#loading-detail").textContent = detail;
}

function showMapError(title, detail) {
  const loading = $("#map-loading");
  loading.classList.remove("is-hidden");
  loading.classList.add("is-querying", "is-error");
  $("#loading-title").textContent = title;
  $("#loading-detail").textContent = detail;
  window.setTimeout(hideMapLoading, 4500);
}

function hideMapLoading() {
  $("#map-loading").classList.add("is-hidden");
  $("#map-loading").classList.remove("is-querying", "is-error");
}

function placeGeoJson(sourcePlaces) {
  return {
    type: "FeatureCollection",
    features: sourcePlaces.map((place) => ({
      type: "Feature",
      properties: { id: place.id, category: place.primaryCategory, name: place.name },
      geometry: { type: "Point", coordinates: [place.longitude, place.latitude] },
    })),
  };
}

function updateSearchGeometry(fit = false) {
  if (!mapReady || !searchContext) return;
  const radius = Number($("#radius").value);
  map.getSource("search-centre").setData({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [searchContext.longitude, searchContext.latitude] } }],
  });
  map.getSource("search-radius").setData({ type: "FeatureCollection", features: [circlePolygon(searchContext.latitude, searchContext.longitude, radius)] });
  if (fit) {
    const latitudeDelta = radius / 111_320;
    const longitudeDelta = radius / (111_320 * Math.cos(searchContext.latitude * Math.PI / 180));
    map.fitBounds([
      [searchContext.longitude - longitudeDelta, searchContext.latitude - latitudeDelta],
      [searchContext.longitude + longitudeDelta, searchContext.latitude + latitudeDelta],
    ], { padding: { top: 65, right: 55, bottom: 55, left: 55 }, duration: 750, maxZoom: 15 });
  }
}

function filteredPlaces() {
  const query = placeFilter.trim().toLowerCase();
  let result = places.filter((place) => activeCategory === "all" || place.categories.includes(activeCategory));
  if (showingPlan) result = result.filter((place) => savedIds.has(place.id));
  if (query) result = result.filter((place) => `${place.name} ${place.type} ${place.address || ""}`.toLowerCase().includes(query));
  return [...result].sort(sortMode === "name"
    ? (a, b) => a.name.localeCompare(b.name, "en-GB") || a.distance - b.distance
    : (a, b) => a.distance - b.distance || a.name.localeCompare(b.name, "en-GB"));
}

function updateMapPlaces(result = filteredPlaces()) {
  if (!mapReady) return;
  map.getSource("student-places").setData(placeGeoJson(result));
  map.setFilter("selected-place", ["==", ["get", "id"], selectedId || "__none__"]);
}

function categoryCounts() {
  const counts = { all: places.length };
  for (const key of CATEGORY_ORDER) counts[key] = places.filter((place) => place.categories.includes(key)).length;
  return counts;
}

function renderCategories() {
  const counts = categoryCounts();
  $("#category-list").innerHTML = Object.entries(CATEGORIES).map(([key, category]) => `
    <button class="category-chip" type="button" data-category="${key}" aria-pressed="${key === activeCategory}" style="--category:${category.colour}">
      <span aria-hidden="true">${category.icon}</span>${escapeHtml(category.short)} <small>${counts[key].toLocaleString("en-GB")}</small>
    </button>`).join("");
}

function detailLine(place) {
  if (place.openingHours) return `Hours listed: ${place.openingHours}`;
  if (place.address) return place.address;
  if (place.operator && place.operator !== place.name) return `Operated by ${place.operator}`;
  return "OpenStreetMap has no extra details for this place.";
}

function placeItemHtml(place) {
  const category = CATEGORIES[place.primaryCategory];
  const saved = savedIds.has(place.id);
  return `<article class="place-item ${place.id === selectedId ? "is-selected" : ""}" id="place-${place.osmType}-${place.osmId}" data-id="${place.id}" style="--category:${category.colour}">
    <span class="place-icon" aria-hidden="true">${category.icon}</span>
    <div class="place-copy">
      <button type="button" data-action="select" data-id="${place.id}">
        <h3>${escapeHtml(place.name)}</h3>
        <div class="place-meta"><span class="category-name">${escapeHtml(category.label)}</span><span>${escapeHtml(place.type)}</span><span>${escapeHtml(formatDistance(place.distance))} straight-line</span></div>
        <div class="place-detail-line">${escapeHtml(detailLine(place))}</div>
      </button>
    </div>
    <button class="card-save ${saved ? "is-saved" : ""}" type="button" data-action="save" data-id="${place.id}" aria-label="${saved ? "Remove from" : "Add to"} My list">${saved ? "♥" : "♡"}</button>
  </article>`;
}

function renderList() {
  const result = filteredPlaces();
  const list = $("#place-list");
  const qualifier = showingPlan ? " in My list" : activeCategory === "all" ? "" : ` in ${CATEGORIES[activeCategory].label}`;
  $("#result-count").textContent = `${plural(result.length, "mapped place")}${qualifier}`;
  $("#plan-count").textContent = savedIds.size;
  $("#plan-toggle").setAttribute("aria-pressed", String(showingPlan));
  if (apiFailed) {
    list.innerHTML = `<div class="empty-results"><span aria-hidden="true">↻</span><h3>Place search is busy right now</h3><p>Your postcode worked, but the OpenStreetMap query services did not return places. Nothing has been interpreted as an empty result.</p><button class="load-more" type="button" data-action="retry">Try again</button></div>`;
    $("#load-more").hidden = true;
    updateMapPlaces([]);
    return;
  }
  if (!result.length) {
    const message = showingPlan
      ? "Add places with the heart button and they will appear here for this tab."
      : "This may mean suitable places have not been added to OpenStreetMap—not that none exist.";
    list.innerHTML = `<div class="empty-results"><span aria-hidden="true">◎</span><h3>No mapped matches found</h3><p>${escapeHtml(message)}</p></div>`;
    $("#load-more").hidden = true;
    updateMapPlaces([]);
    return;
  }
  const visible = result.slice(0, visibleLimit);
  list.innerHTML = visible.map(placeItemHtml).join("");
  const loadMore = $("#load-more");
  loadMore.hidden = visible.length >= result.length;
  loadMore.textContent = `Show ${Math.min(PAGE_SIZE, result.length - visible.length)} more places`;
  updateMapPlaces(result);
}

function renderResults() {
  renderCategories();
  renderList();
}

function placeFacts(place) {
  const facts = [`${formatDistance(place.distance)} straight-line`, place.type];
  if (place.openingHours) facts.push(`Hours: ${place.openingHours}`);
  if (place.wheelchair === "yes") facts.push("Wheelchair access tagged");
  if (place.wheelchair === "limited") facts.push("Limited wheelchair access tagged");
  if (place.fee === "no") facts.push("No fee tagged");
  if (["private", "no", "customers", "permissive"].includes(place.access)) facts.push(`Access tagged: ${humanise(place.access)}`);
  if (place.cuisine) facts.push(place.cuisine);
  return facts;
}

function routeUrl(place) {
  if (!searchContext) return place.osmUrl;
  const route = `${searchContext.latitude},${searchContext.longitude};${place.latitude},${place.longitude}`;
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${encodeURIComponent(route)}`;
}

function renderSelectedPlace(place) {
  const card = $("#place-card");
  if (!place) {
    card.hidden = true;
    return;
  }
  const category = CATEGORIES[place.primaryCategory];
  const osmUrl = `https://www.openstreetmap.org/${place.osmType}/${place.osmId}`;
  const saved = savedIds.has(place.id);
  const website = place.website ? `<a class="card-action secondary" href="${escapeHtml(place.website)}" target="_blank" rel="noopener">Website</a>` : "";
  card.style.setProperty("--category", category.colour);
  card.innerHTML = `<div class="place-card-top">
      <span class="place-icon" aria-hidden="true">${category.icon}</span>
      <div><h2>${escapeHtml(place.name)}</h2><span class="place-type">${escapeHtml(category.label)} · ${escapeHtml(place.type)}</span></div>
      <button class="place-card-close" type="button" data-action="close-place" aria-label="Close place details">×</button>
    </div>
    <div class="place-card-facts">${placeFacts(place).map((fact) => `<span>${escapeHtml(fact)}</span>`).join("")}</div>
    <p class="place-card-address">${escapeHtml(place.address || "No address is tagged in OpenStreetMap.")}<br><small>Check important details with the venue before travelling.</small></p>
    <div class="place-card-actions">
      <a class="card-action" href="${escapeHtml(routeUrl(place))}" target="_blank" rel="noopener">Route</a>
      <a class="card-action secondary" href="${osmUrl}" target="_blank" rel="noopener">OpenStreetMap</a>
      ${website || `<button class="card-action muted" type="button" data-action="save" data-id="${place.id}">${saved ? "Remove from list" : "Save to list"}</button>`}
    </div>
    ${website ? `<button class="load-more" type="button" data-action="save" data-id="${place.id}">${saved ? "Remove from My list" : "Add to My list"}</button>` : ""}`;
  card.hidden = false;
}

function selectPlace(id, scrollList = true) {
  const place = places.find((item) => item.id === id);
  if (!place) return;
  selectedId = id;
  renderSelectedPlace(place);
  renderList();
  if (mapReady) {
    map.setFilter("selected-place", ["==", ["get", "id"], id]);
    map.easeTo({ center: [place.longitude, place.latitude], zoom: Math.max(map.getZoom(), 15), duration: 650, offset: [0, -40] });
  }
  if (scrollList) {
    const item = document.getElementById(`place-${place.osmType}-${place.osmId}`);
    item?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function closeSelectedPlace() {
  selectedId = null;
  $("#place-card").hidden = true;
  if (mapReady) map.setFilter("selected-place", ["==", ["get", "id"], "__none__"]);
  renderList();
}

function toggleSaved(id) {
  if (!places.some((place) => place.id === id)) return;
  if (savedIds.has(id)) savedIds.delete(id); else savedIds.add(id);
  renderSelectedPlace(places.find((place) => place.id === selectedId));
  renderList();
}

function freshnessText(timestamp) {
  if (!timestamp) return "Places loaded from OpenStreetMap when you searched";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Places loaded from OpenStreetMap when you searched";
  return `OpenStreetMap database snapshot: ${new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "UTC", timeZoneName: "short",
  }).format(date)}`;
}

function showResultsContext(context, timestamp, rawCount) {
  $("#welcome").hidden = true;
  $("#results").hidden = false;
  $("#area-kicker").textContent = `Near ${context.postcode || "your location"}`;
  $("#area-title").textContent = context.district ? `${context.district}, unpacked` : "Nearby student places";
  const radius = Number($("#radius").value);
  const area = [context.region, context.country].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(" · ");
  $("#area-subtitle").textContent = `${area || "United Kingdom"} · within ${radius >= 1000 ? `${(radius / 1000).toFixed(1)} km` : `${radius} m`} · straight-line distance`;
  $("#freshness").textContent = `${freshnessText(timestamp)}${rawCount > MAX_PLACES ? ` · showing nearest ${MAX_PLACES.toLocaleString("en-GB")}` : ""}`;
  $("#map-key").hidden = false;
}

async function loadPlaces(context, { force = false } = {}) {
  const radius = Number($("#radius").value);
  const cacheKey = `${context.latitude.toFixed(5)},${context.longitude.toFixed(5)},${radius}`;
  const sequence = ++searchSequence;
  activeController?.abort();
  apiFailed = false;
  selectedId = null;
  closeSelectedPlace();
  showMapLoading("Finding useful places…", "Asking OpenStreetMap for the selected radius");
  updateSearchGeometry(true);

  try {
    let result = force ? null : queryCache.get(cacheKey);
    if (!result) {
      const query = makeOverpassQuery(context, radius);
      const payload = await queryOverpass(query, sequence);
      const normalised = payload.elements.map((element) => normaliseElement(element, context)).filter(Boolean);
      const unique = deduplicatePlaces(normalised).sort((a, b) => a.distance - b.distance);
      result = {
        places: unique.slice(0, MAX_PLACES),
        rawCount: unique.length,
        timestamp: payload.osm3s?.timestamp_osm_base || null,
      };
      queryCache.set(cacheKey, result);
    }
    if (sequence !== searchSequence) return;
    places = result.places;
    activeCategory = "all";
    placeFilter = "";
    sortMode = "distance";
    showingPlan = false;
    visibleLimit = PAGE_SIZE;
    $("#place-filter").value = "";
    $("#sort-results").value = "distance";
    showResultsContext(context, result.timestamp, result.rawCount);
    renderResults();
    hideMapLoading();
    setStatus(`${plural(places.length, "mapped place")} loaded near ${context.postcode || "your location"}.`);
  } catch (error) {
    if (sequence !== searchSequence) return;
    if (error.name === "AbortError" && sequence !== searchSequence) return;
    apiFailed = true;
    places = [];
    showResultsContext(context, null, 0);
    renderResults();
    showMapError("Place search is busy", "The postcode worked. Try the place search again in a moment.");
    setStatus("Your postcode worked, but place search is busy. Try again.", true);
  }
}

async function usePostcode(value) {
  const postcode = normalisePostcode(value);
  if (!postcode || postcode.length < 5 || postcode.length > 9) {
    setStatus("Enter a complete UK postcode, such as LS1 4DY.", true);
    $("#postcode").focus();
    return;
  }
  setStatus("Finding that postcode…");
  try {
    const data = await fetchJson(`${POSTCODE_API}/${encodeURIComponent(postcode)}`);
    const result = data.result;
    const latitude = Number(result?.latitude);
    const longitude = Number(result?.longitude);
    if (!result || !validCoordinate(latitude, longitude) || Number(result.quality) === 9) throw new Error("Postcode coordinates unavailable");
    searchContext = {
      postcode: result.postcode,
      latitude,
      longitude,
      district: result.admin_district || result.region || result.country,
      region: result.region,
      country: result.country,
    };
    $("#postcode").value = result.postcode;
    if (Number(result.quality) >= 5) setStatus("This postcode uses an approximate map centre; loading nearby mapped places…");
    await loadPlaces(searchContext);
  } catch (error) {
    setStatus("That postcode was not found. Check it and try again.", true);
  }
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    setStatus("Location is not available in this browser.", true);
    return;
  }
  setStatus("Waiting for location permission…");
  navigator.geolocation.getCurrentPosition(async (position) => {
    const latitude = Number(position.coords.latitude);
    const longitude = Number(position.coords.longitude);
    if (!validCoordinate(latitude, longitude)) {
      setStatus("This map currently works around UK postcodes.", true);
      return;
    }
    try {
      const data = await fetchJson(`${POSTCODE_API}?lon=${longitude.toFixed(6)}&lat=${latitude.toFixed(6)}&limit=1`);
      const nearest = data.result?.[0];
      searchContext = {
        postcode: nearest?.postcode || null,
        latitude,
        longitude,
        district: nearest?.admin_district || nearest?.region || nearest?.country || "Your area",
        region: nearest?.region,
        country: nearest?.country || "United Kingdom",
      };
      if (nearest?.postcode) $("#postcode").value = nearest.postcode;
      await loadPlaces(searchContext);
    } catch (_) {
      setStatus("Your location was found, but the nearest UK postcode could not be loaded.", true);
    }
  }, (error) => {
    const message = error.code === 1 ? "Location permission was not granted." : "Your location could not be read.";
    setStatus(message, true);
  }, { enableHighAccuracy: false, timeout: 12_000, maximumAge: 300_000 });
}

function openAbout() {
  const dialog = $("#about-dialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
}

function closeAbout() {
  $("#about-dialog").close();
}

function bindEvents() {
  $("#search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    usePostcode($("#postcode").value);
  });
  $("#locate").addEventListener("click", useCurrentLocation);
  $$("[data-postcode]").forEach((button) => button.addEventListener("click", () => {
    $("#postcode").value = button.dataset.postcode;
    usePostcode(button.dataset.postcode);
  }));
  $("#radius").addEventListener("change", () => {
    if (searchContext) loadPlaces(searchContext);
  });
  $("#category-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button || !CATEGORIES[button.dataset.category]) return;
    activeCategory = button.dataset.category;
    showingPlan = false;
    visibleLimit = PAGE_SIZE;
    closeSelectedPlace();
    renderResults();
  });
  $("#place-filter").addEventListener("input", (event) => {
    placeFilter = event.target.value;
    visibleLimit = PAGE_SIZE;
    renderList();
  });
  $("#sort-results").addEventListener("change", (event) => {
    sortMode = event.target.value === "name" ? "name" : "distance";
    renderList();
  });
  $("#plan-toggle").addEventListener("click", () => {
    showingPlan = !showingPlan;
    visibleLimit = PAGE_SIZE;
    closeSelectedPlace();
    renderList();
  });
  $("#load-more").addEventListener("click", () => {
    visibleLimit += PAGE_SIZE;
    renderList();
  });
  $("#surprise").addEventListener("click", () => {
    const result = filteredPlaces();
    if (!result.length) return;
    selectPlace(result[Math.floor(Math.random() * result.length)].id);
  });
  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const id = action.dataset.id;
    if (action.dataset.action === "select") selectPlace(id);
    if (action.dataset.action === "save") toggleSaved(id);
    if (action.dataset.action === "close-place") closeSelectedPlace();
    if (action.dataset.action === "retry" && searchContext) loadPlaces(searchContext, { force: true });
  });
  $("#about-button").addEventListener("click", openAbout);
  $("#about-close").addEventListener("click", closeAbout);
  $("#about-done").addEventListener("click", closeAbout);
  $("#about-dialog").addEventListener("click", (event) => {
    if (event.target === $("#about-dialog")) closeAbout();
  });
}

function init() {
  bindEvents();
  initialiseMap();
}

init();
