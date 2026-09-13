# api

API HTTP local de Node para NeutralNews.

El endpoint `/health` compone una respuesta desde el caso de uso de readiness exportado por `app-domain`. Las futuras integraciones de persistencia, credenciales, RSS, extraccion y proveedores de IA viven en este workspace como adaptadores de infraestructura.

En produccion local, `yarn start` desde la raiz compila todos los workspaces y arranca `apps/api` como unico proceso. La API escucha por defecto en `http://127.0.0.1:3000`, sirve `apps/web/dist` y mantiene la UI y la API en el mismo origen. Las rutas `/health` y `/api/health` exponen el estado JSON; las rutas SPA no API devuelven `index.html` para soportar recargas del navegador.

Variables:

- `API_PORT`: puerto principal.
- `PORT`: fallback si `API_PORT` no existe.
- `API_HOST`: host explicito de escucha; por defecto se usa `127.0.0.1`.
- `NEUTRALNEWS_ALLOWED_ORIGINS`: lista separada por comas de orígenes HTTP(S) exactos para mutaciones autenticadas; es obligatoria fuera de loopback.
- Login admite cinco fallos por ventana móvil de 15 minutos y las mutaciones autenticadas exigen `Origin` permitido.

## Triangulación

`POST /api/triangulation` requiere sesión válida y un `Origin` permitido. Recibe
`{ "query": "tema" }` y devuelve directamente un `TriangulationResult` con sus
advertencias y referencias de evidencia. Una muestra sin cobertura suficiente es
un resultado válido con la advertencia `insufficient_evidence`.

Los errores no incluyen prompts, credenciales ni cuerpos de artículos:

- `400` — `InvalidTriangulationQuery`
- `502` — `TriangulationProviderError`
- `504` — `TriangulationTimeout`

Si el cliente cierra la conexión, la cancelación se propaga a las operaciones de
descubrimiento y generación en curso.

## Reescritura

`POST /api/rewrite` requiere sesión válida y un `Origin` permitido. Recibe
`{ "text": "texto a reescribir" }` y devuelve directamente un `RewriteResult`
con texto neutral, cambios justificados y advertencias. El texto se valida y
limita antes de llamar al proveedor; no se registra en logs.

Los errores no incluyen el texto recibido, prompts ni credenciales:

- `400` — `InvalidRewriteText`
- `502` — `RewriteProviderError`
- `504` — `RewriteTimeout`

## Comandos

- `yarn workspace api dev`
- `yarn workspace api test --run`
- `yarn workspace api build`
- `yarn workspace api start`
