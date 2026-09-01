/**
 * Recordar cómo generas tu CV (T-9.18): que vuelva lo que elegiste, que no vuelva lo que no debe volver —la
 * oferta, el co-piloto—, y que lo que ya no existe se descarte en silencio en vez de dejar el formulario
 * apuntando a una especialidad borrada o a un tema desinstalado.
 */
import { describe, expect, it } from 'vitest';

import { EMPTY_FORM } from './form';
import { GENERATE_KEY, rememberOptions, restoreOptions } from './remember';
import { memoryStorage, type KeyValueStorage } from '../storage';

const AVAILABLE = { specialties: ['backend', 'platform'], themes: ['default', 'classic'], typstUsable: true };

/** Un almacenamiento que se niega a todo: contextos restringidos, o el usuario con las cookies bloqueadas. */
const broken: KeyValueStorage = {
  getItem: () => { throw new Error('prohibido'); },
  setItem: () => { throw new Error('prohibido'); },
  removeItem: () => { throw new Error('prohibido'); },
};

describe('recordar las opciones de Generar', () => {
  it('vuelve lo que elegiste; la oferta, la selección y el co-piloto no', () => {
    const storage = memoryStorage();
    rememberOptions(storage, { ...EMPTY_FORM, specialty: 'backend', format: 'pdf', engine: 'typst', theme: 'classic', locale: 'en', topN: '3', compact: true, offerText: 'una oferta', copilot: true, copilotProvider: 'groq', skills: ['PHP'], build: true });
    const restored = restoreOptions(storage, EMPTY_FORM, AVAILABLE);
    expect(restored).toMatchObject({ specialty: 'backend', engine: 'typst', theme: 'classic', locale: 'en', topN: '3', compact: true });
    // Lo que es de cada búsqueda, o lo que envía datos, se queda como estaba: no se decide por el usuario.
    expect(restored).toMatchObject({ offerText: '', copilot: false, copilotProvider: '', skills: [], build: false });
  });

  it('lo que ya no existe se descarta y el formulario se queda con su valor', () => {
    const storage = memoryStorage();
    rememberOptions(storage, { ...EMPTY_FORM, specialty: 'borrada', theme: 'desinstalado', engine: 'typst' });
    const restored = restoreOptions(storage, { ...EMPTY_FORM, specialty: '', theme: '', engine: 'pdfkit' }, { specialties: ['backend'], themes: ['default'], typstUsable: false });
    expect(restored).toMatchObject({ specialty: '', theme: '', engine: 'pdfkit' });
    // Y «sin especialidad» o «tema por defecto» sí son elecciones válidas que vuelven.
    rememberOptions(storage, { ...EMPTY_FORM, specialty: '', theme: '' });
    expect(restoreOptions(storage, { ...EMPTY_FORM, specialty: 'backend' }, AVAILABLE)).toMatchObject({ specialty: '', theme: '' });
  });

  it('sin nada guardado, con basura guardada o sin poder guardar, el formulario no cambia', () => {
    expect(restoreOptions(memoryStorage(), EMPTY_FORM, AVAILABLE)).toEqual(EMPTY_FORM);
    const sucio = memoryStorage();
    sucio.setItem(GENERATE_KEY, 'esto no es json');
    expect(restoreOptions(sucio, EMPTY_FORM, AVAILABLE)).toEqual(EMPTY_FORM);
    const nulo = memoryStorage();
    nulo.setItem(GENERATE_KEY, 'null');
    expect(restoreOptions(nulo, EMPTY_FORM, AVAILABLE)).toEqual(EMPTY_FORM);
    expect(() => rememberOptions(broken, EMPTY_FORM)).not.toThrow();
    expect(restoreOptions(broken, EMPTY_FORM, AVAILABLE)).toEqual(EMPTY_FORM);
  });
});
