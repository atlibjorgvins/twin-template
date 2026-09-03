<script lang="ts">
  // Face markers drawn over a photo.
  //
  // The boxes are percentages of the image, so this only lines up if its
  // parent is exactly the rendered image rect — not the container the image
  // is centred in. With `object-contain` those differ, sometimes by a lot,
  // so every caller has to wrap the <img> in a shrink-wrapping relative
  // element rather than dropping this into a flex centering box. Getting that
  // wrong puts every box in the wrong place with no error to notice.
  import type { FaceBox } from '$lib/photos/faceBoxes';

  let {
    boxes = [],
    /** Cluster ids to draw as the highlighted face — "this is the one twin
     *  means". Everything else is drawn plainly. */
    highlight = [],
    /** Show Immich's name under each box. */
    labels = true
  }: {
    boxes?: FaceBox[];
    highlight?: string[];
    labels?: boolean;
  } = $props();

  const marked = $derived(new Set(highlight));
</script>

{#if boxes.length > 0}
  <div class="fb" aria-hidden="true">
    {#each boxes as b, i (b.id)}
      {@const on = marked.has(b.clusterId)}
      <span
        class="fb-box"
        class:on
        style="left:{b.x1 * 100}%; top:{b.y1 * 100}%; width:{(b.x2 - b.x1) * 100}%; height:{(b.y2 - b.y1) * 100}%;"
      >
        {#if labels && b.name}
          <!-- Alternating side stops two adjacent faces' names sitting on top
               of each other, which they did on a four-person table shot. -->
          <span class="fb-name" class:on class:above={i % 2 === 1}>{b.name}</span>
        {/if}
      </span>
    {/each}
  </div>
{/if}

<style>
  /* pointer-events: none throughout — the overlay must never eat the clicks
     the lightbox uses for next/previous and close. */
  .fb {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .fb-box {
    position: absolute;
    border: 2px solid rgba(255, 255, 255, 0.85);
    border-radius: 6px;
    /* A dark outer shadow rather than a solid backdrop: a white box alone
       disappears on a bright photo, and a filled one hides the face. */
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(0, 0, 0, 0.35);
  }
  .fb-box.on {
    border-color: var(--brand, #2f7d7d);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), 0 0 0 4px rgba(47, 125, 125, 0.35);
  }
  .fb-name {
    position: absolute;
    left: 50%;
    top: 100%;
    transform: translate(-50%, 4px);
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: 999px;
    padding: 0.05rem 0.4rem;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 10px;
    font-weight: 600;
    line-height: 1.5;
  }
  .fb-name.above {
    top: auto;
    bottom: 100%;
    transform: translate(-50%, -4px);
  }
  .fb-name.on {
    background: var(--brand, #2f7d7d);
  }
</style>
