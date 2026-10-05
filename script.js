// WMO weather codes are returned by the forecast API as numbers, so this one
// lookup translates the supported codes into short labels for the interface.
const weatherLabels = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snowfall",
  73: "Moderate snowfall",
  75: "Heavy snowfall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  97: "Heavy thunderstorm",
  99: "Thunderstorm with heavy hail"
};

// These elements are reused by the small functions below to update the page.
const searchForm = document.querySelector("#search-form");
const cityInput = document.querySelector("#city-input");
const searchButton = document.querySelector("#search-button");
const locationButton = document.querySelector("#location-button");
const statusMessage = document.querySelector("#status-message");
const locationList = document.querySelector("#location-list");
const weatherPanel = document.querySelector("#weather-panel");
const currentWeather = document.querySelector("#current-weather");
const forecastList = document.querySelector("#forecast-list");
const celsiusButton = document.querySelector("#celsius-button");
const fahrenheitButton = document.querySelector("#fahrenheit-button");

// Weather stays in Celsius in memory so switching units never needs a request.
let selectedLocation = null;
let weatherData = null;
let temperatureUnit = "C";

// A small element helper creates text-only nodes so API values are never parsed as HTML.
function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

// The user can start a search with either Enter or the visible button.
searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchCity(cityInput.value);
});
locationButton.addEventListener("click", useMyLocation);

// Changing units rerenders the already-loaded data without calling the API.
celsiusButton.addEventListener("click", () => setTemperatureUnit("C"));
fahrenheitButton.addEventListener("click", () => setTemperatureUnit("F"));

// On a return visit, restore the last selected coordinates and fetch their weather.
loadTemperatureUnit();
loadSavedLocation();

// Search Open-Meteo for a city and show up to five choices when names are ambiguous.
async function searchCity(cityName) {
  const query = cityName.trim();
  if (!query) {
    showError("Enter a city name to search.");
    cityInput.focus();
    return;
  }

  setLoading(true, "Searching for that city...");
  locationList.replaceChildren();
  weatherPanel.hidden = true;

  try {
    const { searchName, qualifier } = splitCityQuery(query);
    const searchUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    searchUrl.search = new URLSearchParams({
      name: searchName,
      count: "10",
      language: "en",
      format: "json"
    });

    const response = await fetch(searchUrl);
    if (!response.ok) {
      throw new Error("The city search request failed.");
    }

    const data = await response.json();
    const allLocations = Array.isArray(data.results) ? data.results : [];
    const locations = filterLocations(allLocations, qualifier).slice(0, 5);

    if (locations.length === 0) {
      setLoading(false);
      showError("City not found");
      return;
    }

    if (locations.length === 1) {
      await chooseLocation(locations[0]);
      return;
    }

    setLoading(false);
    showLocations(locations);
    statusMessage.textContent = "Choose a matching city.";
  } catch (error) {
    console.error(error);
    setLoading(false);
    showError("Could not load weather. Check your connection and try again.");
  }
}

// Split a city query so the optional country or region can filter matches locally.
function splitCityQuery(query) {
  const [searchName, ...qualifierParts] = query.split(",");
  return {
    searchName: searchName.trim(),
    qualifier: qualifierParts.join(",").trim()
  };
}

// Prefer country or region matches, but keep all results if the qualifier misses.
function filterLocations(locations, qualifier) {
  if (!qualifier) {
    return locations;
  }

  const normalizedQualifier = qualifier.toLowerCase();
  const matches = locations.filter((location) => {
    const searchableFields = [location.country, location.admin1, location.country_code];
    return searchableFields.some((field) =>
      typeof field === "string" && field.toLowerCase().includes(normalizedQualifier)
    );
  });

  return matches.length > 0 ? matches : locations;
}

// Create safe, keyboard-operable buttons for each matching city.
function showLocations(locations) {
  locationList.replaceChildren();

  locations.forEach((location) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const regionAndCountry = [location.admin1, location.country]
      .filter(Boolean)
      .join(", ");

    button.type = "button";
    button.className = "location-choice";
    button.setAttribute("aria-label", `${location.name}, ${regionAndCountry}`);
    button.append(
      createTextElement("span", "location-name", location.name),
      createTextElement("span", "location-detail", regionAndCountry)
    );
    button.addEventListener("click", () => chooseLocation(location));
    item.append(button);
    locationList.append(item);
  });
}

// Save a selected location and request its current conditions and five-day forecast.
async function chooseLocation(location) {
  selectedLocation = {
    name: location.name,
    admin1: location.admin1 || "",
    country: location.country || "",
    latitude: location.latitude,
    longitude: location.longitude
  };
  saveLocation(selectedLocation);
  await fetchWeather(selectedLocation);
}

