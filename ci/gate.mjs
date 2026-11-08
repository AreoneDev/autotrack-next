import { pathToFileURL } from 'node:url';
import { suites } from './plan.mjs';

export function validate(needs, testedSha) {
    const errors = [];
    if (needs.plan?.result !== 'success') errors.push('Test planning did not succeed');
    if (!testedSha || needs.plan?.outputs?.tested_sha !== testedSha) errors.push('Tested SHA does not match this run');
    for (const suite of suites) {
        const flag = needs.plan?.outputs?.[suite];
        const result = needs[suite]?.result;
        if (!['true', 'false'].includes(flag)) errors.push(suite + ': missing/invalid plan');
        if (flag === 'true' && result !== 'success') errors.push(suite + ': required but ' + result);
        if (flag === 'false' && !['success', 'skipped'].includes(result)) errors.push(suite + ': unexpected ' + result);
    }
    return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const errors = validate(JSON.parse(process.env.CI_NEEDS), process.env.GITHUB_SHA);
    if (errors.length) {
        console.error(errors.join('\n'));
        process.exitCode = 1;
    } else {
        console.log('All affected suites passed for ' + process.env.GITHUB_SHA);
    }
}
