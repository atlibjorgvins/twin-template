// Weather data, shared by the Today chip (WeatherWidget) and the always-on
// tablet display. Extracted from the widget rather than copied — two forecasts
// that drift apart is exactly the bug nobody notices until the numbers on the
// wall disagree with the numbers in your hand.
//
// Open-Meteo: free, keyless, CORS-open, so this runs straight from the
// browser with no proxy and no secret to leak.

export type WeatherDaily = { date: string; code: number; min: number; max: number };

export type Weather = {
  temp: number;
  feels: number;
  wind: number;
  precip: number;
  code: number;
  days: WeatherDaily[];
};

export type WeatherGlyph = 'sun' | 'partly' | 'cloud' | 'fog' | 'rain' | 'snow' | 'thunder';

export const REYKJAVIK = { lat: 64.1466, lon: -21.9426 };

/** WMO weather code → glyph key. Coarse on purpose: this is a glanceable
 *  hint, not a meteogram. */
export function glyphOf(code: number): WeatherGlyph {
  if (code === 0 || code === 1) return 'sun';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloud';
}

export function labelOf(code: number): string {
  switch (glyphOf(code)) {
    case 'sun': return 'Clear';
    case 'partly': return 'Partly cloudy';
    case 'cloud': return 'Cloudy';
    case 'fog': return 'Fog';
    case 'rain': return 'Rain';
    case 'snow': return 'Snow';
    case 'thunder': return 'Thunderstorm';
  }
}

export function dayName(iso: string, i: number): string {
  if (i === 0) return 'Today';
  try {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(new Date(iso));
  } catch {
    return iso.slice(5);
  }
}

/**
 * Browser position, falling back to Reykjavík.
 *
 * The 4s timer is a deliberate second belt: geolocation's own `timeout` does
 * not fire when the user simply never answers the permission prompt, which on
 * a wall tablet nobody is standing in front of is the normal case.
 */
export function getPosition(): Promise<{ lat: number; lon: number; own: boolean }> {
  return new Promise((resolve) => {
    const fallback = () => resolve({ ...REYKJAVIK, own: false });
    if (typeof navigator === 'undefined' || !navigator.geolocation) return fallback();
    const timer = setTimeout(fallback, 4000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, own: true });
      },
      () => {
        clearTimeout(timer);
        fallback();
      },
      { maximumAge: 30 * 60_000, timeout: 3500 }
    );
  });
}

export async function loadWeather(): Promise<{ weather: Weather; own: boolean }> {
  const pos = await getPosition();
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat.toFixed(4)}&longitude=${pos.lon.toFixed(4)}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=6&wind_speed_unit=ms`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const j = await res.json();
  const days: WeatherDaily[] = (j.daily?.time ?? []).map((date: string, i: number) => ({
    date,
    code: j.daily.weather_code?.[i] ?? 3,
    min: Math.round(j.daily.temperature_2m_min?.[i] ?? 0),
    max: Math.round(j.daily.temperature_2m_max?.[i] ?? 0)
  }));
  return {
    own: pos.own,
    weather: {
      temp: Math.round(j.current?.temperature_2m ?? 0),
      feels: Math.round(j.current?.apparent_temperature ?? 0),
      wind: Math.round(j.current?.wind_speed_10m ?? 0),
      precip: j.current?.precipitation ?? 0,
      code: j.current?.weather_code ?? 3,
      days
    }
  };
}
