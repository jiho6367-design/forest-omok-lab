'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const Sync = require('../tools/learning/sync-adoption.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'omok-adoption-sync-'));
const cases = [];
let serial = 0;

function git(root, args) {
  const result = cp.spawnSync('git', args, {cwd: root, windowsHide: true, encoding: 'utf8', env: {...process.env, GIT_TERMINAL_PROMPT: '0'}});
  if (result.error || result.status !== 0) throw Error(`Fixture git ${args[0]} failed: ${result.error?.message || result.stderr}`);
  return result.stdout.trim();
}
function repository() {
  const base = path.join(temporary, String(++serial));
  const remote = path.join(base, 'remote.git');
  const root = path.join(base, 'checkout');
  fs.mkdirSync(root, {recursive: true});
  git(root, ['init', '--bare', '--initial-branch=main', remote]);
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'Adoption fixture']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(root, 'engine.js'), 'immutable engine fixture\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '/outputs/learning/\n/work/\n');
  git(root, ['add', '--', 'engine.js', '.gitignore']);
  git(root, ['commit', '-m', 'Fixture base']);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '--set-upstream', 'origin', 'main']);
  return {root, remote, base, originalHead: git(root, ['rev-parse', 'HEAD'])};
}
function publisherFixture(root, {accepted = true} = {}) {
  const modelText = JSON.stringify({schemaVersion: 1, modelId: 'accepted-fixture', weights: [0.25], adoption: {accepted: true}}) + '\n';
  const artifactHash = hash(modelText);
  const evidenceText = JSON.stringify({schemaVersion: 1, runId: 'fixture-run', accepted: true, artifactHash}) + '\n';
  const files = ['model.json', 'evidence.json'].map(name => `artifacts/adopted-models/${artifactHash}/${name}`);
  const plan = {skipped: false, artifactHash, modelSha256: artifactHash, evidenceSha256: hash(evidenceText), modelId: 'accepted-fixture', runId: 'fixture-run', files};
  const calls = {verify: 0, prepare: 0, check: 0};
  const verify = () => {
    calls.verify++;
    if (!accepted) return {skipped: true, reason: 'no-adopted-model', files: []};
    if (fs.readFileSync(path.join(root, 'engine.js'), 'utf8') !== 'immutable engine fixture\n') throw Error('fixture evaluation source changed');
    return {...plan};
  };
  const prepare = () => {
    calls.prepare++;
    verify();
    for (const [index, file] of files.entries()) {
      const bytes = [modelText, evidenceText][index];
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      if (fs.existsSync(target)) assert.equal(fs.readFileSync(target, 'utf8'), bytes);
      else fs.writeFileSync(target, bytes);
    }
    return {...plan};
  };
  const check = () => {
    calls.check++;
    verify();
    Sync.validateFiles(fs.realpathSync(root), plan);
    return {...plan};
  };
  return {verify, prepare, check, plan, calls, modelText, evidenceText};
}
function remoteHead(remote) { return git(remote, ['rev-parse', 'refs/heads/main']); }
function blocked(fn, code) { assert.throws(fn, error => error.code === code, `Expected blocked ${code}`); }
function check(name, fn) { fn(); cases.push(name); console.log('PASS ' + name); }

