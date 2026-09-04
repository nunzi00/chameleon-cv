<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Notice from '../components/Notice.svelte';
  import type { ApiClient } from '../lib/api/client';
  import type { VidaLaboralResponse } from '../lib/api/types';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { formatBytes, plural } from '../lib/format';
  import type { Route } from '../lib/router';

  type Item = VidaLaboralResponse['items'][number];

  interface Props {
    api: ApiClient;
    onsession: () => void;
    navigate: (route: Route) => void;
  }
  let { api, onsession, navigate }: Props = $props();

  let report = $state<VidaLaboralResponse | undefined>(undefined);
  let error = $state<ExplainedError | undefined>(undefined);
  let busy = $state(false);
  let fileName = $state('');

  /** Los bloques, del que más urge al que menos. */
  const BLOCKS = [
    { kind: 'still-open' as const, title: 'Empleos que das por abiertos', hint: 'Tus fuentes no les ponen fin y el informe sí registra la baja. Es lo que más se nota en un CV.' },
    { kind: 'start' as const, title: 'Fechas de inicio que no cuadran', hint: 'El informe es lo que consta en la Seguridad Social; tu CV, lo que recordabas al escribirlo.' },
    { kind: 'end' as const, title: 'Fechas de fin que no cuadran', hint: '' },
    { kind: 'missing-in-profile' as const, title: 'En el informe y no en tus fuentes', hint: 'Altas de más de un mes que tu perfil no recoge. Decide tú: el informe registra empleos, no carreras.' },
    { kind: 'missing-in-report' as const, title: 'En tus fuentes y no en el informe', hint: 'Puede estar bien: el informe no cubre el extranjero, las becas sin alta ni los funcionarios.' },
  ];

  const itemsOf = $derived((kind: Item['kind']): readonly Item[] => report?.items.filter((item) => item.kind === kind) ?? []);

  function fail(caught: unknown): void {
    const explained = explainError(caught);
    error = explained;
    if (explained.kind === 'session') {
      onsession();
    }
  }

  async function compare(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file === undefined) {
      return;
    }
    busy = true;
    error = undefined;
    report = undefined;
    fileName = `${file.name} (${formatBytes(file.size)})`;
    try {
      report = await api.vidaLaboral(file);
    } catch (caught) {
      fail(caught);
    } finally {
      busy = false;
      // El fichero no se guarda en ningún sitio: se sube, se compara y se olvida.
      input.value = '';
    }
  }
</script>

<section class="cv-page" aria-labelledby="cv-vida-title">
  <header class="cv-page-head">
    <h1 id="cv-vida-title">Vida laboral</h1>
    <p class="cv-muted">
      Un CV se escribe de memoria y se copia del CV anterior, así que las fechas se degradan solas. El informe de la Seguridad Social es lo más cercano a la verdad que
      existe sobre eso: no es lo que recuerdas, es lo que consta.
    </p>
  </header>

  <div class="cv-card cv-card-tight">
    <h2>1. Descarga tu informe</h2>
    <ol class="cv-steps">
      <li>En la <strong>Sede Electrónica de la Seguridad Social</strong>: <em>Ciudadanos → Informes y certificados → Informe de tu vida laboral</em>.</li>
      <li>Con Cl@ve, certificado digital o por SMS. Llega un <strong>PDF</strong> al momento.</li>
    </ol>
  </div>

  <div class="cv-card cv-card-tight">
    <h2>2. Compáralo con tus fuentes</h2>
    <p class="cv-muted">
      El PDF <strong>no se guarda</strong>: se sube, se compara y se olvida. Del informe solo se leen <strong>empresas y fechas</strong> — el DNI, el número de la
      Seguridad Social y el domicilio que trae dentro no se leen, no se escriben y no salen de tu máquina.
    </p>
    <div class="cv-actions">
      <label class="cv-button primary">
        {busy ? 'Comparando…' : 'Elegir el informe (PDF)'}
        <input type="file" accept="application/pdf" onchange={compare} disabled={busy} hidden />
      </label>
      {#if fileName !== ''}<span class="cv-muted">{fileName}</span>{/if}
    </div>
  </div>

  {#if error !== undefined}<Notice kind="error" title={error.title} lines={error.lines}>{error.detail}</Notice>{/if}

  {#if report !== undefined}
    <Notice kind="ok">
      {plural(report.spells, 'alta de empleo leída', 'altas de empleo leídas')} · {plural(report.employers, 'empresa', 'empresas')} · {plural(report.items.length, 'apunte', 'apuntes')}. No se ha
      cambiado nada: las fechas las corriges tú en Fuentes.
    </Notice>
    {#if report.items.length === 0}
      <Notice kind="ok">Tus fechas cuadran con el informe.</Notice>
    {:else}
      {#each BLOCKS as block (block.kind)}
        {@const items = itemsOf(block.kind)}
        {#if items.length > 0}
          <div class="cv-card cv-card-tight">
            <div class="cv-card-head">
              <h2>{block.title}</h2>
              <span class="cv-muted">{plural(items.length, 'apunte', 'apuntes')}</span>
            </div>
            {#if block.hint !== ''}<p class="cv-muted">{block.hint}</p>{/if}
            <ul class="cv-vida-items">
              {#each items as item, index (`${item.kind}-${index.toString()}`)}
                <li class="cv-vida-item">
                  <div class="cv-vida-item-head">
                    {#if item.matchedBy === 'period'}<span class="cv-badge warn">por el periodo</span>{/if}
                    <strong>{item.title}</strong>
                  </div>
                  {#if item.detail !== undefined && item.detail !== ''}<p class="cv-muted">{item.detail}</p>{/if}
                  {#if item.sources !== undefined && item.sources.length > 0}
                    <p class="cv-muted cv-mono">{item.sources.join(', ')}</p>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if block.kind === 'start' || block.kind === 'end' || block.kind === 'still-open'}
              <div class="cv-actions"><button class="cv-button small" type="button" onclick={() => navigate({ page: 'fuentes' })}>Corregir en Fuentes</button></div>
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  {:else if error === undefined && !busy}
    <div class="cv-empty">
      <div class="cv-empty-inner">
        <div class="cv-empty-icon"><Icon name="shield" size={26} /></div>
        <h1>Las fechas, contra lo que consta</h1>
        <p>Sube tu informe de vida laboral y verás qué inicios y finales no cuadran, qué empresas registra que tu perfil no tiene y qué empleos das por abiertos.</p>
      </div>
    </div>
  {/if}
</section>

<style>
  .cv-page-head {
    display: grid;
    gap: 4px;
  }
  .cv-steps {
    margin: 6px 0 0;
    padding-left: 20px;
    display: grid;
    gap: 8px;
  }
  .cv-vida-items {
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 12px;
  }
  .cv-vida-item {
    display: grid;
    gap: 4px;
  }
  .cv-vida-item-head {
    display: flex;
    gap: 8px;
    align-items: baseline;
    flex-wrap: wrap;
  }
</style>
