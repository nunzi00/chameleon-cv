<script lang="ts">
  import { onMount } from 'svelte';

  import Icon from '../components/Icon.svelte';
  import Notice from '../components/Notice.svelte';
  import type { ApiClient } from '../lib/api/client';
  import type { LinkedinPlanResponse } from '../lib/api/types';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { plural } from '../lib/format';
  import type { Route } from '../lib/router';

  type PlanItem = LinkedinPlanResponse['items'][number];

  interface Props {
    api: ApiClient;
    onsession: () => void;
    navigate: (route: Route) => void;
  }
  let { api, onsession, navigate }: Props = $props();

  let drafts = $state<readonly string[]>([]);
  let draft = $state('');
  let plan = $state<LinkedinPlanResponse | undefined>(undefined);
  let error = $state<ExplainedError | undefined>(undefined);
  let busy = $state(false);
  let copied = $state<string | undefined>(undefined);

  /** Los tres bloques del plan, en el orden en que se trabajan: copiar, corregir y, al final, lo tuyo. */
  const BLOCKS = [
    { action: 'add' as const, title: 'Qué añadir', hint: 'Está en tus fuentes y no en LinkedIn. El cuerpo se copia tal cual.' },
    { action: 'fix' as const, title: 'Qué corregir', hint: 'Está en los dos y no dice lo mismo. Tus fuentes son la referencia: son las que compilas y de las que salen tus CV.' },
    { action: 'pending' as const, title: 'Qué falta por actualizar', hint: 'Esto le falta a TU perfil, no a LinkedIn. Subir un puesto sin contenido no mejora nada.' },
  ];

  const itemsOf = $derived((action: PlanItem['action']): readonly PlanItem[] => plan?.items.filter((item) => item.action === action) ?? []);

  function fail(caught: unknown): void {
    const explained = explainError(caught);
    error = explained;
    if (explained.kind === 'session') {
      onsession();
    }
  }

  async function loadDrafts(): Promise<void> {
    try {
      drafts = (await api.drafts()).drafts.map((entry) => entry.name);
      // Con un solo borrador no hay nada que elegir: queda puesto y solo hay que pulsar.
      draft = drafts.length === 1 ? (drafts[0] ?? '') : draft;
    } catch (caught) {
      fail(caught);
    }
  }

  async function generate(): Promise<void> {
    busy = true;
    error = undefined;
    try {
      plan = await api.linkedinPlan(draft === '' ? {} : { draft });
    } catch (caught) {
      plan = undefined;
      fail(caught);
    } finally {
      busy = false;
    }
  }

  async function copy(item: PlanItem): Promise<void> {
    const text = item.body ?? item.title;
    try {
      await navigator.clipboard.writeText(text);
      copied = item.title;
    } catch {
      // Sin permiso de portapapeles no se rompe la pantalla: el texto está a la vista para seleccionarlo.
      copied = undefined;
    }
  }

  onMount(() => {
    void loadDrafts();
  });
</script>