// Ask the browser for coordinates and use them directly without reverse geocoding.
async function useMyLocation() {
  if (!navigator.geolocation) {
    showError("Location is not available in this browser. Search for a city instead.");
    return;
  }

  setLoading(true, "Finding your location...");
  locationList.replaceChildren();
  weatherPanel.hidden = true;

  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 10000,
        maximumAge: 300000
      });
    });
    selectedLocation = {
      name: "Your location",
      admin1: "",
      country: "",
      latitude: position.coords.latitude,
      longitude: position.coords.longitude
    };
    cityInput.value = "";
    await fetchWeather(selectedLocation);
  } catch (error) {
    console.error(error);
    setLoading(false);
    showError(getLocationErrorMessage(error));
  }
}

// Explain the most common browser geolocation failures with a useful next step.
function getLocationErrorMessage(error) {
  if (error.code === 1) {
    return "Location permission was denied. Allow access or search for a city.";
  }
  if (error.code === 2) {
    return "Your location is unavailable. Try again or search for a city.";
  }
  if (error.code === 3) {
    return "Finding your location took too long. Try again or search for a city.";
  }
  return "Could not get your location. Search for a city instead.";
}

// Request the documented current and daily fields in metric units.
async function fetchWeather(location) {
  setLoading(true, "Loading the forecast...");
  locationList.replaceChildren();
  weatherPanel.hidden = true;

  try {
    const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
    forecastUrl.search = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
      temperature_unit: "celsius",
      wind_speed_unit: "kmh",
      timezone: "auto",
      forecast_days: "5"
    });

    const response = await fetch(forecastUrl);
    if (!response.ok) {
      throw new Error("The forecast request failed.");
    }

    const data = await response.json();
    if (!hasForecastData(data)) {
      throw new Error("The forecast response was incomplete.");
    }

    weatherData = data;
    setLoading(false);
    statusMessage.textContent = `Showing weather for ${location.name}.`;
    renderCurrent(location, data);
    renderForecast(data);
    weatherPanel.hidden = false;
  } catch (error) {
    console.error(error);
    setLoading(false);
    showError("Could not load weather. Check your connection and try again.");
  }
}

// Check the fields used by the renderers before showing any results.
function hasForecastData(data) {
  return Boolean(
    data &&
    data.current &&
    Number.isFinite(data.current.temperature_2m) &&
    Number.isFinite(data.current.apparent_temperature) &&
    Number.isFinite(data.current.relative_humidity_2m) &&
    Number.isFinite(data.current.wind_speed_10m) &&
    Number.isFinite(data.current.is_day) &&
    data.daily &&
    Array.isArray(data.daily.time) &&
    Array.isArray(data.daily.weather_code) &&
    Array.isArray(data.daily.temperature_2m_max) &&
    Array.isArray(data.daily.temperature_2m_min) &&
    Array.isArray(data.daily.precipitation_probability_max) &&
    Array.isArray(data.daily.sunrise) &&
    Array.isArray(data.daily.sunset) &&
    data.daily.time.length >= 5 &&
    data.daily.weather_code.length >= 5 &&
    data.daily.temperature_2m_max.length >= 5 &&
    data.daily.temperature_2m_min.length >= 5 &&
    data.daily.precipitation_probability_max.length >= 5 &&
    data.daily.sunrise.length >= 5 &&
    data.daily.sunset.length >= 5
  );
}

// Render the city, current condition, main temperature, and supporting details.
function renderCurrent(location, data) {
  currentWeather.replaceChildren();

  const topLine = document.createElement("div");
  topLine.className = "current-topline";
  const place = document.createElement("div");
  place.append(createTextElement("h2", "location-heading", location.name));
  const locationDetail = [location.admin1, location.country].filter(Boolean).join(", ");
  if (locationDetail) {
    place.append(createTextElement("p", "location-country", locationDetail));
  }

  const isDay = data.current.is_day === 1;
  document.body.classList.toggle("is-night", !isDay);
  const weatherMark = createWeatherIcon(data.current.weather_code, isDay, "weather-mark");
  topLine.append(place, weatherMark);

  const temperature = document.createElement("p");
  temperature.className = "temperature-block";
  temperature.append(
    createTextElement("span", "temperature-value", formatTemperature(data.current.temperature_2m)),
    createTextElement("span", "temperature-unit", `°${temperatureUnit}`)
  );

  const condition = createTextElement("p", "current-condition", getWeatherLabel(data.current.weather_code));
  const feelsLike = createTextElement(
    "p",
    "feels-like",
    `Feels like ${formatTemperature(data.current.apparent_temperature)}°${temperatureUnit}`
  );

  const details = document.createElement("dl");
  details.className = "weather-details";
  details.append(
    createWeatherDetail("Humidity", `${Math.round(data.current.relative_humidity_2m)}%`),
    createWeatherDetail("Wind", formatWindSpeed(data.current.wind_speed_10m)),
    createWeatherDetail("Chance of rain", formatRainChance(data.daily.precipitation_probability_max[0])),
    createWeatherDetail(
      "Sunrise / Sunset",
      `${formatLocalTime(data.daily.sunrise[0])} / ${formatLocalTime(data.daily.sunset[0])}`
    )
  );
  currentWeather.append(topLine, temperature, condition, feelsLike, details);
}

