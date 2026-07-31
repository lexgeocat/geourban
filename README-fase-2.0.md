# Fase 2.0 — Scaffolding del motor de geometría nativo

Contiene lo descripto en la Fase 2.0 de `auditoria-para-mejora.md`: un
crate Rust nuevo (`geourban-geo`) dentro de `src-tauri/`, los tipos
compartidos que van a viajar por IPC, la decisión de librería booleana
(GEOS vía el crate `geos`, detrás de un feature flag) con su smoke test, y
el cableado mínimo a Tauri + React para probar el round-trip completo.

**No porta ninguna lógica geométrica real todavía** — eso es Fase 2.1 en
adelante. El objetivo de este paquete es: que compile, que los tests
pasen, y que quede un comando invocable desde React que confirme que el
motor nativo está linkeado dentro del binario.

## Cómo aplicar

Copiá estos archivos sobre tu repo, respetando las rutas:

| Archivo | Acción |
|---|---|
| `src-tauri/Cargo.toml` | **Reemplaza** el tuyo (agregué `[workspace]` + la dependencia de path a `crates/geourban-geo`; el resto de tus dependencias quedó igual) |
| `src-tauri/src/lib.rs` | **Reemplaza** el tuyo (agregué `mod geo_bridge;` y el comando nuevo en `invoke_handler!`; el resto igual) |
| `src-tauri/src/geo_bridge.rs` | Archivo nuevo |
| `src-tauri/crates/geourban-geo/` | Carpeta nueva completa (el crate) |
| `src/workers/geoEngineDiagnostics.ts` | Opcional — solo si querés probar el round-trip desde React |

## Verificar que compila

Desde `src-tauri/`:

```bash
cargo check --workspace
cargo test -p geourban-geo
```

El feature `geos-backend` está desactivado por default a propósito:
compilar sin GEOS instalado en el sistema **no debería fallar**. Para
correr el smoke test de GEOS (requiere GEOS instalado, o compilarlo
vendored según la versión del crate que resuelvas):

```bash
cargo test -p geourban-geo --features geos-backend
```

Y para levantar la app entera con el comando nuevo ya registrado:

```bash
npm run tauri dev
```

Desde la consola de devtools de la ventana (o agregando una llamada
temporal en algún componente):

```ts
import { getGeoEngineVersion } from './workers/geoEngineDiagnostics';
console.log(await getGeoEngineVersion()); // "0.1.0"
```

## Decisión tomada en esta fase

**Librería booleana: GEOS vía el crate `geos`**, no el crate `geo`
puro-Rust. Motivo (detallado en la auditoría, §Fase 2 / 2.0): tu código
actual ya tiene mitigaciones propias (reintentos, auto-limpieza en
cascada) contra fallos de `polygon-clipping` en `roadNetworkNet.ts` y
`geoOperations.ts::robustUnionRoadNetwork` — señal de que la geometría
booleana en JS puro es frágil con datos reales. GEOS es el motor maduro
(C++) que JSTS portó en su momento; menos sorpresas de comportamiento en
geometría degenerada.

Verificá las versiones de `geos` en el `Cargo.toml` del crate antes de
fijarlas en un lockfile real — corré `cargo add geos --optional` desde
`crates/geourban-geo/` para tomar la última disponible si la que dejé
(`8`) quedó desactualizada. La superficie de API del crate (`new_from_wkt`,
`.union()`, `.area()`) viene cambiando levemente entre 8.x/9.x — si el
smoke test no compila tal cual, son ajustes de nombre de método, no de
lógica.

## Si `invoke('geo_engine_version')` te tira un error de permisos

Tauri v2 puede requerir una entrada explícita en
`src-tauri/capabilities/default.json` para comandos de app. Si te pasa,
agregá algo como esto (ajustá el nombre exacto de permiso según lo que te
indique el error de consola — Tauri v2 lo genera automáticamente a partir
del nombre del comando):

```json
{
  "permissions": ["core:default", "allow-geo-engine-version"]
}
```

No lo agregué por default en `capabilities/default.json` porque no quería
arriesgar una sintaxis que no coincida exactamente con la versión de Tauri
que estás usando — mejor que lo confirmes con el mensaje de error real, si
aparece.

## Qué sigue: Fase 2.1

`math.rs`, `sanitize.rs`, `roundabout.rs` y la mitad de `roads.rs` están
como stubs con la lista exacta de funciones a portar (mismo nombre que el
`.ts` de origen) en cada doc comment. La Fase 2.1 es, literalmente, ir
llenando esos archivos — sin tocar `boolean_ops.rs` todavía.
