import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const platform = { x64: 'amd64', arm64: 'arm64' }[process.arch];
const command = process.argv[2] ?? 'build';
if (!['build', 'test', 'coverage'].includes(command)) {
  console.error('Use contracts.mjs build, test, or coverage');
  process.exit(1);
}
let binary;
try {
  const filename = process.platform === 'win32' ? 'forge.exe' : 'forge';
  binary = require.resolve(`@foundry-rs/forge-${process.platform}-${platform}/bin/${filename}`);
} catch {
  const filename = process.platform === 'win32' ? 'forge.exe' : 'forge';
  const bundled = path.join(root, 'node_modules', '@foundry-rs', 'dist', filename);
  if (existsSync(bundled)) binary = bundled;
  else {
    console.error('Foundry binary missing. Run npm install with optional dependencies enabled.');
    process.exit(1);
  }
}
if (command === 'coverage' && !existsSync(path.join(root, 'foundry.toml'))) {
  console.error('Root foundry.toml required for accurate dependency coverage.');
  process.exit(1);
}
const args = command === 'coverage'
  ? ['coverage', '--root', '.', '--contracts', 'contracts/src', '--out', 'contracts/coverage-out',
      '--cache-path', 'contracts/coverage-cache', '--lib-paths', 'node_modules',
      '--remappings', '@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/',
      '--ir-minimum', '--exclude-tests']
  : command === 'build'
    ? ['build', '--root', 'contracts', '--skip', 'test']
    : ['test', '--root', 'contracts'];
// Coverage's source analyser requires dependencies within the project root.
const env = command === 'coverage'
  ? { ...process.env, FOUNDRY_TEST: 'contracts/test', FORGE_ALLOW_FAILURE: 'false' }
  : { ...process.env, FORGE_ALLOW_FAILURE: 'false' };
const result = spawnSync(binary, args, { cwd: root, env, stdio: 'inherit' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
if (command === 'build') {
  const output = JSON.parse(readFileSync(path.join(root, 'contracts/out/AgentTreasury.sol/AgentTreasury.json'), 'utf8'));
  const metadata = typeof output.metadata === 'string' ? JSON.parse(output.metadata) : output.metadata;
  const artifact = {
    contractName: 'AgentTreasury',
    abi: output.abi,
    bytecode: output.bytecode.object,
    deployedBytecode: output.deployedBytecode.object,
    compiler: metadata?.compiler?.version ?? '0.8.24',
    evmVersion: 'shanghai',
  };
  mkdirSync(path.join(root, 'contracts/artifacts'), { recursive: true });
  writeFileSync(path.join(root, 'contracts/artifacts/AgentTreasury.json'), JSON.stringify(artifact, null, 2) + '\n');
  console.log('AgentPay vault artifact exported');
}
