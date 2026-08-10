use crate::kernel::types::Pt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Extent1D {
    pub min: f64,
    pub max: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PrincipalAxis {
    pub ux: f64,
    pub uy: f64,
}

pub fn poly_area(pts: &[Pt]) -> f64 {
    let n = pts.len();
    let mut a = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        a += pts[i].0 * pts[j].1 - pts[j].0 * pts[i].1;
    }
    (a / 2.0).abs()
}

pub fn centroid(pts: &[Pt]) -> Pt {
    let mut cx = 0.0;
    let mut cy = 0.0;
    for p in pts {
        cx += p.0;
        cy += p.1;
    }
    let n = pts.len() as f64;
    (cx / n, cy / n)
}

pub fn convex_hull(pts: &[Pt]) -> Vec<Pt> {
    let mut arr: Vec<Pt> = pts.to_vec();
    arr.sort_by(|a, b| {
        if a.0 != b.0 {
            a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)
        } else {
            a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)
        }
    });
    if arr.len() < 3 {
        return arr;
    }

    let cross =
        |o: Pt, a: Pt, b: Pt| -> f64 { (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0) };

    let mut lower: Vec<Pt> = Vec::new();
    for &p in &arr {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], p) <= 0.0 {
            lower.pop();
        }
        lower.push(p);
    }

    let mut upper: Vec<Pt> = Vec::new();
    for &p in arr.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], p) <= 0.0 {
            upper.pop();
        }
        upper.push(p);
    }

    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

pub fn orient_ring_ccw(ring: &[Pt]) -> Vec<Pt> {
    let n = ring.len();
    let mut area = 0.0;
    for i in 0..n {
        let p = ring[i];
        let q = ring[(i + 1) % n];
        area += p.0 * q.1 - q.0 * p.1;
    }
    if area >= 0.0 {
        ring.to_vec()
    } else {
        let mut rev = ring.to_vec();
        rev.reverse();
        rev
    }
}

fn side(pt: Pt, lp1: Pt, lp2: Pt) -> f64 {
    (lp2.0 - lp1.0) * (pt.1 - lp1.1) - (lp2.1 - lp1.1) * (pt.0 - lp1.0)
}

fn line_line_intersect(a: Pt, b: Pt, c: Pt, d: Pt) -> Option<Pt> {
    let dx1 = b.0 - a.0;
    let dy1 = b.1 - a.1;
    let dx2 = d.0 - c.0;
    let dy2 = d.1 - c.1;
    let denom = dx1 * dy2 - dy1 * dx2;
    if denom.abs() < 1e-12 {
        return None;
    }
    let t = ((c.0 - a.0) * dy2 - (c.1 - a.1) * dx2) / denom;
    Some((a.0 + t * dx1, a.1 + t * dy1))
}

pub fn clip_half_plane(pts: &[Pt], lp1: Pt, lp2: Pt, keep_side: i32) -> Vec<Pt> {
    if pts.len() < 3 {
        return Vec::new();
    }
    let n = pts.len();
    let mut out: Vec<Pt> = Vec::new();
    for i in 0..n {
        let cur = pts[i];
        let nxt = pts[(i + 1) % n];
        let sc = side(cur, lp1, lp2);
        let sn = side(nxt, lp1, lp2);
        let cur_in = if keep_side > 0 {
            sc >= -1e-9
        } else {
            sc <= 1e-9
        };
        let nxt_in = if keep_side > 0 {
            sn >= -1e-9
        } else {
            sn <= 1e-9
        };
        if cur_in {
            out.push(cur);
        }
        if cur_in != nxt_in {
            if let Some(inter) = line_line_intersect(cur, nxt, lp1, lp2) {
                out.push(inter);
            }
        }
    }
    if out.len() >= 3 {
        out
    } else {
        Vec::new()
    }
}

