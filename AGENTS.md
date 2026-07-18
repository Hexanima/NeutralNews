# AGENTS.md — NeutralNews

## Propósito

NeutralNews es una aplicación personal y local para consumir noticias políticas con encuadres contrastados. Triangula múltiples fuentes, muestra coincidencias y divergencias atribuibles y genera análisis en español con lenguaje neutral.

La aplicación no hace fact-checking ni promete neutralidad absoluta. Nunca presentar una coincidencia entre medios como prueba definitiva ni atribuir una omisión a una intención editorial.

## Fuente de verdad

- Usar `TAREAS_DESARROLLO.md` como backlog y fuente de criterios de aceptación.
- Antes de implementar, identificar el ID de tarea y leer sus dependencias.
- Mantener cada cambio dentro de una tarea y un PR atómico.
- Si una decisión nueva contradice el backlog, actualizar primero la documentación o pedir confirmación.

## Arquitectura

El repositorio es un monorepo Yarn 4 con tres workspaces:

- `domain`: entidades, value objects, errores, contratos, puertos y casos de uso independientes de frameworks.
- `apps/api`: composición, HTTP, autenticación, persistencia, bóveda de secretos y adaptadores externos.
- `apps/web`: React/Vite, navegación, formularios y presentación.

Reglas obligatorias:

- Las dependencias apuntan hacia adentro: `apps/*` puede depender de `app-domain`; `domain` nunca depende de `apps/*`.
- `domain` no importa React, Node HTTP, filesystem, SDKs de IA, parsers RSS ni detalles de proveedores.
- Definir las operaciones externas como puertos del dominio e implementarlas en `apps/api`.
- La UI consume contratos HTTP y nunca SDKs de proveedores.
- Conservar el contrato discriminado `Result`; representar fallos esperables como errores tipados.
- Capturar excepciones de librerías en los adaptadores y traducirlas a errores del dominio o de aplicación.
- Inyectar reloj, almacenamiento y servicios externos cuando afecten la reproducibilidad de pruebas.

## Proveedores y modelos de IA

- El dominio consume un puerto genérico de IA neutral al proveedor, SDK y modelo.
- Crear un adaptador por protocolo de proveedor, no uno por modelo. OpenAI Responses API es el primer adaptador.
- Representar los modelos como datos: proveedor, ID remoto, disponibilidad y capacidades.
- No hardcodear modelos en casos de uso, endpoints ni componentes.
- Resolver siempre el par proveedor/modelo activo desde la configuración In-App.
- Cada feature declara las capacidades que necesita, por ejemplo `structured_outputs`, `web_search` o nivel de razonamiento.
- Rechazar una operación con un error accionable si la selección activa no existe, no está disponible o carece de capacidades.
- Combinar el catálogo local versionado de capacidades con los IDs accesibles informados por el proveedor.
- Mostrar modelos remotos desconocidos, pero no permitir seleccionarlos hasta definir sus capacidades.
- Tratar los modelos iniciales del backlog como seed configurable, no como tipos o dependencias del dominio.
- Mantener prompts y schemas de salida versionados. Un cambio de prompt debe invalidar los cachés correspondientes.
- Validar toda salida estructurada antes de incorporarla a resultados del dominio.
- Nunca aceptar fuentes, URLs o evidencias inventadas por el modelo.
- Verificar cambios de SDK, endpoints o capacidades contra documentación oficial antes de implementarlos.

## Credenciales y configuración In-App

- Proveedores, campos requeridos, credenciales y modelo activo se administran desde la aplicación.
- Guardar valores secretos en el almacén seguro del sistema operativo o una bóveda cifrada equivalente.
- Los JSON de configuración sólo guardan referencias opacas a secretos.
- Si la bóveda segura no está disponible, devolver un error explícito; no usar texto plano como fallback.
- Ningún endpoint devuelve una credencial completa después de guardarla.
- No precargar secretos guardados en formularios ni persistirlos en localStorage, URLs o logs.
- Sólo `apps/api` puede resolver una referencia de credencial.
- La API debe poder iniciar sin proveedor configurado y exponer un estado no sensible.
- Validar nuevamente en backend todas las entradas recibidas desde la UI.

## Descubrimiento y fuentes

- Usar RSS o Atom como mecanismo principal de descubrimiento.
- Usar búsqueda web mediante el proveedor activo sólo como fallback por cobertura insuficiente o para descubrir fuentes primarias.
- Ejecutar el fallback según umbrales explícitos de cantidad y diversidad, no por decisión implícita del modelo.
- Conservar URL, medio, fecha, idioma, tipo y nivel de evidencia de cada entrada.
- Extraer cuerpos localmente cuando sea posible; no evadir paywalls ni controles de acceso.
- No persistir cuerpos completos de artículos. Mantenerlos en memoria sólo durante la operación.
- Conservar las fuentes en su idioma original. Traducir únicamente el análisis generado para el usuario.
- La orientación editorial es manual. Una fuente descubierta automáticamente entra como `sin_clasificar`.
- Separar orientación, región, país, idioma y tipo de fuente; no inferir neutralidad por ser agencia internacional.
- Priorizar fuentes primarias verificables para contexto factual y mantenerlas separadas de la cobertura periodística.

## Reglas editoriales

