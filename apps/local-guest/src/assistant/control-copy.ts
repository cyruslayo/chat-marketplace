/** Platform-owned fixed responses. No model or external text enters these strings. */
export const ASSISTANT_CONTROL_COPY = {
  redirect: "I can help you find accommodation, review stay prices, and manage your booking. What do you need for your stay?",
  unavailable: "Please tell me what you need for your stay. You can also use the standard search and booking pages.",
  /** Issue 04 follow-up: a task whose pack is not registered, or whose id matches no task. Points to the task list, not a retry. */
  unregisteredTask: "This task is not available in this conversation any more. Choose another task from the task list, or start a new one, to continue.",
  /** ADR 0074: a confirmation after a search change or task switch removed the proposal. Nothing was sent. */
  proposalReplaced: "That Booking Request was replaced when you changed your search or switched task, so nothing was sent. Ask me again if you still want this stay.",
} as const;