pub fn clip_to_strip(pts: &[Pt], ax: f64, ay: f64, min_t: f64, max_t: f64) -> Vec<Pt> {
    if pts.len() < 3 {
        return Vec::new();
    }
    let nx = -ay;
    let ny = ax;

    let min_pt: Pt = (min_t * ax, min_t * ay);
    let p1: Pt = (min_pt.0 + nx, min_pt.1 + ny);
    let p2: Pt = (min_pt.0 - nx, min_pt.1 - ny);
    let test_min: Pt = ((min_t + 1.0) * ax, (min_t + 1.0) * ay);
    let s_min = side(test_min, p1, p2);
    let clipped = clip_half_plane(pts, p1, p2, if s_min >= 0.0 { 1 } else { -1 });
    if clipped.len() < 3 {
        return Vec::new();
    }

    let max_pt: Pt = (max_t * ax, max_t * ay);
    let p3: Pt = (max_pt.0 + nx, max_pt.1 + ny);
    let p4: Pt = (max_pt.0 - nx, max_pt.1 - ny);
    let test_max: Pt = ((max_t - 1.0) * ax, (max_t - 1.0) * ay);
    let s_max = side(test_max, p3, p4);
    clip_half_plane(&clipped, p3, p4, if s_max >= 0.0 { 1 } else { -1 })
}

pub fn principal_axis(pts: &[Pt]) -> PrincipalAxis {
    let n = pts.len() as f64;
    let mut mx = 0.0;
    let mut my = 0.0;
    for p in pts {
        mx += p.0;
        my += p.1;
    }
    mx /= n;
    my /= n;

    let mut cxx = 0.0;
    let mut cxy = 0.0;
    let mut cyy = 0.0;
    for p in pts {
        let dx = p.0 - mx;
        let dy = p.1 - my;
        cxx += dx * dx;
        cxy += dx * dy;
        cyy += dy * dy;
    }

    let trace = cxx + cyy;
    let det = cxx * cyy - cxy * cxy;
    let disc = ((trace * trace) / 4.0 - det).max(0.0).sqrt();
    let l1 = trace / 2.0 + disc;

    let ex: f64;
    let ey: f64;
    if cxy.abs() > 1e-10 {
        ex = l1 - cyy;
        ey = cxy;
    } else if cxx >= cyy {
        ex = 1.0;
        ey = 0.0;
    } else {
        ex = 0.0;
        ey = 1.0;
    }

    let raw_len = (ex * ex + ey * ey).sqrt();
    let len = if raw_len == 0.0 { 1.0 } else { raw_len };
    let mut ux = ex / len;
    let mut uy = ey / len;
    if ux < 0.0 || (ux.abs() < 1e-9 && uy < 0.0) {
        ux = -ux;
        uy = -uy;
    }

    PrincipalAxis { ux, uy }
}

pub fn project_extents(pts: &[Pt], ax: f64, ay: f64) -> Extent1D {
    let mut mn = f64::INFINITY;
    let mut mx = f64::NEG_INFINITY;
    for p in pts {
        let t = p.0 * ax + p.1 * ay;
        if t < mn {
            mn = t;
        }
        if t > mx {
            mx = t;
        }
    }
    Extent1D { min: mn, max: mx }
}

const LOD_MIN_SEGMENTS: u32 = 8;
const LOD_MAX_SEGMENTS: u32 = 160;

pub fn resolution_aware_segments(radius_map_units: f64, resolution: f64, px_error: f64) -> u32 {
    if radius_map_units.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater)
        || resolution.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater)
    {
        return LOD_MIN_SEGMENTS;
    }
    let error_map_units = px_error * resolution;
    let ratio = (error_map_units / radius_map_units).min(1.0);
    let max_angle = 2.0 * (1.0 - ratio).acos();
    if max_angle.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) || !max_angle.is_finite() {
        return LOD_MAX_SEGMENTS;
    }
    let needed = ((2.0 * std::f64::consts::PI) / max_angle).ceil() as u32;
    needed.clamp(LOD_MIN_SEGMENTS, LOD_MAX_SEGMENTS)
}

