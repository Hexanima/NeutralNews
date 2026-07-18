# api

API HTTP local de Node para NeutralNews.

El endpoint `/health` compone una respuesta desde el caso de uso de readiness exportado por `app-domain`. Las futuras integraciones de persistencia, credenciales, RSS, extraccion y proveedores de IA viven en este workspace como adaptadores de infraestructura.

## Comandos

- `yarn workspace api dev`
- `yarn workspace api test --run`
- `yarn workspace api build`
- `yarn workspace api start`
