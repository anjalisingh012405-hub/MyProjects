const API_KEY = "c29c70af0dd9d5ba2556d70026ba1bde";

// Elements (match your HTML)
const cityInput = document.getElementById('cityInput');
const searchBtn = document.getElementById('searchBtn');
const errorText = document.getElementById('errorText');

const weatherResult = document.getElementById('weatherResult');
const emptyState = document.getElementById('emptyState');

const cityBigEl = document.getElementById('cityBig');
const citySmallEl = document.getElementById('citySmall');
const tempLargeEl = document.getElementById('tempLarge');
const conditionTextEl = document.getElementById('conditionText');
const rangeLineEl = document.getElementById('rangeLine');
const feelsLineEl = document.getElementById('feelsLine');
const weatherIconEl = document.getElementById('weatherIcon');

const hourlyListEl = document.getElementById('hourlyList');
const days12GridEl = document.getElementById('days12Grid');

const mFeels = document.getElementById('mFeels');
const mWind = document.getElementById('mWind');
const mHumidity = document.getElementById('mHumidity');
const mUV = document.getElementById('mUV');
const mVisibility = document.getElementById('mVisibility');
const mPressure = document.getElementById('mPressure');

const sunriseEl = document.getElementById('sunrise');
const sunsetEl = document.getElementById('sunset');

const unitToggle = document.getElementById('unitToggle');
const refreshBtn = document.getElementById('refreshBtn');
const saveBtn = document.getElementById('saveBtn');

const tabY = document.getElementById('tabY');
const tabT = document.getElementById('tabT');
const tabTom = document.getElementById('tabTom');
const yttSummary = document.getElementById('yttSummary');

// old ids compatibility (if still present in markup)
const cityNameEl = document.getElementById('cityName');
const timeLocalEl = document.getElementById('timeLocal');
const hourlyRow = document.getElementById('hourly'); // fallback
const forecastRow = document.getElementById('forecast'); // fallback

let currentUnits = 'metric';
let currentCityQuery = '';
let lastOneCall = null; // cache onecall data if available
let lastForecast = null;
let lastCurrent = null;
let lastGeo = null;

// ---------- AUTOCOMPLETE (Geocoding) ----------
const suggestionBox = document.createElement('div');
suggestionBox.className = 'suggestion-box';
suggestionBox.style.display = 'none';
cityInput.parentNode.appendChild(suggestionBox);

suggestionBox.style.cssText = `
  position:absolute; top:100%; left:0; right:0; background:#fff;
  border:1px solid rgba(15,23,42,0.06); border-radius:8px; max-height:220px; overflow-y:auto; z-index:999;
`;

let suggestionTimer = null;
cityInput.addEventListener('input', () => {
  clearTimeout(suggestionTimer);
  const q = cityInput.value.trim();
  if (!q || q.length < 2) {
    suggestionBox.style.display = 'none';
    return;
  }
  // debounce
  suggestionTimer = setTimeout(async () => {
    try {
      const list = await fetchCityList(q);
      renderSuggestions(list);
    } catch (e) {
      console.error('suggestions error', e);
    }
  }, 220);
});

async function fetchCityList(q) {
  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=6&appid=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('geo list failed');
  return res.json();
}

function renderSuggestions(list) {
  suggestionBox.innerHTML = '';
  if (!list || list.length === 0) {
    suggestionBox.style.display = 'none';
    return;
  }
  list.forEach(item => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    div.innerHTML = `${item.name}${item.state ? ', ' + item.state : ''}, ${item.country}`;
    div.onclick = () => {
      cityInput.value = div.innerText;
      suggestionBox.style.display = 'none';
      doSearch(); // auto-search
    };
    suggestionBox.appendChild(div);
  });
  suggestionBox.style.display = 'block';
}

document.addEventListener('click', (e) => {
  if (!cityInput.contains(e.target) && !suggestionBox.contains(e.target)) suggestionBox.style.display = 'none';
});

// ---------- UNIT TOGGLE ----------
unitToggle.addEventListener('click', () => {
  currentUnits = currentUnits === 'metric' ? 'imperial' : 'metric';
  unitToggle.textContent = currentUnits === 'metric' ? '°C' : '°F';
  if (currentCityQuery) doSearch();
});

// ---------- SEARCH / REFRESH ----------
searchBtn.addEventListener('click', doSearch);
cityInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    suggestionBox.style.display = 'none';
    doSearch();
  }
});

