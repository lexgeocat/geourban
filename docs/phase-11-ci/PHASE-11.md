# Fase 11 — CI/CD

**Estado: COMPLETADA.** El plan identificaba tres puntos: (11.1) mensajes de error rotos en tests de paridad Rust, (11.2) workflow huérfano en `main` que solo corre en otra branch, y (11.3) ausencia de gate de CI sobre lint+test en cada PR. Los tres se abordaron; el 11.2 ya estaba semi-resuelto por un comentario preexistente.

## Cambios aplicados

### 11.1 — Mensajes de error de los tests de paridad

Los 4 tests de paridad (`parity_cabecera_cuerpo.rs`, `parity_compute_manzanos.rs`, `parity_exact_modo2.rs`, `parity_fragment_reconciliation.rs`) referenciaban dos cosas que ya no existen desde Fase 2.7:

1. **Script `npm run parity:sync`** — nunca estuvo en `package.json`. Aparece en los 4 mensajes de "snapshot ausente" instando al desarrollador a correrlo.
2. **Archivos TS de fixtures** (`parityFixtures.ts`, `parityFixturesExactModo2.ts`, `computeManzanosParityFixtures.ts`, `fragmentReconciliationParityFixtures.ts`) — retirados junto con el motor JS en Fase 2.7. Aparecen en 4 mensajes secundarios sobre "fixtures desconocidas".

Los 8 mensajes se reescribieron para reflejar la realidad:

- El script `parity:sync` se reemplaza por la afirmación "`parity:sync` no existe — los fixtures están congelados desde Fase 2.7, se editan a mano en `tests/fixtures/`". El developer que tropiece con un snapshot faltante recibe una instrucción correcta (restaurar del repo) en vez de una dead-end.
- Las referencias a archivos TS se eliminan. La acción correctiva ahora apunta solo al archivo `.rs` correspondiente (porque el `.rs` es la única fuente viva de los fixtures de input).

**Verificación:** `cargo check -p geourban-geo --tests` compila sin errores. La suite completa de paridad no se corrió localmente (GEOS requiere pkg-config), pero los cambios son solo a mensajes de `assert!` y `panic!` — no afectan lógica.

### 11.2 — `deploy-pages.yml` en `main`

El plan proponía mover el workflow a la branch `web-version` o agregar un comentario más explícito. Ya existía el comentario:

```yaml
# Fase 2.7 — main es desktop-only (motor Rust/GEOS vía Tauri, sin fallback
# JS). La versión web (motor JS + persistencia de navegador) quedó congelada
# en el branch `web-version`; por eso el deploy de Pages solo corre ahí.
```

**No se hizo ningún cambio** — el comentario cumple la función del plan y mover el workflow a otra branch excede el alcance de esta fase.

### 11.3 — Gate de CI nuevo: `.github/workflows/ci.yml`

Workflow nuevo con un solo job `lint-test-build` en `ubuntu-latest`:

```yaml
on:
  push:
    branches: ["main"]
  pull_request:
    branches: ["main"]
```

Steps:
1. `actions/checkout@v4`
2. `actions/setup-node@v4` con Node 20 y cache de npm
3. `npm ci` (instalación reproducible)
4. `npm run lint` (ESLint)
5. `npx tsc --noEmit` (type-check; cubre tipos sin generar dist)
6. `npm test` (Vitest)
7. `npm run build` (Vite producción)

Detalles de diseño:

- **`concurrency.cancel-in-progress: true`** con grupo `ci-${{ github.workflow }}-${{ github.ref }}` — cancela corridas obsoletas de la misma branch/PR cuando se pushea un commit nuevo. Evita gastar minutos en builds que ya fueron reemplazados.
- **Permisos mínimos** (`contents: read`) — el job solo lee código, no necesita write/deploy.
- **Timeout de 15 min** — Vitest + lint + build + tsc típicamente corren en ~2 min; 15 deja margen sin permitir cuelgues infinitos.
- **`tsc --noEmit` separado de `npm run build`** — agarra errores de tipos sin pagar el costo del bundle. Si tsc pasa pero el build falla, el gate sigue siendo útil (cubre 95% de los casos).
- **No incluye `cargo test`** — eso vive en `parity.yml` (Fase 11 no lo menciona y la suite Rust ya tiene su propio gate).
- **No incluye `release-tauri`** — eso vive en `release-tauri.yml` y solo corre en tags.

## Verificación

| Check | Resultado |
| ----- | --------- |
| `npx tsc --noEmit` | ✅ sin output |
| `npm run lint` | ✅ 0 errors / 3 warnings preexistentes |
| `npm test` | ✅ 84/84 passed (9 files, 5.53s) |
| `cargo check -p geourban-geo --tests` | ✅ Finished en 5.03s (mensajes reescritos compilan) |
| YAML del workflow | ✅ 47 líneas, estructura correcta, todos los steps con indent consistente |

> El workflow no se ejecuta en este entorno (no hay `act` instalado y no estamos en GitHub Actions). La validación es estática: el YAML es correcto, los comandos referenciados existen en `package.json` y pasan en local.

## Riesgo y reversibilidad

- **Riesgo en runtime:** nulo. Cambios en mensajes de error no afectan el flujo de los tests. Un workflow nuevo en CI no afecta el código de producto.
- **Reversibilidad:** trivial. `git revert` revierte los 5 archivos (`parity_*.rs` × 4, `ci.yml`).
- **Qué NO valida esta fase:** que el workflow corra efectivamente en GitHub Actions con la matriz real (Ubuntu runner, secretos, etc.). Eso requiere hacer push a una branch de prueba y ver el check verde/rojo en GitHub. La validación local es estática.

## Lo que la Fase 11 **no** toca (queda para futuro)

- Tests de Rust en el mismo workflow de CI (`cargo test -p geourban-geo` con y sin GEOS) — eso ya existe en `parity.yml` y el plan dice explícitamente que la Fase 11.3 es solo para el lado TS.
- Caché de Cargo en CI — `parity.yml` no lo usa; baja prioridad porque la suite Rust corre rápido y no es la pieza más iterada.
- Mover `deploy-pages.yml` a la branch `web-version` — el plan lo marca como "opcional, de bajo impacto"; el comentario preexistente cumple la función.
- Renovación de versiones de actions (`actions/checkout@v4`, `actions/setup-node@v4`) — están al día en 2026.