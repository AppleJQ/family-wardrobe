import { createHash } from 'node:crypto';
import { Unit } from './model';
import { NotebookRecord } from './notebook-model';

/** Member choices are stable; notification accounts follow their current bindings. */
export async function notebookParticipantUserIds(unit: Unit, row: NotebookRecord, fence = false): Promise<string[]> {
  if (row.participantMemberIds === undefined) return [...row.participantUserIds];
  const ids = new Set<string>();
  for (const id of row.participantMemberIds) {
    const member = await unit.get('family_members', id);
    if (!member || member.familyId !== row.familyId || member.status !== 'active') continue;
    if (fence) await unit.put('family_members', { ...member });
    if (!member.linkedUserId) continue;
    const userId = member.linkedUserId;
    const key = createHash('sha256').update(`${row.familyId}/${userId}`).digest('hex');
    const membership = await unit.get('family_memberships', key), user = await unit.get('users', userId);
    if (membership?.familyId === row.familyId && membership.userId === userId && membership.status === 'active'
      && user?.status === 'active' && user.activeFamilyId === row.familyId) ids.add(userId);
  }
  return [...ids];
}
