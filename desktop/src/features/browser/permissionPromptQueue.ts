import type { PermissionRequest } from '../../services/nativeBrowser'

export type PermissionPromptQueueAction =
  | { type: 'enqueue'; request: PermissionRequest }
  | { type: 'dismiss'; requestId: string }

/**
 * FIFO queue of permission requests. Index 0 is the prompt currently shown in
 * the address bar; the rest wait their turn.
 *
 * The displayed request stays at the head until the user decides, and
 * `dismiss` removes exactly that head. Keeping the current request out of the
 * queue (or shifting before rendering) caused the same prompt to be shown
 * again on the next `decide()` call.
 */
export function permissionPromptQueueReducer(
  queue: readonly PermissionRequest[],
  action: PermissionPromptQueueAction,
): PermissionRequest[] {
  if (action.type === 'enqueue') return [...queue, action.request]
  if (queue.length === 0) return queue as PermissionRequest[]
  if (queue[0].requestId === action.requestId) return queue.slice(1)
  // The request was already dismissed (or belongs to another tab): drop it
  // without changing which prompt is currently visible.
  return queue.filter(item => item.requestId !== action.requestId)
}
