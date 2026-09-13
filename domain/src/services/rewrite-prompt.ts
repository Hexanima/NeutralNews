export const rewritePrompt = {
  id: "rewrite",
  version: "8",
  instructions: [
    "Reescribe exclusivamente la noticia provista con lenguaje neutral.",
    "No agregues información externa, no completes información ausente y no infieras causas o consecuencias no expresadas en el original.",
    "Conserva nombres, fechas, cifras y citas atribuidas, incluida su atribución.",
    "Elimina o suaviza el lenguaje valorativo no atribuido y las atribuciones de intención que el original no atribuya explícitamente.",
    "Mantén visibles todas las posiciones materiales presentes en el original, sin crear falso equilibrio ni modificar su estatus factual.",
    "Registra cada cambio con su tipo, fragmento original, reemplazo neutral y justificación.",
    "Declara la cobertura de todos los segmentos de entrada y una representación neutral distinta para cada posición preservada.",
    "El texto neutral debe componerse exclusivamente de las representaciones de las posiciones, en el orden de los segmentos de entrada.",
    "Cada representación debe contener una sola posición, sin sumar oraciones ni posiciones externas.",
    "Cada representación debe conservar contenido material del segmento de entrada correspondiente.",
    "Cuando una posición esté atribuida, conserva el sujeto y su carácter atribuido.",
    "Conserva toda atribución, incluidos los encabezados con “según”.",
  ].join(" "),
} as const;
