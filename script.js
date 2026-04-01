const els = {
  modeToggle: document.getElementById("modeToggle"),
  locationInput: document.getElementById("locationInput"),
  countInput: document.getElementById("countInput"),
  searchBtn: document.getElementById("searchBtn"),
  loadMoreTop: document.getElementById("loadMoreTop"),
  loadMoreBottom: document.getElementById("loadMoreBottom"),
  locationStatus: document.getElementById("locationStatus"),
  fetchStatus: document.getElementById("fetchStatus"),
  resultsSection: document.getElementById("resultsSection"),
  resultsSummary: document.getElementById("resultsSummary"),
  resultsList: document.getElementById("resultsList"),
  cardView: document.getElementById("cardView"),
  cardStage: document.getElementById("cardStage")
};

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";

// Put your key here.
const FOURSQUARE_API_KEY = "PASTE_YOUR_FOURSQUARE_API_KEY_HERE";
const FSQ_SEARCH_URL = "https://api.foursquare.com/v3/places/search";

const QUERY_RADII = [300, 600, 1200, 2500, 5000, 10000, 20000];

const state = {
  center: null,
  results: [],
  visibleCount: 0,
  currentMode: "list",
  cardQueue: [],
  cardIndex: 0,
  busy: false
};

function setStatus(el, text, type = "neutral") {
  el.textContent = text;
  el.className = `status status-${type}`;
}

function setFetchStatus(text, type = "neutral") {
  setStatus(els.fetchStatus, text, type);
}

function setLocationStatus(text, type = "neutral") {
  setStatus(els.locationStatus, text, type);
}

function setBusy(busy) {
  state.busy = busy;
  els.searchBtn.disabled = busy;
  els.searchBtn.style.display = busy ? "none" : "inline-flex";
  els.modeToggle.disabled = busy;
  els.countInput.disabled = busy;
  els.locationInput.disabled = busy;
}

