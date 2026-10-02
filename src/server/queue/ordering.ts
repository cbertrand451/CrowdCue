// Trusted SQL fragments only. Keep the queue policy shared by readers and future delivery workers.
export function queueOrder(votingEnabled: boolean) {
  return `manual_position ASC NULLS LAST, ${votingEnabled ? 'vote_count DESC, ' : ''}created_at ASC, id ASC`;
}
