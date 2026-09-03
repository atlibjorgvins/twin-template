<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import { getPluginSetting } from '$lib/plugins/settings';

  // Start count comes from the plugin's per-device "Default dice" setting
  // (Settings → Plugins → Games), falling back to 2.
  const startCount: 1 | 2 = getPluginSetting<string>('games', 'defaultDice', '2') === '1' ? 1 : 2;
  let diceCount = $state<1 | 2>(startCount);
  let dice = $state<number[]>(startCount === 1 ? [1] : [1, 6]);
  let rolling = $state(false);
  let history = $state<number[][]>([]);

  const pipPositions: Record<number, string[]> = {
    1: ['center'],
    2: ['top-left', 'bottom-right'],
    3: ['top-left', 'center', 'bottom-right'],
    4: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    5: ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'],
    6: ['top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-right']
  };

  function rollDie() {
    return Math.floor(Math.random() * 6) + 1;
  }

  function throwDice() {
    rolling = true;
    window.setTimeout(() => {
      const next = Array.from({ length: diceCount }, rollDie);
      dice = next;
      history = [next, ...history].slice(0, 12);
      rolling = false;
    }, 350);
  }

  function setDiceCount(count: 1 | 2) {
    diceCount = count;
    dice = dice.slice(0, count);
    if (dice.length < count) dice = [...dice, rollDie()];
  }

  function reset() {
    dice = diceCount === 1 ? [1] : [1, 6];
    history = [];
    rolling = false;
  }

  const total = $derived(dice.reduce((sum, die) => sum + die, 0));
</script>

<svelte:head><title>Dice Throw · Tools</title></svelte:head>

<section class="space-y-5">
  <header class="flex items-center gap-3">
    <a href="/tools" class="btn-ghost !px-2" aria-label="Back to tools"><Icon name="chevron-left" size={20} /></a>
    <div class="min-w-0 flex-1">
      <div class="hero-eyebrow">Games</div>
      <h1 class="font-display text-2xl font-bold sm:text-3xl">Dice Throw</h1>
    </div>
  </header>

  <div class="card space-y-4 p-4 sm:p-6">
    <div class="flex justify-center gap-2">
      <button class:is-selected={diceCount === 1} class="chip-radio" onclick={() => setDiceCount(1)}>1 die</button>
      <button class:is-selected={diceCount === 2} class="chip-radio" onclick={() => setDiceCount(2)}>2 dice</button>
    </div>

    <div class="flex min-h-40 items-center justify-center gap-4">
      {#each dice as die, index (index)}
        <div class="relative grid aspect-square w-32 rounded-[18px] border border-surface-border bg-surface-card shadow-xl sm:w-40" class:scale-95={rolling}>
          {#each pipPositions[die] as pip (pip)}
            <span class={`absolute h-5 w-5 rounded-full bg-ink-900 sm:h-6 sm:w-6 pip-${pip}`}></span>
          {/each}
          <span class="sr-only">Die {index + 1}: {die}</span>
        </div>
      {/each}
    </div>

    <div class="text-center">
      <div class="muted-label">Total</div>
      <div class="mt-1 font-display text-4xl font-bold tabular-nums text-ink-900">{rolling ? '...' : total}</div>
    </div>

    <div class="flex justify-center gap-2">
      <button class="btn-primary min-w-32" onclick={throwDice} disabled={rolling}>Throw</button>
      <button class="btn-ghost" onclick={reset} disabled={history.length === 0}>Reset</button>
    </div>
  </div>

  <div class="card p-4">
    <div class="card-title">Recent throws</div>
    {#if history.length}
      <div class="mt-3 flex flex-wrap gap-2">
        {#each history as throwResult, index (index)}
          <span class="tag">{index + 1}. {throwResult.join(' + ')} = {throwResult.reduce((sum, value) => sum + value, 0)}</span>
        {/each}
      </div>
    {:else}
      <div class="mt-2 text-sm text-ink-400">No throws yet.</div>
    {/if}
  </div>
</section>

<style>
  .pip-top-left { left: 18%; top: 18%; }
  .pip-top-right { right: 18%; top: 18%; }
  .pip-middle-left { left: 18%; top: 50%; transform: translateY(-50%); }
  .pip-middle-right { right: 18%; top: 50%; transform: translateY(-50%); }
  .pip-center { left: 50%; top: 50%; transform: translate(-50%, -50%); }
  .pip-bottom-left { bottom: 18%; left: 18%; }
  .pip-bottom-right { bottom: 18%; right: 18%; }
</style>
