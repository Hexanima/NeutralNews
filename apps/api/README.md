# api

API HTTP local de Node para NeutralNews.

El endpoint `/health` compone una respuesta desde el caso de uso de readiness exportado por `app-domain`. Las futuras integraciones de persistencia, credenciales, RSS, extraccion y proveedores de IA viven en este workspace como adaptadores de infraestructura.

En produccion local, `yarn start` desde la raiz compila todos los workspaces y arranca `apps/api` como unico proceso. La API escucha por defecto en `http://127.0.0.1:3000`, sirve `apps/web/dist` y mantiene la UI y la API en el mismo origen. Las rutas `/health` y `/api/health` exponen el estado JSON; las rutas SPA no API devuelven `index.html` para soportar recargas del navegador.

Variables:

- `API_PORT`: puerto principal.
- `PORT`: fallback si `API_PORT` no existe.
- `API_HOST`: host explicito de escucha; por defecto se usa `127.0.0.1`.

## Comandos

- `yarn workspace api dev`
- `yarn workspace api test --run`
- `yarn workspace api build`
- `yarn workspace api start`
