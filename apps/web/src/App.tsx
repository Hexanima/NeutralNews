import { useState } from 'react'
import { FilterOperators, isOk, ok } from 'app-domain'

import { saveRegionalPreferences } from './regional-preferences-api.js'

const domainStatus = isOk(ok(FilterOperators.Eq)) ? 'ready' : 'error'

function App() {
  const [regionalStatus, setRegionalStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const handleSaveRegionalPreferences = async () => {
    setRegionalStatus('saving')

    try {
      await saveRegionalPreferences({
        timeZone: { mode: 'automatic' },
        feedDistribution: { argentina: 3, latin_america: 2, international: 1 },
      })
      setRegionalStatus('saved')
    } catch {
      setRegionalStatus('error')
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-surface p-shell font-sans text-ink">
      <section className="w-full max-w-[760px]">
        <p className="mb-2 text-sm font-bold uppercase text-muted">
          Aplicacion local de noticias politicas
        </p>
        <h1 className="mb-6 text-5xl leading-none font-bold sm:text-6xl">
          NeutralNews
        </h1>
        <dl className="grid grid-cols-1 gap-card sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
          <div className="rounded-card border border-border bg-panel p-card">
            <dt>Capa de dominio</dt>
            <dd>{domainStatus}</dd>
          </div>
          <div className="rounded-card border border-border bg-panel p-card">
            <dt>Regla de dependencias</dt>
            <dd>inward</dd>
          </div>
          <div className="rounded-card border border-border bg-panel p-card">
            <dt>Contrato Result</dt>
            <dd>discriminated</dd>
          </div>
        </dl>
        <section className="mt-5 rounded-card border border-border bg-panel p-card">
          <h2 className="text-lg font-bold">Preferencias regionales</h2>
          <p className="mt-2 text-sm text-muted">Zona automatica</p>
          <button
            className="mt-4 border border-border px-4 py-2 font-bold text-accent"
            type="button"
            disabled={regionalStatus === 'saving'}
            onClick={handleSaveRegionalPreferences}
          >
            Guardar preferencias
          </button>
          <p className="mt-3 text-sm" aria-live="polite">
            {regionalStatus === 'saved'
              ? 'Preferencias guardadas'
              : regionalStatus === 'error'
                ? 'Error al guardar preferencias'
                : regionalStatus === 'saving'
                  ? 'Guardando preferencias'
                  : ''}
          </p>
        </section>
        <p className="mt-5 font-bold text-accent">Domain layer: {domainStatus}</p>
      </section>
    </main>
  )
}

export default App
