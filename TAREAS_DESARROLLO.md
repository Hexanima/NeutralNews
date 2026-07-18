# Backlog de desarrollo — NeutralNews

## Decisiones confirmadas

- La aplicación se ejecuta localmente y sólo permanece activa cuando el usuario la inicia.
- Se conserva el monorepo existente: dominio independiente en `domain`, API Node en `apps/api` y frontend React/Vite en `apps/web`.
- El dominio consume un puerto genérico de IA. Cada proveedor tiene un adaptador de infraestructura y sus modelos se representan como configuración con capacidades, no como implementaciones duplicadas del mismo servicio.
- Proveedores, credenciales y modelo activo se administran In-App. La configuración guarda referencias a secretos, mientras los valores sensibles permanecen en una bóveda local.
- OpenAI Responses API es el primer adaptador disponible. Codex se utiliza para desarrollar la aplicación, no como dependencia de ejecución.
- El catálogo inicial incluye `gpt-5.6-terra`, `gpt-5.6-sol` y `gpt-5.6-luna`, pero ninguno queda acoplado al dominio. OpenAI describe Terra como el modelo que equilibra inteligencia y costo y los tres soportan web search y structured outputs ([modelos OpenAI](https://developers.openai.com/api/docs/models)).
- La lista In-App combina un catálogo local de capacidades con los IDs accesibles para las credenciales actuales. La API de modelos sólo entrega información básica como ID, propietario y disponibilidad, por lo que no reemplaza el catálogo de capacidades ([Models API](https://platform.openai.com/docs/api-reference/models/object?lang=curl)).
- RSS es el mecanismo principal de descubrimiento. OpenAI `web_search` se usa como fallback y para descubrir fuentes primarias, con dominios y fuentes consultadas explícitamente recuperables ([web search](https://developers.openai.com/api/docs/guides/tools-web-search)).
- Se usa extracción local del cuerpo de artículos cuando sea técnicamente posible; no se evaden paywalls y los cuerpos completos no se persisten.
- La configuración, el caché y las métricas opcionales se guardan en archivos JSON locales mediante escrituras atómicas.
- El día se calcula en una zona horaria IANA configurable, con `America/Argentina/Buenos_Aires` como fallback.
- El feed muestra hasta 6 temas: distribución objetivo de 3 Argentina, 2 Latinoamérica y 1 internacional, reemplazable por relevancia cuando una región no alcance el umbral.
- La orientación editorial y la aprobación de medios son configuraciones manuales. El descubrimiento automático sólo puede crear candidatos `sin_clasificar`.
- La aplicación no presenta afirmaciones como hechos verificados: usa coincidencias entre fuentes, declaraciones atribuidas y evidencia primaria.
- La suscripción de ChatGPT/Codex y la API de OpenAI tienen facturación separada; para ejecutar funciones de IA se requiere configurar In-App una clave habilitada para API ([facturación OpenAI](https://help.openai.com/en/articles/8156019-how-can-i-move-my-chatgpt-subscription-to-the-api)).

---

## Fase 0 — Setup e infraestructura local

### F0.1 — Adaptar el template al dominio NeutralNews

**Descripción:** Reemplazar los nombres, ejemplos y documentación del template por la estructura conceptual de NeutralNews sin alterar las reglas de Clean Architecture. Esto deja una base reconocible antes de agregar funcionalidades.

**Criterios de aceptación:**

- [ ] Los paquetes y README ya no describen una aplicación de ejemplo genérica.
- [ ] `domain` continúa sin depender de `apps/api` ni `apps/web`.
- [ ] Los comandos actuales de test y build siguen funcionando.
- [ ] No se elimina ningún mecanismo de pruebas existente.

**Estimación:** S  
**Dependencias:** Ninguna

### F0.2 — Configurar el entorno de desarrollo local

**Descripción:** Agregar un comando raíz que inicie API y frontend en paralelo, con proxy de Vite hacia la API. Esto permite trabajar con cookies same-origin y una única instrucción de arranque.

**Criterios de aceptación:**

- [ ] Un comando raíz inicia ambos workspaces.
- [ ] El frontend accede a la API sin configurar URLs manuales.
- [ ] Cerrar el comando detiene ambos procesos.
- [ ] Los puertos pueden configurarse por variables de entorno.

**Estimación:** M  
**Dependencias:** F0.1

### F0.3 — Crear el runner de producción local

**Descripción:** Configurar la API para servir el build estático del frontend y arrancar toda la aplicación como un único proceso local. Debe escuchar únicamente en loopback salvo configuración explícita.

**Criterios de aceptación:**

- [ ] Un comando compila los tres workspaces y arranca la aplicación.
- [ ] La UI y la API comparten origen en modo producción local.
- [ ] El servidor escucha por defecto en `127.0.0.1`.
- [ ] Las rutas SPA funcionan al recargar el navegador.

**Estimación:** M  
**Dependencias:** F0.1

### F0.4 — Configurar Tailwind CSS

**Descripción:** Integrar Tailwind en el frontend Vite existente y definir estilos base accesibles. Esto establece la infraestructura visual sin implementar todavía las pantallas del producto.

**Criterios de aceptación:**

- [ ] Tailwind procesa los archivos React del workspace web.
- [ ] Existen tokens iniciales para color, espaciado y tipografía.
- [ ] El build de producción incluye únicamente clases utilizadas.
- [ ] Se conserva un foco visible y contraste base accesible.

**Estimación:** M  
**Dependencias:** F0.1

### F0.5 — Validar variables de entorno

**Descripción:** Crear un módulo de configuración que valide puertos, zona horaria, directorio de datos y secretos internos al iniciar la API. Las credenciales de proveedores de IA se administrarán en runtime y no serán variables obligatorias del proceso.

**Criterios de aceptación:**

- [ ] `.env.example` documenta todas las variables sin secretos reales.
- [ ] El hash de acceso, el secreto de sesión y el directorio de datos se validan al iniciar.
- [ ] La API puede iniciar sin un proveedor de IA configurado y reporta ese estado.
- [ ] Ningún secreto queda disponible en el bundle web.
- [ ] Los errores de configuración indican la variable faltante o inválida.
- [ ] Existen pruebas para configuración válida e inválida.

**Estimación:** M  
**Dependencias:** F0.1

### F0.6 — Crear el repositorio de archivos locales

**Descripción:** Implementar una utilidad backend para leer y escribir JSON de forma atómica dentro de un directorio configurable. Será la infraestructura compartida por fuentes, caché y métricas opcionales.

**Criterios de aceptación:**

- [ ] El directorio runtime se crea automáticamente y está ignorado por Git.
- [ ] Las escrituras usan archivo temporal y reemplazo atómico.
- [ ] Un JSON corrupto produce un error controlado y conserva una copia recuperable.
- [ ] Dos escrituras simultáneas no dejan contenido parcial.
- [ ] Existen pruebas con directorios temporales.

**Estimación:** M  
**Dependencias:** F0.5

### F0.7 — Implementar políticas para servicios externos

**Descripción:** Crear utilidades compartidas de timeout, cancelación, reintento limitado y normalización de errores. Esto evita que un RSS, artículo o llamada de OpenAI bloquee toda la operación.

**Criterios de aceptación:**

- [ ] Cada operación externa tiene timeout configurable.
- [ ] Sólo se reintentan errores transitorios e idempotentes.
- [ ] Los errores no exponen claves ni cuerpos completos de artículos.
- [ ] La cancelación del cliente interrumpe trabajo innecesario.
- [ ] Existen pruebas para timeout, reintento y cancelación.

**Estimación:** M  
**Dependencias:** F0.5

### F0.8 — Crear la bóveda local de credenciales

**Descripción:** Implementar una bóveda backend para guardar credenciales de proveedores sin escribirlas en los JSON de configuración. Debe usar el almacén seguro del sistema operativo o un mecanismo cifrado equivalente y mantener los valores fuera del frontend.

**Criterios de aceptación:**

- [ ] Permite crear, reemplazar, consultar internamente y eliminar secretos por proveedor.
- [ ] La configuración persistida sólo contiene referencias opacas a credenciales.
- [ ] Los endpoints nunca devuelven el valor completo después de guardarlo.
- [ ] Los secretos sólo pueden leerse desde `apps/api`.
- [ ] Un almacén seguro no disponible produce un error explícito sin fallback a texto plano.
- [ ] Tiene pruebas con una implementación de bóveda en memoria.

**Estimación:** M  
**Dependencias:** F0.5, F0.6

---

## Fase 1 — Modelo de dominio y contratos

### F1.1 — Modelar fuentes informativas

**Descripción:** Crear entidades y value objects para fuentes, orientación, tipo, región, país, idioma y estado de aprobación. La orientación editorial debe quedar separada del alcance geográfico y del tipo de fuente.

**Criterios de aceptación:**

- [ ] La orientación admite izquierda, centroizquierda, centro, centroderecha, derecha y sin clasificar.
- [ ] El tipo distingue medio, agencia y fuente primaria.
- [ ] Región, país e idioma se modelan por separado.
- [ ] Cada fuente tiene ID estable, estado activo y fecha de revisión.
- [ ] Existen pruebas de invariantes y serialización.

**Estimación:** M  
**Dependencias:** F0.1

### F1.2 — Modelar artículos y evidencias

**Descripción:** Crear contratos para artículos, fragmentos, declaraciones, procedencia y calidad de evidencia. Debe distinguir cuerpo extraído, resumen RSS, snippet web y documento primario.

**Criterios de aceptación:**

- [ ] Cada artículo conserva fuente, URL, título, idioma y fecha cuando exista.
- [ ] El nivel de evidencia identifica contenido completo o parcial.
- [ ] Las declaraciones conservan atribución y referencia de origen.
- [ ] Los cuerpos completos no forman parte de los contratos persistibles.
- [ ] Existen pruebas de construcción y validación.

**Estimación:** M  
**Dependencias:** F1.1

### F1.3 — Modelar resultados editoriales

**Descripción:** Definir resultados estructurados para triangulación, reescritura, feed y explicación contextual. Los contratos deben expresar incertidumbre, cobertura parcial y asimetría sin afirmar verificación de hechos.

**Criterios de aceptación:**

- [ ] `TriangulationResult` incluye coincidencias, divergencias, resumen, fuentes y advertencias.
- [ ] `RewriteResult` incluye texto neutral y cambios justificados.
- [ ] `ContextResult` separa contexto factual y cobertura mediática.
- [ ] Las advertencias incluyen evidencia insuficiente y cobertura asimétrica.
- [ ] Existen pruebas de todos los estados válidos.

**Estimación:** M  
**Dependencias:** F1.2

### F1.4 — Definir puertos del dominio

**Descripción:** Crear interfaces para repositorios de fuentes, caché, RSS, extracción de artículos, búsqueda web y generación editorial. La IA debe exponerse mediante un puerto neutral al proveedor, al SDK y al modelo seleccionado.

**Criterios de aceptación:**

- [ ] Los puertos no importan SDKs ni tipos de `apps/*`.
- [ ] Todas las operaciones externas devuelven el contrato `Result` existente.
- [ ] Los puertos aceptan cancelación y límites cuando corresponda.
- [ ] El puerto de IA recibe un identificador de proveedor/modelo y capacidades requeridas.
- [ ] Existen dobles de prueba para cada puerto.

**Estimación:** M  
**Dependencias:** F1.1, F1.2, F1.3

### F1.5 — Modelar proveedores y modelos de IA

**Descripción:** Crear contratos para proveedores, modelos, campos de credenciales, capacidades y selección activa. Un modelo debe ser un descriptor configurable; sólo un proveedor con protocolo diferente requiere un nuevo adaptador de servicio.

**Criterios de aceptación:**

- [ ] `AiProviderDefinition` declara ID, nombre y esquema de credenciales requerido.
- [ ] `AiModelDefinition` declara proveedor, ID remoto y capacidades compatibles.
- [ ] Las capacidades incluyen structured outputs, web search y niveles de razonamiento.
- [ ] La selección activa referencia proveedor y modelo sin importar tipos de infraestructura.
- [ ] Un modelo incompatible no puede satisfacer un caso de uso que exige otra capacidad.
- [ ] Existen pruebas de compatibilidad y selección.

**Estimación:** M  
**Dependencias:** F1.4

---

## Fase 2 — Configuración y acceso local

### F2.1 — Crear el catálogo inicial de fuentes

**Descripción:** Crear una configuración versionada con las fuentes argentinas e internacionales iniciales y sus modos RSS o búsqueda. Las fuentes latinoamericanas no conocidas deben poder incorporarse luego como candidatas sin orientación automática.

**Criterios de aceptación:**

- [ ] Cada fuente satisface el modelo de dominio.
- [ ] Se incluyen fuentes de distintas orientaciones argentinas.
- [ ] Reuters, AP, AFP y BBC Mundo se modelan por tipo y región, no como orientación neutral implícita.
- [ ] Cada RSS incluido tiene una URL explícita o queda marcado como search-only.
- [ ] Los IDs son estables y únicos.

**Estimación:** M  
**Dependencias:** F1.1

### F2.2 — Persistir la configuración efectiva

**Descripción:** Implementar un repositorio JSON que combine el catálogo inicial con overrides locales. Debe permitir recuperar defaults si el archivo local no existe o queda corrupto.

**Criterios de aceptación:**

- [ ] El primer inicio crea una configuración efectiva desde el catálogo inicial.
- [ ] Altas, bajas, cambios y activaciones persisten entre reinicios.
- [ ] Existe una operación para restaurar defaults.
- [ ] La configuración tiene versión para invalidar cachés.
- [ ] Existen pruebas con migración y recuperación.

**Estimación:** M  
**Dependencias:** F0.6, F2.1

### F2.3 — Crear endpoints de configuración

**Descripción:** Exponer lectura y mutaciones de fuentes mediante la API local. Todas las entradas deben validarse nuevamente en backend.

**Criterios de aceptación:**

- [ ] Existen operaciones para listar, crear, editar, activar, desactivar, eliminar y restaurar.
- [ ] Una fuente inválida devuelve un error estructurado.
- [ ] Los IDs predeterminados no pueden colisionar con altas manuales.
- [ ] Cada mutación incrementa la versión de configuración.
- [ ] Existen pruebas HTTP de éxito y error.

**Estimación:** M  
**Dependencias:** F2.2

### F2.4 — Persistir preferencias regionales

**Descripción:** Agregar zona horaria, distribución regional del feed y modo automático o manual a la configuración local. El navegador aportará su zona IANA en modo automático y Buenos Aires será el fallback.

**Criterios de aceptación:**

- [ ] Se acepta una zona IANA válida.
- [ ] El fallback es `America/Argentina/Buenos_Aires`.
- [ ] La distribución predeterminada es 3/2/1 para Argentina, Latinoamérica e internacional.
- [ ] Los cambios persisten e invalidan el feed correspondiente.
- [ ] Existen pruebas de cambio de día según zona horaria.

**Estimación:** M  
**Dependencias:** F2.2

### F2.5 — Validar URLs externas

**Descripción:** Implementar validación SSRF para feeds y artículos configurables antes de realizar solicitudes. Aunque la app sea local, una fuente maliciosa no debe acceder a servicios internos de la máquina.

**Criterios de aceptación:**

- [ ] Sólo se aceptan URLs HTTP y HTTPS.
- [ ] Se bloquean localhost, IP privadas, link-local y rangos reservados.
- [ ] Cada redirección se valida nuevamente.
- [ ] Se limita tamaño de respuesta y cantidad de redirecciones.
- [ ] Existen pruebas para destinos permitidos y bloqueados.

**Estimación:** M  
**Dependencias:** F0.7

### F2.6 — Implementar contraseña y sesión

**Descripción:** Crear autenticación de usuario único mediante hash Argon2id y sesión firmada en cookie. No debe existir registro de usuarios ni almacenamiento de contraseñas en texto plano.

**Criterios de aceptación:**

- [ ] El hash de contraseña se obtiene desde una variable de entorno.
- [ ] La cookie es `HttpOnly`, `SameSite=Lax` y `Secure` cuando se usa HTTPS.
- [ ] La sesión expira a los 7 días y puede cerrarse manualmente.
- [ ] La comparación de credenciales no filtra diferencias temporales evidentes.
- [ ] Existen pruebas de login, expiración y logout.

**Estimación:** M  
**Dependencias:** F0.5

### F2.7 — Proteger páginas y endpoints

**Descripción:** Aplicar autorización centralizada a la UI y a todas las operaciones backend excepto health y login. El rate limit de login debe funcionar en memoria porque la aplicación es de usuario único y ejecución local.

**Criterios de aceptación:**

- [ ] Una sesión ausente o inválida no accede a datos ni acciones.
- [ ] El login limita a 5 intentos fallidos cada 15 minutos.
- [ ] Las mutaciones validan origen además de la cookie.
- [ ] El endpoint health no revela configuración sensible.
- [ ] Existen pruebas de rutas públicas y protegidas.

**Estimación:** M  
**Dependencias:** F2.6

### F2.8 — Crear el catálogo de proveedores y modelos

**Descripción:** Crear un catálogo local versionado con proveedores, modelos conocidos, campos de credenciales y capacidades técnicas. El catálogo inicial debe incluir OpenAI y sus modelos configurables sin convertir ningún ID concreto en una dependencia del dominio.

**Criterios de aceptación:**

- [ ] El catálogo inicial define OpenAI y el campo secreto requerido para su API key.
- [ ] Incluye `gpt-5.6-terra`, `gpt-5.6-sol` y `gpt-5.6-luna` como datos editables o actualizables.
- [ ] Cada modelo declara structured outputs, web search, razonamiento y estado de compatibilidad.
- [ ] La selección activa persiste como par proveedor/modelo.
- [ ] El archivo de configuración sólo contiene referencias opacas a credenciales, nunca sus valores.
- [ ] El catálogo tiene versión y pruebas de migración o recuperación de defaults.

**Estimación:** M  
**Dependencias:** F0.6, F1.5

### F2.9 — Implementar el adaptador de OpenAI

**Descripción:** Implementar el puerto genérico de IA con OpenAI Responses API, resolviendo la credencial desde la bóveda local. El adaptador debe encapsular generación estructurada, web search, listado de modelos y consumo para que los casos de uso no conozcan el SDK ni IDs concretos.

**Criterios de aceptación:**

- [ ] Implementa todas las operaciones definidas por el puerto genérico de IA.
- [ ] Obtiene la API key mediante una referencia de la bóveda y nunca desde el frontend.
- [ ] Soporta structured outputs y web search cuando el modelo seleccionado declara esas capacidades.
- [ ] Lista los modelos accesibles mediante la API de OpenAI.
- [ ] Normaliza timeouts, errores, rechazo, cancelación y métricas de uso.
- [ ] Permite probar una credencial sin persistir contenido de la solicitud.
- [ ] Tiene pruebas con el cliente de OpenAI simulado y la bóveda en memoria.

**Estimación:** L  
**Dependencias:** F0.7, F0.8, F1.5, F2.8

### F2.10 — Sincronizar los modelos accesibles

**Descripción:** Cruzar el catálogo local de capacidades con los IDs devueltos por la API del proveedor. Esto permite mostrar disponibilidad real sin asumir capacidades que el endpoint remoto no informa.

**Criterios de aceptación:**

- [ ] Una sincronización manual consulta los modelos accesibles con la credencial guardada.
- [ ] Los modelos conocidos quedan marcados como disponibles o no disponibles sin perder sus capacidades locales.
- [ ] Los IDs remotos desconocidos son visibles, pero no seleccionables hasta mapear sus capacidades.
- [ ] La última sincronización válida se conserva localmente con fecha y proveedor.
- [ ] Un fallo remoto mantiene el último estado válido y devuelve una advertencia.
- [ ] Existen pruebas de altas, bajas, IDs desconocidos y error del proveedor.

**Estimación:** M  
**Dependencias:** F2.9

### F2.11 — Crear endpoints de configuración de IA

**Descripción:** Exponer operaciones protegidas para consultar proveedores, administrar credenciales, sincronizar modelos y elegir la selección activa. Las respuestas deben describir el estado de una credencial sin revelar jamás su valor completo.

**Criterios de aceptación:**

- [ ] Permite listar proveedores, campos requeridos, modelos, capacidades y selección activa.
- [ ] Permite guardar, reemplazar y eliminar una credencial en la bóveda local.
- [ ] Permite probar la conexión y sincronizar modelos bajo demanda.
- [ ] Sólo permite seleccionar modelos disponibles y compatibles con las capacidades requeridas por la app.
- [ ] Ningún endpoint devuelve el valor de una credencial guardada ni lo escribe en logs.
- [ ] Cambiar proveedor o modelo persiste la selección e invalida el feed dependiente.
- [ ] Existen pruebas HTTP de éxito, incompatibilidad, credencial ausente y error remoto.

**Estimación:** M  
**Dependencias:** F2.7, F2.8, F2.9, F2.10

---

## Fase 3 — Descubrimiento y preparación de noticias

### F3.1 — Consumir un feed RSS

**Descripción:** Implementar el adaptador que obtiene un RSS o Atom y extrae sus últimos N artículos. Las entradas inválidas deben omitirse sin perder el resto del feed.

**Criterios de aceptación:**

- [ ] Devuelve título, resumen, enlace, fuente y fecha cuando exista.
- [ ] Respeta un límite configurable.
- [ ] Maneja RSS, Atom, XML inválido y timeout.
- [ ] Asigna nivel de evidencia `rss_summary`.
- [ ] Tiene fixtures de al menos dos medios con formatos distintos.

**Estimación:** M  
**Dependencias:** F1.2, F1.4, F2.5

### F3.2 — Agregar múltiples feeds

**Descripción:** Consultar en paralelo los RSS activos y consolidar resultados con éxito parcial. Una fuente caída no debe impedir que las demás contribuyan.

**Criterios de aceptación:**

- [ ] Se respeta una concurrencia máxima configurable.
- [ ] Cada artículo conserva su fuente de origen.
- [ ] La respuesta identifica feeds fallidos.
- [ ] La cancelación detiene solicitudes pendientes.
- [ ] Existen pruebas de éxito total, parcial y nulo.

**Estimación:** M  
**Dependencias:** F2.2, F3.1

### F3.3 — Canonicalizar y deduplicar artículos

**Descripción:** Normalizar URLs, títulos y fechas para detectar republicaciones y duplicados. La deduplicación debe conservar todas las atribuciones relevantes cuando varias entradas apuntan al mismo contenido.

**Criterios de aceptación:**

- [ ] Elimina parámetros de tracking configurables.
- [ ] Deduplica por URL canónica y similitud fuerte de título.
- [ ] No mezcla artículos distintos que sólo comparten actores políticos.
- [ ] Conserva referencias a las entradas fusionadas.
- [ ] Existen pruebas con duplicados y falsos positivos.

**Estimación:** M  
**Dependencias:** F3.2

### F3.4 — Extraer el cuerpo de un artículo

**Descripción:** Descargar HTML seguro y extraer título, autor, fecha y texto principal mediante una librería tipo Readability. Cuando la extracción falle, debe conservarse el resumen RSS o snippet sin intentar evadir paywalls.

**Criterios de aceptación:**

- [ ] Sólo procesa URLs aprobadas por la validación SSRF.
- [ ] Limita bytes descargados, tiempo y tipo de contenido.
- [ ] Elimina scripts, navegación y contenido no editorial.
- [ ] Marca el resultado como `full_text` o mantiene evidencia parcial.
- [ ] El cuerpo completo sólo vive en memoria durante la operación.
- [ ] Tiene fixtures de extracción exitosa, paywall y HTML inválido.

**Estimación:** L  
**Dependencias:** F2.5, F3.3

### F3.5 — Buscar noticias con el proveedor de IA

**Descripción:** Buscar cobertura mediante el puerto genérico de IA cuando RSS resulte insuficiente. El proveedor y modelo activos deben soportar búsqueda web, recuperar las fuentes consultadas y respetar límites de dominio.

**Criterios de aceptación:**

- [ ] Resuelve el proveedor y modelo activos desde la configuración.
- [ ] Rechaza la operación con un error accionable si falta configuración o capacidad de web search.
- [ ] Puede aplicar dominios permitidos o bloqueados.
- [ ] Recupera todas las URLs informadas por el adaptador del proveedor.
- [ ] Convierte resultados y citas al contrato de evidencias.
- [ ] Registra que la evidencia proviene de búsqueda web.
- [ ] Tiene pruebas con un proveedor simulado, sin depender del SDK de OpenAI.

**Estimación:** M  
**Dependencias:** F1.4, F1.5, F2.9, F2.11

### F3.6 — Filtrar artículos por tema

**Descripción:** Implementar matching inicial entre una consulta y títulos o resúmenes RSS antes de usar IA. Debe priorizar precisión y evitar enviar material evidentemente irrelevante.

**Criterios de aceptación:**

- [ ] Normaliza mayúsculas, acentos y puntuación.
- [ ] Ordena candidatos con una puntuación determinista.
- [ ] Aplica límite y umbral configurables.
- [ ] Contempla coincidencias de entidades y frases del titular.
- [ ] Existen pruebas con coincidencias y falsos positivos.

**Estimación:** M  
**Dependencias:** F3.3

### F3.7 — Orquestar el descubrimiento híbrido

**Descripción:** Combinar RSS, matching, extracción local y búsqueda web para obtener evidencia diversa sobre un tema. El fallback web sólo debe ejecutarse si RSS no alcanza la cantidad o diversidad mínima.

**Criterios de aceptación:**

- [ ] Intenta obtener entre 3 y 6 artículos por tema.
- [ ] Prioriza al menos 3 medios y 2 orientaciones cuando existan.
- [ ] Limita a 2 artículos por medio.
- [ ] Informa cobertura parcial y fuentes fallidas.
- [ ] No llama a web search cuando RSS ya es suficiente.
- [ ] Tiene pruebas de los tres caminos principales.

**Estimación:** L  
**Dependencias:** F3.4, F3.5, F3.6

### F3.8 — Registrar fuentes descubiertas como candidatas

**Descripción:** Detectar dominios periodísticos nuevos obtenidos por búsqueda y guardarlos como candidatos sin clasificación ideológica. Ningún candidato debe modificar silenciosamente la lista activa.

**Criterios de aceptación:**

- [ ] Los candidatos se deduplican por dominio.
- [ ] Su orientación inicial es `sin_clasificar`.
- [ ] Permanecen inactivos hasta aprobación manual.
- [ ] Guardan primera y última fecha de aparición.
- [ ] Existen pruebas de alta y redescubrimiento.

**Estimación:** M  
**Dependencias:** F2.2, F3.5

---

## Fase 4 — Motor de triangulación backend

### F4.1 — Centralizar el prompt de neutralidad

**Descripción:** Convertir las reglas editoriales del PRD y las decisiones confirmadas en una plantilla versionada. Debe evitar tanto la toma de partido como el falso equilibrio.

**Criterios de aceptación:**

- [ ] Incluye identificación de hechos, declaraciones y contradicciones.
- [ ] Prohíbe inventar datos o completar información ausente.
- [ ] Exige visibilidad de posiciones materiales sin igualar su estatus factual.
- [ ] Usa “cobertura asimétrica” sin atribuir intención.
- [ ] La versión del prompt es accesible para caché y evaluaciones.

**Estimación:** S  
**Dependencias:** F1.3

### F4.2 — Definir la salida estructurada de triangulación

**Descripción:** Crear el JSON Schema que debe devolver el proveedor de IA para coincidencias, divergencias, resumen y advertencias. El schema debe conservar IDs de evidencia para comprobar atribuciones.

**Criterios de aceptación:**

- [ ] Cada coincidencia referencia evidencias de más de una fuente cuando corresponda.
- [ ] Cada divergencia identifica medio, afirmación y contraste.
- [ ] El resumen diferencia afirmación corroborada de declaración atribuida.
- [ ] La salida incluye cobertura por región y orientación.
- [ ] Respuestas fuera del schema son rechazadas.
- [ ] Existen pruebas de parseo válido e inválido.

**Estimación:** M  
**Dependencias:** F4.1

### F4.3 — Implementar el analizador de triangulación

**Descripción:** Enviar evidencias preparadas mediante el puerto genérico de IA y validar la respuesta estructurada. El servicio debe controlar tamaño, razonamiento y cantidad de salida sin persistir cuerpos completos ni conocer el SDK del proveedor.

**Criterios de aceptación:**

- [ ] Resuelve la selección activa y exige soporte de structured outputs.
- [ ] Envía cada evidencia con un ID estable y su procedencia.
- [ ] Valida la respuesta contra el schema del dominio.
- [ ] No acepta URLs o fuentes inexistentes en la entrada.
- [ ] Maneja timeout, rechazo y respuesta incompleta.
- [ ] Tiene pruebas con un proveedor de IA simulado.

**Estimación:** M  
**Dependencias:** F2.9, F2.11, F4.2

### F4.4 — Verificar atribuciones del resultado

**Descripción:** Implementar una validación posterior que compruebe que fuentes y evidencias citadas existen y respaldan la sección correspondiente. Los resultados inconsistentes deben degradarse a advertencia o rechazarse según gravedad.

**Criterios de aceptación:**

- [ ] Ninguna fuente inventada llega al frontend.
- [ ] Una evidencia ausente invalida la afirmación asociada.
- [ ] Se detectan divergencias atribuidas al medio equivocado.
- [ ] Los fallos críticos producen un error controlado.
- [ ] Existen pruebas de atribución correcta e incorrecta.

**Estimación:** M  
**Dependencias:** F4.3

### F4.5 — Crear el caso de uso de triangulación

**Descripción:** Orquestar descubrimiento híbrido, análisis y verificación en un caso de uso de dominio. Debe devolver advertencias útiles cuando no exista diversidad suficiente.

**Criterios de aceptación:**

- [ ] No llama a IA cuando no hay evidencia mínima.
- [ ] Devuelve resumen, coincidencias, divergencias, fuentes y advertencias.
- [ ] Identifica cobertura de un único medio u orientación.
- [ ] Conserva resultados válidos ante fallos parciales de fuentes.
- [ ] Tiene pruebas de integración con todos los puertos simulados.

**Estimación:** M  
**Dependencias:** F3.7, F4.4

### F4.6 — Crear el endpoint de triangulación

**Descripción:** Exponer el caso de uso mediante un endpoint protegido de la API local. Debe validar el tema, admitir cancelación y devolver errores estructurados.

**Criterios de aceptación:**

- [ ] Rechaza consultas vacías o demasiado extensas.
- [ ] Devuelve `TriangulationResult` en caso exitoso.
- [ ] Diferencia falta de cobertura, timeout y error de proveedor.
- [ ] No expone prompts, claves ni cuerpos completos.
- [ ] Tiene pruebas HTTP de éxito y error.

**Estimación:** M  
**Dependencias:** F2.7, F4.5

---

## Fase 5 — Reescritura neutral backend

### F5.1 — Definir el prompt de reescritura

**Descripción:** Crear el prompt y schema para neutralizar una noticia pegada y explicar las modificaciones. Debe conservar hechos y posiciones del original sin agregar información externa.

**Criterios de aceptación:**

- [ ] Elimina o suaviza lenguaje valorativo y atribución de intenciones.
- [ ] Conserva nombres, fechas, cifras y citas atribuidas.
- [ ] Mantiene visibilidad de todas las posiciones materiales.
- [ ] Cada cambio incluye tipo, fragmento y justificación.
- [ ] La salida es validable mediante structured outputs.

**Estimación:** M  
**Dependencias:** F4.1

### F5.2 — Implementar el caso de uso de reescritura

**Descripción:** Enviar el texto mediante el puerto genérico de IA y validar el resultado contra el schema definido. Debe usar el proveedor y modelo activos, aplicar límites de tamaño y detectar omisiones estructurales de posiciones.

**Criterios de aceptación:**

- [ ] Devuelve texto neutral y lista de cambios.
- [ ] No utiliza web search ni agrega contexto externo.
- [ ] Rechaza respuestas fuera del schema.
- [ ] Maneja timeout, rechazo y cancelación.
- [ ] Tiene pruebas con texto sesgado, texto neutral y múltiples posiciones.

**Estimación:** M  
**Dependencias:** F2.9, F2.11, F5.1

### F5.3 — Crear el endpoint de reescritura

**Descripción:** Exponer la reescritura mediante un endpoint protegido e independiente. La entrada debe limitarse antes de consumir recursos del proveedor de IA.

**Criterios de aceptación:**

- [ ] Rechaza texto vacío y tamaño excesivo.
- [ ] Devuelve `RewriteResult` válido.
- [ ] Distingue error de validación, timeout y proveedor.
- [ ] No registra el texto pegado en logs.
- [ ] Tiene pruebas HTTP de éxito y error.

**Estimación:** S  
**Dependencias:** F2.7, F5.2

---

## Fase 6 — Feed del día backend

### F6.1 — Obtener candidatos del día

**Descripción:** Reunir artículos publicados dentro del día calendario configurado y descartar contenido que no pueda considerarse actual. Se deben priorizar RSS de secciones políticas y filtrar feeds generales.

**Criterios de aceptación:**

- [ ] Usa la zona horaria efectiva de configuración.
- [ ] Procesa hasta 30 entradas recientes por fuente.
- [ ] Excluye artículos fuera de la ventana temporal.
- [ ] Filtra temas ajenos a política en sentido amplio.
- [ ] Tiene pruebas en ambos límites del día.

**Estimación:** M  
**Dependencias:** F2.4, F3.3

### F6.2 — Agrupar titulares por acontecimiento

**Descripción:** Implementar clustering de artículos que describan el mismo acontecimiento político. Debe tolerar encuadres diferentes sin fusionar hechos que sólo comparten actores.

**Criterios de aceptación:**

- [ ] Cada artículo pertenece como máximo a un grupo.
- [ ] Los grupos conservan fuentes, orientaciones y regiones.
- [ ] Los umbrales son configurables y deterministas.
- [ ] Existen fixtures de equivalencia y falsos positivos.
- [ ] El clustering no requiere una llamada de IA por artículo.

**Estimación:** L  
**Dependencias:** F6.1

### F6.3 — Puntuar la relevancia del feed

**Descripción:** Calcular relevancia mediante repetición, diversidad, actualidad y alcance regional. La fórmula debe ser visible y no permitir que duplicados de un medio dominen el ranking.

**Criterios de aceptación:**

- [ ] La puntuación se desglosa por señal.
- [ ] Se limita a 6 temas.
- [ ] Aplica distribución objetivo 3/2/1 con fallback por relevancia.
- [ ] Los empates tienen resolución determinista.
- [ ] Tiene pruebas de ranking y reemplazo regional.

**Estimación:** M  
**Dependencias:** F6.2

### F6.4 — Triangular temas del feed

**Descripción:** Ejecutar el flujo de triangulación sobre los temas seleccionados con concurrencia máxima de dos. Un tema fallido no debe impedir devolver los demás.

**Criterios de aceptación:**

- [ ] Se reutilizan artículos del cluster como evidencia inicial.
- [ ] Se ejecuta fallback web sólo cuando falta diversidad.
- [ ] Se respetan límites de concurrencia y cancelación.
- [ ] Los errores quedan asociados a su tema.
- [ ] Tiene pruebas de éxito parcial.

**Estimación:** L  
**Dependencias:** F4.5, F6.3

### F6.5 — Implementar el caché local del feed

**Descripción:** Persistir el feed derivado en JSON sin guardar cuerpos completos de artículos. La clave debe depender de día, zona horaria, fuentes, modelo y versión del prompt.

**Criterios de aceptación:**

- [ ] El feed es fresco durante 3 horas.
- [ ] Puede servirse como stale hasta 24 horas con advertencia.
- [ ] Un fallo de escritura no destruye el último resultado válido.
- [ ] Cambiar fuentes, modelo o prompt invalida el caché.
- [ ] Existen pruebas con reloj controlado.

**Estimación:** M  
**Dependencias:** F0.6, F4.1, F6.4

### F6.6 — Orquestar la actualización bajo demanda

**Descripción:** Al iniciar la app o consultar el feed, devolver el caché disponible y regenerar cuando esté vencido. Como la aplicación se apaga manualmente, no debe depender de cron ni procesos siempre activos.

**Criterios de aceptación:**

- [ ] Un feed fresco se devuelve sin regeneración.
- [ ] Un feed stale se devuelve inmediatamente y dispara actualización.
- [ ] Sin caché se informa progreso de generación.
- [ ] Sólo puede existir una regeneración simultánea.
- [ ] El refresco manual tiene cooldown de 15 minutos.
- [ ] Reiniciar la aplicación conserva el estado cacheado.

**Estimación:** M  
**Dependencias:** F6.5

### F6.7 — Crear el endpoint del feed

**Descripción:** Exponer el feed, su estado de caché y el progreso de actualización mediante endpoints protegidos. El frontend debe poder consultar sin iniciar regeneraciones duplicadas.

**Criterios de aceptación:**

- [ ] Devuelve temas ordenados, fecha de generación y expiración.
- [ ] Informa estados fresh, stale, generating, partial y failed.
- [ ] Permite solicitar refresco manual respetando cooldown.
- [ ] Los errores siguen el contrato compartido.
- [ ] Tiene pruebas HTTP del ciclo completo.

**Estimación:** M  
**Dependencias:** F2.7, F6.6

---

## Fase 7 — Explicador de contexto backend

### F7.1 — Clasificar fuentes primarias

**Descripción:** Crear reglas y allowlists para distinguir documentos oficiales, legislación, organismos, comunicados y declaraciones directas. Una clasificación dudosa debe conservar una advertencia y nunca convertirse en oficial por decisión exclusiva de la IA.

**Criterios de aceptación:**

- [ ] Existen niveles primaria verificada, declaración directa, secundaria y candidata.
- [ ] La clasificación conserva dominio, emisor y evidencia.
- [ ] Los casos ambiguos quedan con confianza baja.
- [ ] Las allowlists pueden editarse en configuración.
- [ ] Tiene fixtures positivos y negativos.

**Estimación:** L  
**Dependencias:** F1.1, F2.2

### F7.2 — Buscar fuentes primarias con el proveedor de IA

**Descripción:** Usar web search para encontrar textos oficiales y declaraciones directas sobre el fenómeno solicitado. Las búsquedas deben priorizar dominios aprobados y conservar todas las URLs consultadas.

**Criterios de aceptación:**

- [ ] Genera consultas según fenómeno, país e idioma local.
- [ ] Puede limitar búsqueda a dominios oficiales.
- [ ] Separa resultados primarios de cobertura periodística.
- [ ] Registra fuentes y citas retornadas por el adaptador activo.
- [ ] Tiene pruebas para ley, organización y conflicto.

**Estimación:** M  
**Dependencias:** F3.5, F7.1

### F7.3 — Definir el prompt de contexto factual

**Descripción:** Crear el prompt y schema para explicar origen, objetivo, actores, funcionamiento y estado actual. Debe señalar explícitamente las secciones que no tengan evidencia primaria suficiente.

**Criterios de aceptación:**

- [ ] La salida contiene las cinco secciones del PRD.
- [ ] Cada afirmación relevante referencia evidencia.
- [ ] No mezcla opiniones periodísticas con contexto factual.
- [ ] Distingue hechos actuales de antecedentes.
- [ ] Admite evidencia secundaria sólo con etiqueta visible.

**Estimación:** M  
**Dependencias:** F4.1, F7.1

### F7.4 — Implementar el caso de uso de contexto

**Descripción:** Combinar búsqueda primaria, clasificación y generación estructurada del briefing factual mediante el puerto genérico de IA. La respuesta debe conservar advertencias de evidencia insuficiente o dudosa.

**Criterios de aceptación:**

- [ ] Devuelve las cinco secciones con sus fuentes.
- [ ] Sólo usa fuentes presentes en la evidencia recibida.
- [ ] No presenta fuentes secundarias como oficiales.
- [ ] Maneja falta total o parcial de fuentes primarias.
- [ ] Tiene pruebas con un proveedor de IA simulado.

**Estimación:** M  
**Dependencias:** F2.9, F2.11, F7.2, F7.3

### F7.5 — Combinar contexto y cobertura mediática

**Descripción:** Ejecutar el briefing factual y reutilizar la triangulación para producir la segunda capa. Ambas capas deben compartir el fenómeno, pero mantener fuentes y conclusiones separadas.

**Criterios de aceptación:**

- [ ] La capa factual prioriza fuentes primarias.
- [ ] La capa mediática utiliza el motor de triangulación.
- [ ] Una capa puede devolverse aunque la otra falle.
- [ ] Las fuentes quedan agrupadas por capa.
- [ ] Tiene pruebas de éxito completo y parcial.

**Estimación:** M  
**Dependencias:** F4.5, F7.4

### F7.6 — Crear el endpoint de explicación

**Descripción:** Exponer el resultado combinado mediante un endpoint protegido. Debe validar el término y representar claramente los resultados parciales.

**Criterios de aceptación:**

- [ ] Rechaza término vacío o demasiado extenso.
- [ ] Devuelve contexto, cobertura, fuentes y advertencias por separado.
- [ ] Usa la configuración efectiva de fuentes y región.
- [ ] No expone prompts ni credenciales.
- [ ] Tiene pruebas HTTP de éxito y error.

**Estimación:** M  
**Dependencias:** F2.7, F7.5

---

## Fase 8 — Frontend

### F8.1 — Crear el shell y la navegación

**Descripción:** Construir el layout principal con Feed, Buscar tema, Pegar noticia, Explicar esto y Configuración. La navegación debe funcionar con rutas reales, teclado y recarga directa.

**Criterios de aceptación:**

- [ ] Las cinco secciones tienen rutas diferenciadas.
- [ ] La sección activa se identifica visual y semánticamente.
- [ ] La navegación funciona con teclado.
- [ ] El layout se adapta a móvil y escritorio.

**Estimación:** M  
**Dependencias:** F0.3, F0.4

### F8.2 — Crear el cliente de API

**Descripción:** Centralizar requests, errores, cancelación y estados asíncronos del frontend. Debe utilizar el proxy local en desarrollo y el mismo origen en producción.

**Criterios de aceptación:**

- [ ] Incluye credenciales de sesión sin exponer secretos.
- [ ] Traduce errores backend a mensajes utilizables.
- [ ] Permite cancelar operaciones largas.
- [ ] Evita doble envío accidental.
- [ ] Tiene pruebas de éxito, error y cancelación.

**Estimación:** M  
**Dependencias:** F0.2, F0.3

### F8.3 — Crear la pantalla de login

**Descripción:** Implementar el acceso por contraseña y el cierre de sesión. La UI no debe revelar si el fallo corresponde a contraseña, sesión o rate limit más allá de lo necesario.

**Criterios de aceptación:**

- [ ] Una sesión válida redirige a la aplicación.
- [ ] Una contraseña inválida muestra un error genérico.
- [ ] El estado de rate limit se comunica sin filtrar información sensible.
- [ ] Existe una acción visible de logout.
- [ ] Tiene pruebas de los flujos principales.

**Estimación:** M  
**Dependencias:** F2.7, F8.2

### F8.4 — Crear el indicador de fuentes

**Descripción:** Implementar un componente reutilizable que muestre medios, tipo de evidencia y enlaces originales. Las citas provenientes de web search deben ser visibles y clickeables.

**Criterios de aceptación:**

- [ ] Muestra nombre, dominio y nivel de evidencia.
- [ ] Los enlaces externos usan atributos seguros.
- [ ] No renderiza duplicados.
- [ ] Distingue RSS, cuerpo completo, snippet y fuente primaria.
- [ ] Es accesible con teclado y lector de pantalla.

**Estimación:** S  
**Dependencias:** F1.2, F8.1

### F8.5 — Crear el resultado de triangulación

**Descripción:** Presentar resumen, coincidencias, divergencias atribuidas, cobertura y advertencias en bloques diferenciados. Debe evitar cualquier indicación visual que convierta coincidencia en fact-checking.

**Criterios de aceptación:**

- [ ] Separa coincidencias de divergencias.
- [ ] Cada divergencia identifica su fuente.
- [ ] Integra el indicador de fuentes.
- [ ] Muestra cobertura parcial y asimétrica sin atribuir intención.
- [ ] Soporta resultados vacíos o parciales.

**Estimación:** M  
**Dependencias:** F8.4

### F8.6 — Crear la pantalla de búsqueda

**Descripción:** Construir el formulario de tema y conectarlo al endpoint de triangulación. La consulta debe conservarse durante carga, error y presentación del resultado.

**Criterios de aceptación:**

- [ ] Valida texto vacío y longitud máxima.
- [ ] Muestra progreso y permite cancelar.
- [ ] Renderiza el resultado estructurado.
- [ ] Permite corregir y reenviar la consulta.
- [ ] Comunica falta de cobertura suficiente.

**Estimación:** M  
**Dependencias:** F4.6, F8.2, F8.5

### F8.7 — Crear la pantalla de reescritura

**Descripción:** Construir la entrada de texto, resultado neutral y auditoría de cambios. El original debe permanecer visible para facilitar comparación.

**Criterios de aceptación:**

- [ ] Valida texto vacío y límite de caracteres.
- [ ] Muestra original y reescritura sin perder formato básico.
- [ ] Lista cambios con tipo y justificación.
- [ ] Permite copiar el resultado.
- [ ] Maneja cancelación, timeout y error.

**Estimación:** M  
**Dependencias:** F5.3, F8.2

### F8.8 — Crear la tarjeta del feed

**Descripción:** Implementar una tarjeta reutilizable para cada tema diario, priorizando el resumen y permitiendo expandir evidencia. Debe representar estado parcial, stale o fallido sin bloquear el resto.

**Criterios de aceptación:**

- [ ] Muestra título, resumen y hora de actualización.
- [ ] Permite acceder a coincidencias, divergencias y fuentes.
- [ ] Identifica contenido stale o parcial.
- [ ] Funciona con teclado y lector de pantalla.

**Estimación:** M  
**Dependencias:** F8.5

### F8.9 — Crear la pantalla del feed

**Descripción:** Consumir el endpoint diario y mostrar temas conforme estén disponibles. La primera generación sin caché debe comunicar progreso y no presentar una pantalla congelada.

**Criterios de aceptación:**

- [ ] Muestra temas en el orden recibido.
- [ ] Informa estado y antigüedad del caché.
- [ ] Permite refresco manual respetando cooldown.
- [ ] Un tema fallido no oculta los exitosos.
- [ ] Actualiza la vista al finalizar una regeneración.

**Estimación:** M  
**Dependencias:** F6.7, F8.2, F8.8

### F8.10 — Crear la configuración de fuentes

**Descripción:** Construir la interfaz para administrar fuentes activas y aprobar candidatos descubiertos. La orientación editorial siempre debe confirmarse manualmente.

**Criterios de aceptación:**

- [ ] Permite crear, editar, activar, desactivar y eliminar fuentes.
- [ ] Permite aprobar o descartar candidatos.
- [ ] Valida URL, tipo, orientación, región, país e idioma.
- [ ] Permite restaurar defaults.
- [ ] Confirma acciones destructivas.
- [ ] Refleja inmediatamente el estado persistido.

**Estimación:** L  
**Dependencias:** F2.3, F3.8, F8.2

### F8.11 — Crear la configuración regional

**Descripción:** Permitir seleccionar zona horaria automática o manual y ajustar la mezcla regional del feed. La zona automática debe usar la zona IANA reportada por el navegador.

**Criterios de aceptación:**

- [ ] Muestra la zona detectada antes de guardarla.
- [ ] Permite elegir una zona IANA manual.
- [ ] Permite ajustar la distribución regional dentro del máximo de 6 temas.
- [ ] Los cambios invalidan y regeneran el feed de forma controlada.

**Estimación:** M  
**Dependencias:** F2.4, F8.2, F8.10

### F8.12 — Crear la pantalla de explicación

**Descripción:** Construir el formulario y el resultado de dos capas para fenómenos políticos o sociales. El contexto factual debe aparecer antes que la cobertura mediática y conservar fuentes separadas.

**Criterios de aceptación:**

- [ ] Explica la diferencia entre esta función y Buscar tema.
- [ ] La capa factual contiene las cinco secciones requeridas.
- [ ] La cobertura reutiliza el resultado de triangulación.
- [ ] Las fuentes aparecen agrupadas por capa.
- [ ] Muestra fallos parciales sin mezclar conclusiones.

**Estimación:** M  
**Dependencias:** F7.6, F8.2, F8.5

### F8.13 — Configurar proveedores de IA

**Descripción:** Construir la interfaz para consultar proveedores y administrar sus credenciales según el schema entregado por backend. La UI debe informar si una credencial existe y permitir reemplazarla o eliminarla sin precargar ni revelar su valor.

**Criterios de aceptación:**

- [ ] Lista los proveedores y renderiza dinámicamente sus campos de credenciales.
- [ ] Permite guardar, reemplazar y eliminar credenciales con confirmación.
- [ ] Una credencial guardada aparece como configurada y enmascarada, sin exponer su valor.
- [ ] Permite probar la conexión y muestra un resultado accionable.
- [ ] Los secretos no quedan en URL, almacenamiento del navegador ni logs del frontend.
- [ ] Maneja proveedor no configurado, error de validación y error remoto.

**Estimación:** M  
**Dependencias:** F2.11, F8.2

### F8.14 — Seleccionar el modelo de IA

**Descripción:** Crear la interfaz para sincronizar y seleccionar el modelo activo entre los accesibles para cada proveedor configurado. Debe mostrar capacidades y estado de compatibilidad para evitar selecciones que rompan funcionalidades de la app.

**Criterios de aceptación:**

- [ ] Muestra proveedor, ID de modelo, disponibilidad, capacidades y fecha de sincronización.
- [ ] Permite sincronizar modelos bajo demanda y conserva el último listado ante errores.
- [ ] Sólo habilita modelos compatibles con las capacidades requeridas.
- [ ] Persiste la selección y destaca claramente el modelo activo.
- [ ] Explica por qué un modelo desconocido, no disponible o incompatible no puede seleccionarse.
- [ ] Advierte que cambiar el modelo invalida resultados cacheados dependientes.

**Estimación:** M  
**Dependencias:** F2.11, F8.2, F8.13

### F8.15 — Ajustar accesibilidad y responsive

**Descripción:** Revisar todas las pantallas completas para corregir jerarquía semántica, foco, contraste y comportamiento responsive. Las operaciones largas deben anunciar sus cambios de estado.

**Criterios de aceptación:**

- [ ] No existen desbordes en móvil ni escritorio.
- [ ] Todos los recorridos funcionan sólo con teclado.
- [ ] Carga, errores y actualizaciones se anuncian mediante regiones accesibles.
- [ ] Formularios y botones tienen nombres accesibles.
- [ ] Una auditoría automatizada no reporta errores críticos.

**Estimación:** L  
**Dependencias:** F8.3, F8.6, F8.7, F8.9, F8.10, F8.11, F8.12, F8.13, F8.14

---

## Fase 9 — Calidad editorial y validación

### F9.1 — Crear el corpus de noticias polémicas

**Descripción:** Preparar diez casos reproducibles con fuentes de orientaciones diferentes y evidencia permitida para pruebas. El corpus debe cubrir política argentina, latinoamericana e internacional.

**Criterios de aceptación:**

- [ ] Contiene diez temas variados.
- [ ] Cada caso tiene al menos dos fuentes contrastantes.
- [ ] Guarda URLs, metadatos y fragmentos permitidos, no artículos completos.
- [ ] Incluye expectativas estructurales y riesgos editoriales conocidos.

**Estimación:** M  
**Dependencias:** F4.5

### F9.2 — Implementar la rúbrica editorial

**Descripción:** Formalizar una evaluación de fidelidad, atribución, lenguaje, equilibrio e incertidumbre con escala de 0 a 4. Los fallos críticos deben poder reprobar un resultado independientemente del promedio.

**Criterios de aceptación:**

- [ ] La rúbrica tiene cinco dimensiones documentadas.
- [ ] El mínimo es 17/20 y ninguna dimensión puede ser menor a 3.
- [ ] Invención, fuente inexistente, posición omitida o toma de partido son fallos críticos.
- [ ] El formato permite comparar versiones de prompt y modelo.

**Estimación:** M  
**Dependencias:** F9.1

### F9.3 — Comparar modelos configurados

**Descripción:** Ejecutar el corpus con al menos dos modelos disponibles usando el mismo prompt y parámetros equivalentes; inicialmente se compararán `gpt-5.6-terra` y `gpt-5.6-sol` si la cuenta tiene acceso. Seleccionar el predeterminado según neutralidad, latencia y consumo sin acoplar la evaluación a OpenAI.

**Criterios de aceptación:**

- [ ] Los diez casos se ejecutan con dos selecciones proveedor/modelo configurables.
- [ ] Se comparan rúbrica, duración y unidades de consumo disponibles.
- [ ] La decisión queda documentada con evidencia.
- [ ] Cambiar de proveedor o modelo desde la app no requiere modificar código.

**Estimación:** M  
**Dependencias:** F9.2

### F9.4 — Ajustar el prompt de neutralidad

**Descripción:** Corregir patrones de sesgo residual, omisión o atribución detectados por el corpus. Cada cambio debe incrementar la versión del prompt y volver a ejecutar todos los casos.

**Criterios de aceptación:**

- [ ] Cada ajuste referencia un fallo observado.
- [ ] Al menos 9 de 10 casos alcanzan la rúbrica mínima.
- [ ] No existe ningún fallo crítico.
- [ ] No aparecen regresiones críticas en casos previamente aprobados.

**Estimación:** L  
**Dependencias:** F9.3

### F9.5 — Validar cobertura asimétrica

**Descripción:** Crear casos positivos y negativos para comprobar la señal de cobertura desigual. La salida debe limitarse a observaciones cuantificables sin inferir intención editorial.

**Criterios de aceptación:**

- [ ] La advertencia identifica fuentes consultadas y cobertura encontrada.
- [ ] No utiliza expresiones de omisión intencional.
- [ ] No se activa cuando la muestra es insuficiente para comparar.
- [ ] Backend y frontend representan la misma evidencia.

**Estimación:** M  
**Dependencias:** F4.2, F8.5, F9.2

### F9.6 — Crear el corpus de fenómenos

**Descripción:** Preparar cinco casos para el explicador: ley, movilización, partido, conflicto internacional y fenómeno social. Cada caso debe separar evidencia primaria de cobertura periodística.

**Criterios de aceptación:**

- [ ] Existen cinco tipos distintos de fenómeno.
- [ ] Cada caso incluye fuentes primarias y secundarias cuando están disponibles.
- [ ] Incluye al menos un caso con evidencia primaria incompleta.
- [ ] Las entradas pueden ejecutarse de forma reproducible.

**Estimación:** M  
**Dependencias:** F7.5

### F9.7 — Validar la separación de capas

**Descripción:** Ejecutar los cinco fenómenos y evaluar que contexto factual y cobertura mediática no se contaminen. Deben registrarse y corregirse errores de clasificación o prompt.

**Criterios de aceptación:**

- [ ] Los cinco casos mantienen las capas claramente separadas.
- [ ] Ninguna opinión mediática se presenta como evidencia primaria.
- [ ] Las afirmaciones factuales tienen referencias adecuadas.
- [ ] Las limitaciones de evidencia aparecen explícitamente.

**Estimación:** M  
**Dependencias:** F8.12, F9.6

### F9.8 — Verificar rendimiento y resiliencia

**Descripción:** Medir feed y reescritura con condiciones reproducibles y ajustar límites o concurrencia sin reducir trazabilidad. Deben diferenciarse tiempo de caché, extracción, búsqueda y generación.

**Criterios de aceptación:**

- [ ] Un feed cacheado carga en menos de 2 segundos y siempre debajo de 15 segundos.
- [ ] La reescritura completa apunta a menos de 10 segundos en condiciones normales.
- [ ] La primera generación del feed muestra progreso sin bloquear la UI.
- [ ] Se prueban timeout, RSS caído, artículo inaccesible y error del proveedor de IA.
- [ ] Los límites finales quedan documentados.

**Estimación:** L  
**Dependencias:** F8.7, F8.9, F9.4

### F9.9 — Agregar pruebas end-to-end

**Descripción:** Cubrir los recorridos críticos con servicios externos simulados y almacenamiento temporal. Las pruebas deben detectar roturas entre dominio, API y frontend.

**Criterios de aceptación:**

- [ ] Cubre login y logout.
- [ ] Cubre búsqueda y triangulación.
- [ ] Cubre reescritura.
- [ ] Cubre feed cacheado y regeneración.
- [ ] Cubre explicación de dos capas.
- [ ] Cubre edición y aplicación de fuentes.

**Estimación:** L  
**Dependencias:** F8.15, F9.5, F9.7

### F9.10 — Documentar el arranque local

**Descripción:** Actualizar el README raíz con instalación, variables del sistema, generación del hash de contraseña, configuración In-App de IA, inicio, cierre y recuperación. Debe explicar que apagar el proceso detiene toda actualización automática.

**Criterios de aceptación:**

- [ ] Documenta requisitos de Node, Yarn y una cuenta de API compatible.
- [ ] Explica cómo configurar, probar, reemplazar y eliminar credenciales desde la app.
- [ ] Explica cómo sincronizar y seleccionar modelos sin editar archivos.
- [ ] Incluye comandos de desarrollo y producción local.
- [ ] Explica el directorio de datos y cómo respaldarlo.
- [ ] Explica cómo restaurar defaults y limpiar caché.
- [ ] Advierte que ChatGPT/Codex no incluye consumo de API.

**Estimación:** M  
**Dependencias:** F0.3, F9.9

---

## Fase 10 — Métricas de consumo opcionales

Estas tareas no bloquean ninguna funcionalidad del MVP y pueden omitirse sin modificar el resto del backlog.

### F10.1 — Registrar consumo de IA

**Descripción:** Guardar métricas técnicas agregables de cada llamada al proveedor de IA sin registrar prompts ni contenido periodístico. El objetivo es observar consumo entre proveedores y modelos, no imponer presupuestos o bloquear operaciones.

**Criterios de aceptación:**

- [ ] Registra fecha, feature, proveedor, modelo, duración y estado.
- [ ] Registra las unidades de entrada, salida y caché informadas por cada adaptador.
- [ ] Registra cantidad de llamadas a herramientas como web search.
- [ ] No almacena consultas, textos pegados ni cuerpos de artículos.
- [ ] La falla de métricas nunca rompe la operación principal.

**Estimación:** M  
**Dependencias:** F0.6, F2.9, F2.11

### F10.2 — Mostrar el resumen de consumo

**Descripción:** Crear una vista simple con consumo diario y total por feature, proveedor y modelo. No se calcularán costos monetarios para evitar mantener precios variables.

**Criterios de aceptación:**

- [ ] Muestra unidades de consumo por día, feature, proveedor y modelo.
- [ ] Muestra llamadas de web search y errores.
- [ ] Permite filtrar un rango de fechas.
- [ ] Permite limpiar las métricas con confirmación.
- [ ] La pantalla funciona aunque no existan datos.

**Estimación:** M  
**Dependencias:** F8.1, F8.2, F10.1
