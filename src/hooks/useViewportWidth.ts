import { useEffect, useState } from 'react';

/** Ancho de viewport reactivo — usado para clampear paneles fijos en
 *  pantallas angostas (antes tenían `left`/`width` hardcodeados sin
 *  ningún chequeo contra el viewport real). */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}
