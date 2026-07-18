# NeutralNews

Aplicacion personal y local para consumir noticias politicas con encuadres contrastados. La base mantiene una arquitectura limpia para que el dominio editorial no dependa de frameworks, HTTP, React ni proveedores externos.

## Workspaces

- `domain`: modelo de dominio independiente, contratos `Result`, errores, casos de uso y futuros puertos.
- `apps/api`: adaptador HTTP local de Node que compone casos de uso del dominio.
- `apps/web`: interfaz React/Vite que consume contratos compartidos desde `app-domain`.

## Reglas

- Las dependencias apuntan hacia adentro: `apps/*` puede depender de `app-domain`; `domain` no depende de `apps/*`.
- El dominio conserva el contrato discriminado `Result`.
- La UI no consume SDKs de proveedores ni resuelve credenciales.
- Los mecanismos de prueba existentes se conservan; `passWithNoTests` esta deshabilitado.

## Comandos

- `yarn workspace app-domain test --run`
- `yarn workspace api test --run`
- `yarn workspace web test --run`
- `yarn test`
- `yarn build`
- `yarn workspace api dev`
- `yarn workspace web dev`
