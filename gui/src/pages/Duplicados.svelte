<script lang="ts">
  /**
   * «Duplicados» (T-9.20): lo que está repetido en TUS fuentes y cómo resolverlo. Aparece sobre todo tras
   * adoptar de varios borradores el mismo empleo, que es justo lo que los crea.
   *
   * Resolver **escribe y borra fuentes**, así que va en dos pasos como la importación de un perfil: primero el
   * plan —qué dato se toma de dónde, qué se conserva y qué fichero se borra— y solo después el botón que lo
   * hace. Nada viene elegido: quién se queda lo decides tú, porque cuando dos entradas se contradicen no hay
   * forma honesta de saber cuál lleva razón.
   */
  import { onMount } from 'svelte';

  import Icon from '../components/Icon.svelte';
  import Notice from '../components/Notice.svelte';
  import type { ApiClient } from '../lib/api/client';
  import type { DuplicatesResolveResponse, DuplicatesResponse } from '../lib/api/types';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { plural } from '../lib/format';

  interface Props {
    api: ApiClient;
    onsession: () => void;
    /** Abre un fichero de fuentes en «Fuentes». */
    onopen: (file: string) => void;
  }
  let { api, onsession, onopen }: Props = $props();

  type Group = DuplicatesResponse['groups'][number];

  const SECTION_LABEL: Readonly<Record<string, string>> = { experience: 'Experiencia', education: 'Formación', projects: 'Proyectos' };
  const FIELD_LABEL: Readonly<Record<string, string>> = {
    company: 'empresa',
    role: 'puesto',
    institution: 'centro',
    degree: 'titulación',
    field: 'especialidad',
    location: 'ubicación',
    name: 'nombre',
    url: 'enlace',
    summary: 'resumen',
    dates: 'periodo',
  };

  let data = $state<DuplicatesResponse | undefined>(undefined);
  let loading = $state(true);
  let error = $state<ExplainedError | undefined>(undefined);
  let message = $state<string | undefined>(undefined);
  let busy = $state(false);

  /** Por grupo: qué entrada se queda y cuáles se absorben; nada viene elegido. */
  let keep = $state<Readonly<Record<number, string>>>({});
  let excluded = $state<ReadonlySet<string>>(new Set());
  /** El plan del grupo abierto, tal como lo devuelve el servidor con `dryRun`. */
  let plan = $state<{ readonly group: number; readonly outcome: DuplicatesResolveResponse } | undefined>(undefined);

  function fail(caught: unknown): void {
    const explained = explainError(caught);
    error = explained;
    if (explained.kind === 'session') {
      onsession();
    }
  }

  async function load(): Promise<void> {
    loading = true;
    try {
      data = await api.duplicates();
      error = undefined;
    } catch (caught) {
      fail(caught);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  /** Los ids que se absorberían en un grupo: todos los que no se quedan y no se hayan excluido a mano. */
  function absorbing(group: Group, index: number): readonly string[] {
    const chosen = keep[index];
    return chosen === undefined ? [] : group.members.map((member) => member.entry.id).filter((id) => id !== chosen && !excluded.has(id));
  }

  function choose(index: number, id: string): void {
    keep = { ...keep, [index]: id };
    plan = undefined;
  }

  function toggleExcluded(id: string): void {
    const next = new Set(excluded);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    excluded = next;
    plan = undefined;
  }

  async function preview(group: Group, index: number): Promise<void> {
    const chosen = keep[index];
    const absorb = absorbing(group, index);
    if (chosen === undefined || absorb.length === 0) {
      return;
    }
    busy = true;
    error = undefined;
    message = undefined;
    try {
      plan = { group: index, outcome: await api.resolveDuplicate({ keep: chosen, absorb: [...absorb], dryRun: true }) };
    } catch (caught) {
      fail(caught);
    } finally {
      busy = false;
    }
  }

  async function resolve(group: Group, index: number): Promise<void> {
    const chosen = keep[index];
    const absorb = absorbing(group, index);
    if (chosen === undefined || absorb.length === 0) {
      return;
    }
    busy = true;
    error = undefined;
    try {
      const outcome = await api.resolveDuplicate({ keep: chosen, absorb: [...absorb] });
      plan = undefined;
      keep = {};
      message = `Se queda «${outcome.keep.title}» en ${outcome.keep.path}; borrado(s) ${outcome.absorbed.map((entry) => entry.path).join(', ')}. Deshazlo desde «Fuentes → Historial de esta fuente», o con «cv history restore ${outcome.historyId ?? 'latest'} <ruta>». Después, recompila el artefacto.`;
      await load();
    } catch (caught) {
      fail(caught);
    } finally {
      busy = false;
    }
  }

  function period(start: string | undefined, end: string | undefined): string {
    return start === undefined ? 'sin fechas' : `${start} → ${end ?? 'en curso'}`;
  }

  function label(field: string): string {
    return FIELD_LABEL[field] ?? field;
  }
</script>

<section class="cv-stack">
  <div class="cv-card-head">
    <h1>Duplicados</h1>
    {#if data !== undefined}<span class="cv-muted"><code>{data.root}</code></span>{/if}
  </div>

  {#if error !== undefined}
    <Notice kind="error" title={error.title} lines={error.lines}>{error.detail}</Notice>
  {/if}
  {#if message !== undefined}<Notice kind="ok">{message}</Notice>{/if}

  {#if loading}
    <p class="cv-loading" aria-live="polite">Buscando lo que se repite en tus fuentes…</p>
  {:else if data === undefined}
    <p class="cv-muted">No se han podido leer las fuentes.</p>
  {:else if data.groups.length === 0}
    <div class="cv-empty">
      <div class="cv-empty-inner">
        <div class="cv-empty-icon"><Icon name="copy" size={26} /></div>
        <h1>Nada se repite</h1>
        <p>Se han comparado {data.compared} entradas de tus fuentes y ninguna se parece a otra. Un mismo empleo partido en periodos —una entrada por etapa— no cuenta como duplicado: sus fechas no se solapan.</p>
      </div>
    </div>
  {:else}
    <p class="cv-muted">
      {plural(data.groups.length, 'grupo', 'grupos')} sobre {data.compared} entradas. Elige <strong>cuál se queda</strong>: absorberá de las otras solo los datos que le falten —nunca se pisa un valor que ya
      tenga— y las demás se borrarán. Todo queda en el histórico, así que se puede deshacer.
    </p>

    {#each data.groups as group, index (index)}
      {@const chosen = keep[index]}
      {@const absorb = absorbing(group, index)}
      <div class="cv-card">
        <div class="cv-card-head">
          <h2>{SECTION_LABEL[group.section] ?? group.section} <span class="cv-muted">· {group.members.length} entradas</span></h2>
        </div>
        <ul class="cv-dup-list">
          {#each group.members as member, position (position)}
            {@const id = member.entry.id}
            <li>
              <label>
                <input type="radio" name={`grupo-${index}`} value={id} checked={chosen === id} onchange={() => choose(index, id)} />
                <span class="cv-dup-title">{member.entry.title}</span>
                <span class="cv-muted">{period(member.entry.start, member.entry.end)}</span>
                <button class="cv-link-button" type="button" onclick={() => onopen(data?.files[id] ?? '')}>{data.files[id]}</button>
              </label>
              {#if chosen !== undefined && chosen !== id}
                <label class="cv-dup-absorb">
                  <input type="checkbox" checked={!excluded.has(id)} onchange={() => toggleExcluded(id)} />
                  <span class="cv-muted">absorber y borrar</span>
                </label>
              {/if}
            </li>
          {/each}
        </ul>

        {#if plan !== undefined && plan.group === index}
          <div class="cv-dup-plan">
            <h3>Lo que pasaría</h3>
            {#if plan.outcome.taken.length === 0 && plan.outcome.added.length === 0}
              <p class="cv-muted">La entrada que se queda no gana ningún dato: las otras no traen nada que le falte.</p>
            {:else}
              <ul>
                {#each plan.outcome.taken as field, position (position)}
                  <li>Toma <strong>{label(field.field)}</strong> de «{field.from}»: <code>{field.value}</code></li>
                {/each}
                {#each plan.outcome.added as line, position (position)}
                  <li>Añade <code>{line}</code></li>
                {/each}
              </ul>
            {/if}
            {#if plan.outcome.conflicts.length > 0}
              <p class="cv-muted">Lo que las dos traen distinto se queda como está en la elegida; el otro valor se descarta:</p>
              <ul>
                {#each plan.outcome.conflicts as conflict, position (position)}
                  <li>Conserva <strong>{label(conflict.field)}</strong> = <code>{conflict.kept}</code>; descarta <code>{conflict.discarded}</code></li>
                {/each}
              </ul>
            {/if}
            <p class="cv-muted">Se borrará(n) <code>{plan.outcome.absorbed.map((entry) => entry.path).join(', ')}</code>.</p>
          </div>
        {/if}

        <div class="cv-actions">
          {#if chosen === undefined}
            <span class="cv-muted">Marca cuál se queda.</span>
          {:else if absorb.length === 0}
            <span class="cv-muted">No queda ninguna entrada que absorber.</span>
          {:else if plan !== undefined && plan.group === index}
            <button class="cv-button danger" type="button" disabled={busy} onclick={() => void resolve(group, index)}>Resolver: quedarme con esta y borrar {plural(absorb.length, 'la otra', 'las otras')}</button>
            <button class="cv-button" type="button" disabled={busy} onclick={() => (plan = undefined)}>Cancelar</button>
          {:else}
            <button class="cv-button primary" type="button" disabled={busy} onclick={() => void preview(group, index)}>Ver qué pasaría</button>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</section>

<style>
  .cv-dup-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 2px;
  }
  .cv-dup-list > li {
    display: grid;
    gap: 2px;
  }
  .cv-dup-list label {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 5px 8px;
    border-radius: var(--cv-radius-sm);
    cursor: pointer;
  }
  .cv-dup-list label:hover {
    background: var(--cv-surface-2);
  }
  .cv-dup-title {
    flex: 1;
    min-width: 0;
  }
  .cv-dup-absorb {
    margin-left: 26px;
  }
  .cv-dup-plan {
    margin: 12px 0;
    padding: 10px 14px;
    border: 1px solid var(--cv-border);
    border-radius: var(--cv-radius-md);
    background: var(--cv-surface-2);
  }
  .cv-dup-plan h3 {
    margin: 0 0 6px;
    font-size: 13.5px;
    font-weight: 600;
  }
  .cv-dup-plan ul {
    margin: 0 0 8px;
    padding-left: 1.2rem;
    font-size: var(--cv-size-sm);
  }
</style>