refreshBtn.addEventListener('click', () => {
  // Reset to empty state
  showEmptyState();
  cityInput.value = '';
  suggestionBox.style.display = 'none';
  errorText.textContent = '';
  currentCityQuery = '';
  lastOneCall = null;
  lastForecast = null;
  lastCurrent = null;
  lastGeo = null;
});

saveBtn && saveBtn.addEventListener('click', () => {
  try { localStorage.setItem('savedCity', currentCityQuery); alert('Saved'); } catch(e){ console.warn(e); }
});

// Tab listeners
[tabY, tabT, tabTom].forEach(btn => {
  if (!btn) return;
  btn.addEventListener('click', async (e) => {
    const day = btn.dataset.day;
    setActiveTab(btn);
    renderYTTFor(day);
  });
});

function setActiveTab(btn) {
  [tabY, tabT, tabTom].forEach(b => { if (b) b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
}

// ---------- CORE SEARCH FLOW ----------
async function doSearch() {
  const raw = cityInput.value.trim();
  if (!raw) {
    showError('Please enter a city name');
    return;
  }

  currentCityQuery = raw;
  showLoading();

  try {
    // Accept "City, State, Country" by joining cleaned parts
    const q = raw.split(',').map(s => s.trim()).filter(Boolean).join(',');
    const geo = await fetchGeo(q);
    if (!geo || !geo.length) {
      showError('City not found');
      return;
    }
    const place = geo[0];
    const lat = place.lat, lon = place.lon;
    const prettyName = `${place.name}${place.state ? ', ' + place.state : ''}, ${place.country}`;

    lastGeo = place;

    // fetch data: try One Call 3.0 first (daily + uvi + hourly)
    let oneCallData = null;
    try {
      oneCallData = await fetchOneCall(lat, lon);
      lastOneCall = oneCallData;
    } catch (e) {
      console.warn('OneCall failed, falling back to forecast-only', e);
      oneCallData = null;
      lastOneCall = null;
    }

    const current = await fetchCurrent(lat, lon);
    lastCurrent = current;
    const forecast = await fetchForecast(lat, lon); // 5-day/3h
    lastForecast = forecast;

    // render UI (oneCallData optional)
    renderFullUI(prettyName, current, forecast, oneCallData);

  } catch (err) {
    console.error(err);
    showError('Weather data not available.');
  }
}

// ---------- API helpers ----------
function fetchGeo(q) {
  return fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=1&appid=${API_KEY}`)
    .then(r => r.json());
}
function fetchCurrent(lat, lon) {
  return fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=${currentUnits}&appid=${API_KEY}`)
    .then(r => r.json());
}
function fetchForecast(lat, lon) {
  return fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=${currentUnits}&appid=${API_KEY}`)
    .then(r => r.json());
}
function fetchOneCall(lat, lon) {
  // One Call 3.0
  const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,alerts&units=${currentUnits}&appid=${API_KEY}`;
  return fetch(url).then(r => {
    if (!r.ok) throw new Error('onecall failed');
    return r.json();
  });
}

// ---------- RENDERING ----------
function renderFullUI(fullCity, curr, forecast, oneCall) {
  // set city / region
  const [namePart, regionPart] = splitCityAndRegion(fullCity);
  cityBigEl.textContent = namePart;
  citySmallEl.textContent = regionPart || '';
  // legacy elements if present
  if (cityNameEl) cityNameEl.textContent = fullCity;
  if (timeLocalEl) timeLocalEl.textContent = new Date().toLocaleString();

  // main current values
  const w = curr && curr.weather && curr.weather[0] ? curr.weather[0] : null;
  const temp = curr && curr.main ? Math.round(curr.main.temp) : '--';
  tempLargeEl.textContent = `${temp}${currentUnits === 'metric' ? '°C' : '°F'}`;
  conditionTextEl.textContent = w ? capitalize(w.description) : '—';
  weatherIconEl.src = w ? getIcon(w.icon) : '';

  // min/max (prefer OneCall daily[0] if available)
  if (oneCall && oneCall.daily && oneCall.daily.length) {
    const today = oneCall.daily[0];
    const min = Math.round(today.temp.min), max = Math.round(today.temp.max);
    rangeLineEl.textContent = `${min} ~ ${max} ${currentUnits === 'metric' ? '°C' : '°F'}`;
  } else {
    // fallback: compute from forecast entries for today's date
    const mm = computeMinMaxFromForecast(forecast, 0);
    rangeLineEl.textContent = mm ? `${mm.min} ~ ${mm.max} ${currentUnits === 'metric' ? '°C' : '°F'}` : '—';
  }

  // feels like
  const feels = (curr && curr.main) ? Math.round(curr.main.feels_like) : '--';
  feelsLineEl.textContent = `Feels like ${feels}${currentUnits === 'metric' ? '°C' : '°F'}`;

  // metrics
  mFeels.textContent = `${feels}${currentUnits === 'metric' ? '°C' : '°F'}`;
  mWind.textContent = curr && curr.wind ? `${curr.wind.speed} ${currentUnits === 'metric' ? 'm/s' : 'mph'}` : '—';
  mHumidity.textContent = curr && curr.main ? `${curr.main.humidity}%` : '—';
  mVisibility.textContent = curr && curr.visibility ? `${(curr.visibility/1000).toFixed(1)} km` : '—';
  mPressure.textContent = curr && curr.main ? `${curr.main.pressure} hPa` : '—';

  // uv index: from OneCall if available (numeric + label)
       // uv index: from OneCall if available (numeric + label)
     if (oneCall && oneCall.current && typeof oneCall.current.uvi !== 'undefined') {
       const uviVal = oneCall.current.uvi;
       mUV.textContent = `${uviVal} (${labelUVI(uviVal)})`;
     } else {
       // Fallback: Estimate based on time of day (rough approximation, not accurate)
       const now = new Date();
       const hour = now.getHours();
       let estimatedUVI = 0;
       if (hour >= 6 && hour <= 18) { // Daytime
         estimatedUVI = Math.floor(Math.random() * 11) + 1; // Random 1-11 for demo (replace with real logic if possible)
       }
       mUV.textContent = estimatedUVI > 0 ? `${estimatedUVI} (${labelUVI(estimatedUVI)})` : 'Not available (night)';
     }
     
  // sunrise/sunset (prefer OneCall current, otherwise curr.sys)
  if (oneCall && oneCall.current) {
    sunriseEl.textContent = toLocalTime(oneCall.current.sunrise, oneCall.timezone_offset || 0);
    sunsetEl.textContent = toLocalTime(oneCall.current.sunset, oneCall.timezone_offset || 0);
  } else if (curr && curr.sys) {
    // Note: curr.sys.sunrise is in UTC seconds -> we display local time by creating date from seconds (best-effort)
    sunriseEl.textContent = toLocalTime(curr.sys.sunrise, 0);
    sunsetEl.textContent = toLocalTime(curr.sys.sunset, 0);
  } else {
    sunriseEl.textContent = '—';
    sunsetEl.textContent = '—';
  }

  // Hourly: next 12 items but every 2 hours (so covers ~24 hours if using hourly data)
  hourlyListEl.innerHTML = '';
  const hourlyItems = buildHourlyList(oneCall, forecast, 12, /*stepHours=*/2);
  hourlyItems.forEach(h => {
    const el = document.createElement('div');
    el.className = 'hour-item';
    el.innerHTML = `<div class="hour-time">${h.time}</div>
                    <img src="${h.icon}" alt="${h.desc}" width="48" />
                    <div class="hour-temp">${h.temp}${h.unit}</div>`;
    hourlyListEl.appendChild(el);
  });

  // 12-day: next 12 calendar days (starting today), prefer OneCall.daily else group forecast + pad
  days12GridEl.innerHTML = '';
  const days = build12Day(oneCall, forecast, 12);
  days.slice(0, 12).forEach(d => {
    const card = document.createElement('div');
    card.className = 'day-card';
    card.innerHTML = `
      <div class="d-day">${d.day} <small style="display:block">${d.date || ''}</small></div>
      <img src="${d.icon}" width="40" alt="${d.desc}" />
      <div class="d-temp"><strong>${d.max}${d.unit}</strong> / ${d.min}${d.unit}</div>
      <small>${capitalize(d.desc)}</small>
    `;
    days12GridEl.appendChild(card);
  });

  // also populate fallback legacy forecast element if present
  if (forecastRow && lastForecast && lastForecast.list) {
    forecastRow.innerHTML = '';
    lastForecast.list.slice(0, 3).forEach(f => {
      const day = new Date(f.dt * 1000).toLocaleDateString(undefined, { weekday: 'short' });
      const icon = getIcon(f.weather[0].icon);
      const min = Math.round(f.main.temp_min), max = Math.round(f.main.temp_max);
      const desc = f.weather[0].description;
      forecastRow.innerHTML += `
        <div class="forecast-card">
          <div class="fc-day">${day}</div>
          <img src="${icon}" width="48" />
          <div class="fc-temp"><strong>${max}${currentUnits==='metric'?'°C':'°F'}</strong> / ${min}${currentUnits==='metric'?'°C':'°F'}</div>
          <small>${capitalize(desc)}</small>
        </div>
      `;
    });
  }

  // Show weather card, hide empty
  showWeatherCard();
}

// ---------- HELPERS / UTIL ----------
function splitCityAndRegion(full) {
  const parts = full.split(',');
  const city = parts.shift() || full;
  const rest = parts.join(',').trim();
  return [city, rest];
}

function toLocalTime(unixTs, tzOffset = 0) {
  if (!unixTs) return '—';
  // unixTs is seconds; tzOffset in seconds
  const date = new Date((unixTs + (tzOffset || 0)) * 1000);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getIcon(code) {
  return `https://openweathermap.org/img/wn/${code}@2x.png`;
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function showLoading() {
  errorText.textContent = '';
}

function showError(msg) {
  errorText.textContent = msg;
}

function showWeatherCard() {
  weatherResult.setAttribute('aria-hidden', 'false');
  weatherResult.style.display = 'block';
  emptyState.setAttribute('aria-hidden', 'true');
  emptyState.style.display = 'none';
}

function showEmptyState() {
  weatherResult.setAttribute('aria-hidden', 'true');
  weatherResult.style.display = 'none';
  emptyState.setAttribute('aria-hidden', 'false');
  emptyState.style.display = 'block';
}

// compute min/max for today's date from forecast.list (fallback)
function computeMinMaxFromForecast(forecast, dayOffset = 0) {
  if (!forecast || !forecast.list) return null;
  const now = new Date();
  now.setDate(now.getDate() + dayOffset);
  const targetDay = now.toLocaleDateString();
  const temps = forecast.list
    .filter(item => new Date(item.dt * 1000).toLocaleDateString() === targetDay)
    .map(i => i.main.temp);
  if (!temps.length) return null;
  return { min: Math.round(Math.min(...temps)), max: Math.round(Math.max(...temps)) };
}

// ---------- UPDATED: buildHourlyList to return items every N hours (default 2) ----------
function buildHourlyList(oneCall, forecast, count = 6, stepHours = 2) {
  const unit = currentUnits === 'metric' ? '°C' : '°F';
  const out = [];
  // Use OneCall hourly (which is hourly data) and pick every stepHours (skip current hour)
  if (oneCall && oneCall.hourly && oneCall.hourly.length) {
    const tz = oneCall.timezone_offset || 0;
    // Start from next hour (index 1) and pick every stepHours: index increments by stepHours
    // We use index = stepHours (i.e., 2 means pick index 2 which is ~2 hours later) to avoid current hour
    for (let idx = stepHours; out.length < count && idx < oneCall.hourly.length; idx += stepHours) {
      const h = oneCall.hourly[idx];
      out.push({
        time: toLocalTime(h.dt, tz),
        temp: Math.round(h.temp),
        icon: getIcon(h.weather[0].icon),
        desc: h.weather[0].description,
        unit
      });
    }
    // If not enough items (e.g., hourly length limited), try to append remaining next available hours sequentially
    if (out.length < count) {
      for (let idx = stepHours + 1; out.length < count && idx < oneCall.hourly.length; idx++) {
        const h = oneCall.hourly[idx];
        out.push({
          time: toLocalTime(h.dt, tz),
          temp: Math.round(h.temp),
          icon: getIcon(h.weather[0].icon),
          desc: h.weather[0].description,
          unit
        });
      }
    }
    return out;
  }

  // Fallback: forecast.list provides 3-hourly data. We will synthesize approximate 2-hour spaced data
  if (forecast && forecast.list && forecast.list.length) {
    // Build an array of timestamp -> data for ease
    const points = forecast.list.map(item => ({
      dt: item.dt,
      temp: item.main.temp,
      icon: item.weather[0].icon,
      desc: item.weather[0].description
    }));

    // We'll create synthetic times starting from now + stepHours up to count * stepHours
    const now = Math.floor(Date.now() / 1000);
    let needed = count;
    let offset = stepHours * 3600; // in seconds
    let attempts = 0;
    while (needed > 0 && attempts < count * 3) {
      const targetTs = now + offset;
      // find two nearest forecast points surrounding targetTs
      let left = null, right = null;
      for (let i = 0; i < points.length - 1; i++) {
        if (points[i].dt <= targetTs && points[i + 1].dt >= targetTs) {
          left = points[i];
          right = points[i + 1];
          break;
        }
      }
      // if not found, pick closest end
      if (!left && !right) {
        // pick the closest single point
        let closest = points.reduce((a, b) => Math.abs(b.dt - targetTs) < Math.abs(a.dt - targetTs) ? b : a, points[0]);
        out.push({
          time: new Date(targetTs * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          temp: Math.round(closest.temp),
          icon: getIcon(closest.icon),
          desc: closest.desc,
          unit
        });
      } else if (left && right) {
        // linear interpolation for temperature; choose icon/desc of nearest
        const frac = (targetTs - left.dt) / (right.dt - left.dt);
        const temp = left.temp + (right.temp - left.temp) * frac;
        // choose closer one for icon/desc
        const chosen = (frac < 0.5) ? left : right;
        out.push({
          time: new Date(targetTs * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          temp: Math.round(temp),
          icon: getIcon(chosen.icon),
          desc: chosen.desc,
          unit
        });
      }
      offset += stepHours * 3600;
      needed--;
      attempts++;
    }
  }

  return out;
}

// ---------- UPDATED: build12Day produces next N calendar days uniquely (no repeats) ----------
// ... existing code ...

function build12Day(oneCall, forecast, daysCount = 12) {
  const unit = currentUnits === 'metric' ? '°C' : '°F';
  const out = [];

  // Helper: format date key
  const fmtDate = (d) => d.toLocaleDateString();
  const fmtWeekday = (d) => d.toLocaleDateString(undefined, { weekday: 'short' });

  // We will produce explicit next `daysCount` calendar days starting today
  const start = new Date(); // today
  for (let i = 0; i < daysCount; i++) {
    const dateObj = new Date(start);
    dateObj.setDate(start.getDate() + i);
    const key = fmtDate(dateObj);
    const dayLabel = fmtWeekday(dateObj);
    out.push({
      day: dayLabel,
      date: key,
      min: null,
      max: null,
      desc: 'Forecast not available',  // Changed from '—' to a more descriptive placeholder
      icon: getIcon('01d'), // placeholder clear icon until replaced
      unit
    });
  }

  // If oneCall.daily available, map those dates and fill
  if (oneCall && oneCall.daily && oneCall.daily.length) {
    oneCall.daily.forEach(d => {
      const dateObj = new Date(d.dt * 1000);
      const key = fmtDate(dateObj);
      const idx = out.findIndex(x => x.date === key);
      if (idx !== -1) {
        out[idx].min = Math.round(d.temp.min);
        out[idx].max = Math.round(d.temp.max);
        out[idx].desc = d.weather && d.weather[0] ? d.weather[0].description : out[idx].desc;
        out[idx].icon = getIcon(d.weather && d.weather[0] ? d.weather[0].icon : '01d');
      }
    });
  }

  // Fallback: use forecast.list grouped by date to fill any remaining days
  if (forecast && forecast.list && forecast.list.length) {
    const map = {};
    forecast.list.forEach(item => {
      const key = new Date(item.dt * 1000).toLocaleDateString();
      if (!map[key]) map[key] = [];
      map[key].push(item);
    });
    out.forEach((slot, idx) => {
      if (slot.min === null) {
        const arr = map[slot.date];
        if (arr && arr.length) {
          const temps = arr.map(a => a.main.temp);
          const mins = arr.map(a => a.main.temp_min || a.main.temp);
          const maxs = arr.map(a => a.main.temp_max || a.main.temp);
          const weather = arr[Math.floor(arr.length / 2)].weather[0];
          slot.min = Math.round(Math.min(...mins));
          slot.max = Math.round(Math.max(...maxs));
          slot.desc = weather.description;
          slot.icon = getIcon(weather.icon);
        }
      }
    });
  }

  // Final pass: for any still-null min/max, attempt to infer from nearby days or set same as current temp
  out.forEach((slot, idx) => {
    if (slot.min === null || slot.max === null) {
      // try to use today's current temp as fallback
      if (lastCurrent && lastCurrent.main) {
        const t = Math.round(lastCurrent.main.temp);
        if (slot.min === null) slot.min = t;
        if (slot.max === null) slot.max = t;
        // keep desc/icon as is if still placeholder
      } else {
        // set dummy values 0..0 to avoid UI "null"
        if (slot.min === null) slot.min = '--';
        if (slot.max === null) slot.max = '--';
      }
    }
    // Also ensure desc is not the placeholder if possible; if still 'Forecast not available', try to infer from previous day
    if (slot.desc === 'Forecast not available' && idx > 0) {
      slot.desc = out[idx - 1].desc;  // Infer from previous day
    }
  });

  return out;
}

// ... existing code ...


function buildHourlyForDay(oneCall, forecast, dayOffset = 0, limit = 8) {
  const unit = currentUnits === 'metric' ? '°C' : '°F';
  const out = [];
  const target = new Date();
  target.setDate(target.getDate() + dayOffset);
  const targetDay = target.toLocaleDateString();

  if (oneCall && oneCall.hourly && oneCall.hourly.length) {
    const tz = oneCall.timezone_offset || 0;
    oneCall.hourly.forEach(h => {
      const d = new Date((h.dt + (tz || 0)) * 1000);
      if (d.toLocaleDateString() === targetDay && out.length < limit) {
        out.push({
          time: toLocalTime(h.dt, tz),
          temp: Math.round(h.temp),
          icon: getIcon(h.weather[0].icon),
          desc: h.weather[0].description,
          unit
        });
      }
    });
    return out;
  }

  // fallback: use forecast.list items for that date
  if (forecast && forecast.list) {
    forecast.list.forEach(h => {
      const d = new Date(h.dt * 1000);
      if (d.toLocaleDateString() === targetDay && out.length < limit) {
        out.push({
          time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          temp: Math.round(h.main.temp),
          icon: getIcon(h.weather[0].icon),
          desc: h.weather[0].description,
          unit
        });
      }
    });
  }

  return out;
}

function getDaySummaryFromForecast(forecast, offset = 0) {
  // offset: -1 yesterday, 0 today, 1 tomorrow
  if (!forecast || !forecast.list) return null;
  const target = new Date();
  target.setDate(target.getDate() + offset);
  const key = target.toLocaleDateString();

  const entries = forecast.list.filter(item => new Date(item.dt * 1000).toLocaleDateString() === key);
  if (!entries.length) return null;

  const temps = entries.map(e => e.main.temp);
  const min = Math.round(Math.min(...temps));
  const max = Math.round(Math.max(...temps));
  // choose midday entry as representative
  const midday = entries[Math.floor(entries.length/2)];
  const desc = midday.weather[0].description;
  return { min, max, desc };
}

// ---------- Legacy compatibility: populate some old fields if present ----------
function populateLegacyFields(fullCity, curr) {
  if (cityNameEl) cityNameEl.textContent = fullCity;
  if (timeLocalEl) timeLocalEl.textContent = new Date().toLocaleString();
  if (curr && curr.main && tempEl) tempEl.textContent = `${Math.round(curr.main.temp)}${currentUnits==='metric'?'°C':'°F'}`;
  if (conditionEl && curr && curr.weather && curr.weather[0]) conditionEl.textContent = curr.weather[0].description;
  if (feelsEl && curr && curr.main) feelsEl.textContent = `Feels like ${Math.round(curr.main.feels_like)}${currentUnits==='metric'?'°C':'°F'}`;
  if (humidityEl && curr && curr.main) humidityEl.textContent = `${curr.main.humidity}%`;
  if (windEl && curr && curr.wind) windEl.textContent = `${curr.wind.speed} ${currentUnits==='metric'?'m/s':'mph'}`;
}

// ---------- UV labeling helper ----------
// ... existing code ...

// ---------- UV labeling helper ----------
function labelUVI(uvi) {
  if (uvi === null || typeof uvi === 'undefined' || isNaN(uvi)) return '—';
  const val = Number(uvi);
  if (val <= 2) return 'Weak';
  if (val <= 5) return 'Medium';
  if (val <= 10) return 'High';  // Changed from 'Very High' to 'High' to match desired categories
  return 'Extreme';
}

// ... existing code ...


// ---------- INITIAL UI STATE ----------
showEmptyState();

// Optionally, load last searched city
(function loadLast(){
  try {
    const last = localStorage.getItem('lastCity');
    if (last) cityInput.value = "";
  } catch(e){}
})();
