/**
 * Change a project's or team's logo. Pick an image; the console crops
 * it to its centred square, scales it to 128 px and shows the result in
 * the sizes it will appear in, before anything is uploaded. Save sends
 * the PNG; Remove goes back to the initials tile.
 */

import { useRef, useState } from 'react';

import { ApiError } from '../../../api/client';
import { logoUrl, toLogoPng, useRemoveLogo, useUploadLogo, type LogoOwner } from '../../../api/logos';
import { Banner } from '../../../ui/Banner';
import { Button } from '../../../ui/Button';
import { Dialog } from '../../../ui/Dialog';
import { EntityMark } from '../../../ui/EntityMark';
import { useToast } from '../../../ui/toastContext';

interface Props {
  kind: LogoOwner;
  id: string;
  name: string;
  logoVersion?: string | null;
  onClose: () => void;
}

export function LogoDialog({ kind, id, name, logoVersion, onClose }: Props) {
  const toast = useToast();
  const upload = useUploadLogo(kind, id);
  const remove = useRemoveLogo(kind, id);
  const input = useRef<HTMLInputElement>(null);
  const [png, setPng] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const current = logoUrl(kind, id, logoVersion);
  const busy = upload.isPending || remove.isPending;
  const markKind = kind === 'team' ? 'team' : 'project';

  const choose = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    try {
      const blob = await toLogoPng(file);
      // A data URL, because the page's CSP allows data: images and not blob:.
      const url = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("That file couldn't be read."));
        r.readAsDataURL(blob);
      });
      setPng(blob);
      setPreview(url);
    } catch (e) {
      setPng(null);
      setPreview(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const save = async () => {
    if (!png) return;
    try {
      await upload.mutateAsync(png);
      toast(`Saved the logo for ${name}.`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.message}` : 'Network error. Try again.');
    }
  };

  const doRemove = async () => {
    try {
      await remove.mutateAsync();
      toast(`Removed the logo for ${name}.`);
      onClose();
    } catch (e) {
      setConfirmRemove(false);
      setError(e instanceof ApiError ? `${e.status}: ${e.message}` : 'Network error. Try again.');
    }
  };

  const shown = preview ?? current;

  return (
    <Dialog
      title={`Logo for ${name}`}
      onClose={onClose}
      dismissible={!busy}
      actions={
        confirmRemove ? (
          <>
            <Button variant="secondary" onClick={() => setConfirmRemove(false)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void doRemove()} disabled={busy} aria-busy={remove.isPending}>
              {remove.isPending ? 'Removing…' : 'Remove logo'}
            </Button>
          </>
        ) : (
          <>
            {current && !preview && (
              <Button variant="danger" className="mr-auto" onClick={() => setConfirmRemove(true)} disabled={busy}>
                Remove…
              </Button>
            )}
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={!png || busy} aria-busy={upload.isPending}>
              {upload.isPending ? 'Saving…' : 'Save logo'}
            </Button>
          </>
        )
      }
    >
      {confirmRemove ? (
        <p className="text-muted">The initials tile shows again everywhere {name} appears.</p>
      ) : (
        <>
          <div className="flex items-center gap-4 rounded-md border border-border bg-sunken px-4 py-3.5">
            <EntityMark name={name} kind={markKind} size="lg" src={shown} />
            <EntityMark name={name} kind={markKind} size="md" src={shown} />
            <span className="inline-flex items-center gap-2 text-ui">
              <EntityMark name={name} kind={markKind} src={shown} />
              {name}
            </span>
          </div>
          <p className="text-caption text-muted">
            {preview
              ? 'This is how it will look. Save to use it everywhere.'
              : current
                ? 'The current logo, in the sizes the console uses.'
                : 'No logo yet, so the initials show.'}{' '}
            PNG, JPEG or WebP. It is cropped to a square from the centre and scaled to 128 px.
          </p>
          <div>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              id={`logo-file-${id}`}
              onChange={(e) => void choose(e.target.files?.[0])}
            />
            <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy} data-autofocus>
              {current || preview ? 'Choose another image' : 'Choose an image'}
            </Button>
          </div>
        </>
      )}
      {error && (
        <Banner tone="error" title="The logo wasn't changed.">
          {error}
        </Banner>
      )}
    </Dialog>
  );
}
