<script lang="ts">
  import Icon from '$lib/Icon.svelte';

  type CoinSide = 'front' | 'back';

  const sides: Record<CoinSide, { label: string; image: string }> = {
    front: { label: 'Front', image: '/games/coin-front.png' },
    back: { label: 'Back', image: '/games/coin-back.png' }
  };

  let result = $state<CoinSide>('front');
  let flipping = $state(false);
  let flips = $state<CoinSide[]>([]);

  function flipCoin() {
    flipping = true;
    const next: CoinSide = Math.random() < 0.5 ? 'front' : 'back';
    window.setTimeout(() => {
      result = next;
      flips = [next, ...flips].slice(0, 12);
      flipping = false;
    }, 450);
  }

  function reset() {
    result = 'front';
    flips = [];
    flipping = false;
  }
</script>

<svelte:head><title>Coin Flip · Tools</title></svelte:head>

<section class="space-y-5">
  <header class="flex items-center gap-3">
    <a href="/tools" class="btn-ghost !px-2" aria-label="Back to tools"><Icon name="chevron-left" size={20} /></a>
    <div class="min-w-0 flex-1">
      <div class="hero-eyebrow">Games</div>
      <h1 class="font-display text-2xl font-bold sm:text-3xl">Coin Flip</h1>
    </div>
  </header>

  <div class="card overflow-hidden p-4 text-center sm:p-6">
    <button
      class="mx-auto block rounded-full transition duration-500 active:scale-[0.98]"
      class:scale-95={flipping}
      class:rotate-180={flipping}
      onclick={flipCoin}
      aria-label="Flip coin"
      disabled={flipping}
    >
      <img
        class="mx-auto aspect-square w-full max-w-[17rem] rounded-full object-cover shadow-2xl sm:max-w-[22rem]"
        src={sides[result].image}
        alt={sides[result].label}
      />
    </button>

    <div class="mt-4">
      <div class="muted-label">Result</div>
      <div class="mt-1 font-display text-4xl font-bold text-ink-900">{flipping ? '...' : sides[result].label}</div>
    </div>

    <div class="mt-5 flex justify-center gap-2">
      <button class="btn-primary min-w-32" onclick={flipCoin} disabled={flipping}>Flip</button>
      <button class="btn-ghost" onclick={reset} disabled={flips.length === 0}>Reset</button>
    </div>
  </div>

  <div class="card p-4">
    <div class="card-title">Recent flips</div>
    {#if flips.length}
      <div class="mt-3 flex flex-wrap gap-2">
        {#each flips as side, index (index)}
          <span class="tag">{index + 1}. {sides[side].label}</span>
        {/each}
      </div>
    {:else}
      <div class="mt-2 text-sm text-ink-400">No flips yet.</div>
    {/if}
  </div>
</section>
