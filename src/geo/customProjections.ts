import proj4 from 'proj4';
import { register } from 'ol/proj/proj4.js';

// UTM zona 19S (La Paz, Cochabamba, Oruro, Potosí) y 20S (Santa Cruz, este del país)
proj4.defs('EPSG:32719', '+proj=utm +zone=19 +south +datum=WGS84 +units=m +no_defs +type=crs');
proj4.defs('EPSG:32720', '+proj=utm +zone=20 +south +datum=WGS84 +units=m +no_defs +type=crs');

register(proj4);

export const UTM_19S = 'EPSG:32719';
export const UTM_20S = 'EPSG:32720';