/**
 * Phones and tablets get much less memory per browser tab than a desktop, and
 * iOS in particular closes or starves a tab that grows large. Safari does not
 * report `navigator.deviceMemory`, so Apple touch devices are recognised by
 * platform: an iPad in its default "desktop website" mode calls itself a Mac
 * but, unlike a Mac, has several touch points.
 */
export function isLowMemoryDevice(nav: Pick<Navigator, 'platform' | 'maxTouchPoints' | 'userAgent'> & { deviceMemory?: number } = navigator): boolean {
  const applePhoneOrTablet = /iPhone|iPad|iPod/.test(nav.platform) || (/Mac/.test(nav.platform) && nav.maxTouchPoints > 1);
  const android = /Android/.test(nav.userAgent);
  const reportsLittle = nav.deviceMemory !== undefined && nav.deviceMemory < 8;
  return applePhoneOrTablet || android || reportsLittle;
}
