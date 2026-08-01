// vitest.parity-sync.config.mjs
//
// Config vitest dedicada y aislada para `scripts/parity-sync.mjs`.
//
// El generador de snapshot (`buildSnapshot.test.ts`) está intencionalmente
// excluido del `npm test` normal (ver el comentario al inicio de ese
// archivo: "intencionalmente excluido... ver vitest.config.ts -> exclude").
// En vez de duplicar o adivinar el patrón exacto de exclude que usa el
// config principal (con el riesgo de que ambos se desincronicen con el
// tiempo), esta config es autocontenida: solo conoce el archivo generador
// y nada más, y limpia `exclude` explícitamente para esta corrida puntual.
//
// Si tu vitest.config.ts principal define resolve.alias u otras opciones
// que buildSnapshot.test.ts necesitara, hacé merge acá con
// `mergeConfig(baseConfig, defineConfig({...}))` — se dejó standalone
// porque el generador solo usa imports relativos dentro de src/geo.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/geo/subdivision/__parity__/__generator__/buildSnapshot.test.ts'],
    exclude: [],
    watch: false,
  },
});
