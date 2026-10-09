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
