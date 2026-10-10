/**
 * The Durable Object's alarm work, structured as a task list.
 *
 * 10b runs one task (the notifier sweep); 12a adds the daily export and orphan-receipt sweep to the same list. A
 * task that throws is caught and logged so it can neither stop the remaining tasks nor the alarm's self-reschedule:
 * a Durable Object alarm that throws still fires again, but a lost notifier sweep would silently drop an alert.
 */
export interface AlarmTask {
  readonly name: string;
  run(): Promise<void> | void;
}

/** Run every task even when one throws. Returns the names of the tasks that failed. */
export async function runAlarmTasks(
  tasks: readonly AlarmTask[],
  log: (line: string) => void,
): Promise<readonly string[]> {
  const failed: string[] = [];
  for (const task of tasks) {
    try {
      await task.run();
    } catch (error) {
      failed.push(task.name);
      log(
        JSON.stringify({
          event: "alarm_task_failed",
          task: task.name,
          errorClass: error instanceof Error ? error.constructor.name : typeof error,
        }),
      );
    }
  }
  return failed;
}
