# GitHub synchronization

The user requested on 2026-10-09 that this local project remain synchronized
with https://github.com/jiho6367-design/forest-omok-lab.

After completing authorized project work, commit and push the finished local
changes to the corresponding origin branch. Existing authorization covers
routine commits and pushes; do not request confirmation again.

Use the local working folder as the source of project changes. Respect
`.gitignore`: internal experiments, learning data, and local active models stay
on disk. Do not delete local data or force-add ignored files to synchronize.
Fetch before pushing and verify the local and remote commit IDs afterward.
Never force-push, reset local changes, or overwrite divergent remote history.
If remote commits conflict with local work, preserve both and report the issue.
Run checks appropriate to source changes and report any failures accurately.

## Scheduled adoption-only publication

The user's 2026-10-10 policy supersedes broad automatic synchronization of
experiments. The scheduled Omok task named `github` must run
`node tools/learning/sync-adoption.cjs --push`. If there is no new, verified
adoption, skip publication and do not commit or push any other local changes.
The scheduled task must not infer general maintenance authorization from its
older broad prompt or the routine synchronization paragraph above. Maintenance
commits require a separate, explicit user request; this scheduled task is only
authorised to publish verified adopted-model artifacts.
Only the two validated files for an adopted model under
`artifacts/adopted-models/<artifact-sha256>/` may be staged by this task.
The guard must refuse unrelated working/index changes, unrelated unpublished
commits, remote divergence and mismatched adoption evidence. Never use
`git add .`, `git add -A`, force-add ignored data, or force-push for this task.

Keep runs, complete games, experience databases, training snapshots, optimizer
checkpoints, unaccepted candidates and temporary files local. Do not label an
unaccepted or incomplete evaluation as adoption. Preserve other scheduled
tasks, including the independent python-class Sunday synchronization.

This automatic publication rule is separate from explicitly authorized
maintenance: completed source, test and documentation fixes may still be
reviewed, committed and pushed without manufacturing an adoption event.
Stage only that work; preserve and exclude unfinished changes from other
workers. CI contracts must use small generated fixtures in a clean checkout;
production-run archive checks are explicit optional local integration checks.
See `docs/github-adoption-policy.md` for the publication boundary.
