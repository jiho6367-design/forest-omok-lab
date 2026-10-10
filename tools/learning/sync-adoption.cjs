'use strict';

// Automatic synchronization is deliberately narrower than maintenance pushes.
// It can publish two verified adoption files and cannot include source changes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const OUTPUT = 'artifacts/adopted-models';
const FILES = ['model.json', 'evidence.json'];
const MAX_MODEL_BYTES = 1024 * 1024;
const MAX_EVIDENCE_BYTES = 64 * 1024;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function refusal(code, message) {
  return Object.assign(new Error(message), {code});
}

function defaultGit({root, args}) {
  const result = cp.spawnSync('git', args, {
    cwd: root, windowsHide: true, encoding: null, maxBuffer: 4 * 1024 * 1024,
    env: {...process.env, GIT_TERMINAL_PROMPT: '0'},
  });
  if (result.error) throw refusal('GIT_UNAVAILABLE', 'Git could not run; no automatic upload was performed.');
  return {status: result.status, stdout: result.stdout || Buffer.alloc(0), stderr: result.stderr || Buffer.alloc(0)};
}

function planFiles(plan) {
  if (!/^[a-f0-9]{64}$/.test(plan?.artifactHash || '') || plan.modelSha256 !== plan.artifactHash ||
      !/^[a-f0-9]{64}$/.test(plan.evidenceSha256 || '')) {
    throw refusal('PUBLICATION_PLAN_INVALID', 'Publisher must supply bounded, SHA-256-bound adoption artifacts.');
  }
  const expected = FILES.map(name => `${OUTPUT}/${plan.artifactHash}/${name}`);
  if (!Array.isArray(plan.files) || plan.files.length !== 2 ||
      new Set(plan.files).size !== 2 || expected.some(file => !plan.files.includes(file))) {
    throw refusal('PUBLICATION_PATH_INVALID', 'Only the adopted model and its evidence may be synchronized.');
  }
  return expected;
}

function assertNoLinks(root, relative, {missing = false} = {}) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw refusal('PUBLICATION_PATH_INVALID', 'Publication path escaped the repository.');
  let current = root;
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { if (missing && error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) throw refusal('PUBLICATION_LINK', 'Publication paths must not contain symlinks or junctions.');
    if (fs.realpathSync(current) !== current) throw refusal('PUBLICATION_LINK', 'Publication paths must stay in their actual repository directory.');
  }
}

function validateFiles(root, plan, {missing = false} = {}) {
  const files = planFiles(plan);
  for (const [index, relative] of files.entries()) {
    assertNoLinks(root, relative, {missing});
    const file = path.join(root, ...relative.split('/'));
    let stat;
    try { stat = fs.lstatSync(file); }
    catch (error) { if (missing && error.code === 'ENOENT') continue; throw error; }
    const cap = index === 0 ? MAX_MODEL_BYTES : MAX_EVIDENCE_BYTES;
    if (!stat.isFile() || stat.size <= 0 || stat.size > cap) {
      throw refusal('PUBLICATION_SIZE', 'Publication files must be regular files within the model/evidence size limits.');
    }
    const expectedHash = index === 0 ? plan.modelSha256 : plan.evidenceSha256;
    if (sha256(fs.readFileSync(file)) !== expectedHash) throw refusal('PUBLICATION_CHANGED', 'Publication bytes changed after adoption verification.');
  }
  const directory = path.join(root, OUTPUT, plan.artifactHash);
  if (fs.existsSync(directory)) {
    assertNoLinks(root, `${OUTPUT}/${plan.artifactHash}`);
    if (fs.readdirSync(directory).some(name => !FILES.includes(name))) {
      throw refusal('PUBLICATION_EXTRA_FILE', 'The publication directory contains files beyond its two allowed artifacts.');
    }
  }
  return files;
}

function parseStatus(value) {
  return value.toString('utf8').split('\0').filter(Boolean).map(entry => {
    if (entry.length < 4 || entry[2] !== ' ' || /[RC]/.test(entry.slice(0, 2))) {
      throw refusal('DIRTY_WORKTREE', 'Renames or unsupported worktree changes require a separate maintenance review.');
    }
    return {index: entry[0], worktree: entry[1], path: entry.slice(3)};
  });
}

