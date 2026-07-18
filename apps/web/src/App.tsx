import { FilterOperators, isOk, ok } from 'app-domain'
import './App.css'

const domainStatus = isOk(ok(FilterOperators.Eq)) ? 'ready' : 'error'

function App() {
  return (
    <main className="app-shell">
      <section className="status-panel">
        <p className="eyebrow">Aplicacion local de noticias politicas</p>
        <h1>NeutralNews</h1>
        <dl>
          <div>
            <dt>Capa de dominio</dt>
            <dd>{domainStatus}</dd>
          </div>
          <div>
            <dt>Regla de dependencias</dt>
            <dd>inward</dd>
          </div>
          <div>
            <dt>Contrato Result</dt>
            <dd>discriminated</dd>
          </div>
        </dl>
        <p className="domain-check">Domain layer: {domainStatus}</p>
      </section>
    </main>
  )
}

export default App
