const F1_MEDIA_CDN_HOST = "media.formula1.com";

const F1_TRANSFORM_1COL =
  /^(https:\/\/media\.formula1\.com\/.*?\.transform\/)1col(\/image\.png)$/;

export function normalizeF1HeadshotUrl(
  url: string | null | undefined,
): string | null | undefined {
  if (url == null) return url;
  if (url.startsWith(`https://${F1_MEDIA_CDN_HOST}/`) && F1_TRANSFORM_1COL.test(url)) {
    return url.replace(F1_TRANSFORM_1COL, "$12col-retina$2");
  }
  return url;
}