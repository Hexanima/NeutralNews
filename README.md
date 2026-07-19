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
- `yarn start`: compila los workspaces y arranca la aplicacion en modo produccion local.
- `yarn dev`: inicia API y frontend en paralelo.
- `yarn workspace api dev`
- `yarn workspace web dev`

## Desarrollo local

`yarn dev` levanta `apps/api` y `apps/web` en paralelo. El frontend usa el proxy de Vite para acceder a la API con rutas `/api/*`, por ejemplo `/api/health`, sin configurar una URL manual en la UI.

Puertos por defecto:

- API: `3000`
- Web: `5173`

Variables configurables:

- `API_PORT`: puerto de la API.
- `PORT`: fallback compatible para la API si `API_PORT` no existe.
- `WEB_PORT`: puerto del servidor Vite.

En PowerShell:

```powershell
$env:API_PORT = "4000"
$env:WEB_PORT = "5174"
yarn.cmd dev
```

Al cerrar `yarn dev` con `Ctrl+C`, Yarn detiene los procesos de ambos workspaces.

## Produccion local

`yarn start` compila `domain`, `apps/api` y `apps/web`, y luego arranca un unico proceso Node desde `apps/api`. En este modo la API sirve el build estatico de `apps/web/dist`, por lo que la UI y la API comparten origen.

URL por defecto:

- `http://127.0.0.1:3000`

Variables configurables:

- `API_PORT`: puerto de la API y de la aplicacion servida.
- `PORT`: fallback compatible si `API_PORT` no existe.
- `API_HOST`: host de escucha. Si no se configura, el servidor escucha solo en `127.0.0.1`.

Las rutas de la SPA devuelven `index.html` al recargar el navegador. Los endpoints `/health` y `/api/health` devuelven el estado JSON de la API en el mismo origen.
