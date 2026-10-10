# Staffed dry run with one real paid booking

Status: ready-for-human
Type: task
Blocked by: 03, 04, 05, 06, 07, 08, 09, 10

## What to do

A real person books a real unit with real money on the production deployment, stays and checks out, while the support rota runs. This replaces issue 44's simulated rehearsal.

## Acceptance criteria

- [ ] The booking goes request → confirm → pay → reservation → ID check → Verified Access → checkout → owner paid, with timestamps recorded.
- [ ] At least one injected failure (for example, an access code that doesn't work) is handled using the playbook.
- [ ] A debrief lists every problem, with an owner, and says whether it blocks launch.