function synchronize({root = path.resolve(__dirname, '../..'), push = false,
  publisher = require('./publish-adoption.cjs'), gitRunner = defaultGit, identityProvider, hooks = {}} = {}) {
  root = fs.realpathSync(root);
  const publisherOptions = {root, ...(identityProvider ? {identityProvider} : {})};
  const plan = publisher.verify(publisherOptions);
  // In particular, do not fetch, write a receipt, or create an output directory.
  if (plan?.skipped && (!plan.files || plan.files.length === 0)) {
    return {skipped: true, reason: plan.reason || 'no-adopted-model', files: [], pushed: false};
  }
  const files = planFiles(plan);
  validateFiles(root, plan, {missing: true});
  if (!push) return {skipped: false, reason: 'verified-adoption-dry-run', files, artifactHash: plan.artifactHash, pushed: false};

  const git = (args, {allowFailure = false} = {}) => {
    const result = gitRunner({root, args});
    if (result.status !== 0 && !allowFailure) {
      // Avoid echoing remote URLs, credentials, or hook output from Git's stderr.
      throw refusal('GIT_COMMAND_FAILED', `Git ${args[0]} failed (exit ${result.status}); no reset, stash, or force operation was attempted.`);
    }
    return result;
  };
  const text = args => git(args).stdout.toString('utf8').trim();
  const assertBranch = () => {
    if (text(['rev-parse', '--show-toplevel']).replace(/\\/g, '/') !== root.replace(/\\/g, '/')) {
      throw refusal('GIT_ROOT_MISMATCH', 'Automatic synchronization must run at the actual repository root.');
    }
    if (text(['symbolic-ref', '--short', 'HEAD']) !== 'main') throw refusal('BRANCH_NOT_MAIN', 'Automatic adoption synchronization requires main.');
  };
  const assertClean = () => {
    const status = parseStatus(git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout);
    for (const row of status) {
      if (row.index !== ' ' && row.index !== '?') throw refusal('STAGED_CHANGES', 'The index contains existing changes; preserve them for a separate maintenance review.');
      if (!files.includes(row.path)) throw refusal('DIRTY_WORKTREE', 'The worktree contains unrelated changes; automatic adoption upload was not attempted.');
    }
  };
  const fetch = () => git(['fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
  const head = () => text(['rev-parse', 'HEAD']);
  const upstream = () => text(['rev-parse', 'refs/remotes/origin/main']);
  const verifyPlan = () => {
    const verified = publisher.verify(publisherOptions);
    if (verified.skipped || JSON.stringify(planFiles(verified)) !== JSON.stringify(files) ||
        verified.modelSha256 !== plan.modelSha256 || verified.evidenceSha256 !== plan.evidenceSha256) {
      throw refusal('ADOPTION_CHANGED', 'The adopted model or its evidence changed during synchronization.');
    }
    return verified;
  };
  const verifyIndex = () => {
    const records = git(['diff', '--cached', '--name-status', '-z']).stdout.toString('utf8').split('\0').filter(Boolean);
    if (records.length !== 4 || records[0] !== 'A' || records[2] !== 'A' ||
        new Set([records[1], records[3]]).size !== 2 || [records[1], records[3]].some(file => !files.includes(file))) {
      throw refusal('STAGED_CONTENTS_CHANGED', 'The staged diff must contain exactly the two newly adopted publication files.');
    }
    for (const [index, file] of files.entries()) {
      const mode = text(['ls-files', '--stage', '--', file]).split(' ')[0];
      if (mode !== '100644') throw refusal('PUBLICATION_INDEX_MODE', 'Staged publication files must be regular non-executable files.');
      const bytes = git(['show', `:${file}`]).stdout;
      if (bytes.length > (index === 0 ? MAX_MODEL_BYTES : MAX_EVIDENCE_BYTES) ||
          sha256(bytes) !== (index === 0 ? plan.modelSha256 : plan.evidenceSha256)) {
        throw refusal('STAGED_CONTENTS_CHANGED', 'The staged publication bytes differ from the verified adoption.');
      }
    }
  };

  assertBranch();
  assertClean();
  fetch();
  const base = head();
  if (base !== upstream()) throw refusal('UPSTREAM_DIVERGED', 'Local and origin/main differ; preserve unrelated or unpublished commits for a separate review.');
  verifyPlan();
  const tracked = files.map(file => git(['ls-files', '--error-unmatch', '--', file], {allowFailure: true}).status === 0);
  if (tracked.some(Boolean)) {
    if (!tracked.every(Boolean)) throw refusal('PUBLICATION_INCOMPLETE', 'Only part of this adoption is tracked; automatic repair is refused.');
    validateFiles(root, plan);
    for (const [index, file] of files.entries()) {
      if (sha256(git(['show', `HEAD:${file}`]).stdout) !== (index === 0 ? plan.modelSha256 : plan.evidenceSha256)) {
        throw refusal('PUBLICATION_CHANGED', 'An immutable publication already exists with different bytes.');
      }
    }
    publisher.check(publisherOptions);
    assertClean();
    return {skipped: true, reason: 'adoption-already-synchronized', files, commit: base, pushed: false};
  }
  for (const file of files) if (git(['check-ignore', '--quiet', '--', file], {allowFailure: true}).status === 0) {
    throw refusal('PUBLICATION_IGNORED', 'Publication files are ignored; force-add is not permitted.');
  }
  hooks.beforePrepare?.({root, plan, base});
  const prepared = publisher.prepare(publisherOptions);
  if (JSON.stringify(planFiles(prepared)) !== JSON.stringify(files) || prepared.modelSha256 !== plan.modelSha256 ||
      prepared.evidenceSha256 !== plan.evidenceSha256) throw refusal('ADOPTION_CHANGED', 'The prepared publication differs from its verified plan.');
  validateFiles(root, plan);
  publisher.check(publisherOptions);
  assertBranch();
  assertClean();
  if (head() !== base) throw refusal('HEAD_CHANGED', 'Local HEAD changed while preparing adoption; preserve both changes.');
  hooks.beforeStage?.({root, plan, base});
  validateFiles(root, plan);
  verifyPlan();
  assertClean();
  git(['add', '--', ...files]);
  hooks.afterStage?.({root, plan, base});
  verifyIndex();
  validateFiles(root, plan);
  publisher.check(publisherOptions);
  assertBranch();
  if (head() !== base) throw refusal('HEAD_CHANGED', 'Local HEAD changed before the adoption commit.');
  git(['commit', '-m', `Publish adopted model ${String(plan.modelId || '').slice(0, 80)} (${plan.artifactHash.slice(0, 12)})`]);
  const commit = head();
  // Hooks and concurrent Git operations cannot expand what is sent upstream.
  const parents = text(['rev-list', '--parents', '-n', '1', commit]).split(' ');
  if (parents.length !== 2 || parents[1] !== base) throw refusal('COMMIT_CHANGED', 'Publication commit must have the verified main commit as its sole parent.');
  const committedPaths = git(['diff-tree', '--no-commit-id', '--name-status', '-r', '-z', commit]).stdout.toString('utf8').split('\0').filter(Boolean);
  if (committedPaths.length !== 4 || committedPaths[0] !== 'A' || committedPaths[2] !== 'A' ||
      new Set([committedPaths[1], committedPaths[3]]).size !== 2 || [committedPaths[1], committedPaths[3]].some(file => !files.includes(file))) {
    throw refusal('COMMIT_CHANGED', 'Publication commit includes unexpected changes; it was not pushed.');
  }
  for (const [index, file] of files.entries()) {
    if (text(['ls-tree', commit, '--', file]).split(' ')[0] !== '100644') {
      throw refusal('COMMIT_CHANGED', 'Publication commit contains a link or executable artifact; it was not pushed.');
    }
    if (sha256(git(['show', `${commit}:${file}`]).stdout) !== (index === 0 ? plan.modelSha256 : plan.evidenceSha256)) {
      throw refusal('COMMIT_CHANGED', 'Publication commit contains bytes different from the verified adoption.');
    }
  }
  if (git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout.length) {
    throw refusal('DIRTY_WORKTREE', 'Changes appeared during the adoption commit; the commit remains local.');
  }
  publisher.check(publisherOptions);
  hooks.beforePush?.({root, plan, base, commit});
  fetch();
  assertBranch();
  if (head() !== commit || upstream() !== base) throw refusal('UPSTREAM_CHANGED', 'Main or origin/main changed before push; the verified adoption commit remains local.');
  validateFiles(root, plan);
  publisher.check(publisherOptions);
  if (git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout.length) {
    throw refusal('DIRTY_WORKTREE', 'Changes appeared before push; the adoption commit remains local.');
  }
  git(['push', 'origin', `${commit}:refs/heads/main`]);
  const remote = text(['ls-remote', '--exit-code', 'origin', 'refs/heads/main']).split(/\s+/)[0];
  if (remote !== commit) throw refusal('REMOTE_NOT_CONFIRMED', 'Push returned but the remote adoption commit could not be confirmed.');
  return {skipped: false, reason: 'verified-adoption-synchronized', files, artifactHash: plan.artifactHash, commit, pushed: true};
}

function main(argv = process.argv.slice(2)) {
  if (argv.some(arg => arg !== '--push' && arg !== '--help')) throw refusal('CLI_ARGUMENT', 'Usage: node tools/learning/sync-adoption.cjs [--push]');
  if (argv.includes('--help')) {
    console.log('Usage: node tools/learning/sync-adoption.cjs [--push]\nDefault: verify only. --push: publish two adoption files on clean, synchronized origin/main.');
    return;
  }
  const result = synchronize({push: argv.includes('--push')});
  console.log(JSON.stringify(result));
  return result;
}

module.exports = {synchronize, validateFiles, planFiles, defaultGit, main, OUTPUT, FILES, MAX_MODEL_BYTES, MAX_EVIDENCE_BYTES};
if (require.main === module) {
  try { main(); }
  catch (error) { console.error(JSON.stringify({status: 'blocked', code: error.code || 'PUBLICATION_FAILED', message: error.message})); process.exitCode = 1; }
}
