import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
if (!Number.isInteger(config.step) || config.step < 2) {
  throw new Error('2단계부터는 메모를 Supabase notes 테이블에 두고 공개 data.json을 만들지 않습니다.');
}
await mkdir(resolve(root, 'public'), { recursive: true });
// Never clear public/ as a whole: it holds index.html and aleph.json.
await rm(resolve(root, 'public', 'data.json'), { force: true });
console.log('공개 data.json을 만들지 않습니다. 메모는 Supabase notes 테이블에 있습니다.');
const allowedRoutes = config.allowedRoutes;
if (config.step >= 3 && (!Array.isArray(allowedRoutes) || !allowedRoutes.length
    || allowedRoutes.some(route => typeof route !== 'string' || !/^(GET|POST|PUT|PATCH|DELETE) \/api\/\S+$/u.test(route)))) {
  throw new Error('3단계부터 aleph.config.json의 allowedRoutes에 "메서드 /api/경로" 형식의 허용 경로가 하나 이상 필요합니다.');
}
const originalApiUrl = config.originalApiUrl;
if (config.step >= 5 && (typeof originalApiUrl !== 'string'
    || !/^https:\/\/[^\s?#@]+$/u.test(originalApiUrl))) {
  throw new Error('5단계부터 aleph.config.json의 originalApiUrl에 쿼리·비밀값 없는 https 경로가 필요합니다.');
}
if (!process.argv.includes('--local')) {
  const identity = deploymentIdentity(process.env, config);
  const published = config.step >= 5 ? { ...identity, allowedRoutes, originalApiUrl }
    : config.step >= 3 ? { ...identity, allowedRoutes } : identity;
  await writeFile(resolve(root, 'public', 'aleph.json'),
    `${JSON.stringify(published, null, 2)}\n`, 'utf8');
  console.log('배포 저장소·커밋·주소와 허용 경로를 public/aleph.json에 기록했습니다.');
}