// Draw a small SVG that matches the WMO code and uses the local day or night sky.
function createWeatherIcon(code, isDay, className) {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", className);
  icon.setAttribute("viewBox", "0 0 48 48");
  icon.setAttribute("fill", "none");
  icon.setAttribute("aria-hidden", "true");

  // Keep every icon shape as an SVG element instead of inserting markup strings.
  function addPath(pathData, fill = "none") {
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", fill);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    icon.append(path);
  }

  function addCircle(x, y, radius) {
    const circle = document.createElementNS(namespace, "circle");
    circle.setAttribute("cx", String(x));
    circle.setAttribute("cy", String(y));
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "currentColor");
    circle.setAttribute("stroke-width", "1.8");
    icon.append(circle);
  }

  function addSun(x, y, radius) {
    addCircle(x, y, radius);
    for (let angle = 0; angle < 360; angle += 45) {
      const radians = (angle * Math.PI) / 180;
      const innerRadius = radius + 3;
      const outerRadius = radius + 6;
      const startX = (x + Math.cos(radians) * innerRadius).toFixed(1);
      const startY = (y + Math.sin(radians) * innerRadius).toFixed(1);
      const endX = (x + Math.cos(radians) * outerRadius).toFixed(1);
      const endY = (y + Math.sin(radians) * outerRadius).toFixed(1);
      addPath(`M${startX} ${startY} L${endX} ${endY}`);
    }
  }

  function addMoon() {
    addPath("M31 8a16 16 0 1 0 8 29A17 17 0 0 1 31 8Z");
  }

  function addCloud() {
    addPath("M11 32h25a7 7 0 0 0 0-14h-1a12 12 0 0 0-23-1 8 8 0 0 0-1 15Z");
  }

  if (code === 0 || code === 1) {
    if (isDay) {
      addSun(24, 24, 8);
    } else {
      addMoon();
    }
  } else if (code === 2) {
    if (isDay) {
      addSun(30, 16, 6);
    } else {
      addMoon();
    }
    addCloud();
  } else if (code === 45 || code === 48) {
    addCloud();
    addPath("M14 37h20 M11 42h20");
  } else if (code >= 95) {
    addCloud();
    addPath("m26 30-7 10h6l-2 8 10-13h-6l3-5Z", "currentColor");
  } else if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    addCloud();
    addPath("M16 37v7m-3.5-3.5h7m-6-2.5 5 5m0-5-5 5 M31 37v7m-3.5-3.5h7m-6-2.5 5 5m0-5-5 5");
  } else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    addCloud();
    addPath("m16 37-2 5m10-5-2 5m10-5-2 5");
  } else {
    addCloud();
  }

  return icon;
}

// Build one humidity or wind definition-list entry using text-only elements.
function createWeatherDetail(label, value) {
  const detail = document.createElement("div");
  detail.className = "weather-detail";
  detail.append(
    createTextElement("dt", "", label),
    createTextElement("dd", "", value)
  );
  return detail;
}

// Render the next five local forecast days with their condition and temperature range.
function renderForecast(data) {
  forecastList.replaceChildren();

  data.daily.time.slice(0, 5).forEach((date, index) => {
    const row = document.createElement("div");
    row.className = "forecast-row";
    const dayDate = new Date(`${date}T12:00:00`);
    const dayName = index === 0
      ? "Today"
      : new Intl.DateTimeFormat("en", { weekday: "short" }).format(dayDate);
    const temperatures = document.createElement("div");
    temperatures.className = "forecast-temperatures";
    const conditionGroup = document.createElement("div");
    conditionGroup.className = "forecast-condition-group";
    const condition = document.createElement("span");
    condition.className = "forecast-condition";
    condition.append(
      createWeatherIcon(data.daily.weather_code[index], true, "forecast-weather-icon"),
      createTextElement("span", "", getWeatherLabel(data.daily.weather_code[index]))
    );
    conditionGroup.append(condition);
    const rainChance = data.daily.precipitation_probability_max[index];
    if (Number.isFinite(rainChance) && rainChance >= 20) {
      conditionGroup.append(
        createTextElement("span", "forecast-rain-chance", `${Math.round(rainChance)}% chance of rain`)
      );
    }
    temperatures.append(
      createTextElement("span", "forecast-high", `${formatTemperature(data.daily.temperature_2m_max[index])}°`),
      createTextElement("span", "forecast-low", `${formatTemperature(data.daily.temperature_2m_min[index])}°`)
    );
    row.append(
      createTextElement("span", "forecast-day", dayName),
      conditionGroup,
      temperatures
    );
    forecastList.append(row);
  });
}

