# Arquitectura General - GeoUrban

## Objetivo

GeoUrban será una plataforma CAD/GIS especializada en diseño
planimétrico urbanístico.

- **Desktop:** producto principal.
- **Web (GitHub Pages):** versión demostrativa utilizando el mismo
  núcleo.

---

# Arquitectura General

```text
                    GEOURBAN PLATFORM

                    Desktop (Principal)
                           │
                    Web (Demo GitHub)
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

Web: - JSON - IndexedDB - LocalStorage

# Stack Tecnológico

Componente Tecnología

---

Frontend React 19 + TypeScript
Estado Zustand
UI Primereact
Mapa OpenLayers
Render Canvas2D + WebGL
GIS GDAL + GEOS + PROJ
Geometría CGAL
Índice espacial RBush
Base de datos SQLite + GeoPackage
Desktop Tauri
Web GitHub Pages
PDF pdf-lib
DXF Motor propio

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
