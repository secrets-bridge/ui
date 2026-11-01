// The api has no "kind of user" field, so the label is read from the
// permission set. "No role" is the honest label for a signed-in user
// with zero grants (e.g. an OIDC user not yet in any mapped group).
export function roleLabelFor(perms: string[]): string {
  if (perms.includes('role.edit') || perms.includes('user_role.edit')) return 'Platform admin';
  if (perms.includes('secret.security.approve')) return 'Security approver';
  if (perms.includes('secret.approve')) return 'Approver';
  if (perms.includes('secret.value.provide')) return 'Value provider';
  if (perms.includes('secret.request')) return 'Requester';
  if (perms.length === 0) return 'No role';
  return 'Member';
}
