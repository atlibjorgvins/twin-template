<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';

  type Player = {
    id: string;
    name: string;
    scores: number[];
  };

  type HistoryTarget = {
    player: Player;
    round: number;
  };

  type CalculatorTarget = {
    player: Player;
  };

  type GameMode = 'default' | 'flip7';
  type Flip7CardType = 'number' | 'modifier' | 'action';
  type Flip7Card = {
    id: string;
    label: string;
    type: Flip7CardType;
    image: string;
    value?: number;
    bonus?: number;
    multiplier?: number;
  };
  type Flip7Score = {
    score: number;
    numberTotal: number;
    bonusTotal: number;
    multiplier: number;
    uniqueNumbers: number;
    bust: boolean;
    flip7: boolean;
    secondChanceUsed: boolean;
  };

  const uid = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let players = $state<Player[]>([
    { id: uid(), name: 'Atli', scores: [] },
    { id: uid(), name: 'Friend', scores: [] }
  ]);
  let playerName = $state('');
  let roundInputs = $state<Record<string, string>>({});
  let historyTarget = $state<HistoryTarget | null>(null);
  let calculatorTarget = $state<CalculatorTarget | null>(null);
  let calculatorExpression = $state('');
  let gameMode = $state<GameMode>('default');
  let flip7Selections = $state<Record<string, string[]>>({});
  let flip7Draft = $state<string[]>([]);
  let ready = $state(false);
  const quickNames = ['Anna H', 'Marín H'];
  const calculatorKeys = [
    ['7', '8', '9', '+'],
    ['4', '5', '6', '-'],
    ['1', '2', '3', '×'],
    ['0', '00', 'back', 'clear']
  ];
  const flip7Cards: Flip7Card[] = [
    ...Array.from({ length: 13 }, (_, value) => ({
      id: `number-${value}`,
      label: String(value),
      type: 'number' as const,
      value,
      image: `/scorekeeper/flip7/number-${value}.png`
    })),
    { id: 'modifier-x2', label: 'x2', type: 'modifier', multiplier: 2, image: '/scorekeeper/flip7/modifier-x2.png' },
    { id: 'modifier-plus2', label: '+2', type: 'modifier', bonus: 2, image: '/scorekeeper/flip7/modifier-plus2.png' },
    { id: 'modifier-plus4', label: '+4', type: 'modifier', bonus: 4, image: '/scorekeeper/flip7/modifier-plus4.png' },
    { id: 'modifier-plus6', label: '+6', type: 'modifier', bonus: 6, image: '/scorekeeper/flip7/modifier-plus6.png' },
    { id: 'modifier-plus8', label: '+8', type: 'modifier', bonus: 8, image: '/scorekeeper/flip7/modifier-plus8.png' },
    { id: 'modifier-plus10', label: '+10', type: 'modifier', bonus: 10, image: '/scorekeeper/flip7/modifier-plus10.png' },
    { id: 'action-second-chance', label: 'Second Chance', type: 'action', image: '/scorekeeper/flip7/action-second-chance.png' },
    { id: 'action-freeze', label: 'Freeze', type: 'action', image: '/scorekeeper/flip7/action-freeze.png' },
    { id: 'action-flip3', label: 'Flip Three', type: 'action', image: '/scorekeeper/flip7/action-flip3.png' }
  ];
  const flip7NumberCards = flip7Cards.filter((card) => card.type === 'number');
  const flip7ModifierCards = flip7Cards.filter((card) => card.type === 'modifier');

  const totals = $derived(players.map((p) => p.scores.reduce((sum, score) => sum + score, 0)));
  const roundCount = $derived(Math.max(0, ...players.map((p) => p.scores.length)));
  const leaderId = $derived.by(() => {
    if (!players.length) return '';
    const high = Math.max(...totals);
    return players[totals.indexOf(high)]?.id ?? '';
  });

  onMount(() => {
    const saved = localStorage.getItem('twin.scorekeeper.v1');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { players?: Player[] };
        if (Array.isArray(parsed.players) && parsed.players.length) {
          players = parsed.players
            .filter((p) => typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.scores))
            .map((p) => ({ ...p, scores: p.scores.filter((score) => Number.isFinite(score)) }));
        }
        const savedMode = (parsed as { mode?: unknown }).mode;
        if (savedMode === 'default' || savedMode === 'flip7') gameMode = savedMode;
      } catch {
        // Ignore corrupt local drafts; a live game should recover to a blank table.
      }
    }
    ready = true;
  });

  $effect(() => {
    if (!ready) return;
    localStorage.setItem('twin.scorekeeper.v1', JSON.stringify({ players, mode: gameMode }));
  });

  function addPlayer() {
    const name = playerName.trim();
    if (!name) return;
    addNamedPlayer(name);
    playerName = '';
  }

  function addNamedPlayer(name: string) {
    players = [...players, { id: uid(), name, scores: Array(roundCount).fill(0) }];
  }

  function removePlayer(id: string) {
    players = players.filter((p) => p.id !== id);
    const next = { ...roundInputs };
    delete next[id];
    roundInputs = next;
    const nextFlip7 = { ...flip7Selections };
    delete nextFlip7[id];
    flip7Selections = nextFlip7;
    if (historyTarget?.player.id === id) historyTarget = null;
    if (calculatorTarget?.player.id === id) calculatorTarget = null;
  }

  function renamePlayer(id: string, name: string) {
    players = players.map((p) => (p.id === id ? { ...p, name } : p));
  }

  function movePlayer(id: string, direction: -1 | 1) {
    const index = players.findIndex((p) => p.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= players.length) return;
    const next = [...players];
    [next[index], next[target]] = [next[target], next[index]];
    players = next;
  }

  function setRoundInput(id: string, value: string) {
    roundInputs = { ...roundInputs, [id]: value };
  }

  function setGameMode(mode: GameMode) {
    gameMode = mode;
    closeCalculator();
  }

  function openCalculator(player: Player) {
    historyTarget = null;
    calculatorTarget = { player };
    calculatorExpression = roundInputs[player.id] ?? '';
    flip7Draft = [...(flip7Selections[player.id] ?? [])];
  }

  function closeCalculator() {
    calculatorTarget = null;
    calculatorExpression = '';
    flip7Draft = [];
  }

  function cardById(id: string) {
    return flip7Cards.find((card) => card.id === id);
  }

  function addFlip7Card(id: string) {
    flip7Draft = [...flip7Draft, id];
  }

  function removeFlip7DraftCard(index: number) {
    flip7Draft = flip7Draft.filter((_, i) => i !== index);
  }

  function countFlip7DraftCard(id: string) {
    return flip7Draft.filter((cardId) => cardId === id).length;
  }

  function scoreFlip7(cardIds: string[]): Flip7Score {
    const seen = new Set<number>();
    let numberTotal = 0;
    let bonusTotal = 0;
    let multiplier = 1;
    let secondChances = 0;
    let secondChanceUsed = false;
    let bust = false;

    for (const id of cardIds) {
      const card = cardById(id);
      if (!card) continue;
      if (card.id === 'action-second-chance') {
        secondChances += 1;
        continue;
      }
      if (card.type === 'modifier') {
        if (card.multiplier) multiplier *= card.multiplier;
        if (card.bonus) bonusTotal += card.bonus;
        continue;
      }
      if (card.type === 'number' && typeof card.value === 'number') {
        if (seen.has(card.value)) {
          if (secondChances > 0) {
            secondChances -= 1;
            secondChanceUsed = true;
            continue;
          }
          bust = true;
          continue;
        }
        seen.add(card.value);
        numberTotal += card.value;
      }
    }

    const flip7 = seen.size >= 7 && !bust;
    const score = bust ? 0 : numberTotal * multiplier + bonusTotal + (flip7 ? 15 : 0);
    return { score, numberTotal, bonusTotal, multiplier, uniqueNumbers: seen.size, bust, flip7, secondChanceUsed };
  }

  function applyFlip7Cards() {
    if (!calculatorTarget) return;
    const score = scoreFlip7(flip7Draft).score;
    flip7Selections = { ...flip7Selections, [calculatorTarget.player.id]: [...flip7Draft] };
    setRoundInput(calculatorTarget.player.id, String(score));
    closeCalculator();
  }

  function calculatorResult(expression: string) {
    const compact = expression.replace(/\s+/g, '').replaceAll('×', '*');
    if (!compact) return 0;

    let total = 0;
    let term = 0;
    let current = '';
    let additive: 1 | -1 = 1;
    let multiplier: '*' | null = null;

    const flushNumber = () => {
      if (!current) return;
      const value = Number(current);
      term = multiplier === '*' ? term * value : value;
      current = '';
      multiplier = null;
    };

    for (const char of compact) {
      if (/\d/.test(char)) {
        current += char;
        continue;
      }
      if (char === '*') {
        flushNumber();
        multiplier = '*';
        continue;
      }
      if (char === '+' || char === '-') {
        flushNumber();
        total += additive * term;
        additive = char === '-' ? -1 : 1;
        term = 0;
        multiplier = null;
      }
    }

    flushNumber();
    return total + additive * term;
  }

  function calculatorCurrentInput(expression: string) {
    const compact = expression.replace(/\s+/g, '').replaceAll('×', '*');
    const withoutTrailingOp = compact.replace(/[+\-*]+$/, '');
    const last = withoutTrailingOp.match(/[+\-*]?\d+$/)?.[0] ?? '';
    return last.replace(/^[+*]/, '') || '0';
  }

  function appendCalculatorKey(key: string) {
    const op = key === '×' ? '*' : key;
    const last = calculatorExpression.slice(-1);
    const isOperator = op === '+' || op === '-' || op === '*';
    const lastIsOperator = last === '+' || last === '-' || last === '×';

    if (op === '*' && calculatorExpression === '') return;
    if (isOperator && lastIsOperator) {
      calculatorExpression = calculatorExpression.slice(0, -1) + key;
      return;
    }
    calculatorExpression += key;
  }

  function pressCalculatorKey(key: string) {
    if (key === 'clear') {
      calculatorExpression = '';
      return;
    }
    if (key === 'back') {
      calculatorExpression = calculatorExpression.slice(0, -1);
      return;
    }
    if (key === 'done') {
      applyCalculator();
      return;
    }
    appendCalculatorKey(key);
  }

  function applyCalculator() {
    if (!calculatorTarget) return;
    setRoundInput(calculatorTarget.player.id, String(calculatorResult(calculatorExpression)));
    closeCalculator();
  }

  function addRound() {
    const hasAnyInput = players.some((p) => (roundInputs[p.id]?.trim() ?? '') !== '');
    const nextScores = players.map((p) => {
      const raw = roundInputs[p.id]?.trim() ?? '';
      const score = raw === '' ? 0 : Number(raw);
      return Number.isFinite(score) ? score : 0;
    });

    if (!hasAnyInput) return;

    players = players.map((p, index) => ({ ...p, scores: [...p.scores, nextScores[index]] }));
    roundInputs = {};
    flip7Selections = {};
  }

  function undoRound() {
    players = players.map((p) => ({ ...p, scores: p.scores.slice(0, -1) }));
    historyTarget = null;
  }

  function resetGame() {
    players = players.map((p) => ({ ...p, scores: [] }));
    roundInputs = {};
    flip7Selections = {};
    historyTarget = null;
    closeCalculator();
  }

  function totalBefore(player: Player, round: number) {
    return player.scores.slice(0, Math.max(0, round - 1)).reduce((sum, score) => sum + score, 0);
  }

  function totalAfter(player: Player, round: number) {
    return player.scores.slice(0, round).reduce((sum, score) => sum + score, 0);
  }

  function roundScore(player: Player, round: number) {
    return player.scores[round - 1] ?? 0;
  }

  function formatScore(score: number) {
    return score.toLocaleString('en-GB');
  }
