/**
 * Project and team logos (api: project and team logo endpoints).
 *
 *   GET    /api/v1/projects/:id/logo?v=<logo_version>   read scope of the project
 *   PUT    /api/v1/projects/:id/logo  (image/png body)  team.edit
 *   DELETE /api/v1/projects/:id/logo                    team.edit
 *   ... and the same under /api/v1/teams/:id/logo
 *
 * A body's `logo_version` is null when there is no logo; then the
 * initials tile shows and nothing is fetched. The version goes in the
 * URL, so the api can let the browser cache the image for good.
 *
 * The console crops and scales an image to a 128 px PNG before upload
 * (`toLogoPng`); the api decodes, checks and re-encodes it again.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api, apiUrl } from './client';
import { meKey } from './me';
import { projectsKey } from './tenancy';
import { teamsKey } from './teams';

export type LogoOwner = 'project' | 'team';

const base = (kind: LogoOwner, id: string) => `/api/v1/${kind === 'project' ? 'projects' : 'teams'}/${encodeURIComponent(id)}/logo`;

/** The image URL for a logo, or undefined when there is none. */
export function logoUrl(kind: LogoOwner, id: string | undefined, version: string | null | undefined): string | undefined {
  if (!id || !version) return undefined;
  return apiUrl(`${base(kind, id)}?v=${encodeURIComponent(version)}`);
}

function useInvalidate(kind: LogoOwner, id: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: kind === 'project' ? projectsKey.all : teamsKey.all });
    qc.invalidateQueries({ queryKey: kind === 'project' ? projectsKey.one(id) : teamsKey.one(id) });
    qc.invalidateQueries({ queryKey: meKey.all });
  };
}

export function useUploadLogo(kind: LogoOwner, id: string) {
  const invalidate = useInvalidate(kind, id);
  return useMutation({
    mutationFn: (png: Blob) => api.putBlob<{ logo_version: string }>(base(kind, id), png, 'image/png'),
    onSuccess: invalidate,
  });
}

export function useRemoveLogo(kind: LogoOwner, id: string) {
  const invalidate = useInvalidate(kind, id);
  return useMutation({
    mutationFn: () => api.delete<void>(base(kind, id)),
    onSuccess: invalidate,
  });
}

export const LOGO_SIZE = 128;
export const LOGO_MAX_BYTES = 64 * 1024;

/**
 * Crop an image file to its centred square and scale it to a 128 px
 * PNG. Only raster formats the browser decodes into a bitmap are
 * accepted (PNG, JPEG, WebP); SVG is refused before it is read.
 */
export async function toLogoPng(file: File): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    throw new Error('Use a PNG, JPEG or WebP image.');
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('That image is over 5 MB. Use a smaller file.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That file couldn't be read as an image.");
  }
  try {
    if (bitmap.width < 16 || bitmap.height < 16) throw new Error('Use an image at least 16 px on each side.');
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = LOGO_SIZE;
    canvas.height = LOGO_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("This browser can't prepare the image.");
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, LOGO_SIZE, LOGO_SIZE);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error("This browser can't prepare the image.");
    if (blob.size > LOGO_MAX_BYTES) throw new Error('That image is too detailed to fit in 64 KB at 128 px. Try a simpler one.');
    return blob;
  } finally {
    bitmap.close();
  }
}
