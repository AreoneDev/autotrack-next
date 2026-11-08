import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classify, changedPaths, comparison, eventPlan, suites } from './plan.mjs';
import { validate } from './gate.mjs';

const selected = paths => suites.filter(s => classify(paths)[s]);
const all = paths => assert.deepEqual(selected(paths), suites);
for (const path of ['README.md', 'docs/release.md', 'tests/TESTING.md', 'Storyboard/screen.png']) {
    test('documentation: ' + path, () => assert.deepEqual(selected([path]), []));
}
for (const path of ['lib/date.ts', 'domain/objects/Lead.ts', 'proxy.ts', 'supabase/migrations/new.sql',
    'package.json', 'package-lock.json', '.github/workflows/ci.yml', 'ci/plan.mjs',
    'tests/helpers/auth.ts', 'tests/setup.ts', 'new-unknown-config', 'jest.config.ts', 'playwright.config.ts']) {
    test('full regression: ' + path, () => all([path]));
}
for (const [path, expected] of [
    ['components/AccountMenu.tsx', ['checks', 'browser']],
    ['app/globals.css', ['checks', 'browser']],
    ['public/logo.svg', ['checks', 'browser']],
    ['tests/ui/LoginPage.test.tsx', ['checks']],
    ['tests/integration/persistence/real/LeadRepo.test.ts', ['checks']],
    ['tests/e2e/fixtures/supabase-server.mjs', ['checks', 'browser']],
    ['tests/supabase/security.live.ts', ['supabase']],
    ['tests/recovery/bootstrap.sql', ['supabase', 'recovery']],
    ['tests/data-recovery/run.mjs', ['supabase', 'recovery']],
    ['tests/nonfunctional/app.spec.ts', ['browser']],
    ['tests/nonfunctional/dependency-audit.mjs', ['dependencies']],
]) {
    test('scoped regression: ' + path, () => assert.deepEqual(selected([path]), expected));
}
test('mixed changes union their suites', () => assert.deepEqual(selected([
    'README.md', 'tests/ui/Foo.test.tsx', 'tests/supabase/security.live.ts',
]), ['checks', 'supabase']));
test('explicit full regression', () => assert.ok(suites.every(s => classify([], true)[s])));

const sha = 'a'.repeat(40);
const needsFor = required => ({
    plan: { result: 'success', outputs: { tested_sha: sha, ...Object.fromEntries(suites.map(s => [s, String(required.includes(s))])) } },
    ...Object.fromEntries(suites.map(s => [s, { result: required.includes(s) ? 'success' : 'skipped' }])),
});
test('gate accepts intentional skips and all-success', () => {
    assert.deepEqual(validate(needsFor([]), sha), []);
    assert.deepEqual(validate(needsFor(suites), sha), []);
});
for (const result of ['failure', 'cancelled', 'skipped', 'neutral', undefined]) {
    test('required task fails closed on ' + result, () => {
        const needs = needsFor(suites);
        needs.checks.result = result;
        assert.ok(validate(needs, sha).length);
    });
}
for (const result of ['failure', 'cancelled', undefined]) {
    test('unselected task cannot hide ' + result, () => {
        const needs = needsFor([]);
        needs.recovery.result = result;
        assert.ok(validate(needs, sha).length);
    });
}
for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    test('planning fails closed on ' + result, () => {
        const needs = needsFor([]);
        needs.plan.result = result;
        assert.ok(validate(needs, sha).length);
    });
}
test('missing/malformed plan and wrong SHA fail closed', () => {
    assert.ok(validate({}, sha).length);
    const needs = needsFor([]);
    needs.plan.outputs.checks = '';
    assert.ok(validate(needs, sha).length);
    assert.ok(validate(needsFor([]), 'b'.repeat(40)).length);
});

// Use real Git history, including divergence, multi-commit pushes, moves and deletes.
test('event diff integration', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'autotrack-ci-diff-'));
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const commit = message => { git('add', '-A'); git('-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.test', 'commit', '-m', message); return git('rev-parse', 'HEAD'); };
    try {
        git('init', '-b', 'main');
        mkdirSync(join(cwd, 'docs'));
        writeFileSync(join(cwd, 'docs', 'before.md'), 'base');
        const base = commit('base');
        git('checkout', '-b', 'feature');
        writeFileSync(join(cwd, 'docs', 'space file.md'), 'first');
        commit('first of two');
        writeFileSync(join(cwd, 'docs', 'second.md'), 'second');
        const head = commit('second');
        assert.deepEqual(changedPaths(base, head, cwd).sort(), ['docs/second.md', 'docs/space file.md']);
        assert.equal(eventPlan('push', { before: base, after: head }, cwd).head, head);
        git('checkout', 'main');
        writeFileSync(join(cwd, 'package.json'), '{}');
        const mainHead = commit('unrelated base change');
        assert.deepEqual(comparison('pull_request', { pull_request: { base: { sha: mainHead }, head: { sha: head } } }, cwd), [base, head]);
        assert.ok(suites.every(s => !eventPlan('pull_request', { pull_request: { base: { sha: mainHead }, head: { sha: head } } }, cwd)[s]));
        git('checkout', 'feature');
        // Moving a code/config file into docs must still select its old path.
        writeFileSync(join(cwd, 'package.json'), '{}');
        const beforeMove = commit('source');
        renameSync(join(cwd, 'package.json'), join(cwd, 'docs', 'moved.md'));
        rmSync(join(cwd, 'docs', 'before.md'));
        const moved = commit('move and delete');
        const paths = changedPaths(beforeMove, moved, cwd);
        assert.ok(paths.includes('package.json') && paths.includes('docs/moved.md') && paths.includes('docs/before.md'));
        all(paths);
        assert.deepEqual(comparison('merge_group', { merge_group: { base_sha: base, head_sha: head } }, cwd), [base, head]);
        for (const [event, payload] of [
            ['workflow_dispatch', {}], ['push', { before: '0'.repeat(40), after: head }],
            ['push', { before: 'f'.repeat(40), after: head }], ['pull_request', {}], ['unknown', {}],
        ]) assert.ok(suites.every(s => eventPlan(event, payload, cwd)[s]), event);
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});

test('workflow wires every selectable job into its always-running aggregate', async () => {
    const { readFileSync } = await import('node:fs');
    const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    assert.match(workflow, /fetch-depth: 0/);
    assert.doesNotMatch(workflow, /^\s+paths(?:-ignore)?:/m);
    assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
    assert.match(workflow, /needs: \[plan, checks, supabase, browser, dependencies, recovery\]/);
    for (const suite of suites) {
        const block = workflow.split('\n  ' + suite + ':')[1]?.split(/\n  [a-z]+:/)[0];
        assert.ok(block, suite);
        assert.ok(block.includes("if: needs.plan.outputs." + suite + " == 'true'"), suite);
        assert.match(block, /needs: plan/);
    }
    assert.match(workflow, /'Production CI'/);
    assert.match(workflow, /'PR CI'/);
    assert.match(workflow, /'Full regression CI'/);
    assert.match(workflow, /run: npm run test:data-recovery/);
});
