# domain

Paquete de dominio independiente de frameworks para NeutralNews.

Mantiene entidades, value objects, errores de dominio, contratos `Result`, casos de uso y futuros puertos de repositorios o servicios externos. Este paquete no debe depender de `apps/*`, React, HTTP, filesystem, SDKs de IA ni parsers RSS.

El use case minimo de readiness existe para verificar la composicion del monorepo antes de agregar funcionalidad editorial.

## Comandos

- `yarn workspace app-domain test --run`
- `yarn workspace app-domain build`