check('no accepted model performs no Git command and creates no artifact files', () => {
  const root = path.join(temporary, 'not-a-git-repository');
  fs.mkdirSync(root);
  const publisher = {verify: () => ({skipped: true, reason: 'no-adopted-model', files: []}), prepare: () => assert.fail('must not prepare'), check: () => assert.fail('must not check')};
  const before = fs.readdirSync(root);
  const result = Sync.synchronize({root, push: true, publisher, gitRunner: () => assert.fail('must not invoke Git')});
  assert.equal(result.skipped, true);
  assert.equal(result.pushed, false);
  assert.deepEqual(fs.readdirSync(root), before);
});
check('default dry run verifies adoption without Git, output writes, commits, or pushes', () => {
  const fixture = repository();
  const publisher = publisherFixture(fixture.root);
  const result = Sync.synchronize({root: fixture.root, publisher, gitRunner: () => assert.fail('dry run must not invoke Git')});
  assert.equal(result.reason, 'verified-adoption-dry-run');
  assert.equal(publisher.calls.prepare, 0);
  assert(!fs.existsSync(path.join(fixture.root, 'artifacts')));
  assert.equal(remoteHead(fixture.remote), fixture.originalHead);
});
check('only the two exact validated files enter a publication commit and local bare remote', () => {
  const fixture = repository();
  const publisher = publisherFixture(fixture.root);
  // Ignored raw data never enters the Git status/allowed publication diff.
  fs.mkdirSync(path.join(fixture.root, 'outputs/learning/runs/local'), {recursive: true});
  fs.writeFileSync(path.join(fixture.root, 'outputs/learning/runs/local/experience.sqlite'), 'local experience stays local');
  const result = Sync.synchronize({root: fixture.root, push: true, publisher});
  assert.equal(result.pushed, true);
  assert.equal(remoteHead(fixture.remote), result.commit);
  assert.equal(git(fixture.root, ['rev-parse', `${result.commit}^`]), fixture.originalHead);
  assert.deepEqual(git(fixture.root, ['diff-tree', '--no-commit-id', '--name-only', '-r', result.commit]).split('\n').sort(), publisher.plan.files.slice().sort());
  for (const file of publisher.plan.files) assert.equal(git(fixture.remote, ['show', `main:${file}`]), fs.readFileSync(path.join(fixture.root, file), 'utf8').trim());
  assert.equal(git(fixture.root, ['status', '--porcelain']), '');
  assert(!git(fixture.remote, ['ls-tree', '-r', '--name-only', 'main']).includes('experience.sqlite'));
  const repeated = Sync.synchronize({root: fixture.root, push: true, publisher});
  assert.equal(repeated.reason, 'adoption-already-synchronized');
  assert.equal(repeated.commit, result.commit);
  assert.equal(remoteHead(fixture.remote), result.commit);
});
check('non-main branch is refused before publication writes', () => {
  const fixture = repository();
  git(fixture.root, ['checkout', '-b', 'other-work']);
  const publisher = publisherFixture(fixture.root);
  blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher}), 'BRANCH_NOT_MAIN');
  assert.equal(publisher.calls.prepare, 0);
  assert.equal(remoteHead(fixture.remote), fixture.originalHead);
});
check('unrelated tracked and untracked work is preserved and blocks automatic synchronization', () => {
  for (const name of ['tracked', 'untracked']) {
    const fixture = repository();
    const file = path.join(fixture.root, name === 'tracked' ? '.gitignore' : 'unfinished.txt');
    fs.appendFileSync(file, 'unfinished user work\n');
    const bytes = fs.readFileSync(file);
    const publisher = publisherFixture(fixture.root);
    blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher}), 'DIRTY_WORKTREE');
    assert.deepEqual(fs.readFileSync(file), bytes);
    assert.equal(publisher.calls.prepare, 0);
    assert.equal(remoteHead(fixture.remote), fixture.originalHead);
  }
});
check('pre-existing staged user changes are neither reset nor included', () => {
  const fixture = repository();
  fs.writeFileSync(path.join(fixture.root, 'unfinished.txt'), 'user staged work\n');
  git(fixture.root, ['add', '--', 'unfinished.txt']);
  const before = git(fixture.root, ['diff', '--cached']);
  blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher: publisherFixture(fixture.root)}), 'STAGED_CHANGES');
  assert.equal(git(fixture.root, ['diff', '--cached']), before);
  assert.equal(remoteHead(fixture.remote), fixture.originalHead);
});
check('unrelated unpublished maintenance commits cannot hitchhike on candidate publication', () => {
  const fixture = repository();
  fs.writeFileSync(path.join(fixture.root, 'maintenance.txt'), 'authorized separately\n');
  git(fixture.root, ['add', '--', 'maintenance.txt']);
  git(fixture.root, ['commit', '-m', 'Separate maintenance']);
  const before = git(fixture.root, ['rev-parse', 'HEAD']);
  const publisher = publisherFixture(fixture.root);
  blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher}), 'UPSTREAM_DIVERGED');
  assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), before);
  assert.equal(publisher.calls.prepare, 0);
  assert.equal(remoteHead(fixture.remote), fixture.originalHead);
});
check('offline fetch blocks before publication files are written', () => {
  const fixture = repository();
  const publisher = publisherFixture(fixture.root);
  let fetches = 0;
  blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher, gitRunner: args => {
    if (args.args[0] === 'fetch') { fetches++; return {status: 128, stdout: Buffer.alloc(0), stderr: Buffer.from('offline')}; }
    return Sync.defaultGit(args);
  }}), 'GIT_COMMAND_FAILED');
  assert.equal(fetches, 1);
  assert.equal(publisher.calls.prepare, 0);
  assert(!fs.existsSync(path.join(fixture.root, 'artifacts')));
});
check('an advanced origin/main is preserved and automatic publication does not merge it', () => {
  const fixture = repository();
  const other = path.join(fixture.base, 'other');
  git(fixture.root, ['clone', fixture.remote, other]);
  git(other, ['config', 'user.name', 'Other fixture']);
  git(other, ['config', 'user.email', 'other@example.invalid']);
  fs.writeFileSync(path.join(other, 'remote.txt'), 'other authorized work\n');
  git(other, ['add', '--', 'remote.txt']);
  git(other, ['commit', '-m', 'Remote maintenance']);
  git(other, ['push', 'origin', 'main']);
  const remote = remoteHead(fixture.remote);
  const publisher = publisherFixture(fixture.root);
  blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher}), 'UPSTREAM_DIVERGED');
  assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), fixture.originalHead);
  assert.equal(remoteHead(fixture.remote), remote);
  assert.equal(publisher.calls.prepare, 0);
});
check('source identity changes while preparing block staging and leave source bytes intact', () => {
  const fixture = repository();
  const publisher = publisherFixture(fixture.root);
  const changed = 'changed source fixture\n';
  assert.throws(() => Sync.synchronize({root: fixture.root, push: true, publisher, hooks: {beforePrepare() {
    fs.writeFileSync(path.join(fixture.root, 'engine.js'), changed);
  }}}), /evaluation source changed/);
  assert.equal(fs.readFileSync(path.join(fixture.root, 'engine.js'), 'utf8'), changed);
  assert.equal(git(fixture.root, ['diff', '--cached']), '');
  assert.equal(remoteHead(fixture.remote), fixture.originalHead);
});
check('extra paths and oversized publication files are refused before any upload', () => {
  for (const failure of ['extra', 'oversize']) {
    const fixture = repository();
    const publisher = publisherFixture(fixture.root);
    publisher.prepare();
    if (failure === 'extra') fs.writeFileSync(path.join(fixture.root, path.dirname(publisher.plan.files[0]), 'checkpoint.pt'), 'never publish');
    else fs.writeFileSync(path.join(fixture.root, publisher.plan.files[0]), Buffer.alloc(Sync.MAX_MODEL_BYTES + 1));
    blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher}), failure === 'extra' ? 'PUBLICATION_EXTRA_FILE' : 'PUBLICATION_SIZE');
    assert.equal(remoteHead(fixture.remote), fixture.originalHead);
    assert.equal(git(fixture.root, ['diff', '--cached']), '');
  }
});
check('junctions and symlink artifacts cannot redirect the publication allowlist', () => {
  const fixture = repository();
  const publisher = publisherFixture(fixture.root);
  const outside = path.join(fixture.base, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(fixture.root, 'artifacts'), process.platform === 'win32' ? 'junction' : 'dir');
  blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher}), 'PUBLICATION_LINK');
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(remoteHead(fixture.remote), fixture.originalHead);
});
check('tampering with staged bytes is detected and left for review without a remote write', () => {
  const fixture = repository();
  const publisher = publisherFixture(fixture.root);
  blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher, hooks: {afterStage() {
    fs.writeFileSync(path.join(fixture.root, publisher.plan.files[0]), 'tampered model');
    git(fixture.root, ['add', '--', publisher.plan.files[0]]);
  }}}), 'STAGED_CONTENTS_CHANGED');
  assert(git(fixture.root, ['diff', '--cached', '--name-only']).includes(publisher.plan.files[0]));
  assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), fixture.originalHead);
  assert.equal(remoteHead(fixture.remote), fixture.originalHead);
});
check('a commit hook that introduces unrelated files is detected before push', () => {
  const fixture = repository();
  const publisher = publisherFixture(fixture.root);
  const hook = path.join(fixture.root, '.git/hooks/pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nprintf "hook changed file\\n" > injected.txt\ngit add -- injected.txt\n');
  fs.chmodSync(hook, 0o755);
  blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher}), 'COMMIT_CHANGED');
  assert.equal(remoteHead(fixture.remote), fixture.originalHead);
  assert(git(fixture.root, ['ls-tree', '-r', '--name-only', 'HEAD']).includes('injected.txt'));
});
check('a commit hook cannot publish an executable or link mode even with identical verified bytes', () => {
  const fixture = repository();
  const publisher = publisherFixture(fixture.root);
  const hook = path.join(fixture.root, '.git/hooks/pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\ngit update-index --chmod=+x -- "' + publisher.plan.files[0] + '"\n');
  fs.chmodSync(hook, 0o755);
  blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher}), 'COMMIT_CHANGED');
  assert.equal(remoteHead(fixture.remote), fixture.originalHead);
});
check('work appearing immediately before push blocks transmission and stays available for review', () => {
  const fixture = repository();
  const publisher = publisherFixture(fixture.root);
  const bytes = 'new unfinished user work\n';
  blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher, hooks: {beforePush() {
    fs.writeFileSync(path.join(fixture.root, 'new-user-work.txt'), bytes);
  }}}), 'DIRTY_WORKTREE');
  assert.equal(remoteHead(fixture.remote), fixture.originalHead);
  assert.equal(fs.readFileSync(path.join(fixture.root, 'new-user-work.txt'), 'utf8'), bytes);
});
check('ignored publication paths are never force-added', () => {
  const fixture = repository();
  fs.appendFileSync(path.join(fixture.root, '.gitignore'), '/artifacts/adopted-models/\n');
  git(fixture.root, ['add', '--', '.gitignore']);
  git(fixture.root, ['commit', '-m', 'Fixture ignored publication']);
  git(fixture.root, ['push', 'origin', 'main']);
  const before = remoteHead(fixture.remote);
  const publisher = publisherFixture(fixture.root);
  blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher}), 'PUBLICATION_IGNORED');
  assert.equal(publisher.calls.prepare, 0);
  assert(!fs.existsSync(path.join(fixture.root, 'artifacts')));
  assert.equal(remoteHead(fixture.remote), before);
});
check('a failed push retains its adoption-only local commit and conservative retry refuses to broaden it', () => {
  const fixture = repository();
  const publisher = publisherFixture(fixture.root);
  blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher, gitRunner: args => args.args[0] === 'push'
    ? {status: 128, stdout: Buffer.alloc(0), stderr: Buffer.from('fixture push unavailable')}
    : Sync.defaultGit(args)}), 'GIT_COMMAND_FAILED');
  const unpublished = git(fixture.root, ['rev-parse', 'HEAD']);
  assert.notEqual(unpublished, fixture.originalHead);
  assert.equal(remoteHead(fixture.remote), fixture.originalHead);
  blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher}), 'UPSTREAM_DIVERGED');
  assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), unpublished);
  assert.equal(remoteHead(fixture.remote), fixture.originalHead);
});
check('remote changes between commit and push preserve both histories and refuse the upload', () => {
  const fixture = repository();
  const publisher = publisherFixture(fixture.root);
  let advanced;
  blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher, hooks: {beforePush() {
    const other = path.join(fixture.base, 'before-push-other');
    git(fixture.root, ['clone', fixture.remote, other]);
    git(other, ['config', 'user.name', 'Remote fixture']);
    git(other, ['config', 'user.email', 'remote@example.invalid']);
    fs.writeFileSync(path.join(other, 'remote.txt'), 'advanced during publication\n');
    git(other, ['add', '--', 'remote.txt']);
    git(other, ['commit', '-m', 'Concurrent remote work']);
    git(other, ['push', 'origin', 'main']);
    advanced = remoteHead(fixture.remote);
  }}}), 'UPSTREAM_CHANGED');
  assert.equal(remoteHead(fixture.remote), advanced);
  assert.notEqual(git(fixture.root, ['rev-parse', 'HEAD']), advanced);
});
check('malformed publication plans cannot include arbitrary files or duplicate allowlist names', () => {
  const fixture = repository();
  for (const files of [['engine.js', 'evidence.json'], ['artifacts/adopted-models/' + 'a'.repeat(64) + '/model.json', 'artifacts/adopted-models/' + 'a'.repeat(64) + '/model.json']]) {
    const publisher = publisherFixture(fixture.root);
    publisher.verify = () => ({...publisher.plan, files});
    blocked(() => Sync.synchronize({root: fixture.root, push: true, publisher}), 'PUBLICATION_PATH_INVALID');
  }
  assert.equal(remoteHead(fixture.remote), fixture.originalHead);
});

console.log(JSON.stringify({suite: 'learning-sync-adoption', passed: cases.length, fixtureRoot: temporary, realRemoteModified: false}));
