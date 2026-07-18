# Arquitectura General - GeoUrban

## Objetivo

GeoUrban será una plataforma CAD/GIS especializada en diseño
planimétrico urbanístico.

- **Desktop:** producto principal.

---

# Arquitectura General

```text
                    GEOURBAN PLATFORM

                    Desktop (Principal)
                           │
──────────────────────────────────────────────────────
                    CORE ENGINE
──────────────────────────────────────────────────────
 Project Engine
 Object Engine
 History Engine
 Plugin Engine (Futuro)
 Event Engine
 Command Engine
 Settings Engine
──────────────────────────────────────────────────────
                 CAD ENGINE
──────────────────────────────────────────────────────
 Draw Engine
 Edit Engine
 Selection Engine
 Snap Engine
 Grip Engine
 Dimension Engine
 Label Engine
 Hatch Engine
 Symbol Engine
 Block Engine
 Layer Engine
 Style Engine
 Layout Engine
 Print Engine
──────────────────────────────────────────────────────
                 GIS ENGINE
──────────────────────────────────────────────────────
 GDAL
 GEOS
 PROJ
 Spatial Index (RBush)
 Spatial Analysis
 Coordinate Engine
──────────────────────────────────────────────────────
        ADVANCED GEOMETRY ENGINE
──────────────────────────────────────────────────────
 CGAL
 Subdivision Engine
 Parcel Engine
 Road Engine
 Topology Engine
 Validation Engine
──────────────────────────────────────────────────────
         IMPORT / EXPORT ENGINE
──────────────────────────────────────────────────────
 Native DXF Reader
 Native DXF Writer
 SHP
 GeoPackage
 GeoJSON
 KML/KMZ
 PDF
 SVG
 PNG
──────────────────────────────────────────────────────
             RENDER ENGINE
──────────────────────────────────────────────────────
 Scene Manager
 Layer Manager
 Cache Manager
 Tile Manager
 LOD Manager
 GPU Renderer
 CPU Renderer
──────────────────────────────────────────────────────
            STORAGE ENGINE
──────────────────────────────────────────────────────
 SQLite
 GeoPackage
 JSON Project
 Cloud Sync (Futuro)
```

# Motores

## Core Engine

- Gestión de proyectos.
- Historial (Undo/Redo).
- Sistema de comandos.
- Eventos.
- Configuración.
- Plugins futuros.

## CAD Engine

### Draw Engine

- Línea
- Polilínea
- Polígono
- Rectángulo
- Círculo
- Arco
- Texto

### Edit Engine

- Mover
- Copiar
- Rotar
- Escalar
- Offset
- Trim
- Extend
- Fillet
- Chamfer
- Mirror
- Split
- Join

### Selection Engine

- Click
- Rectángulo
- Lazo
- Filtros
- Shift/Ctrl

### Snap Engine

- Endpoint
- Midpoint
- Center
- Nearest
- Perpendicular
- Tangent
- Intersection

### Dimension Engine

- Manual
- Automático
- Lineal
- Angular
- Radio
- Diámetro

### Label Engine

- Manual
- Automático
- Expresiones
- Evitar colisiones
- Rotación
- Escala

### Layer Engine

- Visible
- Editable
- Bloqueada
- Color
- Espesor
- Transparencia
- Orden

## GIS Engine

### GDAL

- Lectura y escritura de formatos.
- Raster.
- Vector.
- Conversión.
- Reproyección.

### GEOS

- Operaciones geométricas.
- Buffer.
- Union.
- Difference.
- Split.
- Validación.

### PROJ

- Transformación de coordenadas.

### Spatial Index

- RBush / RTree.

## Advanced Geometry Engine

### CGAL

- Triangulación.
- Voronoi.
- Offset.
- Booleanas.

### Parcel Engine

- Subdivisión automática.
- Subdivisión manual.
- Lotes mínimos.
- Ochavas.
- Áreas verdes.

### Road Engine

- Trazado vial.
- Radios.
- Curvas.
- Perfiles.

### Validation Engine

- Topología.
- Superposiciones.
- Huecos.
- Geometrías inválidas.

## Import / Export

Lector DXF nativo con soporte para: - LINE - LWPOLYLINE - POLYLINE -
ARC - CIRCLE - TEXT - MTEXT - BLOCK - INSERT - HATCH - DIMENSION -
SPLINE

