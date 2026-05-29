export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="bg-surface border border-border rounded p-8">
      <div className="text-text font-semibold">{title}</div>
      <div className="text-muted text-sm mt-2">{note}</div>
      <div className="text-muted text-xs mt-4 border-t border-border pt-3">
        Page lands in a follow-up PR. See `secrets-bridge/ui#1` for the full Step 12 scope.
      </div>
    </div>
  );
}