// Convert a Celsius value only for display; the API response remains unchanged.
function convertTemp(celsiusValue) {
  return temperatureUnit === "F" ? (celsiusValue * 9) / 5 + 32 : celsiusValue;
}

// Round and display a temperature consistently in both current and forecast views.
function formatTemperature(celsiusValue) {
  return String(Math.round(convertTemp(celsiusValue)));
}

// Convert metric wind speed locally so changing units never needs another request.
function formatWindSpeed(kilometersPerHour) {
  if (temperatureUnit === "F") {
    return `${Math.round(kilometersPerHour * 0.621371)} mph`;
  }
  return `${Math.round(kilometersPerHour)} km/h`;
}

// Format a probability value while keeping missing API values understandable.
function formatRainChance(probability) {
  return Number.isFinite(probability) ? `${Math.round(probability)}%` : "Not available";
}

// Read the clock portion of Open-Meteo's timezone=auto timestamp as local time.
function formatLocalTime(dateTime) {
  const time = typeof dateTime === "string" ? dateTime.split("T")[1]?.slice(0, 5) : "";
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return "Not available";
  }

  const [hourText, minute] = time.split(":");
  const hour = Number(hourText);
  const period = hour >= 12 ? "PM" : "AM";
  const twelveHourClock = hour % 12 || 12;
  return `${twelveHourClock}:${minute} ${period}`;
}

// Return the official WMO label or a readable fallback for an unknown code.
function getWeatherLabel(code) {
  return weatherLabels[code] || "Variable conditions";
}

// Update the unit buttons and redraw all visible temperatures from saved metric data.
function setTemperatureUnit(unit) {
  temperatureUnit = unit;
  const isCelsius = unit === "C";
  celsiusButton.classList.toggle("is-selected", isCelsius);
  fahrenheitButton.classList.toggle("is-selected", !isCelsius);
  celsiusButton.setAttribute("aria-pressed", String(isCelsius));
  fahrenheitButton.setAttribute("aria-pressed", String(!isCelsius));
  saveTemperatureUnit(unit);

  if (weatherData && selectedLocation) {
    renderCurrent(selectedLocation, weatherData);
    renderForecast(weatherData);
  }
}

// Show loading feedback and prevent duplicate requests until the current one finishes.
function setLoading(isLoading, message) {
  searchButton.disabled = isLoading;
  locationButton.disabled = isLoading;
  weatherPanel.setAttribute("aria-busy", String(isLoading));
  statusMessage.classList.remove("is-error");
  if (message) {
    statusMessage.textContent = message;
  }
}

// Display a clear status message while hiding stale results and old city choices.
function showError(message) {
  statusMessage.textContent = message;
  statusMessage.classList.add("is-error");
  locationList.replaceChildren();
  weatherPanel.hidden = true;
}

// Remember the chosen city and coordinates so returning visitors can load it again.
function saveLocation(location) {
  try {
    localStorage.setItem("weather-last-location", JSON.stringify(location));
  } catch (error) {
    console.error(error);
    // The app still works when browser storage is unavailable.
  }
}

// Save the selected unit separately so it survives reloads without changing city data.
function saveTemperatureUnit(unit) {
  try {
    localStorage.setItem("weather-temperature-unit", unit);
  } catch (error) {
    console.error(error);
  }
}

// Restore only supported units and update the toggle's accessible pressed state.
function loadTemperatureUnit() {
  try {
    const savedUnit = localStorage.getItem("weather-temperature-unit");
    if (savedUnit === "C" || savedUnit === "F") {
      setTemperatureUnit(savedUnit);
    }
  } catch (error) {
    console.error(error);
  }
}

// Load a saved city only when its coordinates and display name are valid.
function loadSavedLocation() {
  try {
    const savedLocation = JSON.parse(localStorage.getItem("weather-last-location"));
    if (
      savedLocation &&
      typeof savedLocation.name === "string" &&
      Number.isFinite(savedLocation.latitude) &&
      Number.isFinite(savedLocation.longitude)
    ) {
      selectedLocation = savedLocation;
      cityInput.value = savedLocation.name;
      fetchWeather(savedLocation);
    }
  } catch (error) {
    console.error(error);
    // An empty or inaccessible saved value leaves the normal search state ready.
  }
}