/// Cierra un anillo si el primer y último punto no coinciden dentro de una
/// tolerancia `eps`. Versión canónica unificada — antes existían 3 copias
/// privadas en `boolean_ops.rs` (`eps = 1e-9`), `sanitize.rs`
/// (`eps = 1e-12`) y `roads.rs` (`eps = 1e-9`), con la salvedad de que
/// `sanitize` usa una tolerancia mucho más estricta por motivos de
/// sanitización (ver `kernel::constants::EPSILON_SANITIZE`).
///
/// **Convención de llamada:**
///   - Para operaciones booleanas sobre geometría saneada → `EPSILON_NORMAL`.
///   - Para sanitización antes de pasar a GEOS → `EPSILON_SANITIZE`.
pub fn close_ring(ring: &[Pt], eps: f64) -> Vec<Pt> {
    if ring.is_empty() {
        return ring.to_vec();
    }
    let first = ring[0];
    let last = *ring.last().unwrap();
    if (first.0 - last.0).abs() > eps || (first.1 - last.1).abs() > eps {
        let mut out = ring.to_vec();
        out.push(first);
        out
    } else {
        ring.to_vec()
    }
}

/// Bisección binaria clásica: encuentra `x` en `[lo, hi]` tal que
/// `f(x) >= target` (asumiendo `f(lo) < target <= f(hi)`, es decir
/// monótona creciente y con cruce en el intervalo).
///
/// Versión canónica unificada — antes era una función privada de
/// `cabecera_cuerpo.rs` con 60 iteraciones hardcoded. La parametrización
/// por `max_iter` permite a callers que necesitan más precisión usar más
/// iteraciones sin copiar el loop.
///
/// `tick` es un callback opcional que se llama una vez por iteración.
/// Si devuelve `false`, la bisección termina antes (útil para budgets de
/// operaciones globales que cortan cálculos largos para no bloquear).
///
/// **Nota:** esta es la variante *simple* de bisección. Si necesitás
/// tracking del mejor ajuste (cuando `f` no es exactamente monótona o
/// querés minimizar `|f(x) - target|` en vez de encontrar el cruce
/// exacto), usá `bisect_with_best_fit`.
pub fn bisect<F, T>(f: &F, lo: f64, hi: f64, target: f64, max_iter: usize, tick: &T) -> f64
where
    F: Fn(f64) -> f64 + ?Sized,
    T: Fn() -> bool + ?Sized,
{
    let mut a = lo;
    let mut b = hi;
    for _ in 0..max_iter {
        if !tick() {
            break;
        }
        let m = (a + b) / 2.0;
        if f(m) < target {
            a = m;
        } else {
            b = m;
        }
    }
    (a + b) / 2.0
}

/// Bisección con tracking del mejor ajuste: devuelve el `x` que minimiza
/// `|f(x) - target|`, no el cruce exacto. Útil cuando `f` no es
/// monótona, o cuando `target` puede no ser exactamente alcanzable
/// (caso típico: encontrar la coordenada `t` a lo largo de un eje tal
/// que el área del polígono recortado sea lo más cercana posible al
/// `target_area`).
///
/// `max_iter` controla el número de iteraciones. El loop termina antes
/// si el error cae por debajo de `1e-6` o si `tick()` devuelve `false`.
pub fn bisect_with_best_fit<F, T>(f: &F, lo: f64, hi: f64, target: f64, max_iter: usize, tick: &T) -> f64
where
    F: Fn(f64) -> f64 + ?Sized,
    T: Fn() -> bool + ?Sized,
{
    let mut a = lo;
    let mut b = hi;
    let mut best_x = (a + b) / 2.0;
    let mut best_err = f64::INFINITY;
    for _ in 0..max_iter {
        if !tick() {
            break;
        }
        let mid = (a + b) / 2.0;
        let value = f(mid);
        let err = value - target;
        let abs_err = err.abs();
        if abs_err < best_err {
            best_err = abs_err;
            best_x = mid;
        }
        if abs_err <= 1e-6 {
            break;
        }
        if err < 0.0 {
            a = mid;
        } else {
            b = mid;
        }
    }
    best_x
}
