# Rules 03: navigation

Status: draft. Screen rules; no policy.

| # | Rule | Source |
| --- | --- | --- |
| N1 | Every guest screen has Help | PRD |
| N2 | Every screen has an exit that is not the browser's Back | Kit R4 |
| N3 | From every screen the guest can reach their list and Find | PRD |
| N4 | The tab bar shows on section pages and never on task screens | PRD |
| N5 | A task screen has one title, one Close, one primary action | Kit R1, R2 |
| N6 | Closing a task changes nothing on the server | 0072 |
| N7 | With one registered domain, no chooser, no domain tag, no other domain's name | 0107 |
| N8 | No screen offers an action the server would refuse for the current state | 0074; rules 01 |
| N9 | Every screen works with no model, and as a plain page with no JavaScript where the task is critical | 0080 |
| N10 | A link from an email opens its own item, and sign-in returns to it | Issue 13 |
| N11 | The badge number has words for screen readers and is not colour alone | 0078 |

Check: one screen table in `test/`, listing each route, its kind (section, task, state) and its exits. The test walks the rendered pages and compares. A route missing from the table fails.
