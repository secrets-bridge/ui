/**
 * Delete a provider connection. The api refuses while bindings or open
 * requests use it, answering 409 `connection_in_use` with both counts;
 * the dialog then shows them and keeps Delete disabled.
 */

import { useState } from 'react';

import { ApiError } from '../../../api/client';
import {
  extractProviderConnectionErrorCode,
  providerConnectionErrorMessage,
  useDeleteProviderConnection,
} from '../../../api/providerConnections';
import type { ConnectionInUseBody, ProviderConnection } from '../../../api/types';
import { Banner } from '../../../ui/Banner';
import { Button } from '../../../ui/Button';
import { Dialog } from '../../../ui/Dialog';
import { useToast } from '../../../ui/toastContext';

export function DeleteConnectionDialog({ connection, onClose }: { connection: ProviderConnection; onClose: () => void }) {
  const del = useDeleteProviderConnection();
  const toast = useToast();
  const [counts, setCounts] = useState<{ b: number; r: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inUse = counts !== null && (counts.b > 0 || counts.r > 0);

  const tryDelete = async () => {
    setErr(null);
    try {
      await del.mutateAsync(connection.id);
      toast(`Deleted ${connection.name}.`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        const code = extractProviderConnectionErrorCode(e);
        if (code === 'connection_in_use' && e.body && typeof e.body === 'object') {
          const body = e.body as ConnectionInUseBody;
          setCounts({ b: body.bindings_count ?? 0, r: body.open_requests_count ?? 0 });
          return;
        }
        setErr(providerConnectionErrorMessage(code) ?? `${e.status}: ${e.message}`);
      } else {
        setErr(e instanceof Error ? e.message : String(e));
      }
    }
  };

  return (
    <Dialog
      title={`Delete ${connection.name}?`}
      onClose={onClose}
      dismissible={!del.isPending}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void tryDelete()}
            disabled={del.isPending || inUse}
            aria-busy={del.isPending}
            title={inUse ? 'Remove the bindings and close the open requests first.' : undefined}
          >
            {del.isPending ? 'Deleting…' : 'Delete connection'}
          </Button>
        </>
      }
    >
      <p className="text-muted">
        This can't be undone. The api refuses while bindings or open requests still use the connection.
      </p>
      {counts && (
        <Banner tone="error" title="Still in use.">
          {counts.b} {counts.b === 1 ? 'binding' : 'bindings'} and {counts.r} open {counts.r === 1 ? 'request' : 'requests'} use this
          connection. Unbind it and close those requests first.
        </Banner>
      )}
      {err && !counts && (
        <Banner tone="error" title="Not deleted.">
          {err}
        </Banner>
      )}
    </Dialog>
  );
}
