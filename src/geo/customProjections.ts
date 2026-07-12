import proj4 from 'proj4';
import { register } from 'ol/proj/proj4.js';

proj4.defs('EPSG:32719', '+proj=utm +zone=19 +south +datum=WGS84 +units=m +no_defs +type=crs');
proj4.defs('EPSG:32720', '+proj=utm +zone=20 +south +datum=WGS84 +units=m +no_defs +type=crs');

register(proj4);

export const UTM_19S = 'EPSG:32719';