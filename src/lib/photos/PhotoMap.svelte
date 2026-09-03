<script lang="ts">
  // Minimal Leaflet map of geotagged photos. Markers come from Immich's
  // reverse-geocoded /map/markers index (see immich.ts). Nearby photos
  // group into count bubbles (markercluster); clicking a bubble or a
  // single dot hands the assets at that spot back to the host, which
  // renders them in a PhotoGrid below the map.
  //
  // Leaflet touches `window`, so everything loads dynamically in onMount
  // (the page is ssr=false, but the import is still kept lazy to be safe).
  // We use divIcon dots instead of Leaflet's image markers to dodge the
  // classic missing-marker-icon asset problem and to match Helga.
  import { onMount, onDestroy } from 'svelte';
  import { assetThumbUrl, type MapMarker } from '$lib/immich';
  import 'leaflet/dist/leaflet.css';
  import 'leaflet.markercluster/dist/MarkerCluster.css';
  import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

  let {
    markers,
    onSelect
  }: {
    markers: MapMarker[];
    /** Called with the asset markers at a clicked dot or cluster. */
    onSelect: (markers: MapMarker[], label: string) => void;
  } = $props();

  let el: HTMLDivElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let L: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let map: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let layer: any = null;
  let ready = $state(false);

  // KLAK pink-ish accent for the dots; falls back gracefully.
  const DOT = '#2c8c99';

  function placeLabel(m: MapMarker): string {
    return [m.city, m.country].filter(Boolean).join(', ') || 'Unknown location';
  }

  onMount(async () => {
    const leaflet = await import('leaflet');
    await import('leaflet.markercluster');
    L = leaflet.default ?? leaflet;

    map = L.map(el, { scrollWheelZoom: false, attributionControl: true }).setView([64.13, -21.9], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    // Enable wheel-zoom only after a click, so the page still scrolls past the map.
    map.on('focus', () => map.scrollWheelZoom.enable());
    map.on('blur', () => map.scrollWheelZoom.disable());

    ready = true;
    rebuild();
  });

  onDestroy(() => {
    if (map) map.remove();
  });

  // Rebuild the marker layer whenever the marker set changes.
  $effect(() => {
    void markers;
    if (ready) rebuild();
  });

  function dotIcon() {
    return L.divIcon({
      className: '',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:${DOT};box-shadow:0 0 0 2px #fff,0 1px 3px rgba(0,0,0,.4);"></span>`
    });
  }

  function rebuild() {
    if (!map) return;
    if (layer) {
      map.removeLayer(layer);
      layer = null;
    }
    if (!markers.length) return;

    layer = L.markerClusterGroup({
      maxClusterRadius: 48,
      showCoverageOnHover: false,
      iconCreateFunction: (cluster: { getChildCount: () => number }) => {
        const n = cluster.getChildCount();
        const size = n < 10 ? 34 : n < 100 ? 42 : 50;
        return L.divIcon({
          className: '',
          iconSize: [size, size],
          html:
            `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;` +
            `border-radius:9999px;background:${DOT};color:#fff;font:600 12px/1 'Inter',sans-serif;` +
            `box-shadow:0 0 0 4px ${DOT}33,0 1px 4px rgba(0,0,0,.4);">${n.toLocaleString('is-IS')}</div>`
        });
      }
    });

    for (const m of markers) {
      const mk = L.marker([m.lat, m.lon], { icon: dotIcon() });
      // Stash the source marker so click handlers can recover it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mk as any).__data = m;
      mk.bindPopup(
        `<div style="text-align:center;font:500 11px/1.4 'Inter',sans-serif;">` +
          `<img src="${assetThumbUrl(m.id)}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:8px;display:block;margin-bottom:4px;"/>` +
          `${placeLabel(m)}</div>`,
        { closeButton: false, minWidth: 132 }
      );
      mk.on('click', () => onSelect([m], placeLabel(m)));
      layer.addLayer(mk);
    }

    layer.on('clusterclick', (e: { layer: { getAllChildMarkers: () => Array<{ __data: MapMarker }> } }) => {
      const kids = e.layer.getAllChildMarkers().map((c) => c.__data);
      const labels = [...new Set(kids.map(placeLabel))];
      onSelect(kids, labels.length === 1 ? labels[0] : `${labels.length} places`);
    });

    map.addLayer(layer);
    try {
      map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 14 });
    } catch {
      /* no bounds (empty) — keep default view */
    }
  }
</script>

<div
  bind:this={el}
  class="h-[420px] w-full overflow-hidden rounded-[12px] border border-surface-border sm:h-[520px]"
  style="background: var(--bg-tertiary);"
></div>
{#if !markers.length && ready}
  <p class="mt-2 text-xs text-ink-400">No geotagged photos found — only photos with GPS data appear here.</p>
{/if}
