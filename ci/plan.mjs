import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const suites = ['checks', 'e2e', 'supabase', 'browser', 'dependencies', 'recovery'];
const full = reason => ({ ...Object.fromEntries(suites.map(s => [s, true])), reasons: [reason] });

// Narrow allowlists are intentional: a new/unclassified path gets the full suite.
export function classify(paths, force = false) {
    if (force) return full('Explicit full regression or unavailable comparison');
    const plan = { ...Object.fromEntries(suites.map(s => [s, false])), reasons: [] };
    const add = (selected, reason) => {
        for (const suite of selected) plan[suite] = true;
        plan.reasons.push(reason);
    };
    for (const path of paths) {
        if (/^(docs\/|Storyboard\/)/.test(path) || /^(README|AGENTS|CLAUDE|DevLog)\.md$/.test(path)
            || /^tests\/.*\.md$/.test(path)) continue;
        if (/^(app\/|components\/|public\/)/.test(path)) {
            add(['checks', 'e2e', 'browser'], 'Application, UI or asset change');
        } else if (/^tests\/(unit|integration|ui)\//.test(path)) {
            add(['checks'], 'Jest test change');
        } else if (/^tests\/e2e\//.test(path)) {
            // NFR imports the same backend/journey fixtures.
            add(['checks', 'e2e', 'browser'], 'Browser test or shared HTTP fixture change');
        } else if (/^tests\/supabase\//.test(path)) {
            add(['supabase'], 'Supabase test change');
        } else if (path === 'tests/nonfunctional/dependency-audit.mjs') {
            add(['dependencies'], 'Dependency audit change');
        } else if (/^tests\/nonfunctional\//.test(path)) {
            add(['browser'], 'Nonfunctional browser test change');
        } else if (/^tests\/(recovery|data-recovery)\//.test(path)) {
            // Supabase's bootstrap and recovery suites share SQL fixtures.
            add(['recovery', 'supabase'], 'Recovery or shared database fixture change');
        } else {
            return full('Shared code, database, dependencies, tooling or unclassified path: ' + path);
        }
    }
    if (!plan.reasons.length) plan.reasons.push('Documentation-only or empty diff');
    plan.reasons = [...new Set(plan.reasons)];
    return plan;
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const sha = value => typeof value === 'string' && /^[a-f0-9]{40,64}$/.test(value) && !/^0+$/.test(value);

// Returns both sides of moves/deletions by disabling rename detection, with NUL
// separation so spaces/newlines/unicode in filenames cannot hide changes.
export function changedPaths(base, head, cwd) {
    return git(['diff', '--no-renames', '--name-only', '-z', base, head, '--'], cwd).split('\0').filter(Boolean);
}

export function comparison(eventName, event, cwd) {
    if (eventName === 'pull_request') {
        const base = event.pull_request?.base?.sha;
        const head = event.pull_request?.head?.sha;
        if (!sha(base) || !sha(head)) throw new Error('Missing PR refs');
        return [git(['merge-base', base, head], cwd).trim(), head];
    }
    if (eventName === 'push') {
        if (!sha(event.before) || !sha(event.after)) throw new Error('Initial push or missing refs');
        return [event.before, event.after];
    }
    if (eventName === 'merge_group') {
        if (!sha(event.merge_group?.base_sha) || !sha(event.merge_group?.head_sha)) throw new Error('Missing merge group refs');
        return [event.merge_group.base_sha, event.merge_group.head_sha];
    }
    throw new Error('Manual/unknown event requires full regression');
}

export function eventPlan(eventName, event, cwd) {
    try {
        const [base, head] = comparison(eventName, event, cwd);
        return { ...classify(changedPaths(base, head, cwd)), base, head };
    } catch (error) {
        // Fail safe for initial commits, unreachable history, force pushes, etc.
        return { ...full(error.message), base: null, head: null };
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const plan = eventPlan(process.env.GITHUB_EVENT_NAME, event);
    const testedSha = process.env.GITHUB_SHA;
    if (!sha(testedSha)) throw new Error('Missing tested commit SHA');
    if (git(['rev-parse', 'HEAD']).trim() !== testedSha) throw new Error('Checkout does not match tested commit SHA');
    console.log(JSON.stringify({ testedSha, ...plan }, null, 2));
    for (const suite of suites) appendFileSync(process.env.GITHUB_OUTPUT, suite + '=' + plan[suite] + '\n');
    appendFileSync(process.env.GITHUB_OUTPUT, 'tested_sha=' + testedSha + '\n');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        '## Test plan\n\nTested commit: ' + testedSha + '\n\nDiff: ' + (plan.base ?? 'full') + ' → ' + (plan.head ?? testedSha)
        + '\n\n' + suites.map(s => '- ' + s + ': ' + (plan[s] ? 'required' : 'not affected')).join('\n')
        + '\n\n' + plan.reasons.join('\n') + '\n');
}
