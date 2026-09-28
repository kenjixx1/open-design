import nodePath from 'node:path';

/**
 * `<base href>` for a renderer loading a project file through a minted,
 * short-lived preview scope. Pure: the caller supplies the daemon URL.
 */
export function projectPreviewBaseHref(
  daemonUrl: string,
  projectId: string,
  fileName: string,
  scope: string,
): string {
  const previewDir = nodePath.posix.dirname(fileName.replace(/^\/+/, ''));
  const previewRoot = `${daemonUrl.replace(/\/+$/, '')}/api/projects/${encodeURIComponent(projectId)}/preview/${encodeURIComponent(scope)}/`;
  return !previewDir || previewDir === '.'
    ? previewRoot
    : `${previewRoot}${previewDir.split('/').filter(Boolean).map(encodeURIComponent).join('/')}/`;
}