Exportación: - DXF - SHP - GeoPackage - GeoJSON - KML - PDF - SVG - PNG

## Render Engine

### GPU (WebGL)

- Lotes masivos.
- Parcelas.
- Manzanos.
- Raster.

### CPU (Canvas2D)

- Cursor.
- Snap.
- Cotas.
- Etiquetas.
- Selección.
- Preview.

### Módulos

- Scene Manager.
- Layer Manager.
- Cache Manager.
- Tile Manager.
- LOD Manager.

## Layout Engine

Generación automática de: - Plano General. - Plano Individual. -
Carimbo. - Leyenda. - Escala. - Norte. - Cuadro de coordenadas. - Cuadro
de superficies.

## Storage

Desktop: - SQLite - GeoPackage

# Stack Tecnológico

> **Alineación con el código real (Fase 0 del plan de integración):**
> la tabla siguiente refleja el stack que está en uso hoy en el
> repositorio. Las diferencias respecto de la versión original del
> documento son, en su mayoría, **de nombre y no de arquitectura**
> ("GEOS" se cumple con JSTS, port directo de JTS/GEOS; "PROJ" con
> proj4, port oficial JS de PROJ; "GDAL" con `ol/format` + `shpjs` +
> `dxf-parser`/`dxf-writer` + `sql.js`; "CGAL" con un Geometry Engine
> propio portado de un proyecto anterior ya en producción). Los **dos
> únicos gaps genuinos** a cerrar son **SQLite nativo** (Fase 10) y
> **pdf-lib** (Fase 9).

| Componente | Tecnología | Notas |
|---|---|---|
| Frontend | React 19 + TypeScript | — |
| Bundler | Vite | Build web (PWA) y entrada del target Tauri |
| Estado | Zustand (+ Immer, middleware `persist`) | — |
| UI | Design system propio: Radix primitives + CVA + Tailwind + lucide-react | El doc declaraba "Primereact"; se mantiene por coherencia con el lenguaje visual CAD ya construido. |
| Mapa | OpenLayers 10 | WebGL para capas masivas, Canvas2D para edición |
| Render | GPU (`ol/layer/WebGLVector`) + CPU (postrender Canvas2D) | Cotas, snap, calles, fillets, selección |
| GIS — topología | JSTS (port JS de JTS/GEOS) en Web Worker | El doc declaraba "GEOS"; equivalente funcional. |
| GIS — reproyección | proj4 (port oficial JS de PROJ) | El doc declaraba "PROJ"; mismo motor. |
| GIS — formatos vectoriales y ráster | `ol/format` + `shpjs`/`shp-write` + `dxf-parser`/`dxf-writer` + `sql.js` (SQLite-wasm, lectura de `.gpkg`) + `JSZip` | El doc declaraba "GDAL". Sidecar GDAL queda como opción futura si aparece un formato no cubierto. |
| Geometría avanzada | Geometry Engine propio (port TS de LOTES_SAI): `polygonEngine.ts`, `subdivisionAlgorithms.ts`, `streetEngine.ts` | El doc declaraba "CGAL"; CGAL no tiene binding JS/WASM maduro y el motor propio ya está probado. |
| Índice espacial | RBush | — |
| DXF | `dxf-parser` (lectura) + `dxf-writer` (escritura) | Cobertura actual: LINE/LWPOLYLINE/POLYLINE/POINT; ampliación planificada en Fase 8.1. |
| Persistencia | Dexie sobre IndexedDB (autosave) + `sql.js` solo lectura de `.gpkg` | **Gap:** SQLite nativo de Tauri (`tauri-plugin-sql`) → Fase 10. |
| Desktop | Tauri v2 | — |
| PDF | `pdf-lib` *(declarado, aún no instalado)* | **Gap:** se agrega con la Fase 9 (Layout Engine). |
| Publicación | GitHub Pages (web/PWA) + GitHub Releases (instaladores Tauri) | — |

# Principio de Arquitectura

```text
Usuario
   │
Herramienta
   │
Command Engine
   │
Object Model
   │
Event Engine
   │
Render Engine
   │
Canvas / WebGL
```

Todo debe pasar por el modelo de objetos y el sistema de comandos, nunca
directamente por el render.