<section class="cv-page" aria-labelledby="cv-linkedin-title">
  <header class="cv-page-head">
    <h1 id="cv-linkedin-title">LinkedIn</h1>
    <p class="cv-muted">Qué cambiar en tu perfil de LinkedIn para que diga lo que dicen tus fuentes. No se envía nada a ningún sitio: es una comparación local.</p>
  </header>

  <div class="cv-card cv-card-tight">
    <h2>1. Exporta tu perfil de LinkedIn</h2>
    <p class="cv-muted">Hay dos formas, y la primera es mejor porque trae los datos ya estructurados:</p>
    <ol class="cv-steps">
      <li>
        <strong>La exportación de datos (recomendada).</strong> En LinkedIn: <em>Yo → Configuración y privacidad → Privacidad de los datos → Obtener una copia de tus datos</em>. Elige
        <strong>«Quiero algunos datos»</strong> y marca <em>Positions</em>, <em>Education</em>, <em>Skills</em>, <em>Languages</em> y <em>Profile</em>. Llega un <code>.zip</code> por correo en unos minutos.
        <span class="cv-muted">No pidas «todos los datos»: tarda hasta 24 horas y trae mensajes y anuncios que no son un CV.</span>
      </li>
      <li>
        <strong>El PDF del perfil.</strong> En tu perfil: <em>Más → Guardar como PDF</em>. Es inmediato, pero hay que adivinar la maquetación, así que reconoce menos.
      </li>
    </ol>
  </div>

  <div class="cv-card cv-card-tight">
    <h2>2. Impórtalo aquí</h2>
    <p class="cv-muted">La importación deja un <strong>borrador</strong> en <code>import/</code>. Nunca escribe en tus fuentes: eso lo decides tú después, entrada a entrada.</p>
    <ol class="cv-steps">
      <li>El <code>.zip</code> de la exportación va por <strong>Importar CV → Origen: exportación de LinkedIn</strong>.</li>
      <li>El PDF del perfil va por <strong>Importar CV → un fichero</strong>.</li>
      <li>En <strong>Borradores</strong> revisas lo que reconoció y adoptas en tus fuentes lo que te falte.</li>
    </ol>
    <div class="cv-actions">
      <button class="cv-button" type="button" onclick={() => navigate({ page: 'importar' })}>Ir a Importar CV</button>
      <button class="cv-button" type="button" onclick={() => navigate({ page: 'borradores' })}>Ir a Borradores</button>
    </div>
  </div>

  <div class="cv-card cv-card-tight">
    <h2>3. Genera el plan</h2>
    <div class="cv-linkedin-run">
      <label class="cv-field">
        <span>Comparar con</span>
        <select name="draft" bind:value={draft}>
          <option value="">Nada: solo qué tengo yo</option>
          {#each drafts as name (name)}<option value={name}>{name}</option>{/each}
        </select>
      </label>
      <button class="cv-button primary" type="button" disabled={busy} onclick={generate}>{busy ? 'Comparando…' : 'Generar mejoras para LinkedIn'}</button>
    </div>
    {#if draft === ''}
      <p class="cv-muted">Sin un borrador con el que comparar, el plan solo puede decir <strong>qué tienes tú</strong>: para saber qué corregir y qué sobra hace falta lo que LinkedIn exportó.</p>
    {/if}
  </div>

  {#if error !== undefined}<Notice kind="error" title={error.title} lines={error.lines}>{error.detail}</Notice>{/if}

  {#if plan !== undefined}
    {#if plan.items.length === 0}
      <Notice kind="ok">Tu LinkedIn ya dice lo mismo que tus fuentes: no hay nada que cambiar.</Notice>
    {:else}
      {#if copied !== undefined}<Notice kind="ok">Copiado al portapapeles.</Notice>{/if}
      {#each BLOCKS as block (block.action)}
        {@const items = itemsOf(block.action)}
        {#if items.length > 0}
          <div class="cv-card cv-card-tight">
            <div class="cv-card-head">
              <h2>{block.title}</h2>
              <span class="cv-muted">{plural(items.length, 'apunte', 'apuntes')}</span>
            </div>
            <p class="cv-muted">{block.hint}</p>
            <ul class="cv-plan-items">
              {#each items as item, index (`${item.action}-${index.toString()}`)}
                <li class="cv-plan-item">
                  <div class="cv-plan-item-head">
                    <span class="cv-badge">{item.kind}</span>
                    <strong>{item.title}</strong>
                    {#if item.body !== undefined}
                      <span class="cv-header-spacer"></span>
                      <button class="cv-button small" type="button" onclick={() => copy(item)}>Copiar</button>
                    {/if}
                  </div>
                  {#if item.body !== undefined}<pre class="cv-text">{item.body}</pre>{/if}
                  {#if item.reason !== undefined}<p class="cv-muted">{item.reason}</p>{/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      {/each}
    {/if}
  {:else if error === undefined}
    <div class="cv-empty">
      <div class="cv-empty-inner">
        <div class="cv-empty-icon"><Icon name="globe" size={26} /></div>
        <h1>Tu perfil, comparado con LinkedIn</h1>
        <p>Pulsa «Generar mejoras para LinkedIn» y verás en tres bloques qué añadir, qué corregir y qué le falta a tu perfil antes de subirlo.</p>
      </div>
    </div>
  {/if}
</section>

<style>
  .cv-page-head {
    display: grid;
    gap: 4px;
  }
  .cv-plan-item {
    display: grid;
    gap: 6px;
  }
  .cv-steps {
    margin: 6px 0 0;
    padding-left: 20px;
    display: grid;
    gap: 8px;
  }
  .cv-steps span {
    display: block;
  }
  .cv-linkedin-run {
    display: flex;
    gap: 12px;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .cv-plan-items {
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 12px;
  }
  .cv-plan-item-head {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
</style>
