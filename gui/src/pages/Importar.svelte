<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Notice from '../components/Notice.svelte';
  import type { ApiClient } from '../lib/api/client';
  import type { ImportCvResponse } from '../lib/api/types';
  import { ApiError } from '../lib/api/client';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { plural } from '../lib/format';

  interface Props {
    api: ApiClient;
    onsession: () => void;
  }
  let { api, onsession }: Props = $props();

  let file = $state<File | undefined>(undefined);
  let name = $state('');
  let busy = $state(false);
  let error = $state<ExplainedError | undefined>(undefined);
  let conflict = $state(false);
  let result = $state<ImportCvResponse | undefined>(undefined);

  function pick(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    file = input.files?.[0];
    result = undefined;
    error = undefined;
    conflict = false;
  }

  async function importCv(replace: boolean): Promise<void> {
    if (file === undefined || busy) {
      return;
    }
    busy = true;
    error = undefined;
    conflict = false;
    try {
      result = await api.importCv(file, { ...(name.trim() === '' ? {} : { name: name.trim() }), ...(replace ? { replace: true } : {}) });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'conflict') {
        conflict = true;
        error = { kind: 'conflict', title: 'Ya existe un borrador con ese nombre', detail: caught.message, lines: [] };
      } else {
        const explained = explainError(caught);
        error = explained;
        if (explained.kind === 'session') {
          onsession();
        }
      }
    } finally {
      busy = false;
    }
  }

  const counts = $derived(
    result === undefined
      ? []
      : [
          [result.counts.experience, 'experiencia', 'experiencias'],
          [result.counts.projects, 'proyecto', 'proyectos'],
          [result.counts.education, 'formación', 'formaciones'],
          [result.counts.certifications, 'certificación', 'certificaciones'],
          [result.counts.skills, 'habilidad', 'habilidades'],
          [result.counts.achievements, 'logro', 'logros'],
          [result.counts.languages, 'idioma', 'idiomas'],
        ] as const,
  );
</script>

<section class="cv-card" aria-labelledby="importar-titulo">
  <header class="cv-card-head">
    <h1 id="importar-titulo"><Icon name="file-up" size={18} /> Importar un CV</h1>
    <p class="cv-muted">
      Convierte un CV ya maquetado (PDF o DOCX) en un <strong>borrador de fuentes</strong> en <code>import/&lt;nombre&gt;/</code>.
      Nunca escribe en <code>data/sources/</code>: revisa el borrador, valídalo con <code>cv build --data import/&lt;nombre&gt;</code> y muévelo cuando esté a tu gusto.
    </p>
  </header>

  <form class="cv-import-form" onsubmit={(event) => { event.preventDefault(); void importCv(false); }}>
    <label class="cv-field">
      <span>Fichero (.pdf o .docx)</span>
      <input type="file" accept=".pdf,.docx,application/pdf" onchange={pick} />
    </label>
    <label class="cv-field">
      <span>Nombre del borrador (opcional)</span>
      <input type="text" placeholder="por defecto, el nombre del CV" bind:value={name} />
    </label>
    <button class="cv-button" type="submit" disabled={file === undefined || busy}>
      {busy ? 'Importando…' : 'Importar como borrador'}
    </button>
  </form>

  {#if error !== undefined}
    <Notice kind="error" title={error.title}>
      <p>{error.detail}</p>
      {#if conflict}
        <button class="cv-button" type="button" onclick={() => void importCv(true)} disabled={busy}>Sustituir el borrador existente</button>
      {/if}
    </Notice>
  {/if}

  {#if result !== undefined}
    <div class="cv-import-result">
      <Notice kind="ok" title="Borrador escrito en import/{result.name}">
        <p>
          {result.files} ficheros ·
          {counts.filter(([count]) => count > 0).map(([count, one, many]) => plural(count, one, many)).join(' · ') || 'sin elementos reconocidos'}
        </p>
        {#if result.issues.length > 0 || result.unparsed.length > 0}
          <p>{plural(result.issues.length, 'aviso', 'avisos')} y {plural(result.unparsed.length, 'línea sin situar', 'líneas sin situar')} — el detalle, en el informe de abajo.</p>
        {/if}
      </Notice>
      <h2>Informe del borrador (README.md)</h2>
      <pre class="cv-pre" aria-label="Informe del borrador">{result.readme}</pre>
    </div>
  {/if}
</section>

<style>
  .cv-import-form {
    display: grid;
    gap: var(--cv-space-3);
    max-width: 460px;
    margin: var(--cv-space-4) 0;
  }
  .cv-import-result {
    margin-top: var(--cv-space-4);
    display: grid;
    gap: var(--cv-space-3);
  }
  .cv-import-result h2 {
    font-size: var(--cv-size-lg);
    margin: 0;
  }
</style>