</script>

<svelte:head><title>Scorekeeper · Tools</title></svelte:head>

<section class="space-y-5">
  <header class="flex items-center gap-3">
    <a href="/tools" class="btn-ghost !px-2" aria-label="Back to tools"><Icon name="chevron-left" size={20} /></a>
    <div class="min-w-0 flex-1">
      <div class="hero-eyebrow">Games</div>
      <h1 class="font-display text-2xl font-bold sm:text-3xl">Scorekeeper</h1>
    </div>
  </header>

  <div class="card space-y-3 p-3 sm:p-4">
    <div class="flex flex-col gap-2 sm:flex-row">
      <input
        class="input"
        type="text"
        placeholder="Add player"
        bind:value={playerName}
        onkeydown={(e) => {
          if (e.key === 'Enter') addPlayer();
        }}
      />
      <button class="btn-primary shrink-0" onclick={addPlayer} disabled={!playerName.trim()}>
        <Icon name="plus" size={16} /> Add
      </button>
    </div>

    <div class="flex flex-wrap gap-2">
      {#each quickNames as name (name)}
        <button class="chip-radio" onclick={() => addNamedPlayer(name)}>
          <Icon name="plus" size={13} /> {name}
        </button>
      {/each}
    </div>

    <div class="flex flex-wrap items-center gap-2 border-t border-surface-divider pt-3">
      <span class="muted-label">Mode</span>
      <button class:is-selected={gameMode === 'default'} class="chip-radio" onclick={() => setGameMode('default')}>
        Default
      </button>
      <button class:is-selected={gameMode === 'flip7'} class="chip-radio" onclick={() => setGameMode('flip7')}>
        Flip 7
      </button>
    </div>

    <div class="flex gap-2 overflow-x-auto pb-1 scroll-momentum">
      {#each players as player, index (player.id)}
        <div class="flex min-w-[9.75rem] items-center gap-1.5 rounded-[10px] border border-surface-border bg-surface-card px-2 py-2 sm:min-w-[11rem] sm:gap-2">
          <div class="flex shrink-0">
            <button
              class="nav-icon !h-8 !w-7"
              aria-label={`Move ${player.name || 'Player'} left`}
              onclick={() => movePlayer(player.id, -1)}
              disabled={index === 0}
            >
              <Icon name="chevron-left" size={13} />
            </button>
            <button
              class="nav-icon !h-8 !w-7"
              aria-label={`Move ${player.name || 'Player'} right`}
              onclick={() => movePlayer(player.id, 1)}
              disabled={index === players.length - 1}
            >
              <Icon name="chevron-right" size={13} />
            </button>
          </div>
          <input
            class="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink-900 outline-none"
            aria-label={`Name for ${player.name}`}
            value={player.name}
            oninput={(e) => renamePlayer(player.id, e.currentTarget.value)}
          />
          <button class="nav-icon !h-8 !w-8 shrink-0" aria-label={`Remove ${player.name}`} onclick={() => removePlayer(player.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      {/each}
    </div>
  </div>

  <div class="grid grid-cols-3 gap-2 sm:gap-3">
    <div class="card p-3 sm:p-4">
      <div class="muted-label">Round</div>
      <div class="mt-1 font-display text-xl font-bold tabular-nums text-ink-900 sm:text-2xl">{roundCount + 1}</div>
    </div>
    <div class="card min-w-0 p-3 sm:p-4">
      <div class="muted-label">Leader</div>
      <div class="mt-1 truncate font-display text-lg font-bold text-ink-900 sm:text-xl">
        {players.find((p) => p.id === leaderId)?.name || '—'}
      </div>
    </div>
    <div class="card p-3 sm:p-4">
      <div class="muted-label">High score</div>
      <div class="mt-1 font-display text-xl font-bold tabular-nums text-ink-900 sm:text-2xl">{formatScore(Math.max(0, ...totals))}</div>
    </div>
  </div>

  {#if players.length}
    <div class="card overflow-hidden">
      <div class="overflow-x-auto scroll-momentum">
        <div
          class="grid min-w-max"
          style={`grid-template-columns: 3.25rem repeat(${players.length}, minmax(8.5rem, 1fr));`}
        >
          <div class="sticky left-0 z-20 border-b border-r border-surface-divider bg-surface-card px-3 py-3 text-xs font-medium uppercase text-ink-400">
            Round
          </div>
          {#each players as player, index (player.id)}
            <div class="border-b border-surface-divider px-3 py-3">
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0 truncate font-display text-sm font-semibold text-ink-900">{player.name || 'Player'}</span>
                <span class:nav-icon-active={player.id === leaderId} class="rounded-[8px] px-2 py-1 text-xs font-semibold tabular-nums text-ink-500">
                  {formatScore(totals[index] ?? 0)}
                </span>
              </div>
            </div>
          {/each}

          {#each Array(roundCount) as _, roundIndex (roundIndex)}
            {@const round = roundIndex + 1}
            <div class="sticky left-0 z-10 border-r border-surface-divider bg-surface-card px-3 py-4 text-sm font-medium tabular-nums text-ink-500">
              {round}
            </div>
            {#each players as player (player.id)}
              {@const before = totalBefore(player, round)}
              {@const after = totalAfter(player, round)}
              {@const score = roundScore(player, round)}
              <div class="min-w-0 border-t border-surface-divider px-3 py-3">
                <button
                  class="w-full rounded-[10px] px-2 py-2 text-left transition hover:bg-surface-hover"
                  onclick={() => (historyTarget = { player, round })}
                  aria-label={`Show ${player.name}'s history through round ${round}`}
                >
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="text-xs text-ink-400">+{formatScore(score)}</span>
                    <span class="text-xs tabular-nums text-ink-400 line-through">{formatScore(before)}</span>
                  </div>
                  <div class="mt-1 font-display text-2xl font-bold tabular-nums text-ink-900">{formatScore(after)}</div>
                </button>
              </div>
            {/each}
          {/each}

          <div class="sticky left-0 z-10 border-r border-t border-surface-divider bg-surface-card px-3 py-4 text-sm font-medium text-ink-500">
            Now
          </div>
          {#each players as player (player.id)}
            <div class="border-t border-surface-divider px-3 py-3">
              <button
                class="input flex items-center justify-center text-center font-display text-lg font-semibold tabular-nums transition hover:bg-surface-hover"
                onclick={() => openCalculator(player)}
                aria-label={`Open calculator for ${player.name}`}
              >
                {roundInputs[player.id] || '0'}
              </button>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2">
      <button class="btn-ghost" onclick={undoRound} disabled={roundCount === 0}>Undo round</button>
      <button class="btn-ghost" onclick={resetGame} disabled={roundCount === 0}>Reset scores</button>
      <button class="btn-primary" onclick={addRound}>
        <Icon name="check" size={16} /> Score round
      </button>
    </div>
  {:else}
    <div class="rounded-[14px] border border-dashed border-surface-border bg-surface-card px-4 py-8 text-center text-sm text-ink-500">
      Add at least one player to start scoring.
    </div>
  {/if}
</section>

{#if historyTarget}
  <button
    class="fixed inset-0 z-40 bg-black/40"
    aria-label="Close history"
    onclick={() => (historyTarget = null)}
  ></button>
  <div class="fixed inset-x-3 bottom-3 z-50 max-h-[80vh] overflow-hidden rounded-[14px] border border-surface-border bg-surface-card shadow-2xl sm:left-1/2 sm:right-auto sm:w-[28rem] sm:-translate-x-1/2">
    <div class="flex items-center justify-between border-b border-surface-divider px-4 py-3">
      <div class="min-w-0">
        <div class="muted-label">History</div>
        <div class="truncate font-display text-lg font-semibold text-ink-900">{historyTarget.player.name || 'Player'}</div>
      </div>
      <button class="nav-icon" aria-label="Close history" onclick={() => (historyTarget = null)}>
        <Icon name="x" size={16} />
      </button>
    </div>
    <div class="max-h-[62vh] overflow-y-auto p-3 scroll-momentum">
      <ul class="divide-y divide-surface-divider">
        {#each historyTarget.player.scores.slice(0, historyTarget.round) as score, index (index)}
          {@const round = index + 1}
          <li class="grid grid-cols-[4rem_1fr_5rem] items-center gap-3 py-2 text-sm">
            <span class="text-ink-400">Round {round}</span>
            <span class="tabular-nums text-ink-500">
              <span class="line-through">{formatScore(totalBefore(historyTarget.player, round))}</span>
              <span class="mx-1 text-ink-300">-&gt;</span>
              <span class="font-semibold text-ink-900">{formatScore(totalAfter(historyTarget.player, round))}</span>
            </span>
            <span class="text-right font-medium tabular-nums text-ink-900">+{formatScore(score)}</span>
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

{#if calculatorTarget}
  <button
    class="fixed inset-0 z-40 bg-black/40"
    aria-label="Close calculator"
    onclick={closeCalculator}
  ></button>
  <div class={gameMode === 'flip7'
    ? 'fixed inset-x-2 bottom-2 z-50 max-h-[calc(100vh-1rem)] overflow-hidden rounded-[14px] border border-surface-border bg-surface-card shadow-2xl sm:inset-x-3 sm:bottom-3 sm:left-1/2 sm:right-auto sm:w-[42rem] sm:-translate-x-1/2'
    : 'fixed inset-x-2 bottom-2 z-50 overflow-hidden rounded-[14px] border border-surface-border bg-surface-card shadow-2xl sm:inset-x-3 sm:bottom-3 sm:left-1/2 sm:right-auto sm:w-[24rem] sm:-translate-x-1/2'}
  >
    <div class="flex items-center justify-between border-b border-surface-divider px-4 py-3">
      <div class="min-w-0">
        <div class="muted-label">Now</div>
        <div class="truncate font-display text-lg font-semibold text-ink-900">{calculatorTarget.player.name || 'Player'}</div>
      </div>
      <button class="nav-icon" aria-label="Close calculator" onclick={closeCalculator}>
        <Icon name="x" size={16} />
      </button>
    </div>

    {#if gameMode === 'flip7'}
      {@const flip7Score = scoreFlip7(flip7Draft)}
      <div class="max-h-[calc(100vh-5.5rem)] space-y-3 overflow-y-auto p-3 scroll-momentum sm:max-h-[72vh] sm:p-4">
        <div class="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[12px] border border-surface-border bg-surface-card px-3 py-2.5 sm:py-3">
          <div class="min-w-0">
            <div class="muted-label">Flip 7 score</div>
            <div class="mt-2 flex max-w-full gap-2 overflow-x-auto pb-1 scroll-momentum">
              {#if flip7Draft.length}
                {#each flip7Draft as id, index (index)}
                  {@const card = cardById(id)}
                  {#if card}
                    <button
                      class="relative h-16 w-11 shrink-0 overflow-hidden rounded-[7px] border border-surface-border bg-surface-card p-0.5 transition hover:bg-surface-hover sm:h-20 sm:w-14"
                      onclick={() => removeFlip7DraftCard(index)}
                      aria-label={`Remove ${card.label}`}
                    >
                      <img class="h-full w-full rounded-[5px] object-cover" src={card.image} alt="" />
                      <span class="absolute inset-x-1 bottom-1 rounded bg-ink-900/80 px-1 py-0.5 text-[9px] font-semibold text-white">{card.label}</span>
                    </button>
                  {/if}
                {/each}
              {:else}
                <span class="text-sm text-ink-400">No cards yet</span>
              {/if}
            </div>
          </div>
          <div class="text-right">
            <div class={flip7Score.bust ? 'font-display text-2xl font-bold text-[color:var(--state-danger)] sm:text-3xl' : 'font-display text-3xl font-bold tabular-nums text-ink-900 sm:text-4xl'}>
              {flip7Score.bust ? 'Bust' : formatScore(flip7Score.score)}
            </div>
            <div class="mt-1 text-xs tabular-nums text-ink-500">
              {flip7Score.uniqueNumbers}/7 numbers{#if flip7Score.flip7} · +15{/if}{#if flip7Score.secondChanceUsed} · saved{/if}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 text-xs tabular-nums text-ink-500 sm:grid-cols-4">
          <div class="rounded-[10px] bg-surface-hover px-2.5 py-2 sm:px-3">Numbers <span class="font-semibold text-ink-900">{formatScore(flip7Score.numberTotal)}</span></div>
          <div class="rounded-[10px] bg-surface-hover px-2.5 py-2 sm:px-3">Multiplier <span class="font-semibold text-ink-900">x{flip7Score.multiplier}</span></div>
          <div class="rounded-[10px] bg-surface-hover px-2.5 py-2 sm:px-3">Bonus <span class="font-semibold text-ink-900">+{formatScore(flip7Score.bonusTotal)}</span></div>
          <div class="rounded-[10px] bg-surface-hover px-2.5 py-2 sm:px-3">Round <span class="font-semibold text-ink-900">{formatScore(flip7Score.score)}</span></div>
        </div>

        <div class="space-y-2">
          <div class="muted-label">Numbers</div>
          <div class="grid grid-cols-5 gap-1.5 sm:grid-cols-7 sm:gap-2">
            {#each flip7NumberCards as card (card.id)}
              {@const count = countFlip7DraftCard(card.id)}
              <button class="relative overflow-hidden rounded-[8px] border border-surface-border bg-surface-card p-1 transition hover:bg-surface-hover" onclick={() => addFlip7Card(card.id)} aria-label={`Add ${card.label}`}>
                <img class="aspect-[3/4] w-full rounded-[6px] object-cover" src={card.image} alt="" />
                {#if count}
                  <span class="absolute right-1 top-1 rounded-full bg-ink-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">{count}</span>
                {/if}
              </button>
            {/each}
          </div>
        </div>

        <div class="space-y-2">
          <div class="muted-label">Modifiers</div>
          <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-6 sm:gap-2">
            {#each flip7ModifierCards as card (card.id)}
              {@const count = countFlip7DraftCard(card.id)}
              <button class="relative overflow-hidden rounded-[8px] border border-surface-border bg-surface-card p-1 transition hover:bg-surface-hover" onclick={() => addFlip7Card(card.id)} aria-label={`Add ${card.label}`}>
                <img class="aspect-[3/4] w-full rounded-[6px] object-cover" src={card.image} alt="" />
                {#if count}
                  <span class="absolute right-1 top-1 rounded-full bg-ink-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">{count}</span>
                {/if}
              </button>
            {/each}
          </div>
        </div>

        <div class="flex gap-2">
          <button class="btn-ghost flex-1" onclick={() => (flip7Draft = [])}>Clear</button>
          <button class="btn-primary flex-1" onclick={applyFlip7Cards} aria-label="Use Flip 7 score">
            <Icon name="check" size={18} /> Use {formatScore(flip7Score.score)}
          </button>
        </div>
      </div>
    {:else}
    <div class="space-y-3 p-3 sm:p-4">
      <div class="rounded-[12px] border border-surface-border bg-surface-card px-3 py-3 text-right">
        <div class="flex items-center justify-between gap-3">
          <span class="muted-label">Total</span>
          <span class="font-display text-lg font-semibold tabular-nums text-ink-700">
            {formatScore(calculatorResult(calculatorExpression))}
          </span>
        </div>
        <div class="mt-2 font-display text-4xl font-bold tabular-nums text-ink-900">
          {calculatorCurrentInput(calculatorExpression)}
        </div>
        <div class="mt-2 min-h-5 truncate border-t border-surface-divider pt-2 text-sm tabular-nums text-ink-500">
          {calculatorExpression || 'No inputs yet'}
        </div>
      </div>

      <div class="rounded-[10px] bg-surface-hover px-3 py-2 text-right text-xs tabular-nums text-ink-500">
        Round score will be
        <span class="ml-1 font-semibold text-ink-900">
          {formatScore(calculatorResult(calculatorExpression))}
        </span>
      </div>

      <div class="grid grid-cols-4 gap-2">
        {#each calculatorKeys as row}
          {#each row as key (key)}
            <button
              class="btn-ghost !min-h-14 !px-0 border border-surface-border bg-surface-card text-base tabular-nums"
              onclick={() => pressCalculatorKey(key)}
              aria-label={key === 'back' ? 'Backspace' : key === 'clear' ? 'Clear' : key}
            >
              {#if key === 'back'}
                <Icon name="chevron-left" size={18} />
              {:else if key === 'clear'}
                C
              {:else}
                {key}
              {/if}
            </button>
          {/each}
        {/each}
      </div>

      <button class="btn-primary w-full" onclick={applyCalculator} aria-label="Use calculated score">
        <Icon name="check" size={18} /> Use {formatScore(calculatorResult(calculatorExpression))}
      </button>
    </div>
    {/if}
  </div>
{/if}
