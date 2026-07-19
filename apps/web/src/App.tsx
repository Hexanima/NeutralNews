import { FilterOperators, isOk, ok } from 'app-domain'

const domainStatus = isOk(ok(FilterOperators.Eq)) ? 'ready' : 'error'

function App() {
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
        <p className="mt-5 font-bold text-accent">Domain layer: {domainStatus}</p>
      </section>
    </main>
  )
}

export default App
