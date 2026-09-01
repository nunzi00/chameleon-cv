<script lang="ts">
  /**
   * Comparar varias de las ofertas guardadas (T-9.13). Vive aparte de «Generar» porque es una pregunta distinta
   * —«¿a cuál me presento primero?», no «¿cómo hago este CV?»— y porque así se lleva consigo su propio estado:
   * lo marcado y la tabla. El análisis es el determinista de siempre, uno por oferta: ni red ni modelo, así que
   * no hay coste que confirmar.
   */
  import Notice from './Notice.svelte';
  import type { ApiClient } from '../lib/api/client';
  import { rankView, type RankView } from '../lib/generate/rank';

  interface Props {
    api: ApiClient;
    /** Las ofertas de `offers/` que se pueden comparar. */
    offers: readonly { readonly path: string }[];
    /** La especialidad elegida en el formulario, si hay alguna: la comparación se hace con la misma. */
    specialty: string;
    /** Mientras la pantalla está ocupada no se lanza otra comparación. */
    busy: boolean;
    /** «Usar esta»: la fila elegida vuelve al formulario. */
    onuse: (path: string) => void;
    onerror: (caught: unknown) => void;
  }
  let { api, offers, specialty, busy, onuse, onerror }: Props = $props();

  let chosen = $state<readonly string[]>([]);
  let ranking = $state<RankView | undefined>(undefined);
  let comparing = $state(false);

  function toggle(path: string): void {
    chosen = chosen.includes(path) ? chosen.filter((entry) => entry !== path) : [...chosen, path];
  }

  async function compare(): Promise<void> {
    if (chosen.length < 2 || busy || comparing) {
      return;
    }
    comparing = true;
    ranking = undefined;
    try {
      const sources = [...chosen];
      ranking = rankView(await api.rankOffers({ offers: sources.map((path) => ({ workspaceFile: path })), ...(specialty === '' ? {} : { specialty }) }), sources);
    } catch (caught) {
      onerror(caught);
    } finally {
      comparing = false;
    }
  }
</script>

<details class="cv-rank-panel">
  <summary>Comparar varias ofertas ({offers.length} guardadas)</summary>
  <p class="cv-muted cv-step-note">Marca las que estés valorando y se analizan todas con el mismo motor determinista —sin red y sin modelo—, ordenadas por imprescindibles cubiertos y después por adecuación.</p>
  <ul class="cv-copilot-picks">
    {#each offers as offer (offer.path)}
      <li>
        <label class="cv-check">
          <input type="checkbox" checked={chosen.includes(offer.path)} onchange={() => toggle(offer.path)} />
          <span class="cv-mono">{offer.path}</span>
        </label>
      </li>
    {/each}
  </ul>
  <div class="cv-actions">
    <button class="cv-button small" type="button" disabled={busy || comparing || chosen.length < 2} onclick={() => void compare()}>
      {comparing ? 'Comparando…' : chosen.length < 2 ? 'Comparar (marca al menos dos)' : `Comparar ${chosen.length} ofertas`}
    </button>
  </div>
  {#if ranking !== undefined}
    <div class="cv-table cv-table-rank">
      <div class="cv-table-head"><span>Oferta</span><span>Adecuación</span><span>Imprescindibles</span><span>Especialidad</span><span>Carencias</span><span></span></div>
      {#each ranking.rows as row, index (`${row.name}-${index}`)}
        <div class="cv-table-row static">
          <span>{row.name}</span>
          <span class="cv-muted">{row.fit}</span>
          <span class="cv-muted">{row.required}</span>
          <span class="cv-muted">{row.specialty}</span>
          <span class="cv-muted">{row.gaps}</span>
          <button class="cv-button small" type="button" onclick={() => onuse(chosen[index] ?? '')}>Usar esta</button>
        </div>
      {/each}
    </div>
    {#if ranking.warnings.length > 0}<Notice kind="warn" title="Avisos" lines={ranking.warnings}></Notice>{/if}
    {#if ranking.failed.length > 0}<Notice kind="error" title="No se pudieron analizar" lines={ranking.failed}></Notice>{/if}
  {/if}
</details>