- Identificar hechos verificables, cifras, fechas, actores y declaraciones atribuidas.
- Eliminar lenguaje valorativo, hipérboles y atribuciones de intención.
- Mostrar contradicciones sin elegir una versión como verdadera.
- Dar visibilidad proporcional a posiciones materiales sin crear falso equilibrio.
- No inferir causas o consecuencias ausentes en las evidencias.
- Cada coincidencia, divergencia y afirmación factual debe referenciar IDs de evidencia existentes.
- Mostrar cobertura asimétrica como una observación cuantificable, nunca como omisión intencional.
- Explicar qué se eliminó o suavizó durante una reescritura y por qué.
- Mantener contexto factual y mapa de cobertura mediática como capas independientes.

## Persistencia local

- Guardar fuentes, preferencias, caché y métricas opcionales en JSON local versionado.
- Escribir mediante archivo temporal y reemplazo atómico.
- Conservar recuperación ante JSON corrupto y migraciones explícitas entre versiones.
- La zona horaria es IANA, detectable por navegador y configurable; usar `America/Argentina/Buenos_Aires` como fallback.
- El feed contiene hasta seis temas, con objetivo inicial 3 Argentina, 2 Latinoamérica y 1 internacional.
- Permitir reemplazo por relevancia cuando una región no alcance el umbral.
- Invalidar caché ante cambios de fuentes, región, proveedor, modelo, prompt o schema que afecten el resultado.
- Las métricas son opcionales y nunca bloquean una operación principal.
- No guardar consultas, textos pegados, prompts completos ni cuerpos periodísticos en métricas.

## Seguridad y resiliencia

- Escuchar en `127.0.0.1` por defecto. No ampliar la interfaz de red sin configuración explícita.
- Proteger páginas y endpoints mediante contraseña de usuario único y sesión firmada.
- Usar cookies `HttpOnly`, `SameSite=Lax` y `Secure` bajo HTTPS.
- No incluir secretos, prompts privados ni cuerpos completos en respuestas de error.
- Validar SSRF antes de cada solicitud externa y después de cada redirección.
- Bloquear localhost, redes privadas, link-local y rangos reservados como destinos configurables.
- Limitar timeout, bytes, redirecciones y concurrencia de toda operación externa.
- Reintentar sólo operaciones idempotentes ante errores transitorios.
- Propagar cancelación y tolerar éxito parcial cuando fallen fuentes individuales.
- Sanitizar logs y mensajes antes de registrar errores de proveedores.

## Frontend

- Distinguir visualmente resumen, coincidencias, divergencias, advertencias y fuentes.
- No usar etiquetas o estilos que presenten el análisis como verificación de hechos.
- Mostrar estados de carga, progreso, cancelación, error, parcial y stale.
- Mantener navegación, formularios y resultados utilizables sólo con teclado.
- Usar HTML semántico, foco visible, contraste suficiente y regiones accesibles para cambios asíncronos.
- Los enlaces externos deben mostrar su origen y usar atributos seguros.
- Separar la configuración de fuentes, región, proveedores, credenciales y modelo activo.

## Convenciones de código

- Usar TypeScript estricto y evitar `any`; preferir `unknown` más validación.
- Mantener ESM y las convenciones de importación existentes en cada workspace.
- Usar UTF-8, LF, indentación de dos espacios y newline final.
- Mantener funciones y contratos pequeños, con nombres explícitos del dominio.
- No duplicar contratos entre API y web si pertenecen al dominio compartido.
- Colocar pruebas junto al código con sufijo `.test.ts` o `.test.tsx`.
- Usar fixtures mínimos y permitidos; no copiar artículos completos a las pruebas.
- No introducir dependencias nuevas si una utilidad pequeña y probada es suficiente.

## Flujo de desarrollo

1. Leer la tarea y sus criterios en `TAREAS_DESARROLLO.md`.
2. Confirmar que sus dependencias ya existen en el código.
3. Escribir o actualizar primero las pruebas que expresan el comportamiento.
4. Implementar el cambio mínimo que satisface los criterios.
5. Ejecutar pruebas focalizadas del workspace modificado.
6. Ejecutar la verificación global proporcional al cambio.
7. Actualizar documentación cuando cambien contratos, configuración o decisiones.

Comandos disponibles:

```bash
yarn workspace app-domain test --run
yarn workspace api test --run
yarn workspace web test --run
yarn workspace web lint
yarn test
yarn build
```

No afirmar que una tarea está terminada si las verificaciones relevantes no se ejecutaron correctamente. Si una prueba no puede ejecutarse, informar el motivo exacto.

## Definición de terminado

- Todos los criterios de aceptación de la tarea están cubiertos.
- La regla de dependencias de Clean Architecture se conserva.
- Existen pruebas de éxito, error y bordes relevantes.
- No se filtran credenciales ni contenido periodístico sensible.
- Errores externos, timeout y cancelación tienen comportamiento definido.
- `yarn test` y `yarn build` pasan cuando el alcance requiere validación global.
- La documentación refleja cualquier cambio de configuración o contrato.

## Auditorías de PR

- Evaluar siempre contra los criterios de aceptación provistos.
- No modificar archivos durante una auditoría; sólo reportar hallazgos.
- Si no se especifica rama base, asumir `origin/dev`.
- Comparar con `origin/<rama>` sin crear ramas locales innecesarias.
- Reportar de forma concisa:
  - `✅ Correcto`
  - `⚠️ A corregir (archivo:línea)`
  - `❌ Crítico (archivo:línea)`
