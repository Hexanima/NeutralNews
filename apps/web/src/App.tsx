import { FilterOperators, isOk, ok } from 'app-domain'
import './App.css'

const domainStatus = isOk(ok(FilterOperators.Eq)) ? 'ready' : 'error'

function App() {
  return (
    <main className="app-shell">
      <section className="status-panel">
        <p className="eyebrow">TypeScript monorepo</p>
        <h1>Clean Architecture Template</h1>
        <dl>
          <div>
            <dt>Domain layer</dt>
            <dd>{domainStatus}</dd>
          </div>
          <div>
            <dt>Dependency rule</dt>
            <dd>inward</dd>
          </div>
          <div>
            <dt>Result contract</dt>
            <dd>discriminated</dd>
          </div>
        </dl>
        <p className="domain-check">Domain layer: {domainStatus}</p>
      </section>
    </main>
  )
}

export default App
