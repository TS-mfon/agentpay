import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const binary = process.env.GENVM_LINT_BIN || '.venv/bin/genvm-lint';
if (!existsSync(binary)) { console.error('Install requirements.txt into .venv before governance checks.'); process.exit(1); }
const result = spawnSync(binary, ['check', 'governance/AgentMandate.py'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const tests = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'tests/governance', '-v'], { stdio: 'inherit' });
process.exit(tests.status ?? 1);
