<script lang="ts">
  // Helga pill — a single neutral surface + accent variants. Tones
  // collapse to either a neutral chip or an accent chip; state tones
  // (sales = danger, nutrition = success) read from semantic tokens.
  type Tone = 'sales' | 'nutrition' | 'garden' | 'chat' | 'health' | 'online' | 'neutral';
  let { tone = 'neutral', children }: { tone?: Tone; children: any } = $props();

  const styleFor: Record<Tone, string> = {
    neutral:
      'background: var(--bg-tertiary); color: var(--text-secondary); border-color: var(--border-subtle);',
    online:
      'background: var(--accent-alpha-10); color: var(--accent-electric); border-color: var(--accent-alpha-30);',
    garden:
      'background: var(--accent-alpha-10); color: var(--accent-electric); border-color: var(--accent-alpha-30);',
    sales:
      'background: var(--bg-tertiary); color: var(--state-danger); border-color: var(--border-subtle);',
    health:
      'background: var(--bg-tertiary); color: var(--state-danger); border-color: var(--border-subtle);',
    nutrition:
      'background: var(--bg-tertiary); color: var(--state-success); border-color: var(--border-subtle);',
    chat:
      'background: var(--bg-tertiary); color: var(--state-warning); border-color: var(--border-subtle);'
  };
</script>

<span class="tag" style={styleFor[tone]}>{@render children()}</span>
