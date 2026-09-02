<script lang="ts">
  import Dialog from '../components/Dialog.svelte';
  import Icon from '../components/Icon.svelte';
  import Notice from '../components/Notice.svelte';
  import type { ApiClient } from '../lib/api/client';
  import type { CvFoldersResponse, ImportCvResponse, ImportFolderResponse, ImportMapJobResult, LlmConfigResponse } from '../lib/api/types';
  import { ApiError } from '../lib/api/client';
  import { launchProblem, type LaunchProblem } from '../lib/copilot/consent';
  import { applyJobEvent, isFinished, type JobSnapshot } from '../lib/copilot/jobs';
  import { remoteProviderOptions } from '../lib/copilot/providers';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { plural } from '../lib/format';

  interface Props {
    api: ApiClient;
    onsession: () => void;
  }
  let { api, onsession }: Props = $props();

  // Dos orígenes con el mismo destino: un CV maquetado (se adivina la maquetación) o la exportación oficial de
  // datos de LinkedIn (CSV estructurado, sin adivinar nada y sin líneas sin situar). La URL del perfil NO es una
  // opción: el robots.txt de LinkedIn prohíbe el acceso automatizado y esa URL devuelve el muro de acceso.
  let source = $state<'cv' | 'linkedin' | 'manfred' | 'carpeta'>('cv');
  /* ── T-9.14: una carpeta entera del espacio de trabajo, un borrador por CV ── */
  let folder = $state('');
  let folderResult = $state<ImportFolderResponse | undefined>(undefined);
  /* ── T-9.21: elegir la carpeta en vez de escribir su ruta ── */
  // El navegador NO puede dar la ruta de una carpeta (un selector de directorio entrega los ficheros, nunca su
  // sitio en el disco), y esta importación la hace el SERVIDOR leyendo el espacio de trabajo. Así que las
  // carpetas las ofrece el servidor: las suyas, las que de verdad tienen CV dentro.
  let folders = $state<CvFoldersResponse['folders'] | undefined>(undefined);
  let scanning = $state(false);
  /** Con él, el campo de ruta a mano; se activa solo si la carpeta buscada no está en la lista. */
  let manualFolder = $state(false);
  let file = $state<File | undefined>(undefined);
  let name = $state('');
  let busy = $state(false);
  let error = $state<ExplainedError | undefined>(undefined);
  let conflict = $state(false);
  let result = $state<ImportCvResponse | undefined>(undefined);

  // Refinado con el co-piloto (T-8.18): trabajo aparte que solo PROPONE; el borrador no se toca.
  let config = $state<LlmConfigResponse | undefined>(undefined);
  let provider = $state('');
  let job = $state<JobSnapshot | undefined>(undefined);
  let refined = $state<ImportMapJobResult | undefined>(undefined);
  let problem = $state<LaunchProblem | undefined>(undefined);
  const remotes = $derived(remoteProviderOptions(config));
  const refining = $derived(job !== undefined && !isFinished(job.status));

  // Aplicar una propuesta (T-9.5): el modelo no escribe nada; escribe este botón cuando la persona confirma (C2).
  // Lo que el esquema exige y la línea no puede dar se pide aquí; la regla de verdad la tiene el servidor, que
  // responde 422 con lo que falta si algo se queda corto.
  const EXTRA_FIELDS: Readonly<Record<string, readonly string[]>> = {
    experiencia: ['company', 'role', 'start', 'end'],
    formacion: ['institution', 'degree', 'start', 'end'],
    idioma: ['level'],
    contacto: ['contact', 'label'],
  };
  const FIELD_LABEL: Readonly<Record<string, string>> = {
    company: 'Empresa',
    role: 'Puesto',
    institution: 'Institución',
    degree: 'Titulación',
    start: 'Desde (AAAA, AAAA-MM o AAAA-MM-DD)',
    end: 'Hasta (vacío = en curso)',
    level: 'Nivel MCER (A1–C2 o native)',
    contact: 'Campo de contacto',
    label: 'Etiqueta del enlace (opcional)',
  };
  const CONTACT_OPTIONS = [
    { value: 'email', label: 'Correo' },
    { value: 'phone', label: 'Teléfono' },
    { value: 'location', label: 'Ubicación' },
    { value: 'link', label: 'Enlace' },
  ];

  type Proposal = ImportMapJobResult['proposals'][number];
  let pending = $state<Proposal | undefined>(undefined);
  let fields = $state<Record<string, string>>({});
  let applyError = $state<string | undefined>(undefined);
  let applying = $state(false);
  let applied = $state<string[]>([]);

  function askApply(proposal: Proposal): void {
    pending = proposal;
    fields = {};
    applyError = undefined;
  }

  async function confirmApply(): Promise<void> {
    if (pending === undefined || result === undefined) {
      return;
    }
    const proposal = pending;
    const extra = Object.fromEntries(Object.entries(fields).filter(([, value]) => value.trim() !== ''));
    applying = true;
    applyError = undefined;
    try {
      const outcome = await api.applyImportProposal({
        name: result.name,
        line: proposal.n,
        section: proposal.section,
        ...(Object.keys(extra).length === 0 ? {} : { fields: extra }),
      });
      result = { ...result, readme: outcome.report };
      if (refined !== undefined) {
        refined = { ...refined, proposals: refined.proposals.filter((item) => item.n !== proposal.n) };
      }
      applied = [...applied, outcome.written.length === 0 ? `línea ${outcome.line}: descartada` : `línea ${outcome.line} → ${outcome.written.join(', ')}`];
      pending = undefined;
    } catch (caught) {
      const explained = explainError(caught);
      applyError = explained.detail === '' ? explained.title : explained.detail;
      if (explained.kind === 'session') {
        onsession();
      }
    } finally {
      applying = false;
    }
  }

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
      const options = { ...(name.trim() === '' ? {} : { name: name.trim() }), ...(replace ? { replace: true } : {}) };
      result = source === 'linkedin' ? await api.importLinkedIn(file, options) : source === 'manfred' ? await api.importManfred(file, options) : await api.importCv(file, options);
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

  /**
   * Importa todos los CV de una carpeta del espacio de trabajo (T-9.14). Cada uno va a su propio borrador,
   * nombrado por el fichero, y la tabla es lo que sirve para decidir cuál merece la pena revisar. Uno que falle
   * se anota y no detiene a los demás.
   */
  async function importFolder(replace: boolean): Promise<void> {
    if (folder.trim() === '' || busy) {
      return;
    }
    busy = true;
    error = undefined;
    conflict = false;
    folderResult = undefined;
    try {
      folderResult = await api.importFolder({ directory: folder.trim(), ...(replace ? { replace: true } : {}) });
    } catch (caught) {
      const explained = explainError(caught);
      error = explained;
      if (explained.kind === 'session') {
        onsession();
      }
    } finally {
      busy = false;
    }
  }

  /** Las carpetas con CV, una sola vez y solo al elegir ese origen: es un recorrido del disco. */
  async function loadFolders(): Promise<void> {
    if (folders !== undefined || scanning) {
      return;
    }
    scanning = true;
    try {
      folders = (await api.cvFolders()).folders;
      // Con una sola candidata no hay nada que elegir: se deja puesta.
      if (folder.trim() === '' && folders.length === 1) {
        folder = folders[0]?.path ?? '';
      }
    } catch (caught) {
      // Que el catálogo falle no puede impedir importar: se cae al campo de ruta a mano.
      folders = [];
      manualFolder = true;
      const explained = explainError(caught);
      if (explained.kind === 'session') {
        onsession();
      }
    } finally {
      scanning = false;
    }
  }

  function chooseSource(): void {
    file = undefined;
    result = undefined;
    folderResult = undefined;
    error = undefined;
    if (source === 'carpeta') {
      void loadFolders();
    }
  }

  /** El catálogo de proveedores se pide una sola vez, y solo cuando hay un borrador que refinar. */
  async function loadProviders(): Promise<void> {
    if (config !== undefined) {
      return;
    }
    try {
      config = await api.llmConfig();
    } catch {
      config = undefined; // sin catálogo se refina con el proveedor local configurado
    }
  }

  async function refine(estimateId?: string): Promise<void> {
    if (result === undefined || refining) {
      return;
    }
    problem = undefined;
    error = undefined;
    refined = undefined;
    const body = { name: result.name, ...(provider === '' ? {} : { provider }), ...(estimateId === undefined ? {} : { consent: { estimateId } }) };
    try {
      const created = await api.startJob({ kind: 'import-map', body });
      job = created.job;
      for await (const event of api.jobEvents(created.job.id)) {
        job = applyJobEvent(job, event);
        if (isFinished(job.status)) {
          break;
        }
      }
      if (job.status === 'done') {
        refined = job.result as ImportMapJobResult;
        result = { ...result, readme: refined.report };
      } else if (job.error !== undefined) {
        error = { kind: 'other', title: 'El refinado no terminó', detail: job.error.message, lines: [] };
      }
    } catch (caught) {
      const rejected = launchProblem(caught);
      if (rejected !== undefined) {
        problem = rejected;
        job = undefined;
        return;
      }
      const explained = explainError(caught);
      error = explained;
      job = undefined;
      if (explained.kind === 'session') {
        onsession();
      }
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

  <form class="cv-import-form" onsubmit={(event) => { event.preventDefault(); if (source === 'carpeta') { void importFolder(false); } else { void importCv(false); } }}>
    <label class="cv-field">
      <span>Origen</span>
      <select bind:value={source} onchange={chooseSource}>
        <option value="cv">Un CV maquetado (.pdf o .docx)</option>
        <option value="linkedin">La exportación de datos de LinkedIn (.zip)</option>
        <option value="manfred">Un MAC de Manfred (.json)</option>
        <option value="carpeta">Una carpeta con varios CV (se comparan)</option>
      </select>
    </label>
    {#if source === 'linkedin'}
      <p class="cv-muted">
        Pídela en LinkedIn: <strong>Configuración y privacidad → Privacidad de datos → Obtener una copia de tus
        datos</strong>, eligiendo los datos concretos (Positions, Education, Skills, Languages, Certifications,
        Projects, Profile). Llega por correo en unos minutos. Trae los datos <strong>estructurados</strong>, así
        que no hay maquetación que adivinar y no queda nada sin situar. La URL del perfil no sirve: LinkedIn
        prohíbe el acceso automatizado y esa dirección devuelve el muro de acceso, no el CV.
      </p>
    {/if}
    {#if source === 'manfred'}
      <p class="cv-muted">
        El <strong>MAC</strong> («Manfred Awesome CV») es el JSON que <a href="https://www.getmanfred.com" target="_blank" rel="noreferrer noopener">Manfred</a> te deja
        exportar de tu perfil. Trae los datos <strong>estructurados</strong>, así que no hay maquetación que adivinar y
        no queda nada sin situar. Lo que el MAC guarda y este perfil no —los puestos que buscas, el tipo de contrato,
        tu salario— <strong>no se importa y se te dice</strong> en el informe del borrador, para que sepas qué se
        quedó en Manfred. El <code>$schema</code> que declara el fichero no se descarga: se lee sin red.
      </p>
    {/if}
    {#if source === 'carpeta'}
      <p class="cv-muted">
        Se importan los <code>.pdf</code> y <code>.docx</code> del <strong>primer nivel</strong> de la carpeta, cada uno a
        su propio borrador <strong>nombrado por el fichero</strong> —si todos son tuyos, el nombre del perfil sería el
        mismo para todos y solo entraría el primero—. Uno que falle se anota y no detiene a los demás.
      </p>
      {#if scanning}
        <p class="cv-loading" aria-live="polite">Buscando carpetas con CV en tu espacio de trabajo…</p>
      {:else if folders !== undefined && folders.length > 0 && !manualFolder}
        <fieldset class="cv-folder-pick">
          <legend>Carpeta</legend>
          {#each folders as candidate (candidate.path)}
            <label>
              <input type="radio" name="carpeta" value={candidate.path} checked={folder === candidate.path} onchange={() => (folder = candidate.path)} />
              <span class="cv-mono">{candidate.path === '.' ? 'la raíz del espacio de trabajo' : candidate.path}</span>
              <span class="cv-muted">{plural(candidate.files, 'CV', 'CV')}</span>
            </label>
          {/each}
        </fieldset>
        <button class="cv-link-button" type="button" onclick={() => (manualFolder = true)}>¿No está? Escribir la ruta</button>
      {:else}
        {#if folders !== undefined && folders.length === 0}
          <p class="cv-muted">No hay ninguna carpeta con <code>.pdf</code> o <code>.docx</code> en tu espacio de trabajo (se miran tres niveles). Escribe la ruta si está en otro sitio.</p>
        {/if}
        <label class="cv-field">
          <span>Carpeta (relativa al espacio de trabajo)</span>
          <input type="text" class="mono" placeholder="mis-cv" bind:value={folder} />
        </label>
        {#if folders !== undefined && folders.length > 0}
          <button class="cv-link-button" type="button" onclick={() => (manualFolder = false)}>Volver a la lista</button>
        {/if}
      {/if}
      <button class="cv-button" type="submit" disabled={folder.trim() === '' || busy}>
        {busy ? 'Importando…' : 'Importar la carpeta'}
      </button>
    {:else}
      <label class="cv-field">
        <span>{source === 'linkedin' ? 'Fichero (.zip de la exportación)' : source === 'manfred' ? 'Fichero (.json del MAC)' : 'Fichero (.pdf o .docx)'}</span>
        {#if source === 'linkedin'}
          <input type="file" accept=".zip,application/zip" onchange={pick} />
        {:else if source === 'manfred'}
          <input type="file" accept=".json,application/json" onchange={pick} />
        {:else}
          <input type="file" accept=".pdf,.docx,application/pdf" onchange={pick} />
        {/if}
      </label>
      <label class="cv-field">
        <span>Nombre del borrador (opcional)</span>
        <input type="text" placeholder="por defecto, el nombre del CV" bind:value={name} />
      </label>
      <button class="cv-button" type="submit" disabled={file === undefined || busy}>
        {busy ? 'Importando…' : 'Importar como borrador'}
      </button>
    {/if}
  </form>

  {#if error !== undefined}
    <Notice kind="error" title={error.title}>
      <p>{error.detail}</p>
      {#if conflict}
        <button class="cv-button" type="button" onclick={() => void importCv(true)} disabled={busy}>Sustituir el borrador existente</button>
      {/if}
    </Notice>
  {/if}

  {#if folderResult !== undefined}
    <div class="cv-import-result">
      <Notice kind={folderResult.imported.length === 0 ? 'warn' : 'ok'} title={`${folderResult.imported.length} de ${folderResult.total} CV importados`}>
        <p>Revisa el <code>README.md</code> de cada borrador: la fila con menos avisos y menos líneas sin situar suele ser el mejor punto de partida.</p>
      </Notice>
      <div class="cv-table cv-table-corpus">
        <div class="cv-table-head"><span>Fichero</span><span>Borrador</span><span>Exp.</span><span>Form.</span><span>Hab.</span><span>Avisos</span><span>Sin situar</span></div>
        {#each folderResult.imported as row (row.file)}
          <div class="cv-table-row static">
            <span class="cv-mono">{row.file}</span>
            <span class="cv-mono">import/{row.name}</span>
            <span class="cv-muted">{row.counts.experience}</span>
            <span class="cv-muted">{row.counts.education}</span>
            <span class="cv-muted">{row.counts.skills}</span>
            <span class="cv-muted">{row.issues}</span>
            <span class="cv-muted">{row.unparsed}</span>
          </div>
        {/each}
      </div>
      {#if folderResult.failed.length > 0}
        <Notice kind="error" title="No se pudieron importar" lines={folderResult.failed.map((entry) => `${entry.file}: ${entry.message}`)}></Notice>
        <div class="cv-actions"><button class="cv-button small" type="button" disabled={busy} onclick={() => void importFolder(true)}>Reimportar sustituyendo los borradores</button></div>
      {/if}
    </div>
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
      {#if result.unparsed.length > 0}
        <div class="cv-panel cv-refine">
          <h2>¿Te ayuda el co-piloto con lo que quedó sin situar?</h2>
          <p class="cv-muted">
            Se envían <strong>solo las {plural(result.unparsed.length, 'línea sin situar', 'líneas sin situar')}</strong>, seudonimizadas y sin datos de contacto, para que el modelo
            <strong>proponga</strong> a qué sección pertenecen. Las propuestas van al informe del borrador: <strong>no se aplica nada</strong>.
          </p>
          <div class="cv-refine-actions">
            <label class="cv-field">
              <span>Proveedor</span>
              <select bind:value={provider} disabled={refining} onfocus={() => void loadProviders()}>
                <option value="">Local (el configurado)</option>
                {#each remotes as option (option.id)}
                  <option value={option.id} disabled={!option.usable}>{option.label}</option>
                {/each}
              </select>
            </label>
            <button class="cv-button" type="button" disabled={refining} onclick={() => void refine()}>
              {refining ? 'Refinando…' : 'Refinar con el co-piloto'}
            </button>
          </div>
          {#if job !== undefined}
            <ul class="cv-refine-log" aria-label="Progreso del refinado" aria-live="polite">
              {#each job.lines as line, index (index)}<li>{line}</li>{/each}
            </ul>
          {/if}
          {#if refined !== undefined}
            <Notice kind={refined.proposals.length > 0 ? 'ok' : 'info'} title={refined.proposals.length > 0 ? `${plural(refined.proposals.length, 'propuesta', 'propuestas')} en el informe (sin aplicar)` : 'El co-piloto no propuso ninguna sección'}>
              {#if refined.proposals.length > 0}
                <ul class="cv-refine-proposals">
                  {#each refined.proposals as proposal (proposal.n)}
                    <li>
                      <span><strong>{proposal.section}</strong> · línea {proposal.n}: {proposal.text}{proposal.reason === '' ? '' : ` (${proposal.reason})`}</span>
                      <button class="cv-button" type="button" onclick={() => askApply(proposal)}>Mover al borrador</button>
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if applied.length > 0}
                <ul class="cv-refine-applied" aria-label="Propuestas aplicadas">
                  {#each applied as line, index (index)}<li>{line}</li>{/each}
                </ul>
              {/if}
              {#if refined.rejected > 0}<p class="cv-muted">{plural(refined.rejected, 'propuesta rechazada', 'propuestas rechazadas')} por el código (sección desconocida, línea inexistente o repetida).</p>{/if}
              {#if refined.skipped > 0}<p class="cv-muted">{plural(refined.skipped, 'línea', 'líneas')} sin situar fuera del lote: vuelve a refinar cuando hayas movido las de arriba.</p>{/if}
            </Notice>
          {/if}
        </div>
      {/if}
      <h2>Informe del borrador (README.md)</h2>
      <pre class="cv-text" aria-label="Informe del borrador">{result.readme}</pre>
    </div>
  {/if}

  <Dialog open={pending !== undefined} title="Mover la línea al borrador" onclose={() => (pending = undefined)}>
    {#if pending !== undefined}
      <p>
        La línea <strong>{pending.n}</strong> pasará a <strong>{pending.section}</strong> del borrador
        <span class="cv-mono">import/{result?.name}</span>, y quedará registrada en su informe.
      </p>
      <p class="cv-quote">{pending.text}</p>
      {#each EXTRA_FIELDS[pending.section] ?? [] as field (field)}
        <label class="cv-field">
          <span>{FIELD_LABEL[field]}</span>
          {#if field === 'contact'}
            <select bind:value={fields[field]}>
              <option value="">Elige el campo…</option>
              {#each CONTACT_OPTIONS as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
            </select>
          {:else}
            <input type="text" bind:value={fields[field]} />
          {/if}
        </label>
      {/each}
      {#if applyError !== undefined}<p class="cv-warning">{applyError}</p>{/if}
      <div class="cv-dialog-actions">
        <button class="cv-button" type="button" onclick={() => (pending = undefined)}>Cancelar</button>
        <button class="cv-button primary" type="button" disabled={applying} onclick={() => void confirmApply()}>{applying ? 'Moviendo…' : 'Mover'}</button>
      </div>
    {/if}
  </Dialog>

  <Dialog open={problem?.kind === 'remote-disabled'} title="Este servidor no admite proveedores remotos" onclose={() => (problem = undefined)}>
    <p>{problem?.message}</p>
    <div class="cv-dialog-actions"><button class="cv-button" type="button" onclick={() => (problem = undefined)}>Entendido</button></div>
  </Dialog>

  <Dialog open={problem?.kind === 'consent-required'} title="Proveedor remoto: confirma el coste" onclose={() => (problem = undefined)}>
    {#if problem?.kind === 'consent-required'}
      <p>{problem.warning === '' ? problem.message : problem.warning}</p>
      {#if problem.dataNote !== ''}<p class="cv-muted">⚠ {problem.dataNote}</p>{/if}
      <dl class="cv-consent">
        <dt>Se envía</dt><dd>{result === undefined ? '' : plural(result.unparsed.length, 'línea sin situar', 'líneas sin situar')}, seudonimizadas</dd>
        <dt>Se escribe</dt><dd class="cv-mono">import/{result?.name}/README.md</dd>
        {#each problem.estimate as line, index (index)}<dt>{index === 0 ? 'Coste estimado' : ''}</dt><dd>{line}</dd>{/each}
      </dl>
      <div class="cv-dialog-actions">
        <button class="cv-button" type="button" onclick={() => (problem = undefined)}>Cancelar</button>
        <button class="cv-button primary" type="button" onclick={() => { const id = problem?.kind === 'consent-required' ? problem.estimateId : undefined; problem = undefined; if (id !== undefined) { void refine(id); } }}>Confirmar y enviar</button>
      </div>
    {/if}
  </Dialog>
</section>

<style>
  .cv-folder-pick {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 8px 10px;
    border: 1px solid var(--cv-border);
    border-radius: var(--cv-radius-md);
  }
  .cv-folder-pick legend {
    padding: 0 4px;
    font-size: var(--cv-size-sm);
    color: var(--cv-muted);
  }
  .cv-folder-pick label {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 5px 6px;
    border-radius: var(--cv-radius-sm);
    cursor: pointer;
  }
  .cv-folder-pick label:hover {
    background: var(--cv-surface-2);
  }
  .cv-folder-pick .cv-mono {
    flex: 1;
    min-width: 0;
  }

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
  .cv-refine {
    display: grid;
    gap: var(--cv-space-2);
  }
  .cv-refine h2 {
    font-size: var(--cv-size-md);
    margin: 0;
  }
  .cv-refine-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--cv-space-3);
    align-items: end;
  }
  .cv-refine-log,
  .cv-refine-proposals {
    margin: 0;
    padding-left: 1.1em;
    display: grid;
    gap: 2px;
  }
  /* La propuesta a la izquierda y su botón a la derecha: la decisión se lee junto a lo que decide (T-9.5). */
  .cv-refine-proposals li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--cv-space-2);
  }
  .cv-refine-applied {
    margin: var(--cv-space-2) 0 0;
    padding-left: 1.1em;
    color: var(--cv-muted);
    font-size: var(--cv-size-sm);
  }
  /* El texto tal cual de la línea que se va a mover: se lee como una cita, no como prosa del diálogo. */
  .cv-quote {
    margin: var(--cv-space-2) 0;
    padding-left: var(--cv-space-2);
    border-left: 2px solid var(--cv-border);
    color: var(--cv-muted);
  }
  .cv-warning {
    margin: var(--cv-space-2) 0 0;
    color: var(--cv-warn);
    font-size: var(--cv-size-sm);
  }
  .cv-refine-log {
    color: var(--cv-muted);
    font-size: var(--cv-size-sm);
  }
</style>
