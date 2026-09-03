<script lang="ts">
  // Small static-feel map for one place, on the same free stack the photo
  // map already uses: Leaflet + OpenStreetMap tiles, no key, no bill.
  //
  // Interaction is deliberately off. This sits on a wall tablet as a "where
  // is that" glance; a map you can accidentally pan and never re-centre is
  // worse than a picture of a map.
  import { onMount, onDestroy } from 'svelte';
  import 'leaflet/dist/leaflet.css';
  import type { LatLon } from '$lib/geo';

  let {
    at,
    label = '',
    zoom = 14,
    height = '260px'
  }: { at: LatLon; label?: string; zoom?: number; height?: string } = $props();

  let el: HTMLDivElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let map: any = null;

  onMount(async () => {
    // Leaflet touches `window`, so it is imported lazily even though the
    // route is ssr=false — same reasoning as PhotoMap.
    const leaflet = await import('leaflet');
    const L = leaflet.default ?? leaflet;

    map = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      keyboard: false
    }).setView([at.lat, at.lon], zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    // divIcon rather than Leaflet's image marker: dodges the classic
    // missing-marker-asset problem, same as PhotoMap.
    L.marker([at.lat, at.lon], {
      icon: L.divIcon({
        className: '',
        html: '<span class="evmap-pin"></span>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      }),
      keyboard: false,
      title: label
    }).addTo(map);
  });

  onDestroy(() => map?.remove());
</script>

<div class="evmap" style="height:{height}" bind:this={el} aria-label={label ? `Map of ${label}` : 'Map'}></div>

<style>
  .evmap {
    width: 100%;
    border-radius: 14px;
    overflow: hidden;
    background: var(--bg-secondary, #f2f2f2);
  }
  /* Global: Leaflet injects the marker HTML outside this component's scope. */
  :global(.evmap-pin) {
    display: block;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    background: #e2483d;
    box-shadow: 0 0 0 4px rgba(226, 72, 61, 0.28), 0 1px 4px rgba(0, 0, 0, 0.4);
  }
</style>