function metersToText(meters) {
  if (!Number.isFinite(meters)) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return km >= 10 ? `${km.toFixed(0)} km` : `${km.toFixed(1)} km`;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// --- NEW: Build address string from OSM tags if available ---
function getPlaceAddress(place) {
  const tags = place.tags || {};
  const parts = [];

  // Common address keys
  const house = tags["addr:housenumber"] || tags["addr:conscriptionnumber"] || "";
  const street = tags["addr:street"] || "";
  const city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || "";
  const postcode = tags["addr:postcode"] || "";
  const country = tags["addr:country"] || "";

  if (house && street) parts.push(`${house} ${street}`);
  else if (street) parts.push(street);
  else if (house) parts.push(house);

  if (city) parts.push(city);
  if (postcode && !parts.includes(postcode)) parts.push(postcode);
  if (country && !parts.includes(country)) parts.push(country);

  // If we got at least one part, combine them
  if (parts.length) return parts.join(", ");
  return null;
}

// --- MODIFIED: Google Maps link uses address if available, otherwise coordinates ---
function googleMapsUrl(place) {
  const address = getPlaceAddress(place);
  if (address) {
    // Use address for a more descriptive search
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }
  // Fallback to coordinates
  return `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lon}`;
}

function makePlaceholderThumb(name) {
  const label = String(name || "Food").trim().slice(0, 2).toUpperCase() || "FD";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#dbeafe"/>
          <stop offset="100%" stop-color="#e2e8f0"/>
        </linearGradient>
      </defs>
      <rect width="240" height="240" rx="32" fill="url(#g)"/>
      <circle cx="120" cy="110" r="42" fill="#ffffff" fill-opacity="0.72"/>
      <text x="120" y="132" text-anchor="middle" font-size="42" font-family="Arial, sans-serif" font-weight="700" fill="#1e40af">${label}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function makeThemedSvg(emoji, label) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#fff7ed"/>
          <stop offset="100%" stop-color="#e2e8f0"/>
        </linearGradient>
      </defs>
      <rect width="640" height="480" rx="36" fill="url(#bg)"/>
      <circle cx="320" cy="180" r="86" fill="#ffffff" fill-opacity="0.70"/>
      <text x="320" y="205" text-anchor="middle" font-size="92" font-family="Arial, sans-serif">${emoji}</text>
      <text x="320" y="320" text-anchor="middle" font-size="44" font-family="Arial, sans-serif" font-weight="700" fill="#334155">${label}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function parseCoordinates(raw) {
  const input = String(raw || "");

  const gmapPattern = [...input.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
  if (gmapPattern.length) {
    const last = gmapPattern[gmapPattern.length - 1];
    return { lat: Number(last[1]), lon: Number(last[2]) };
  }

  const atPattern = [...input.matchAll(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/g)];
  if (atPattern.length) {
    const last = atPattern[atPattern.length - 1];
    return { lat: Number(last[1]), lon: Number(last[2]) };
  }

  const plainPattern = [...input.matchAll(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/g)];
  if (plainPattern.length) {
    const last = plainPattern[plainPattern.length - 1];
    return { lat: Number(last[1]), lon: Number(last[2]) };
  }

  return null;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
  }
  return JSON.parse(text);
}

async function reverseGeocode(lat, lon) {
  try {
    const url =
      `${NOMINATIM_REVERSE_URL}?format=jsonv2&addressdetails=1&zoom=18&lat=${encodeURIComponent(lat)}` +
      `&lon=${encodeURIComponent(lon)}`;

    const data = await fetchJson(url, {
      headers: { Accept: "application/json" }
    });

    return data?.display_name || "";
  } catch (err) {
    console.warn("reverseGeocode failed:", err);
    return "";
  }
}

async function resolveLocation(raw) {
  const coord = parseCoordinates(raw);

  if (coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lon)) {
    setLocationStatus("Looking up address...", "neutral");
    const label = await reverseGeocode(coord.lat, coord.lon);
    if (label) {
      setLocationStatus(`Location selected: ${label}`, "success");
      return { lat: coord.lat, lon: coord.lon, label };
    }
    setLocationStatus("Using coordinates", "success");
    return { lat: coord.lat, lon: coord.lon, label: `${coord.lat}, ${coord.lon}` };
  }

  try {
    setLocationStatus("Looking up location...", "neutral");
    const url =
      `${NOMINATIM_SEARCH_URL}?format=jsonv2&limit=5&addressdetails=1&polygon_geojson=0&` +
      `q=${encodeURIComponent(raw)}`;

    const data = await fetchJson(url, {
      headers: { Accept: "application/json" }
    });

    if (!Array.isArray(data) || !data.length) {
      setLocationStatus("Location not found", "error");
      return null;
    }

    const exact =
      data.find((d) => !["city", "town", "village", "state", "country"].includes(d.type)) ||
      data[0];

    setLocationStatus(`Location selected: ${exact.display_name}`, "success");

    return {
      lat: Number(exact.lat),
      lon: Number(exact.lon),
      label: exact.display_name
    };
  } catch (err) {
    console.error("resolveLocation failed:", err);
    setLocationStatus(`Location error: ${err.message}`, "error");
    return null;
  }
}

function buildOverpassQuery(lat, lon, radius) {
  return `
[out:json][timeout:25];
(
  nwr(around:${radius},${lat},${lon})["amenity"~"restaurant|cafe|fast_food|ice_cream|food_court"];
  nwr(around:${radius},${lat},${lon})["shop"="bakery"];
);
out center tags;
`.trim();
}

function normalizePlace(element) {
  const tags = element.tags || {};
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;

  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;

  const name = tags.name || tags.brand || tags.operator || "Unnamed";
  const category = tags.amenity || tags.shop || "food";

  if (/ikea/i.test(name) || /ikea/i.test(tags.brand || "") || /ikea/i.test(tags.operator || "")) {
    return null;
  }

  return {
    id: `${element.type}/${element.id}`,
    name,
    lat: Number(lat),
    lon: Number(lon),
    kind: category,
    tags,
    distance: haversine(state.center.lat, state.center.lon, Number(lat), Number(lon)),
    imageUrl: "",
    imageLoading: false,
    imageChecked: false
  };
}

async function fetchPlacesForRadius(radius) {
  const query = buildOverpassQuery(state.center.lat, state.center.lon, radius);
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "application/json"
    },
    body: query
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}: ${text.slice(0, 180)}`);
  }

  const data = JSON.parse(text);
  const elements = Array.isArray(data.elements) ? data.elements : [];

  return elements.map(normalizePlace).filter(Boolean);
}

function mergePlaces(existing, incoming) {
  const map = new Map(existing.map((p) => [p.id, p]));
  for (const place of incoming) {
    if (place && !map.has(place.id)) map.set(place.id, place);
  }
  return Array.from(map.values()).sort((a, b) => a.distance - b.distance);
}

function updateModeButton() {
  if (state.currentMode === "list") {
    els.modeToggle.textContent = "Card mode";
    els.modeToggle.setAttribute("aria-label", "Switch to card mode");
  } else {
    els.modeToggle.textContent = "List mode";
    els.modeToggle.setAttribute("aria-label", "Switch to list mode");
  }
}

function showListView() {
  state.currentMode = "list";
  els.resultsSection.classList.remove("hidden");
  els.cardView.classList.add("hidden");
  updateModeButton();
  renderList();
}

function showCardView() {
  state.currentMode = "card";
  els.resultsSection.classList.add("hidden");
  els.cardView.classList.remove("hidden");
  updateModeButton();
  renderCard();
}

async function searchAllNearbyPlaces(targetCount) {
  let merged = [];

  for (const radius of QUERY_RADII) {
    setFetchStatus(`Searching within ${radius.toLocaleString()} meters...`, "neutral");

    try {
      const places = await fetchPlacesForRadius(radius);
      merged = mergePlaces(merged, places);
      state.results = merged;

      state.visibleCount = Math.min(targetCount, state.results.length);

      els.resultsSection.classList.remove("hidden");
      if (state.results.length > 0) {
        renderList();
      } else {
        els.resultsSummary.textContent = "Searching...";
        els.resultsList.innerHTML = "";
      }

      await new Promise(resolve => requestAnimationFrame(resolve));
    } catch (err) {
      console.error(`Radius ${radius} failed:`, err);
      setFetchStatus(`Some search steps failed: ${err.message}`, "warn");
      els.resultsSection.classList.remove("hidden");
      renderList();
    }
  }
}

async function runSearch() {
  const raw = els.locationInput.value.trim();
  const count = Math.max(1, Number.parseInt(els.countInput.value, 10) || 50);

  if (!raw) {
    setFetchStatus("Enter a location", "warn");
    setLocationStatus("Paste a location to begin.", "neutral");
    return;
  }

  setBusy(true);
  state.center = null;
  state.results = [];
  state.visibleCount = 0;
  state.cardQueue = [];
  state.cardIndex = 0;

  els.resultsList.innerHTML = "";
  els.resultsSummary.textContent = "No results yet.";
  els.resultsSection.classList.add("hidden");
  els.cardView.classList.add("hidden");

  try {
    setFetchStatus("Starting search...", "neutral");

    const loc = await resolveLocation(raw);
    if (!loc) {
      setFetchStatus("Search failed before restaurant lookup", "error");
      return;
    }

    state.center = loc;
    els.resultsSection.classList.remove("hidden");
    els.resultsSummary.textContent = "Searching...";
    els.resultsList.innerHTML = "";

    await searchAllNearbyPlaces(count);

    state.visibleCount = Math.min(count, state.results.length);

    if (!state.results.length) {
      setFetchStatus("No places found nearby", "warn");
      els.resultsSection.classList.remove("hidden");
      renderList();
      return;
    }

    setFetchStatus(`Found ${state.results.length} places`, "success");
    showListView();
  } catch (err) {
    console.error("runSearch failed:", err);
    setFetchStatus(`Search error: ${err.message}`, "error");
    els.resultsSection.classList.remove("hidden");
    els.resultsSummary.textContent = "Search failed.";
    els.resultsList.innerHTML = "";
  } finally {
    setBusy(false);
  }
}

function loadMoreOne(e) {
  if (!state.results.length) return;

  const step = e && e.shiftKey ? 5 : 1;
  state.visibleCount += step;

  if (state.visibleCount > state.results.length) {
    state.visibleCount = state.visibleCount % state.results.length;
    if (state.visibleCount === 0) state.visibleCount = 1;
  }

  renderList();
}

function getWikipediaTitleFromTag(value) {
  if (!value) return "";
  const s = String(value).trim();
  const idx = s.indexOf(":");
  return idx >= 0 ? s.slice(idx + 1) : s;
}

async function fetchWikipediaImageByTitle(title) {
  const url =
    `${WIKIPEDIA_API}?action=query&prop=pageimages&titles=${encodeURIComponent(title)}` +
    `&piprop=thumbnail|original&pithumbsize=1200&format=json&origin=*`;

  const data = await fetchJson(url, { headers: { Accept: "application/json" } });
  const pages = data?.query?.pages || {};
  const page = Object.values(pages)[0];
  return page?.original?.source || page?.thumbnail?.source || "";
}

async function fetchWikidataWikipediaTitle(qid) {
  const url =
    `${WIKIDATA_API}?action=wbgetentities&ids=${encodeURIComponent(qid)}` +
    `&props=sitelinks&format=json&origin=*`;

  const data = await fetchJson(url, { headers: { Accept: "application/json" } });
  const entity = data?.entities?.[qid];
  const enwiki = entity?.sitelinks?.enwiki?.title;
  return enwiki || "";
}

async function searchWikipediaTitle(query) {
  const url =
    `${WIKIPEDIA_API}?action=query&list=search&srnamespace=0&srlimit=1&format=json&origin=*` +
    `&srsearch=${encodeURIComponent(query)}`;

  const data = await fetchJson(url, { headers: { Accept: "application/json" } });
  return data?.query?.search?.[0]?.title || "";
}

function fsqHasKey() {
  const key = String(FOURSQUARE_API_KEY || "").trim();
  return key && !key.startsWith("PASTE_YOUR_FOURSQUARE_API_KEY_HERE");
}

function buildFoursquarePhotoUrl(photo, maxWidth = 480, maxHeight = 360) {
  const srcW = Number(photo?.width) || maxWidth;
  const srcH = Number(photo?.height) || maxHeight;
  const width = Math.max(1, Math.min(maxWidth, srcW));
  const height = Math.max(1, Math.min(maxHeight, Math.round((width / srcW) * srcH)));
  return `${photo.prefix}${width}x${height}${photo.suffix}`;
}

function buildFoursquareCategoryIconUrl(icon, size = 120) {
  return `${icon.prefix}bg_${size}${icon.suffix}`;
}

function placeTextBlob(place) {
  return [
    place?.name,
    place?.kind,
    place?.tags?.cuisine,
    place?.tags?.brand,
    place?.tags?.operator
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getEmojiFromPlace(place) {
  const text = placeTextBlob(place);

  if (/\bpizza\b|\bpizzeria\b|domino|little caesars|pizza hut/.test(text)) return "🍕";
  if (/\bburger\b|\bhamburger\b|cheeseburger|wendy|mcdonald|burger king|five guys/.test(text)) return "🍔";
  if (/\btaco\b|\bmexican\b|burrito|quesadilla|taqueria|nacho/.test(text)) return "🌮";
  if (/\bcafe\b|\bcoffee\b|espresso|latte|starbucks|dunkin|barista|capuccino/.test(text)) return "☕";
  if (/\bsushi\b|\bjapanese\b|sashimi|ramen/.test(text)) return "🍣";
  if (/\bramen\b|\bpho\b|\bnoodle\b|\budon\b/.test(text)) return "🍜";
  if (/\bseafood\b|\bshrimp\b|\boyster\b|\bfish\b/.test(text)) return "🦐";
  if (/\bsteak\b|\bsteak_house\b|\bgrill\b|\bbc?q\b|barbecue|smokehouse/.test(text)) return "🥩";
  if (/\bbakery\b|\bbread\b|\bcroissant\b|\bpastry\b|\bdonut\b/.test(text)) return "🥐";
  if (/\bice cream\b|\bgelato\b|\bdessert\b|\bcake\b|\bsweet\b/.test(text)) return "🍦";
  if (/\bsalad\b|\bvegan\b|\bvegetarian\b/.test(text)) return "🥗";
  if (/\bchicken\b|\bfried chicken\b/.test(text)) return "🍗";
  if (/\bbreakfast\b|\bbrunch\b|\bpancake\b|\bwaffle\b/.test(text)) return "🥞";
  if (/\bbowl\b|\bhealthy\b|\bjuice\b|\bsmoothie\b/.test(text)) return "🥤";
  if (/\bmexican\b/.test(text)) return "🌯";
  if (/\brestaurant\b|\bdiner\b|\bbistro\b|\beatery\b|\bfood court\b/.test(text)) return "🍽️";

  return "🍽️";
}

function isPizzaPlace(place) {
  return getEmojiFromPlace(place) === "🍕";
}

function isCoffeePlace(place) {
  return getEmojiFromPlace(place) === "☕";
}

function isRestaurantPlace(place) {
  const emoji = getEmojiFromPlace(place);
  return emoji === "🍽️" || emoji === "🍔" || emoji === "🌮" || emoji === "🍣" || emoji === "🍜";
}

function buildThemedFallback(place) {
  const emoji = getEmojiFromPlace(place);
  if (emoji === "🍕") return makeThemedSvg("🍕", "Pizza");
  if (emoji === "☕") return makeThemedSvg("☕", "Cafe");
  if (emoji === "🍔") return makeThemedSvg("🍔", "Burger");
  if (emoji === "🌮") return makeThemedSvg("🌮", "Tacos");
  if (emoji === "🌯") return makeThemedSvg("🌯", "Mexican");
  if (emoji === "🍣") return makeThemedSvg("🍣", "Sushi");
  if (emoji === "🍜") return makeThemedSvg("🍜", "Noodles");
  if (emoji === "🦐") return makeThemedSvg("🦐", "Seafood");
  if (emoji === "🥩") return makeThemedSvg("🥩", "Steak");
  if (emoji === "🥐") return makeThemedSvg("🥐", "Bakery");
  if (emoji === "🍦") return makeThemedSvg("🍦", "Dessert");
  if (emoji === "🥗") return makeThemedSvg("🥗", "Fresh");
  if (emoji === "🍗") return makeThemedSvg("🍗", "Chicken");
  if (emoji === "🥞") return makeThemedSvg("🥞", "Brunch");
  if (emoji === "🥤") return makeThemedSvg("🥤", "Smoothie");
  if (emoji === "🍽️") return makeThemedSvg("🍽️", "Food");
  return null;
}

async function fetchFoursquarePlaceForImage(place) {
  if (!fsqHasKey() || !place?.name || place.name === "Unnamed") return null;

  const params = new URLSearchParams({
    query: place.name,
    ll: `${place.lat},${place.lon}`,
    radius: "150",
    limit: "1",
    fields: "fsq_id,name,geocodes,categories,photos,distance,location"
  });

  const res = await fetch(`${FSQ_SEARCH_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      Authorization: FOURSQUARE_API_KEY
    }
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Foursquare HTTP ${res.status}: ${text.slice(0, 180)}`);
  }

  const data = JSON.parse(text);
  return data?.results?.[0] || null;
}

async function fetchBestImageForPlace(place) {
  if (place.imageChecked || place.imageLoading) return;
  place.imageLoading = true;

  try {
    const fsqPlace = await fetchFoursquarePlaceForImage(place);

    if (fsqPlace) {
      place.fsq = fsqPlace;

      const photo = fsqPlace.photos?.[0];
      if (photo?.prefix && photo?.suffix) {
        place.imageUrl = buildFoursquarePhotoUrl(photo, 480, 360);
        place.imageChecked = true;
        return;
      }

      const icon = fsqPlace.categories?.[0]?.icon;
      if (icon?.prefix && icon?.suffix) {
        place.imageUrl = buildFoursquareCategoryIconUrl(icon, 120);
        place.imageChecked = true;
        return;
      }

      if (fsqPlace.categories?.[0]?.name && (place.kind === "food" || !place.kind)) {
        place.kind = fsqPlace.categories[0].name;
      }
    }

    const themed = buildThemedFallback(place);
    if (themed) {
      place.imageUrl = themed;
      place.imageChecked = true;
      return;
    }

    place.imageUrl = makePlaceholderThumb(place.name);
    place.imageChecked = true;
  } catch (err) {
    console.warn("Image lookup failed:", err);

    const themed = buildThemedFallback(place);
    place.imageUrl = themed || makePlaceholderThumb(place.name);
    place.imageChecked = true;
  } finally {
    place.imageLoading = false;

    const currentCard = state.cardQueue[state.cardIndex];
    if (state.currentMode === "list") {
      renderList();
    } else if (currentCard && currentCard.id === place.id) {
      renderCard();
    }
  }
}

function loadVisibleImages() {
  const visible = state.results.slice(0, state.visibleCount);
  for (const place of visible) {
    fetchBestImageForPlace(place);
  }
}

function renderList() {
  const visible = state.results.slice(0, state.visibleCount);
  els.resultsSection.classList.remove("hidden");

  if (!state.results.length && state.busy) {
    els.resultsSummary.textContent = "Searching...";
  } else {
    els.resultsSummary.textContent = state.results.length
      ? `Showing ${visible.length} of ${state.results.length} places`
      : "No results found.";
  }

  els.resultsList.innerHTML = visible
    .map((place) => {
      const maps = googleMapsUrl(place);
      const thumb = place.imageUrl || makePlaceholderThumb(place.name);
      return `
        <article class="result-item">
          <img class="result-thumb" src="${thumb}" alt="" loading="lazy" />
          <div class="result-main">
            <a class="result-name" href="${maps}" target="_blank" rel="noopener noreferrer">
              ${escapeHTML(place.name)}
            </a>
            <div class="result-meta">
              <span class="badge">${escapeHTML(place.kind)}</span>
              <span class="badge muted">${escapeHTML(place.tags?.cuisine || "food")}</span>
            </div>
          </div>
          <div class="result-right">
            <div class="distance">${escapeHTML(metersToText(place.distance))}</div>
            <div class="result-subtext">Open in Google Maps</div>
          </div>
        </article>
      `;
    })
    .join("");

  els.loadMoreTop.style.display = "inline-flex";
  els.loadMoreBottom.style.display = "inline-flex";
  els.loadMoreTop.textContent = "+1";
  els.loadMoreBottom.textContent = "+1";

  loadVisibleImages();
}

function renderDoneCard() {
  els.cardStage.innerHTML = `
    <div class="done-card">
      <h2>All done!</h2>
      <p>Every card in the current deck has been shown.</p>
      <p>Swipe left to remove, swipe right to keep.</p>
      <button id="loopCardsBtn" class="loop-btn" type="button">Loop cards</button>
    </div>
  `;

  document.getElementById("loopCardsBtn").addEventListener("click", () => {
    state.cardQueue = state.results.slice(0, state.visibleCount);
    state.cardIndex = 0;
    renderCard();
  });
}

function attachSwipeHandlers(cardEl) {
  const threshold = 90;
  let startX = 0;
  let currentX = 0;
  let dragging = false;

  const resetTransform = () => {
    cardEl.style.transition = "transform 180ms ease, opacity 180ms ease";
    cardEl.style.transform = "translateX(0px) rotate(0deg)";
    cardEl.style.opacity = "1";
    window.setTimeout(() => {
      cardEl.style.transition = "";
    }, 180);
  };

  cardEl.onpointerdown = (event) => {
    dragging = true;
    startX = event.clientX;
    currentX = startX;
    cardEl.setPointerCapture(event.pointerId);
    cardEl.style.transition = "none";
  };

  cardEl.onpointermove = (event) => {
    if (!dragging) return;
    currentX = event.clientX;
    const delta = currentX - startX;
    const rotate = Math.max(-12, Math.min(12, delta / 24));
    const opacity = Math.max(0.7, 1 - Math.abs(delta) / 500);
    cardEl.style.transform = `translateX(${delta}px) rotate(${rotate}deg)`;
    cardEl.style.opacity = String(opacity);
  };

  cardEl.onpointerup = () => {
    if (!dragging) return;
    dragging = false;
    const delta = currentX - startX;

    if (delta > threshold) {
      keepCard();
    } else if (delta < -threshold) {
      removeCard();
    } else {
      resetTransform();
    }
  };

  cardEl.onpointercancel = () => {
    dragging = false;
    resetTransform();
  };
}

function renderCard() {
  const place = state.cardQueue[state.cardIndex];

  if (!place) {
    renderDoneCard();
    return;
  }

  const hasImage = Boolean(place.imageUrl);

  els.cardStage.innerHTML = `
    <div class="card-shell ${hasImage ? "with-image" : "no-image"}" id="activeCard">
      ${
        hasImage
          ? `
            <div class="card-image">
              <img src="${escapeHTML(place.imageUrl)}" alt="${escapeHTML(place.name)}" />
            </div>
          `
          : ""
      }
      <div class="card-copy ${hasImage ? "compact" : "no-image"}">
        <div>
          <h2>${escapeHTML(place.name)}</h2>
          <p>${escapeHTML(metersToText(place.distance))} • ${escapeHTML(place.kind)}</p>
          <p class="muted">${place.tags?.cuisine ? escapeHTML(place.tags.cuisine) : "No extra details found"}</p>
        </div>
      </div>
    </div>

    <div class="card-hint">Swipe left to remove • swipe right to keep</div>

    <div class="card-actions">
      <button id="skipBtn" class="skip-btn" type="button">✖ Remove</button>
      <button id="keepBtn" class="keep-btn" type="button">✔ Keep</button>
    </div>
  `;

  const activeCard = document.getElementById("activeCard");
  attachSwipeHandlers(activeCard);

  document.getElementById("skipBtn").addEventListener("click", removeCard);
  document.getElementById("keepBtn").addEventListener("click", keepCard);

  if (!hasImage) {
    fetchBestImageForPlace(place);
  }
}

function openCardMode() {
  if (!state.results.length) {
    setFetchStatus("Search first", "warn");
    return;
  }

  state.cardQueue = state.results.slice(0, state.visibleCount);
  state.cardIndex = 0;
  showCardView();
}

function keepCard() {
  state.cardIndex += 1;
  renderCard();
}

function removeCard() {
  const current = state.cardQueue[state.cardIndex];
  if (!current) return;

  state.results = state.results.filter((p) => p.id !== current.id);
  state.cardQueue = state.cardQueue.filter((p) => p.id !== current.id);
  state.visibleCount = Math.min(state.visibleCount, state.results.length);

  renderList();
  renderCard();
}

function loopCards() {
  state.cardQueue = state.results.slice(0, state.visibleCount);
  state.cardIndex = 0;
  renderCard();
}

function loadMoreOne(e) {
  if (!state.results.length) return;

  const step = e && e.shiftKey ? 5 : 1;
  state.visibleCount += step;

  if (state.visibleCount > state.results.length) {
    state.visibleCount = state.visibleCount % state.results.length;
    if (state.visibleCount === 0) state.visibleCount = 1;
  }

  renderList();
}

els.searchBtn.addEventListener("click", runSearch);
els.modeToggle.addEventListener("click", () => {
  if (!state.results.length) {
    setFetchStatus("Search first", "warn");
    return;
  }
  if (state.currentMode === "list") {
    state.cardQueue = state.results.slice(0, state.visibleCount);
    state.cardIndex = 0;
    showCardView();
  } else {
    showListView();
  }
});

els.loadMoreTop.addEventListener("click", loadMoreOne);
els.loadMoreBottom.addEventListener("click", loadMoreOne);

els.locationInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") runSearch();
});

els.countInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") runSearch();
});

setLocationStatus("Paste a location to begin.", "neutral");
setFetchStatus("Waiting for a search.", "neutral");
updateModeButton();
