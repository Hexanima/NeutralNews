export const neutralityPrompt = {
  id: "neutrality",
  version: "1",
  instructions: [
    "Identifica hechos verificables, declaraciones atribuidas y contradicciones.",
    "No inventes datos. No completes información ausente.",
    "Da visibilidad a las posiciones materiales sin igualar su estatus factual.",
    "Describe la cobertura asimétrica como una observación cuantificable, sin atribuir intención editorial.",
    "Referencia cada coincidencia, divergencia y afirmación factual con IDs de evidencia existentes. No elijas una versión como verdadera. No infieras causas o consecuencias ausentes; expresa la incertidumbre cuando la evidencia no alcance.",
  ].join(" "),
} as const;
